import { useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { fetchModels, type FetchModelsResult } from "../models";
import { useTheme } from "./themeContext";
import type { Provider } from "../providers";
import type { ReasoningLevel } from "../reasoning";

type ModelPickerProps = {
  provider: Provider;
  current: string;
  onSelect: (model: string) => void;
  onSwitchProvider: () => void;
  // Hop to the reasoning picker without leaving the /model flow — App reopens
  // this one when that closes.
  onSwitchReasoning: () => void;
  // Shown in the footer so ^r advertises what it changes.
  reasoning: ReasoningLevel;
  // The quick exit that doesn't route through the provider picker.
  onClose: () => void;
};

// The list scrolls to keep the highlight in view rather than growing.
const WINDOW = 8;

export default function ModelPicker({
  provider,
  current,
  onSelect,
  onSwitchProvider,
  onSwitchReasoning,
  reasoning,
  onClose,
}: ModelPickerProps) {
  const t = useTheme();
  // undefined while the first fetch is in flight.
  const [result, setResult] = useState<FetchModelsResult | undefined>();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);

  // Usually instant (cached or primed at key-paste); the loading state covers
  // the cold path.
  useEffect(() => {
    let live = true;
    fetchModels(provider.id).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [provider.id]);

  const all = useMemo(() => (result?.ok ? result.models : []), [result]);

  // The highlight is reset to the top by the input handler, so it never points
  // past the shortened list.
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  }, [all, filter]);

  useKeyboard((key) => {
    // A ctrl chord, because the filter <input> is focused and a bare letter has
    // to stay available for type-ahead.
    if (key.ctrl && key.name === "r") {
      key.preventDefault();
      onSwitchReasoning();
      return;
    }
    switch (key.name) {
      case "up":
        key.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
        break;
      case "down":
        key.preventDefault();
        setSelected((i) => Math.min(matches.length - 1, i + 1));
        break;
      case "return":
        key.preventDefault();
        // Fall back to the typed text so a manual id still works when the list
        // is empty (fetch failed, or a filter matching nothing but itself
        // valid).
        if (matches[selected]) {
          onSelect(matches[selected]);
        } else if (filter.trim()) {
          onSelect(filter.trim());
        }
        break;
      case "escape":
        key.preventDefault();
        onSwitchProvider();
        break;
      case "q":
        // Only on a pristine filter, so a literal "q" can still start a
        // type-ahead ("qwen"). With text present, let the input receive it.
        if (filter === "") {
          key.preventDefault();
          onClose();
        }
        break;
    }
  });

  const start = Math.max(
    0,
    Math.min(selected - WINDOW + 1, matches.length - WINDOW),
  );
  const visible = matches.slice(start, start + WINDOW);

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title={` ${provider.label} — models `}
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="70%"
      maxWidth={72}
    >
      <input
        value={filter}
        focused
        placeholder="type to filter…"
        backgroundColor={t.appBg}
        focusedBackgroundColor={t.appBg}
        textColor={t.text}
        focusedTextColor={t.text}
        onInput={(value: string) => {
          setFilter(value);
          setSelected(0);
        }}
      />

      {result === undefined ? (
        <text fg={t.warning} marginTop={1}>
          loading models from {provider.label}…
        </text>
      ) : !result.ok ? (
        <text fg={t.dangerDeep} marginTop={1} wrapMode="word">
          {result.reason === "no-key"
            ? `no API key for ${provider.label} yet — switch to it via /provider first`
            : result.reason === "empty"
              ? `${provider.label} returned no usable models — type a model id above and press ↵`
              : `couldn't reach ${provider.label} — type a model id above and press ↵`}
        </text>
      ) : matches.length === 0 ? (
        <text fg={t.textMuted} marginTop={1}>
          no models match "{filter}"
        </text>
      ) : (
        <box flexDirection="column" marginTop={1}>
          {visible.map((m) => {
            const isSelected = matches[selected] === m;
            return (
              <box
                key={m}
                paddingX={1}
                flexDirection="row"
                backgroundColor={isSelected ? t.selectionBg : undefined}
              >
                <text fg={isSelected ? t.textSelected : t.textSecondary}>
                  {m === current ? "● " : "  "}
                  {m}
                </text>
              </box>
            );
          })}
        </box>
      )}

      {/* esc and ^r are repurposed to hop to the provider and reasoning
          pickers without leaving the /model flow; both return here. */}
      <text fg={t.textDim} marginTop={1}>
        ↵ select ⋅ esc switch provider ⋅ ^r thinking ({reasoning}) ⋅ q quit
      </text>
    </box>
  );
}
