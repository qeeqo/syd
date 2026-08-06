import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  providerList,
  hasApiKey,
  type Provider,
  type ProviderId,
} from "../providers";
import { useTheme } from "./themeContext";
import "./overlayBox";

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
    <overlay-box
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
            {/* Show only credential presence; selecting an unready provider starts authentication. */}
            <text fg={ready ? t.successDim : t.warning}>
              {"  "}
              {ready ? readyLabel : needLabel}
            </text>
          </box>
        );
      })}
    </overlay-box>
  );
}
