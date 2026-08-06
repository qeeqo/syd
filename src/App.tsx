import { useEffect, useRef, useState } from "react";
import { useRenderer, useKeyboard } from "@opentui/react";
import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";
import SessionPicker from "./components/sessionPicker";
import HelpPopup from "./components/helpPopup";
import ProviderPicker from "./components/providerPicker";
import ApiKeyPrompt from "./components/apiKeyPrompt";
import ChatGPTLoginPrompt from "./components/chatGPTLoginPrompt";
import ApprovalPrompt from "./components/approvalPrompt";
import ModelPicker from "./components/modelPicker";
import McpToolsPopup, { type McpServerView } from "./components/mcpToolsPopup";
import SettingsPopup, { type SettingItem } from "./components/settingsPopup";
import SkillsPopup from "./components/skillsPopup";
import AskUserPopup from "./components/askUserPopup";
import { saveApiKey, verifyApiKey, saveChatGPTTokens } from "./auth";
import { startChatGPTLogin, openUrl, verifyChatGPTAccess } from "./oauth";
import { copyToClipboard } from "./clipboard";
import { providers, providerList, isProviderId, hasApiKey } from "./providers";
import type { Provider, ProviderId } from "./providers";
import { primeModels, reasoningDescriptions } from "./models";
import {
  REASONING_LEVELS,
  isReasoningLevel,
  type ReasoningLevel,
} from "./reasoning";
import { dispatch } from "./commands/registry";
import { streamChat, type ApprovalRequest } from "./chat";
import { describeToolEvent } from "./tools";
import {
  createSession,
  findSessionsByIdPrefix,
  listSessions,
  saveSession,
} from "./session";
import type { Session } from "./session";
import {
  configPath,
  loadConfig,
  saveMcpServer,
  removeMcpServerFromConfig,
  saveSettings,
  saveSkill,
  removeSkillFromConfig,
  saveTheme,
  type Config,
} from "./config";
import { resolveTheme } from "./theme";
import { ThemeProvider } from "./components/themeContext";
import ThemePicker from "./components/themePicker";
import ReasoningPicker from "./components/reasoningPicker";
import { findMentionedSkills, type Skill } from "./skills";
import type { AskUserRequest } from "./tools";
import {
  connectMcpServers,
  closeMcpClients,
  emptyMcpRuntime,
  type McpRuntime,
  type McpServerConfig,
} from "./mcp";
import { loginMcpServer } from "./mcpOAuth";
import type { CommandContext, Message } from "./commands/type";

// Committing per token re-parses the markdown and re-pins the sticky scroll on
// every token, which makes long replies lag and jump. Coalesce to ~30fps.
const DELTA_FLUSH_MS = 33;

type AppProps = {
  config: Config;
  configWarnings?: string[];
};

export default function App({ config, configWarnings = [] }: AppProps) {
  const renderer = useRenderer();
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [messages, setMessages] = useState<Message[]>(() =>
    configWarnings.map((content) => ({
      role: "system",
      content,
      tone: "warn",
    })),
  );
  const [provider, setProvider] = useState<ProviderId>(config.provider);
  const [model, setModel] = useState(config.model);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pickerSessions, setPickerSessions] = useState<Session[] | null>(null);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [keyPrompt, setKeyPrompt] = useState<Provider | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [themeName, setThemeName] = useState(config.theme);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [reasoningPickerOpen, setReasoningPickerOpen] = useState(false);
  const reasoningFromModelPicker = useRef(false);
  const themeBeforePreview = useRef(config.theme);
  const [approval, setApproval] = useState<{
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
  } | null>(null);
  // The ref mirrors the state so the streaming approval closure reads the live
  // value even when the mode is toggled mid-turn.
  const [autoApprove, setAutoApproveState] = useState(config.autoApprove);
  const autoApproveRef = useRef(config.autoApprove);
  const [shellEnabled, setShellEnabledState] = useState(config.shellEnabled);
  const [reasoning, setReasoningState] = useState(config.reasoning);
  // The ref mirrors the state so a skill tool sees edits made earlier in the
  // same turn (setState is async).
  const [skills, setSkills] = useState<Skill[]>(config.skills);
  const skillsRef = useRef<Skill[]>(config.skills);
  // The resolver is a ref, not state, so the turn's finally can settle a
  // still-pending question without a second render or a double-resolve.
  const [askUserReq, setAskUserReq] = useState<AskUserRequest | null>(null);
  const askUserResolve = useRef<((answer: string) => void) | null>(null);
  const [mcp, setMcp] = useState<McpRuntime>(emptyMcpRuntime);
  const [mcpServers, setMcpServers] = useState(config.mcpServers);
  // Two concurrent reload/login runs would race the client list.
  const mcpBusy = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingDelta = useRef("");
  const flushHandle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gates both the input's focus and Escape-to-cancel: an open popup owns the
  // keyboard, and its own Escape must win over turn cancellation.
  const overlayOpen =
    pickerSessions !== null ||
    providerPickerOpen ||
    keyPrompt !== null ||
    helpOpen ||
    mcpToolsOpen ||
    settingsOpen ||
    skillsOpen ||
    modelPickerOpen ||
    themePickerOpen ||
    reasoningPickerOpen ||
    approval !== null ||
    askUserReq !== null;

  useKeyboard((key) => {
    if (key.name === "escape" && isStreaming && !overlayOpen) {
      key.preventDefault();
      abortRef.current?.abort();
    }
  });

  const metaRef = useRef<Session | null>(null);
  metaRef.current ??= createSession(provider, model);

  // Warm the model cache so the first /model open is instant. Fire-and-forget;
  // a failure just falls back to fetching on open.
  useEffect(() => {
    if (hasApiKey(providers[provider])) primeModels(provider);
    // Intentionally run once for the initial provider only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect in the background: a slow or unreachable server can take 20s, and
  // blocking here would hold up the first paint.
  useEffect(() => {
    const names = Object.keys(config.mcpServers);
    if (names.length === 0) return;
    let cancelled = false;
    void connectMcpServers(config.mcpServers).then((runtime) => {
      // Unmounted before the connect settled — close the orphaned clients so
      // no socket or subprocess leaks.
      if (cancelled) {
        void closeMcpClients(runtime.clients);
        return;
      }
      setMcp(runtime);
      // Quiet on success, so a clean startup keeps the home banner. A warning is
      // the only on-screen signal that tools are missing.
      if (runtime.warnings.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...runtime.warnings.map((content) => ({
            role: "system" as const,
            content,
            tone: "warn" as const,
          })),
        ]);
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once on mount for the startup server set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  // Report a save failure once, not on every retriggered save.
  const saveFailed = useRef(false);
  // Survives the key-paste detour, so provider → model stays one flow.
  const openModelAfterProvider = useRef(false);

  function buildSession(msgs: Message[]): Session {
    const meta = metaRef.current!;
    return {
      id: meta.id,
      title: sessionTitle,
      provider,
      model,
      messages: msgs,
      cwd: meta.cwd,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
    };
  }

  useEffect(() => {
    if (isStreaming) return;
    // Command-only activity (/help, a /rename before any chat) isn't worth a
    // file, so it never touches disk.
    if (!messages.some((m) => m.role !== "system")) return;
    pendingSave.current = saveSession(buildSession(messages))
      .then(() => {
        saveFailed.current = false;
      })
      .catch((err) => {
        if (saveFailed.current) return;
        saveFailed.current = true;
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `failed to save session: ${msg}`,
            tone: "error",
          },
        ]);
      });
    // buildSession only reads state already listed here (plus stable refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionTitle, provider, model, isStreaming]);

  // Swapping the tool set mid-turn would pull tools out from under an in-flight
  // call.
  function mcpGuard(): boolean {
    if (isStreaming) {
      ctx.addSystemMessage("wait for the current response to finish", "warn");
      return false;
    }
    if (mcpBusy.current) {
      ctx.addSystemMessage("an MCP operation is already in progress", "warn");
      return false;
    }
    return true;
  }

  // Callers own the mcpGuard() check and the mcpBusy flag.
  async function reconnectMcp(): Promise<McpRuntime> {
    const { config: fresh, warnings } = await loadConfig();
    for (const w of warnings) ctx.addSystemMessage(w, "warn");
    await closeMcpClients(mcp.clients);
    const next = await connectMcpServers(fresh.mcpServers);
    setMcp(next);
    setMcpServers(fresh.mcpServers);
    for (const w of next.warnings) ctx.addSystemMessage(w, "warn");
    return next;
  }

  async function persistSkill(
    skill: Skill,
    previousName?: string | null,
  ): Promise<void> {
    await saveSkill(skill);
    if (previousName && previousName !== skill.name) {
      await removeSkillFromConfig(previousName).catch(() => {});
    }
    const rest = skillsRef.current.filter(
      (s) => s.name !== skill.name && s.name !== previousName,
    );
    const next = [...rest, skill].sort((a, b) => a.name.localeCompare(b.name));
    skillsRef.current = next;
    setSkills(next);
  }

  async function removeSkill(name: string): Promise<boolean> {
    const removed = await removeSkillFromConfig(name);
    // Purge from live state even when disk reported "not there", so a drift
    // between the two self-heals instead of leaving an unremovable row.
    // `removed` still reflects the disk result for the model tool's reply.
    if (skillsRef.current.some((s) => s.name === name)) {
      const next = skillsRef.current.filter((s) => s.name !== name);
      skillsRef.current = next;
      setSkills(next);
    }
    return removed;
  }

  function requestUserAnswer(request: AskUserRequest): Promise<string> {
    return new Promise((resolve) => {
      askUserResolve.current = resolve;
      setAskUserReq(request);
    });
  }

  function settleUserAnswer(answer: string) {
    const resolve = askUserResolve.current;
    askUserResolve.current = null;
    setAskUserReq(null);
    resolve?.(answer);
  }

  const skillActions = {
    save: (skill: Skill) => persistSkill(skill),
    remove: (name: string) => removeSkill(name),
    list: () => skillsRef.current,
  };

  const ctx: CommandContext = {
    addSystemMessage: (text, tone) =>
      setMessages((prev) => [...prev, { role: "system", content: text, tone }]),
    newSession: () => {
      // In-flight deltas would append onto the wrong transcript.
      if (isStreaming) {
        ctx.addSystemMessage("wait for the current response to finish", "warn");
        return;
      }
      setSessionTitle("New Chat");
      setMessages([]);
      // New id/timestamps, so it saves to a fresh file.
      metaRef.current = createSession(provider, model);
    },
    resumeSession: async (id) => {
      if (isStreaming) {
        ctx.addSystemMessage("wait for the current response to finish", "warn");
        return;
      }

      // Only sessions started in THIS directory are offered.
      const cwd = process.cwd();

      if (!id) {
        const sessions = await listSessions(cwd);
        if (sessions.length === 0) {
          ctx.addSystemMessage(
            "no sessions to resume in this directory",
            "warn",
          );
          return;
        }
        setPickerSessions(sessions);
        return;
      }

      const matches = await findSessionsByIdPrefix(id, cwd);
      if (matches.length === 0) {
        ctx.addSystemMessage(
          `no session matching "${id}" in this directory`,
          "warn",
        );
        return;
      }
      if (matches.length > 1) {
        ctx.addSystemMessage(
          `"${id}" matches ${matches.length} sessions — add more characters`,
          "warn",
        );
        return;
      }
      applySession(matches[0]);
    },
    setSessionTitle: (title) => setSessionTitle(title),
    setModel: (next) => {
      if (!next) {
        setModelPickerOpen(true);
        return;
      }
      setModel(next);
      ctx.addSystemMessage(`model set to ${next}`);
    },
    setAutoApprove: (auto) => {
      autoApproveRef.current = auto;
      setAutoApproveState(auto);
    },
    toggleAutoApprove: () => ctx.setAutoApprove(!autoApproveRef.current),
    setProvider: (id) => {
      if (!id) {
        setProviderPickerOpen(true);
        return;
      }
      const normalized = id.toLowerCase();
      if (!isProviderId(normalized)) {
        ctx.addSystemMessage(
          `unknown provider: ${id} (valid: ${providerList
            .map((p) => p.id)
            .join(", ")})`,
          "error",
        );
        return;
      }
      applyProvider(providers[normalized]);
    },
    setReasoning: (level) => {
      if (!level) {
        reasoningFromModelPicker.current = false;
        setReasoningPickerOpen(true);
        return;
      }
      const normalized = level.trim().toLowerCase();
      if (!isReasoningLevel(normalized)) {
        ctx.addSystemMessage(
          `unknown thinking level: ${level} (valid: ${REASONING_LEVELS.join(", ")})`,
          "error",
        );
        return;
      }
      applyReasoning(normalized);
    },
    showHelp: () => setHelpOpen(true),
    showSettings: () => setSettingsOpen(true),
    showSkills: () => setSkillsOpen(true),
    showTheme: () => {
      // The picker live-previews as you scroll; remember what to revert to.
      themeBeforePreview.current = themeName;
      setThemePickerOpen(true);
    },
    showMcpTools: () => {
      if (Object.keys(mcpServers).length === 0) {
        ctx.addSystemMessage(
          `no MCP servers configured — add them under "mcpServers" in ${configPath()}`,
          "warn",
        );
        return;
      }
      setMcpToolsOpen(true);
    },
    reloadMcp: async () => {
      if (!mcpGuard()) return;
      mcpBusy.current = true;
      ctx.addSystemMessage("reloading MCP servers…");
      try {
        const next = await reconnectMcp();
        ctx.addSystemMessage(
          `MCP reloaded — ${next.clients.length} server${next.clients.length === 1 ? "" : "s"} connected, ${Object.keys(next.tools).length} tool${Object.keys(next.tools).length === 1 ? "" : "s"}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`MCP reload failed: ${msg}`, "error");
      } finally {
        mcpBusy.current = false;
      }
    },
    loginMcp: async (server) => {
      const cfg = mcpServers[server];
      if (!cfg) {
        ctx.addSystemMessage(
          `unknown MCP server "${server}" (configured: ${Object.keys(mcpServers).join(", ") || "none"})`,
          "error",
        );
        return;
      }
      if (!("url" in cfg) || cfg.auth !== "oauth") {
        ctx.addSystemMessage(
          `"${server}" is not an OAuth server — login only applies to servers with "auth": "oauth"`,
          "error",
        );
        return;
      }
      if (!mcpGuard()) return;
      mcpBusy.current = true;
      ctx.addSystemMessage(`opening browser to sign in to "${server}"…`);
      try {
        await loginMcpServer(server, cfg.url, (url) => {
          // Safe to print: no secret in the URL, PKCE protects the exchange.
          ctx.addSystemMessage(`if your browser didn't open, visit:\n${url}`);
        });
        ctx.addSystemMessage(`signed in to "${server}" — reconnecting…`);
        const next = await reconnectMcp();
        const count = Object.keys(next.tools).filter((t) =>
          t.startsWith(`${server}__`),
        ).length;
        ctx.addSystemMessage(
          `"${server}" ready — ${count} tool${count === 1 ? "" : "s"} available`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`login to "${server}" failed: ${msg}`, "error");
      } finally {
        mcpBusy.current = false;
      }
    },
    addMcpServer: async (name, url, oauth) => {
      // Tools are keyed `<name>__<tool>`, so "__" in a name corrupts the keys.
      if (name.includes("__")) {
        ctx.addSystemMessage('server name cannot contain "__"', "error");
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        ctx.addSystemMessage(`not a valid URL: ${url}`, "error");
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addSystemMessage(
          "url must be http(s) — /mcp-add is for HTTP servers",
          "error",
        );
        return;
      }
      if (name in mcpServers) {
        ctx.addSystemMessage(
          `"${name}" already exists — /mcp-remove ${name} first to replace it`,
          "error",
        );
        return;
      }
      if (!mcpGuard()) return;
      mcpBusy.current = true;
      try {
        const server: McpServerConfig = oauth
          ? { transport: "http", url, auth: "oauth" }
          : { transport: "http", url };
        await saveMcpServer(name, server);
        ctx.addSystemMessage(
          `added MCP server "${name}"${oauth ? " (OAuth)" : ""} — connecting…`,
        );
        const next = await reconnectMcp();
        if (oauth) {
          ctx.addSystemMessage(
            `"${name}" uses OAuth — run /mcp-login ${name} to sign in`,
          );
        } else {
          const count = Object.keys(next.tools).filter((t) =>
            t.startsWith(`${name}__`),
          ).length;
          ctx.addSystemMessage(
            count > 0
              ? `"${name}" ready — ${count} tool${count === 1 ? "" : "s"}`
              : `"${name}" added but exposed no tools (see warnings above)`,
            count > 0 ? undefined : "warn",
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`adding "${name}" failed: ${msg}`, "error");
      } finally {
        mcpBusy.current = false;
      }
    },
    removeMcpServer: async (name) => {
      if (!mcpGuard()) return;
      mcpBusy.current = true;
      try {
        const removed = await removeMcpServerFromConfig(name);
        if (!removed) {
          ctx.addSystemMessage(`no MCP server "${name}" in config`, "warn");
          return;
        }
        ctx.addSystemMessage(`removed MCP server "${name}" — reconnecting…`);
        await reconnectMcp();
        ctx.addSystemMessage(`"${name}" removed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`removing "${name}" failed: ${msg}`, "error");
      } finally {
        mcpBusy.current = false;
      }
    },
    copyLastResponse: async () => {
      // A mid-stream copy would grab a half-finished response.
      if (isStreaming) {
        ctx.addSystemMessage("wait for the current response to finish", "warn");
        return;
      }
      // One response can span several bubbles (text split around tool calls),
      // so collect back to the last user turn rather than taking the last one.
      const parts: string[] = [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === "user") break;
        if (m.role === "assistant" && m.content.length > 0) {
          parts.unshift(m.content);
        }
      }
      const lastResponse = parts.join("\n\n");
      if (!lastResponse) {
        ctx.addSystemMessage("no response to copy yet", "warn");
        return;
      }
      try {
        await copyToClipboard(lastResponse);
        ctx.addSystemMessage(
          `copied last response to clipboard (${lastResponse.length} chars)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`copy failed: ${msg}`, "error");
      }
    },
    exit: () => {
      void (async () => {
        // process.exit would cut off an in-flight save and lose the last change.
        await pendingSave.current.catch(() => {});
        // Capped: quitting shouldn't wait on a sluggish server, and process.exit
        // reclaims anything still open.
        await closeMcpClients(mcp.clients, 1_000);
        renderer.destroy();
        process.exit(0);
      })();
    },
  };

  function applyProvider(next: Provider) {
    if (!hasApiKey(next)) {
      // handleKeySubmit re-applies once the key lands.
      setKeyPrompt(next);
      return;
    }
    const flowingToModelPicker = openModelAfterProvider.current;
    if (next.id !== provider) {
      setProvider(next.id);
      // The old provider's model id is meaningless here.
      setModel(next.defaultModel);
      // In the picker flow the model picker opening is already the feedback.
      if (!flowingToModelPicker) {
        ctx.addSystemMessage(
          `provider set to ${next.label} (${next.defaultModel})`,
        );
      }
    }
    if (flowingToModelPicker) {
      openModelAfterProvider.current = false;
      setModelPickerOpen(true);
    }
  }

  // Returns an error string (prompt stays open and shows it) or null on success.
  async function handleKeySubmit(
    target: Provider,
    key: string,
  ): Promise<string | null> {
    // Also narrows the union so target.envVar below is well-typed.
    if (target.auth !== "api-key") return `${target.label} does not use a key`;
    const verdict = await verifyApiKey(target, key);
    if (verdict === "invalid") {
      return `${target.label} rejected this key — check it and try again`;
    }
    if (verdict === "unreachable") {
      return `could not reach ${target.label} to verify — check your connection and retry`;
    }
    try {
      await saveApiKey(target.envVar, key);
    } catch (err) {
      // fs message only — never echo the key itself.
      const msg = err instanceof Error ? err.message : String(err);
      return `verified, but saving failed: ${msg}`;
    }
    setKeyPrompt(null);
    ctx.addSystemMessage(`API key verified and saved for ${target.label}`);
    primeModels(target.id);
    applyProvider(target);
    return null;
  }

  // Returns an error string (prompt stays open and shows it) or null on success.
  async function handleOAuthLogin(target: Provider): Promise<string | null> {
    try {
      const { url, result } = await startChatGPTLogin();
      openUrl(url);
      // Safe to print: no secret in the URL, PKCE protects it.
      ctx.addSystemMessage(`if your browser didn't open, visit:\n${url}`);
      await saveChatGPTTokens(await result);
    } catch (err) {
      // Flow/fetch message only — never echo token values.
      return err instanceof Error ? err.message : String(err);
    }
    setKeyPrompt(null);
    ctx.addSystemMessage(`signed in to ${target.label}`);
    // Fail loudly here rather than on the user's first prompt. Not a block —
    // auth succeeded, and they can pick another model in the picker that follows.
    const problem = await verifyChatGPTAccess(target.defaultModel);
    if (problem) {
      ctx.addSystemMessage(
        `heads up: a test call with ${target.defaultModel} was rejected — ${problem}. Try another model via /model.`,
        "warn",
      );
    }
    applyProvider(target);
    return null;
  }

  // An approved change traces itself via the tool-result note; a denial doesn't.
  function handleApprovalDecision(approved: boolean) {
    if (!approval) return;
    approval.resolve(approved);
    setApproval(null);
    if (!approved) {
      const label = approval.request.note?.label ?? approval.request.tool;
      insertDuringStream({
        role: "system",
        content: `declined: ${label}`,
        tone: "warn",
      });
    }
  }

  function applySession(session: Session) {
    setSessionTitle(session.title);
    setProvider(session.provider);
    setModel(session.model);
    setMessages(session.messages);
    metaRef.current = session;
  }

  // Called by the flush timer, before any mid-stream insert, and once at turn
  // settle, so coalescing never drops or reorders text.
  function flushDelta() {
    if (flushHandle.current !== null) {
      clearTimeout(flushHandle.current);
      flushHandle.current = null;
    }
    const chunk = pendingDelta.current;
    if (chunk.length === 0) return;
    pendingDelta.current = "";
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + chunk },
        ];
      }
      return [...prev, { role: "assistant", content: chunk }];
    });
  }

  // Keeps mid-stream entries in chronological order: the note lands after what
  // the model has said so far, and a fresh placeholder re-opens below it so
  // later text continues underneath rather than stacking above.
  function insertDuringStream(msg: Message) {
    // Land buffered text on the current bubble before the note splits it.
    flushDelta();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      const base =
        last && last.role === "assistant" && last.content.length === 0
          ? prev.slice(0, -1)
          : prev;
      return [...base, msg, { role: "assistant", content: "" }];
    });
  }

  async function handleSubmit(message: string) {
    if (dispatch(message, ctx)) return;

    // Injected into the system prompt for this turn only, never sticky.
    const invokedSkills = findMentionedSkills(message, skills);

    const userMsg: Message = { role: "user", content: message };
    // Collapse consecutive assistant bubbles (one turn split around tool notes)
    // back into one message — some providers reject same-role runs.
    const history = [...messages, userMsg]
      .filter((m) => m.role !== "system" && m.content.length > 0)
      .reduce<Message[]>((acc, m) => {
        const prev = acc[acc.length - 1];
        if (prev && prev.role === m.role) {
          acc[acc.length - 1] = {
            ...prev,
            content: `${prev.content}\n\n${m.content}`,
          };
          return acc;
        }
        acc.push(m);
        return acc;
      }, []);

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    try {
      await streamChat({
        provider,
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
        mcpTools: mcp.tools,
        mcpGated: mcp.gated,
        shellEnabled,
        reasoning,
        skills: invokedSkills,
        onAskUser: requestUserAnswer,
        skillActions,
        abortSignal: controller.signal,
        onDelta: (delta) => {
          pendingDelta.current += delta;
          if (flushHandle.current === null) {
            flushHandle.current = setTimeout(flushDelta, DELTA_FLUSH_MS);
          }
        },
        onToolEvent: (evt) => {
          const note = describeToolEvent(evt);
          insertDuringStream({
            role: "system",
            content: note.label,
            toolNote: note,
          });
        },
        onApprovalRequest: (request) =>
          // runCommand always prompts, even under auto-approve: auto-applying a
          // diff you can see is one thing, silently running arbitrary shell (no
          // path containment) is a far bigger blast radius.
          autoApproveRef.current && request.tool !== "runCommand"
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
                setApproval({ request, resolve });
              }),
      });
    } catch (err) {
      // A cancel can throw AbortError instead of ending cleanly — not a failure
      // to report; the finally block leaves the "cancelled" note.
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`error: ${msg}`, "error");
      }
    } finally {
      const cancelled = controller.signal.aborted;
      abortRef.current = null;
      // Settle a question left parked by an errored turn, so its tool promise
      // never dangles and no ghost popup lingers.
      if (askUserResolve.current) {
        settleUserAnswer("(the question was cancelled)");
      }
      // Nothing stranded in the buffer when the markdown re-parses.
      flushDelta();
      setIsStreaming(false);
      // A turn ending on a tool call re-opened an empty placeholder, which
      // would render as a bare "syd" header.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && last.content.length === 0
          ? prev.slice(0, -1)
          : prev;
      });
      // So a cancelled turn reads as deliberate, not as output that stopped.
      if (cancelled) {
        ctx.addSystemMessage("response cancelled", "warn");
      }
    }
  }

  // Clears the flag either way, so the next open can't inherit a stale handoff.
  function closeReasoningPicker() {
    const backToModels = reasoningFromModelPicker.current;
    reasoningFromModelPicker.current = false;
    setReasoningPickerOpen(false);
    if (backToModels) setModelPickerOpen(true);
  }

  // A save failure is surfaced but doesn't roll back — the level still applies
  // this session.
  function applyReasoning(next: ReasoningLevel, announce = true) {
    setReasoningState(next);
    if (announce) ctx.addSystemMessage(`thinking set to ${next}`);
    void saveSettings({ reasoning: next }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`failed to save settings: ${msg}`, "error");
    });
  }

  // A save failure is surfaced but doesn't roll back — the setting still
  // applies this session.
  function toggleSetting(key: string) {
    const reportSaveError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`failed to save settings: ${msg}`, "error");
    };
    if (key === "shell") {
      const next = !shellEnabled;
      setShellEnabledState(next);
      void saveSettings({ shellEnabled: next }).catch(reportSaveError);
    } else if (key === "autoApprove") {
      const next = !autoApproveRef.current;
      autoApproveRef.current = next;
      setAutoApproveState(next);
      void saveSettings({ autoApprove: next }).catch(reportSaveError);
    } else if (key === "reasoning") {
      // A choice, not a toggle: step forward through the scale and wrap. No
      // system note — the popup row already shows the new value.
      const levels = REASONING_LEVELS;
      const next = levels[(levels.indexOf(reasoning) + 1) % levels.length];
      applyReasoning(next, false);
    }
  }

  // Built from live state, so the popup re-renders on every change.
  const settingItems: SettingItem[] = [
    {
      kind: "toggle",
      key: "shell",
      label: "Shell commands",
      description:
        "Let syd run shell commands (lint, tests, build). Each command still " +
        "asks for your approval before it runs — even with auto-approve on.",
      value: shellEnabled,
    },
    {
      kind: "toggle",
      key: "autoApprove",
      label: "Auto-approve edits",
      description:
        "Apply file edits and MCP tool calls without a confirmation popup. " +
        "Shell commands always ask regardless. Off is safer.",
      value: autoApprove,
    },
    {
      kind: "choice",
      key: "reasoning",
      label: "Thinking",
      description:
        'How hard the model reasons before answering. "default" sends no ' +
        "setting at all, letting each model use its own — the only value " +
        "guaranteed safe on models with no reasoning support.",
      value: reasoning,
      options: REASONING_LEVELS,
    },
  ];

  function buildMcpViews(): McpServerView[] {
    const toolsByServer = new Map<string, McpServerView["tools"]>();
    for (const [key, def] of Object.entries(mcp.tools)) {
      const sep = key.indexOf("__");
      if (sep === -1) continue;
      const owner = key.slice(0, sep);
      const description =
        typeof (def as { description?: unknown }).description === "string"
          ? (def as { description: string }).description
          : "";
      const list = toolsByServer.get(owner) ?? [];
      list.push({ name: key.slice(sep + 2), description });
      toolsByServer.set(owner, list);
    }
    return Object.keys(mcpServers).map((name) => {
      const cfg = mcpServers[name];
      const where =
        "url" in cfg ? `${cfg.transport} ${cfg.url}` : `stdio ${cfg.command}`;
      const tools = (toolsByServer.get(name) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return {
        name,
        where,
        trust: cfg.trust ?? "prompt",
        connected: tools.length > 0,
        tools,
      };
    });
  }

  const theme = resolveTheme(themeName);

  return (
    <ThemeProvider tokens={theme.tokens}>
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        backgroundColor={theme.tokens.appBg}
      >
        <ChatMain messages={messages} streaming={isStreaming} model={model} />
        <ChatInputBox
          title={sessionTitle}
          model={model}
          reasoning={reasoning}
          autoApprove={autoApprove}
          shellEnabled={shellEnabled}
          skills={skills}
          focused={!overlayOpen}
          onSubmit={handleSubmit}
        />
        {/* Absolute so a popup floats above the chat without reflowing it. */}
        {pickerSessions && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <SessionPicker
              sessions={pickerSessions}
              onSelect={(session) => {
                setPickerSessions(null);
                applySession(session);
              }}
              onDismiss={() => setPickerSessions(null)}
            />
          </box>
        )}
        {providerPickerOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <ProviderPicker
              current={provider}
              onSelect={(next) => {
                setProviderPickerOpen(false);
                openModelAfterProvider.current = true;
                applyProvider(next);
              }}
              onDismiss={() => {
                openModelAfterProvider.current = false;
                setProviderPickerOpen(false);
              }}
            />
          </box>
        )}
        {helpOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <HelpPopup onDismiss={() => setHelpOpen(false)} />
          </box>
        )}
        {mcpToolsOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <McpToolsPopup
              servers={buildMcpViews()}
              onDismiss={() => setMcpToolsOpen(false)}
            />
          </box>
        )}
        {settingsOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <SettingsPopup
              items={settingItems}
              onToggle={toggleSetting}
              onDismiss={() => setSettingsOpen(false)}
            />
          </box>
        )}
        {skillsOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <SkillsPopup
              skills={skills}
              onSave={(skill, previousName) => {
                void persistSkill(skill, previousName).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  ctx.addSystemMessage(`failed to save skill: ${msg}`, "error");
                });
              }}
              onDelete={(name) => {
                void removeSkill(name).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  ctx.addSystemMessage(
                    `failed to delete skill: ${msg}`,
                    "error",
                  );
                });
              }}
              onDismiss={() => setSkillsOpen(false)}
            />
          </box>
        )}
        {askUserReq && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <AskUserPopup
              request={askUserReq}
              onAnswer={settleUserAnswer}
              onDismiss={() =>
                settleUserAnswer(
                  "(the user dismissed the question without answering)",
                )
              }
            />
          </box>
        )}
        {keyPrompt && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            {keyPrompt.auth === "oauth" ? (
              <ChatGPTLoginPrompt
                provider={keyPrompt}
                onLogin={() => handleOAuthLogin(keyPrompt)}
                onCancel={() => {
                  openModelAfterProvider.current = false;
                  setKeyPrompt(null);
                }}
              />
            ) : (
              <ApiKeyPrompt
                provider={keyPrompt}
                onSubmit={(key) => handleKeySubmit(keyPrompt, key)}
                onCancel={() => {
                  openModelAfterProvider.current = false;
                  setKeyPrompt(null);
                }}
              />
            )}
          </box>
        )}
        {modelPickerOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <ModelPicker
              provider={providers[provider]}
              current={model}
              onSelect={(next) => {
                setModelPickerOpen(false);
                ctx.setModel(next);
              }}
              onSwitchProvider={() => {
                setModelPickerOpen(false);
                setProviderPickerOpen(true);
              }}
              reasoning={reasoning}
              onSwitchReasoning={() => {
                setModelPickerOpen(false);
                reasoningFromModelPicker.current = true;
                setReasoningPickerOpen(true);
              }}
              onClose={() => setModelPickerOpen(false)}
            />
          </box>
        )}
        {reasoningPickerOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <ReasoningPicker
              current={reasoning}
              returnsToModels={reasoningFromModelPicker.current}
              descriptions={reasoningDescriptions(provider, model)}
              onSelect={(next) => {
                const announce = !reasoningFromModelPicker.current;
                closeReasoningPicker();
                applyReasoning(next, announce);
              }}
              onDismiss={closeReasoningPicker}
            />
          </box>
        )}
        {themePickerOpen && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <ThemePicker
              current={themeBeforePreview.current}
              onHighlight={(name) => setThemeName(name)}
              onSelect={(name) => {
                setThemePickerOpen(false);
                setThemeName(name);
                void saveTheme(name).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  ctx.addSystemMessage(`failed to save theme: ${msg}`, "error");
                });
              }}
              onDismiss={() => {
                setThemeName(themeBeforePreview.current);
                setThemePickerOpen(false);
              }}
            />
          </box>
        )}
        {approval && (
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
          >
            <ApprovalPrompt
              request={approval.request}
              onDecide={handleApprovalDecision}
              onApproveAll={() => {
                ctx.setAutoApprove(true);
                handleApprovalDecision(true);
              }}
            />
          </box>
        )}
      </box>
    </ThemeProvider>
  );
}
