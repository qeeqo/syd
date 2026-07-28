import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "./themeContext";
import type { Provider } from "../providers";

type ChatGPTLoginPromptProps = {
  provider: Provider;
  // Runs the full OAuth flow (open browser → await redirect → save tokens).
  // Resolves to null on success (parent closes the prompt) or an error message
  // to show inline — the prompt stays open so the user can retry or esc out.
  onLogin: () => Promise<string | null>;
  onCancel: () => void;
};

export default function ChatGPTLoginPrompt({
  provider,
  onLogin,
  onCancel,
}: ChatGPTLoginPromptProps) {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  // True from the moment the browser opens until the flow settles.
  const [waiting, setWaiting] = useState(false);

  async function start() {
    setError(null);
    setWaiting(true);
    const failure = await onLogin();
    if (failure) {
      setWaiting(false);
      setError(failure);
      return;
    }
    // Success: parent unmounts us.
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      // esc during the wait just abandons the UI; the loopback server times
      // out on its own. Only allow it when not mid-flight to avoid a dangling
      // prompt state.
      if (!waiting) onCancel();
      return;
    }
    if (key.name === "return" && !waiting) {
      key.preventDefault();
      void start();
    }
  });

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title={` ${provider.label} — sign in `}
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={2}
      minWidth={56}
    >
      <text fg={t.textSecondary} wrapMode="word">
        Sign in with your ChatGPT account to use your plan's Codex quota
        instead of a paid API key.
      </text>
      {waiting ? (
        <text fg={t.warning} marginTop={1} wrapMode="word">
          opening your browser… complete the sign-in there, then come back.
          Waiting for the redirect…
        </text>
      ) : (
        <text fg={t.textHint} marginTop={1}>
          ↵ open browser to sign in · esc cancel
        </text>
      )}
      {error && (
        <text fg={t.dangerDeep} marginTop={1} wrapMode="word">
          {error}
        </text>
      )}
    </box>
  );
}
