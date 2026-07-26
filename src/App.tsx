import { useEffect, useRef, useState } from "react";
import { useRenderer } from "@opentui/react";
import ChatMain from "./components/chatMain";
import ChatInputBox from "./components/chatInputBox";
import SessionPicker from "./components/sessionPicker";
import HelpPopup from "./components/helpPopup";
import ProviderPicker from "./components/providerPicker";
import ApiKeyPrompt from "./components/apiKeyPrompt";
import ChatGPTLoginPrompt from "./components/chatGPTLoginPrompt";
import ApprovalPrompt from "./components/approvalPrompt";
import ModelPicker from "./components/modelPicker";
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
import type { CommandContext, Message } from "./commands/type";

export default function App() {
  const renderer = useRenderer();
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [provider, setProvider] = useState<ProviderId>("google");
  const [model, setModel] = useState("gemini-3.6-flash");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pickerSessions, setPickerSessions] = useState<Session[] | null>(null);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [keyPrompt, setKeyPrompt] = useState<Provider | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [approval, setApproval] = useState<{
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
  } | null>(null);
  // Approval mode. Default manual (confirm each write) — the diff preview is
  // what guards against wrong-file / oversized edits. The ref mirrors the
  // state so the streaming closure reads the live value even if the mode is
  // toggled mid-turn; the state drives the input-box indicator.
  const [autoApprove, setAutoApproveState] = useState(false);
  const autoApproveRef = useRef(false);

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
      ctx.addSystemMessage(
        auto
          ? "auto-approve ON — file edits apply without asking (/auto off to stop)"
          : "auto-approve OFF — file edits ask first",
      );
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
      // process.exit would otherwise cut it off and lose the last change.
      void pendingSave.current.finally(() => {
        renderer.destroy();
        process.exit(0);
      });
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

  // Single place a loaded session becomes the live one — shared by the
  // picker popup and the /resume <id> direct path.
  function applySession(session: Session) {
    setSessionTitle(session.title);
    // Raw setters — resume shouldn't echo "model set to" / "provider set to".
    setProvider(session.provider);
    setModel(session.model);
    setMessages(session.messages);
    // Adopt the loaded session's identity so future saves update its file.
    metaRef.current = session;
    ctx.addSystemMessage(
      `resumed "${session.title}" (${session.messages.length} messages)`,
    );
  }

  // Append a transcript entry (tool note, denial notice) mid-stream in true
  // chronological order: it lands after whatever the model has said so far,
  // and a fresh placeholder re-opens below it so subsequent text (and the
  // thinking sprout) continue underneath — not stacked above. A trailing
  // *empty* placeholder is dropped first so the note doesn't leave a bare
  // "syd" header hanging over it.
  function insertDuringStream(msg: Message) {
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
    setIsStreaming(true);
    try {
      await streamChat({
        provider,
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
        onDelta: (delta) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            // Append to the open assistant bubble, or start a new one if a tool
            // note is the last thing in the transcript — so text after a tool
            // call lands below it, preserving order.
            if (last && last.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + delta },
              ];
            }
            return [...prev, { role: "assistant", content: delta }];
          });
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
          autoApproveRef.current
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
                setApproval({ request, resolve });
              }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.addSystemMessage(`error: ${msg}`);
    } finally {
      setIsStreaming(false);
      // A turn that ended on a tool call (or denial) re-opened an empty
      // placeholder that would render as a bare "syd" header — drop it.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && last.content.length === 0
          ? prev.slice(0, -1)
          : prev;
      });
    }
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#0f1117"
    >
      <ChatMain messages={messages} streaming={isStreaming} />
      <ChatInputBox
        title={sessionTitle}
        model={model}
        autoApprove={autoApprove}
        // Unfocus while a popup is open so keystrokes can't leak into the
        // draft; the popup owns the keyboard instead.
        focused={
          pickerSessions === null &&
          !providerPickerOpen &&
          keyPrompt === null &&
          !helpOpen &&
          !modelPickerOpen &&
          approval === null
        }
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
            // esc closes the model picker and opens the provider picker, so
            // the two read as one connected flow.
            onSwitchProvider={() => {
              setModelPickerOpen(false);
              setProviderPickerOpen(true);
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
  );
}
