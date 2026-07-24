import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  providerList,
  hasApiKey,
  type Provider,
  type ProviderId,
} from "../providers";

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
  // Start the highlight on the active provider.
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      providerList.findIndex((p) => p.id === current),
    ),
  );
  const total = providerList.length;

  // The picker owns navigation; App owns what happens on select/dismiss.
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
      borderColor="#2a3350"
      backgroundColor="#141824"
      title=" switch provider "
      titleColor="#8bb4ff"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {providerList.map((p, i) => {
        const isSelected = i === selected;
        const keyed = hasApiKey(p);
        return (
          <box
            key={p.id}
            paddingX={1}
            flexDirection="row"
            backgroundColor={isSelected ? "#233056" : undefined}
          >
            <text fg={isSelected ? "#cfe0ff" : "#8bb4ff"}>
              {p.id === current ? "● " : "  "}
              {p.label.padEnd(labelWidth, " ")}
            </text>
            {/* Presence only — the key value is never read or shown.
                Selecting an unkeyed provider opens the paste prompt. */}
            <text fg={keyed ? "#5fae7f" : "#c9a24f"}>
              {"  "}
              {keyed ? "key ✓" : "key needed"}
            </text>
          </box>
        );
      })}
    </box>
  );
}
