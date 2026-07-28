import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { validateApiKey } from "../auth";
import { useTheme } from "./themeContext";
import type { Provider } from "../providers";

type ApiKeyPromptProps = {
  provider: Provider;
  // Called with a validated, trimmed key. Resolves to null on success
  // (parent closes the prompt) or an error message to show inline — the
  // prompt stays open so the user can fix the paste and retry.
  onSubmit: (key: string) => Promise<string | null>;
  onCancel: () => void;
};

export default function ApiKeyPrompt({
  provider,
  onSubmit,
  onCancel,
}: ApiKeyPromptProps) {
  const t = useTheme();
  // The input's text renders in the popup background color so the pasted key is
  // invisible on screen (OpenTUI has no native masked input). Sourced from the
  // active theme so masking holds under any palette.
  const BG = t.panelBg;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // True while the key is being verified against the provider's API.
  const [verifying, setVerifying] = useState(false);

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      onCancel();
    }
  });

  async function handleSubmit() {
    if (verifying) return; // ignore a second Enter mid-check
    const key = validateApiKey(draft);
    if (!key) {
      setError("that doesn't look like an API key — check the paste");
      return;
    }
    setError(null);
    setVerifying(true);
    const failure = await onSubmit(key);
    if (failure) {
      // Still open: show why and let the user re-paste or esc out.
      setVerifying(false);
      setError(failure);
      return;
    }
    // Success: parent unmounts us; the secret dies with this component.
  }

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={BG}
      title={` ${provider.label} — API key `}
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={2}
      minWidth={56}
    >
      <text fg={t.textSecondary}>Paste your API key. Input is hidden.</text>
      {/* The real input: mounted and focused so typing/paste lands here, but
          text + cursor colors match the popup background — nothing shows. */}
      <input
        value={draft}
        focused
        textColor={BG}
        focusedTextColor={BG}
        backgroundColor={BG}
        focusedBackgroundColor={BG}
        onInput={(value: string) => {
          setDraft(value);
          setError(null);
        }}
        onSubmit={handleSubmit}
      />
      {/* Visible feedback: bullets + length, never the key itself. */}
      <text fg={t.accent}>
        {draft.length > 0
          ? `${"•".repeat(Math.min(draft.length, 40))}  (${draft.length} chars)`
          : " "}
      </text>
      {error && <text fg={t.dangerDeep}>{error}</text>}
      {verifying ? (
        <text fg={t.warning} marginTop={1}>
          verifying key with {provider.label}…
        </text>
      ) : (
        <text fg={t.textHint} marginTop={1}>
          ↵ verify & save · esc cancel
        </text>
      )}
    </box>
  );
}
