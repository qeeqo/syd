import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  providerList,
  hasApiKey,
  type Provider,
  type ProviderId,
} from "../providers";
import { useTheme } from "./themeContext";

type ProviderPickerProps = {
  current: ProviderId;
  onSelect: (provider: Provider) => void;
  onDismiss: () => void;
};

export default function ProviderPicker({
  current,
  onSelect,
  onDismiss,
}: ProviderPickerProps) {
  const t = useTheme();
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      providerList.findIndex((p) => p.id === current),
    ),
  );
  const total = providerList.length;

  useKeyboard((key) => {
    switch (key.name) {
      case "up":
        key.preventDefault();
        setSelected((i) => (i - 1 + total) % total);
        break;
      case "down":
        key.preventDefault();
        setSelected((i) => (i + 1) % total);
        break;
      case "return":
        key.preventDefault();
        onSelect(providerList[selected]);
        break;
      case "escape":
        key.preventDefault();
        onDismiss();
        break;
    }
  });

  const labelWidth = providerList.reduce(
    (w, p) => Math.max(w, p.label.length),
    0,
  );

  return (
    <box
      border
      borderColor={t.border}
      backgroundColor={t.panelBg}
      title=" switch provider "
      titleColor={t.accent}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {providerList.map((p, i) => {
        const isSelected = i === selected;
        const ready = hasApiKey(p);
        // OAuth providers "sign in" rather than take a key.
        const readyLabel = p.auth === "oauth" ? "signed in" : "key ✓";
        const needLabel = p.auth === "oauth" ? "sign in" : "key needed";
        return (
          <box
            key={p.id}
            paddingX={1}
            flexDirection="row"
            backgroundColor={isSelected ? t.selectionBg : undefined}
          >
            <text fg={isSelected ? t.textSelected : t.accent}>
              {p.id === current ? "● " : "  "}
              {p.label.padEnd(labelWidth, " ")}
            </text>
            {/* Presence only — the key value is never read or shown.
                Selecting an unready provider opens the paste/sign-in prompt. */}
            <text fg={ready ? t.successDim : t.warning}>
              {"  "}
              {ready ? readyLabel : needLabel}
            </text>
          </box>
        );
      })}
    </box>
  );
}
