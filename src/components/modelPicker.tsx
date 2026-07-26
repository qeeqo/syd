import { useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { fetchModels, type FetchModelsResult } from "../models";
import type { Provider } from "../providers";

type ModelPickerProps = {
  provider: Provider;
  current: string;
  onSelect: (model: string) => void;
  onSwitchProvider: () => void;
  // Dismiss the picker straight back to chat — the quick exit that doesn't
  // route through the provider picker / key prompt.
  onClose: () => void;
};

// How many rows are visible at once; the list scrolls to keep the highlight
// in view rather than growing unbounded.
const WINDOW = 8;

export default function ModelPicker({
  provider,
  current,
  onSelect,
  onSwitchProvider,
  onClose,
}: ModelPickerProps) {
  // undefined while the first fetch is in flight; set once it resolves.
  const [result, setResult] = useState<FetchModelsResult | undefined>();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);

  // Fetch on mount. Cached after the first call (or primed at key-paste), so
  // this is usually instant; the loading state covers the cold path.
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

  // Case-insensitive substring filter. Re-derived on every keystroke; the
  // highlight is reset to the top by the input handler so it never points
  // past the shortened list.
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  }, [all, filter]);

  useKeyboard((key) => {
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
        // Prefer the highlighted match; otherwise fall back to the typed
        // text so a manual id still works when the list is empty (fetch
        // failed, or a filter that matches nothing but is itself valid).
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
        // Quit straight back to chat — but only on a pristine (empty) filter,
        // so a literal "q" can still start a type-ahead (e.g. "qwen"). With
        // text present, fall through and let the focused input receive it.
        if (filter === "") {
          key.preventDefault();
          onClose();
        }
        break;
    }
  });

  // Scroll the fixed window so `selected` stays visible.
  const start = Math.max(
    0,
    Math.min(selected - WINDOW + 1, matches.length - WINDOW),
  );
  const visible = matches.slice(start, start + WINDOW);

  return (
    <box
      border
      borderColor="#2a3350"
      backgroundColor="#141824"
      title={` ${provider.label} — models `}
      titleColor="#8bb4ff"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
      width="70%"
      maxWidth={72}
    >
      {/* Type-ahead filter — focused so keystrokes narrow the list. */}
      <input
        value={filter}
        focused
        placeholder="type to filter…"
        backgroundColor="#0f1117"
        focusedBackgroundColor="#0f1117"
        textColor="#dfe8ff"
        focusedTextColor="#dfe8ff"
        onInput={(value: string) => {
          setFilter(value);
          // Reset the highlight to the top of the freshly filtered list.
          setSelected(0);
        }}
      />

      {result === undefined ? (
        <text fg="#c9a24f" marginTop={1}>
          loading models from {provider.label}…
        </text>
      ) : !result.ok ? (
        <text fg="#b3564f" marginTop={1} wrapMode="word">
          {result.reason === "no-key"
            ? `no API key for ${provider.label} yet — switch to it via /provider first`
            : result.reason === "empty"
              ? `${provider.label} returned no usable models — type a model id above and press ↵`
              : `couldn't reach ${provider.label} — type a model id above and press ↵`}
        </text>
      ) : matches.length === 0 ? (
        <text fg="#6b7280" marginTop={1}>
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
                backgroundColor={isSelected ? "#233056" : undefined}
              >
                <text fg={isSelected ? "#cfe0ff" : "#9fb2d8"}>
                  {m === current ? "● " : "  "}
                  {m}
                </text>
              </box>
            );
          })}
        </box>
      )}

      {/* Footer hints — esc is repurposed to hop to the provider picker so
          the user can change provider without leaving the /model flow. */}
      <text fg="#5b6472" marginTop={1}>
        ↵ select ⋅ esc switch provider ⋅ q quit
      </text>
    </box>
  );
}
