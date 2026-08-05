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
import { primeModels } from "./models";
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

// How often buffered stream tokens are committed to the transcript (~30fps).
// Tokens arrive faster than this; coalescing them to a steady frame cadence
// keeps the markdown re-parse and sticky-scroll re-pin from firing per token,
// which is what made long, fast replies lag and jump. Small enough that text
// still reads as live streaming.
const DELTA_FLUSH_MS = 33;

type AppProps = {
  // Resolved startup config (from ~/.sydcli/config.json, defaults filled in)
  // and any warnings from parsing it, surfaced as opening system messages.
  config: Config;
  configWarnings?: string[];
};

export default function App({ config, configWarnings = [] }: AppProps) {
  const renderer = useRenderer();
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  // Seed the transcript with any config-parse warnings so a bad config.json is
  // visible on launch. The MCP connect runs silently in the background (see the
  // effect below) — no "connecting…" line — so a clean startup keeps the home
  // banner (chatMain shows it only while messages is empty) instead of MCP
  // status chatter. These are system messages, so the save effect ignores them:
  // a warning alone never writes a session file.
  const [messages, setMessages] = useState<Message[]>(() =>
    configWarnings.map((content) => ({ role: "system", content })),
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
  // Active color theme id (see theme.ts). Drives the whole UI's palette via the
  // ThemeProvider below. `themePickerOpen` shows the picker; `themeBeforePreview`
  // remembers what to revert to if the picker is dismissed after live-previewing.
  const [themeName, setThemeName] = useState(config.theme);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const themeBeforePreview = useRef(config.theme);
  const [approval, setApproval] = useState<{
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
  } | null>(null);
  // Approval mode. Default manual (confirm each write) — the diff preview is
  // what guards against wrong-file / oversized edits. The ref mirrors the
  // state so the streaming closure reads the live value even if the mode is
  // toggled mid-turn; the state drives the input-box indicator.
  const [autoApprove, setAutoApproveState] = useState(config.autoApprove);
  const autoApproveRef = useRef(config.autoApprove);
  // Whether syd may run shell commands (the runCommand tool). Off by default;
  // toggled in /settings, which persists it to config.json. Read at submit time
  // to decide whether the shell tool joins the turn's tool set — it never needs
  // to change mid-turn, so plain state (no ref) is enough.
  const [shellEnabled, setShellEnabledState] = useState(config.shellEnabled);
  // Defined skills (@name → instructions). Drives the @ palette and the /skills
  // manager. The ref mirrors the state so the model's skill tools can read the
  // live list mid-turn (setState is async); persist/remove update both.
  const [skills, setSkills] = useState<Skill[]>(config.skills);
  const skillsRef = useRef<Skill[]>(config.skills);
  // A model-driven askUser question awaiting the user's answer. The resolver is
  // kept in a ref (not state) so the turn's finally can settle a still-pending
  // question without a second render or a double-resolve.
  const [askUserReq, setAskUserReq] = useState<AskUserRequest | null>(null);
  const askUserResolve = useRef<((answer: string) => void) | null>(null);
  // The live MCP runtime (tools/gated/clients) and the server config that
  // produced it. Starts empty and is filled by the background connect on mount
  // (see below); /mcp reload replaces it wholesale — so buildMcpViews,
  // streamChat, and exit always read the current set, not a stale snapshot.
  const [mcp, setMcp] = useState<McpRuntime>(emptyMcpRuntime);
  const [mcpServers, setMcpServers] = useState(config.mcpServers);
  // Guards /mcp reload | login against overlapping runs (each closes and
  // reconnects clients; two at once would race the client list).
  const mcpBusy = useRef(false);
  // Set while a turn is streaming so Escape can abort it (see the useKeyboard
  // handler below); cleared when the turn settles.
  const abortRef = useRef<AbortController | null>(null);
  // Streamed tokens are coalesced here and flushed on a frame-paced timer,
  // not committed one-per-token. Every commit re-lexes the growing trailing
  // markdown block and re-pins the sticky scroll, so a per-token cadence makes
  // long, fast replies lag and jump as blocks reflow. `pendingDelta` holds the
  // text accumulated since the last flush; `flushHandle` is the scheduled timer
  // (null when nothing is pending).
  const pendingDelta = useRef("");
  const flushHandle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True while any popup owns the keyboard. Drives both the input's focus (it
  // must not swallow keys meant for the popup) and the Escape-to-cancel gate
  // (Escape belongs to an open popup, not to turn cancellation).
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
    approval !== null ||
    askUserReq !== null;

  // Escape cancels an in-flight turn. Global keypress handler (fires even while
  // the input is focused), gated so it only acts mid-stream and only when no
  // popup is open — an open popup's own Escape handles dismissal/denial.
  useKeyboard((key) => {
    if (key.name === "escape" && isStreaming && !overlayOpen) {
      key.preventDefault();
      abortRef.current?.abort();
    }
  });

  // Stable per-session metadata (id, cwd, createdAt) that must survive
  // re-renders without triggering them. Lazily created on first render.
  const metaRef = useRef<Session | null>(null);
  metaRef.current ??= createSession(provider, model);

  // Warm the model cache once at startup for the active provider if its key
  // is already present (from a prior session) — makes the first /model open
  // instant. Fire-and-forget; a fetch failure just falls back to on-open.
  useEffect(() => {
    if (hasApiKey(providers[provider])) primeModels(provider);
    // Intentionally run once for the initial provider only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect the configured MCP servers in the BACKGROUND, so the UI drew
  // instantly above instead of waiting on a slow/unreachable server (each
  // connect can take up to 20s). Status and per-server warnings arrive as
  // system messages once the connect settles; until then tools are simply
  // absent. Runs once on mount for the startup server set.
  useEffect(() => {
    const names = Object.keys(config.mcpServers);
    if (names.length === 0) return;
    let cancelled = false;
    void connectMcpServers(config.mcpServers).then((runtime) => {
      // Unmounted (or a double-invoked effect) before the connect settled —
      // close the now-orphaned clients so no socket/subprocess leaks.
      if (cancelled) {
        void closeMcpClients(runtime.clients);
        return;
      }
      setMcp(runtime);
      // Stay quiet on success — no "MCP ready" note — so the home banner
      // survives a clean startup. Only genuine problems (a server that failed,
      // needs login, or a config issue) surface as system messages, since those
      // are the sole on-screen signal that tools are missing; /mcp shows the
      // full per-server state on demand.
      if (runtime.warnings.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...runtime.warnings.map((content) => ({
            role: "system" as const,
            content,
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

  // The most recent disk write — /exit awaits it so a save that's still
  // in flight isn't cut off by process.exit.
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  // Report a save failure once, not on every retriggered save.
  const saveFailed = useRef(false);

  // True while a provider selection is mid-flight: set when a provider is
  // chosen from the picker, consumed once that provider is actually active
  // (which may be after a key-paste detour) to open the model picker. Makes
  // provider → model one connected flow. Cleared if the user backs out.
  const openModelAfterProvider = useRef(false);

  // Assemble the current durable Session from live state + stable metadata.
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

  // Single save point: persist whenever session-shaping state settles.
  // Only a real conversation is worth a file — command-only activity
  // (/help, a /rename before any chat) never touches disk, so sessions
  // without at least one user/assistant message don't litter.
  useEffect(() => {
    if (isStreaming) return;
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
          { role: "system", content: `failed to save session: ${msg}` },
        ]);
      });
    // buildSession only reads state already listed here (plus stable refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionTitle, provider, model, isStreaming]);

  // Shared gate for the MCP mutating commands: refuse mid-turn (swapping the
  // tool set would pull tools out from under an in-flight call) or while another
  // MCP op is running. Returns true when it's safe to proceed.
  function mcpGuard(): boolean {
    if (isStreaming) {
      ctx.addSystemMessage("wait for the current response to finish");
      return false;
    }
    if (mcpBusy.current) {
      ctx.addSystemMessage("an MCP operation is already in progress");
      return false;
    }
    return true;
  }

  // Close the current MCP clients and reconnect from the freshly-read config,
  // swapping in the new runtime + server list and surfacing warnings. Shared by
  // /mcp-reload, /mcp-add, /mcp-remove, and the post-login reconnect. Callers own
  // the mcpGuard() check and the mcpBusy flag.
  async function reconnectMcp(): Promise<McpRuntime> {
    const { config: fresh, warnings } = await loadConfig();
    for (const w of warnings) ctx.addSystemMessage(w);
    await closeMcpClients(mcp.clients);
    const next = await connectMcpServers(fresh.mcpServers);
    setMcp(next);
    setMcpServers(fresh.mcpServers);
    for (const w of next.warnings) ctx.addSystemMessage(w);
    return next;
  }

  // Persist a skill and reflect it in live state + the ref the model tools read.
  // Shared by the /skills popup and the saveSkill tool, so tool-driven and
  // popup-driven edits stay consistent. `previousName` (a rename from the popup)
  // is removed after the new one lands. skillsRef is the source of truth here so
  // a follow-up tool call in the same turn sees the change immediately.
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

  // Delete a skill from disk and live state. Returns false (no change) when it
  // wasn't defined, so the model tool can report "no such skill".
  async function removeSkill(name: string): Promise<boolean> {
    const removed = await removeSkillFromConfig(name);
    // Purge from live state whenever the name is present in it, even if disk
    // reported "not there" (removed === false). Delete is idempotent: the goal
    // is "skill gone", and if state and disk ever drift (a clobbered write, a
    // hand-edited config.json) this lets the UI self-heal instead of showing a
    // row that can never be removed. `removed` still reflects the disk result so
    // the model tool can honestly say "no such skill".
    if (skillsRef.current.some((s) => s.name === name)) {
      const next = skillsRef.current.filter((s) => s.name !== name);
      skillsRef.current = next;
      setSkills(next);
    }
    return removed;
  }

  // Park a model-driven question until the user answers it in the popup. The
  // resolver lives in a ref so the turn's finally can settle a still-open one.
  function requestUserAnswer(request: AskUserRequest): Promise<string> {
    return new Promise((resolve) => {
      askUserResolve.current = resolve;
      setAskUserReq(request);
    });
  }

  // The askUser popup's single exit point (answer or dismiss): close it and
  // resolve the paused tool so the turn continues. Safe to call with nothing
  // pending (the ref guards the resolve).
  function settleUserAnswer(answer: string) {
    const resolve = askUserResolve.current;
    askUserResolve.current = null;
    setAskUserReq(null);
    resolve?.(answer);
  }

  // The skill operations handed to the model's saveSkill/deleteSkill tools —
  // the same code paths /skills uses. `list` reads the live ref so a tool sees
  // edits made earlier in the same turn.
  const skillActions = {
    save: (skill: Skill) => persistSkill(skill),
    remove: (name: string) => removeSkill(name),
    list: () => skillsRef.current,
  };

  const ctx: CommandContext = {
    addSystemMessage: (text) =>
      setMessages((prev) => [...prev, { role: "system", content: text }]),
    newSession: () => {
      // Swapping messages out mid-stream would let in-flight deltas append
      // onto the wrong transcript — refuse until the turn settles.
      if (isStreaming) {
        ctx.addSystemMessage("wait for the current response to finish");
        return;
      }
      setSessionTitle("New Chat");
      setMessages([]);
      // New conversation → new id/timestamps, so it saves to a fresh file.
      metaRef.current = createSession(provider, model);
    },
    resumeSession: async (id) => {
      if (isStreaming) {
        ctx.addSystemMessage("wait for the current response to finish");
        return;
      }

      // Hybrid model: only sessions started in THIS directory are offered.
      const cwd = process.cwd();

      // No id → open the arrow-key picker popup. An id (or unique prefix)
      // still works for direct, scriptable resumes.
      if (!id) {
        const sessions = await listSessions(cwd);
        if (sessions.length === 0) {
          ctx.addSystemMessage("no sessions to resume in this directory");
          return;
        }
        setPickerSessions(sessions);
        return;
      }

      const matches = await findSessionsByIdPrefix(id, cwd);
      if (matches.length === 0) {
        ctx.addSystemMessage(`no session matching "${id}" in this directory`);
        return;
      }
      if (matches.length > 1) {
        ctx.addSystemMessage(
          `"${id}" matches ${matches.length} sessions — add more characters`,
        );
        return;
      }
      applySession(matches[0]);
    },
    setSessionTitle: (title) => setSessionTitle(title),
    setModel: (next) => {
      // No name → open the live-model picker for the current provider.
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
      // No arg → arrow-key picker popup.
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
        );
        return;
      }
      applyProvider(providers[normalized]);
    },
    showHelp: () => setHelpOpen(true),
    showSettings: () => setSettingsOpen(true),
    showSkills: () => setSkillsOpen(true),
    showTheme: () => {
      // Remember the current theme so dismissing the picker (which live-previews
      // as you scroll) reverts cleanly to where we started.
      themeBeforePreview.current = themeName;
      setThemePickerOpen(true);
    },
    showMcpTools: () => {
      if (Object.keys(mcpServers).length === 0) {
        ctx.addSystemMessage(
          `no MCP servers configured — add them under "mcpServers" in ${configPath()}`,
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
        ctx.addSystemMessage(`MCP reload failed: ${msg}`);
      } finally {
        mcpBusy.current = false;
      }
    },
    loginMcp: async (server) => {
      const cfg = mcpServers[server];
      if (!cfg) {
        ctx.addSystemMessage(
          `unknown MCP server "${server}" (configured: ${Object.keys(mcpServers).join(", ") || "none"})`,
        );
        return;
      }
      if (!("url" in cfg) || cfg.auth !== "oauth") {
        ctx.addSystemMessage(
          `"${server}" is not an OAuth server — login only applies to servers with "auth": "oauth"`,
        );
        return;
      }
      if (!mcpGuard()) return;
      mcpBusy.current = true;
      ctx.addSystemMessage(`opening browser to sign in to "${server}"…`);
      try {
        await loginMcpServer(server, cfg.url, (url) => {
          // Fallback when the browser can't auto-open (SSH, no handler). The
          // authorize URL carries no secret; PKCE protects the exchange.
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
        ctx.addSystemMessage(`login to "${server}" failed: ${msg}`);
      } finally {
        mcpBusy.current = false;
      }
    },
    addMcpServer: async (name, url, oauth) => {
      // Names key the merged tool set as `<name>__<tool>`, so "__" in a name
      // would corrupt those keys.
      if (name.includes("__")) {
        ctx.addSystemMessage('server name cannot contain "__"');
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        ctx.addSystemMessage(`not a valid URL: ${url}`);
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addSystemMessage(
          "url must be http(s) — /mcp-add is for HTTP servers",
        );
        return;
      }
      if (name in mcpServers) {
        ctx.addSystemMessage(
          `"${name}" already exists — /mcp-remove ${name} first to replace it`,
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
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`adding "${name}" failed: ${msg}`);
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
          ctx.addSystemMessage(`no MCP server "${name}" in config`);
          return;
        }
        ctx.addSystemMessage(`removed MCP server "${name}" — reconnecting…`);
        await reconnectMcp();
        ctx.addSystemMessage(`"${name}" removed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`removing "${name}" failed: ${msg}`);
      } finally {
        mcpBusy.current = false;
      }
    },
    copyLastResponse: async () => {
      // A mid-stream copy would grab a half-finished response.
      if (isStreaming) {
        ctx.addSystemMessage("wait for the current response to finish");
        return;
      }
      // The latest response can span several assistant bubbles (text split
      // around tool calls). Collect every assistant bubble back to the last
      // user turn and join them, so /copy grabs the whole reply — not just the
      // final fragment after the last tool call.
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
        ctx.addSystemMessage("no response to copy yet");
        return;
      }
      try {
        await copyToClipboard(lastResponse);
        ctx.addSystemMessage(
          `copied last response to clipboard (${lastResponse.length} chars)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`copy failed: ${msg}`);
      }
    },
    exit: () => {
      // Let an in-flight session write land before killing the process —
      // process.exit would otherwise cut it off and lose the last change — then
      // close MCP clients so their subprocesses don't outlive syd.
      void (async () => {
        await pendingSave.current.catch(() => {});
        // Best-effort close, but capped tight — quitting shouldn't wait on a
        // sluggish server. process.exit reclaims anything still open.
        await closeMcpClients(mcp.clients, 1_000);
        renderer.destroy();
        process.exit(0);
      })();
    },
  };

  // Single place a provider switch happens — shared by the picker popup and
  // the /provider <id> direct path. No key yet → open the paste prompt; the
  // switch completes after the key is saved.
  function applyProvider(next: Provider) {
    if (!hasApiKey(next)) {
      // Detour through the key-paste prompt; the flag persists so the model
      // picker still opens once the key lands (handleKeySubmit re-applies).
      setKeyPrompt(next);
      return;
    }
    // Chosen from the provider picker → continue into the model picker so the
    // user can pick a model for the provider they just landed on.
    const flowingToModelPicker = openModelAfterProvider.current;
    if (next.id !== provider) {
      setProvider(next.id);
      // The old provider's model id is meaningless here — adopt the default.
      setModel(next.defaultModel);
      // Only announce on the direct /provider <id> path. In the picker flow
      // the model picker opening is the feedback; a line here would just be
      // noise (and "already on …" for a no-op switch is pure spam), so skip it.
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

  // Key pasted into the prompt: verify it against the provider's API first,
  // then persist (owner-only file + this process's env) and finish the
  // provider switch. Returns an error string (prompt stays open, shows it
  // inline) or null on success (prompt closes).
  async function handleKeySubmit(
    target: Provider,
    key: string,
  ): Promise<string | null> {
    // Only key providers reach this prompt; the guard also narrows the union
    // so target.envVar below is well-typed.
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
      // Never include the key in errors — message is from fs, not the value.
      const msg = err instanceof Error ? err.message : String(err);
      return `verified, but saving failed: ${msg}`;
    }
    setKeyPrompt(null);
    ctx.addSystemMessage(`API key verified and saved for ${target.label}`);
    // The key is now in env — warm the model cache so the /model picker is
    // instant on first open (this reuses the fetch, not a second round-trip).
    primeModels(target.id);
    applyProvider(target);
    return null;
  }

  // OAuth sibling of handleKeySubmit: run the ChatGPT browser login, persist
  // the tokens, and finish the provider switch (same model-picker handoff).
  // Returns an error string (prompt stays open, shows it) or null on success.
  async function handleOAuthLogin(target: Provider): Promise<string | null> {
    try {
      const { url, result } = await startChatGPTLogin();
      openUrl(url);
      // Fallback for when the browser can't auto-open (SSH, no default handler)
      // — the authorize URL is safe to show (no secret; PKCE protects it).
      ctx.addSystemMessage(`if your browser didn't open, visit:\n${url}`);
      await saveChatGPTTokens(await result);
    } catch (err) {
      // Never include token values — these come from the flow/fetch, not them.
      return err instanceof Error ? err.message : String(err);
    }
    setKeyPrompt(null);
    ctx.addSystemMessage(`signed in to ${target.label}`);
    // Prove the account can actually run a call before handing off — a wrong
    // model id or an account without access fails here loudly instead of on
    // the first prompt. A failure is a warning, not a block: auth succeeded,
    // and the user can pick a different model in the picker that follows.
    const problem = await verifyChatGPTAccess(target.defaultModel);
    if (problem) {
      ctx.addSystemMessage(
        `heads up: a test call with ${target.defaultModel} was rejected — ${problem}. Try another model via /model.`,
      );
    }
    applyProvider(target);
    return null;
  }

  // The popup's single exit point: resolve the paused stream, close the
  // popup, and leave a transcript trace when the change was declined (an
  // approved change traces itself via the tool-result note).
  function handleApprovalDecision(approved: boolean) {
    if (!approval) return;
    approval.resolve(approved);
    setApproval(null);
    if (!approved) {
      const label = approval.request.note?.label ?? approval.request.tool;
      insertDuringStream({ role: "system", content: `declined: ${label}` });
    }
  }

  function applySession(session: Session) {
    setSessionTitle(session.title);
    setProvider(session.provider);
    setModel(session.model);
    setMessages(session.messages);
    metaRef.current = session;
  }

  // Commit any buffered stream text to the open assistant bubble and cancel a
  // pending flush. Called by the flush timer, before any mid-stream insert, and
  // once at turn settle — so coalescing never drops or reorders text. Appends
  // to the open assistant bubble, or opens a new one when a tool note is the
  // last entry (so text after a tool call lands below it, preserving order).
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

  // Append a transcript entry (tool note, denial notice) mid-stream in true
  // chronological order: it lands after whatever the model has said so far,
  // and a fresh placeholder re-opens below it so subsequent text (and the
  // thinking sprout) continue underneath — not stacked above. A trailing
  // *empty* placeholder is dropped first so the note doesn't leave a bare
  // "syd" header hanging over it.
  function insertDuringStream(msg: Message) {
    // Land any buffered text on the current bubble before the note splits it.
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

    // Skills invoked with @name in this message — their instructions are
    // injected into the system prompt for this turn only (per-message, not
    // sticky). Unknown @mentions are ignored (@ is ordinary text).
    const invokedSkills = findMentionedSkills(message, skills);

    const userMsg: Message = { role: "user", content: message };
    // Drop system notes and empty placeholders, then collapse consecutive
    // assistant bubbles (one turn's text, split around tool notes) back into a
    // single message — some providers reject same-role runs.
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

    // The save effect skips while streaming (no per-token writes) and
    // persists the finished transcript once this flips back to false.
    // A fresh controller per turn; the Escape handler aborts it.
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
        skills: invokedSkills,
        onAskUser: requestUserAnswer,
        skillActions,
        abortSignal: controller.signal,
        onDelta: (delta) => {
          // Buffer the token and let the frame timer commit it (flushDelta);
          // committing per token re-parses and re-pins on every token, which is
          // what made long/fast replies lag and jump.
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
          // Auto mode: approve immediately, no popup (the change still lands in
          // the transcript as a diff via onToolEvent). Manual mode: park the
          // resolver in state; the popup's keypress calls it via
          // handleApprovalDecision, which un-pauses the stream.
          //
          // Shell commands are the one exception: they ALWAYS prompt, even under
          // auto-approve. Auto-applying a file diff you can see is one thing;
          // silently running arbitrary shell (no path-containment safety net) is
          // a far bigger blast radius, so it stays a deliberate, per-command
          // decision.
          autoApproveRef.current && request.tool !== "runCommand"
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
                setApproval({ request, resolve });
              }),
      });
    } catch (err) {
      // A cancel can throw an AbortError out of the stream instead of ending
      // cleanly — that's not a failure to report, so swallow it and let the
      // finally block leave its "cancelled" note.
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`error: ${msg}`);
      }
    } finally {
      const cancelled = controller.signal.aborted;
      abortRef.current = null;
      // A question left parked (e.g. the turn errored out while its popup was
      // open) is settled so its tool promise never dangles and no ghost popup
      // lingers. Normal answers clear the ref before we reach here.
      if (askUserResolve.current) {
        settleUserAnswer("(the question was cancelled)");
      }
      // Commit any tail buffered since the last flush before the turn settles,
      // so the finalized transcript (and the streaming=false markdown re-parse)
      // sees the complete text — nothing is left stranded in the buffer.
      flushDelta();
      setIsStreaming(false);
      // A turn that ended on a tool call (or denial) re-opened an empty
      // placeholder that would render as a bare "syd" header — drop it.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && last.content.length === 0
          ? prev.slice(0, -1)
          : prev;
      });
      // Leave a trace so a cancelled turn reads as deliberate, not as output
      // that mysteriously stopped. Whatever streamed before the cancel is kept.
      if (cancelled) {
        ctx.addSystemMessage("response cancelled");
      }
    }
  }

  // Flip one setting from the /settings popup: update the live state so the
  // change takes effect immediately, and persist it to config.json so it
  // survives a restart. A save failure is surfaced but doesn't roll back the
  // in-memory toggle — the setting still applies this session.
  function toggleSetting(key: string) {
    const reportSaveError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`failed to save settings: ${msg}`);
    };
    if (key === "shell") {
      const next = !shellEnabled;
      setShellEnabledState(next);
      void saveSettings({ shellEnabled: next }).catch(reportSaveError);
    } else if (key === "autoApprove") {
      // Mirror the state into the ref too, so the streaming approval closure
      // (which reads autoApproveRef) sees the change even mid-turn.
      const next = !autoApproveRef.current;
      autoApproveRef.current = next;
      setAutoApproveState(next);
      void saveSettings({ autoApprove: next }).catch(reportSaveError);
    }
  }

  // The toggleable preferences shown in /settings, built from live state so the
  // popup always reflects (and re-renders on) the current values.
  const settingItems: SettingItem[] = [
    {
      key: "shell",
      label: "Shell commands",
      description:
        "Let syd run shell commands (lint, tests, build). Each command still " +
        "asks for your approval before it runs — even with auto-approve on.",
      value: shellEnabled,
    },
    {
      key: "autoApprove",
      label: "Auto-approve edits",
      description:
        "Apply file edits and MCP tool calls without a confirmation popup. " +
        "Shell commands always ask regardless. Off is safer.",
      value: autoApprove,
    },
  ];

  // Assemble the /mcp window's data: every declared server, paired with the
  // tools that actually connected. Namespaced keys carry the server prefix; the
  // description is the server-authored one the SDK attached to each tool.
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

  // Resolve the active theme once per render; the provider hands its tokens to
  // every component via useTheme(), so changing themeName recolors the whole UI.
  const theme = resolveTheme(themeName);

  return (
    <ThemeProvider tokens={theme.tokens}>
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        backgroundColor={theme.tokens.appBg}
      >
        <ChatMain messages={messages} streaming={isStreaming} />
        <ChatInputBox
          title={sessionTitle}
          model={model}
          autoApprove={autoApprove}
          shellEnabled={shellEnabled}
          skills={skills}
          // Unfocus while a popup is open so keystrokes can't leak into the
          // draft; the popup owns the keyboard instead.
          focused={!overlayOpen}
          onSubmit={handleSubmit}
        />
        {/* Centered overlay: absolute so it floats above the chat without
          reflowing it, full-screen box centering the popup on both axes. */}
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
                // Selecting a provider flows on into the model picker.
                openModelAfterProvider.current = true;
                applyProvider(next);
              }}
              onDismiss={() => {
                // Backing out goes to chat, not on to the model picker.
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
                  ctx.addSystemMessage(`failed to save skill: ${msg}`);
                });
              }}
              onDelete={(name) => {
                void removeSkill(name).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  ctx.addSystemMessage(`failed to delete skill: ${msg}`);
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
                  // Abandoning the paste also abandons the pending model-picker
                  // handoff — else it fires on the next provider switch.
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
              onClose={() => setModelPickerOpen(false)}
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
              // Live preview only — repaint the UI without touching disk.
              onHighlight={(name) => setThemeName(name)}
              onSelect={(name) => {
                setThemePickerOpen(false);
                setThemeName(name);
                // Only persist on an explicit choice; a previewed-but-dismissed
                // theme never reaches config.json.
                void saveTheme(name).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  ctx.addSystemMessage(`failed to save theme: ${msg}`);
                });
              }}
              onDismiss={() => {
                // Undo any live preview back to where we opened.
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
              // "approve all": flip to auto for the rest of the session and
              // approve this one, so a multi-file change stops interrupting.
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
