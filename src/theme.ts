// Color themes — a pure data module (no React, no TUI), so a future headless
// core / neovim plugin can share the same palette definitions the way it shares
// session.ts / config.ts. The React glue (context + hook) lives separately in
// components/themeContext.tsx; this file only owns the semantic token contract
// and the concrete palettes.
//
// Every color the UI draws is named by ROLE here (accent, danger, textMuted …),
// never by hue, so a component asks for `t.accent` and each theme decides what
// that is. Adding a theme is just one more entry in THEMES with all tokens
// filled — the type makes a missing token a compile error, so a theme can never
// half-cover the UI.
//
// Bundled non-default palettes are derived from well-known open-source themes,
// all under the permissive MIT license (see THIRD_PARTY_LICENSES.md for the
// copyright + permission notices):
//   • Solarized — Copyright (c) 2011 Ethan Schoonover
//   • Gruvbox   — Copyright (c) 2017 Pavel Pertsev
//   • Catppuccin — Copyright (c) 2021 Catppuccin
// The accent/base hexes come from those projects; the incidental surface tints
// (diff backgrounds, armed/user-message rows) are derived to match each family.

// The complete set of semantic color roles the UI paints with. Every theme must
// provide all of them — the type is the single source of truth for "what a theme
// needs to define", so a new component color should be added here first.
export type ThemeTokens = {
  // --- surfaces ---
  // App root background (the whole screen).
  appBg: string;
  // The chat transcript area behind messages.
  transcriptBg: string;
  // Popup / panel background (every overlay window).
  panelBg: string;
  // Highlighted row background in a list/picker.
  selectionBg: string;
  // Background strip behind a user's own message in the transcript.
  userBg: string;

  // --- borders ---
  // Default panel / input border.
  border: string;
  // Active / focused border (focused input, focused editor field, logo accent).
  borderActive: string;
  // Border for a caution panel (the approve-change prompt).
  warnBorder: string;
  // Border for an interaction panel (the "syd asks" prompt).
  infoBorder: string;

  // --- special surfaces ---
  // Added-line background in a rendered diff.
  diffAddBg: string;
  // Removed-line background in a rendered diff.
  diffRemoveBg: string;
  // Background of a delete-armed row (the two-step delete guard in /skills).
  armedBg: string;

  // --- text, brightest → faintest ---
  // Brightest text (a user's own message).
  textStrong: string;
  // Primary body text (assistant output, prompt bodies).
  text: string;
  // Text on a highlighted/selected row (reads a touch brighter than `text`).
  textSelected: string;
  // Secondary text (descriptions, sub-labels).
  textSecondary: string;
  // Muted text (list descriptions, dim notices).
  textMuted: string;
  // Dim text (footer hints, inline separators).
  textDim: string;
  // Fainter text (scroll "N more" markers, unselected ids).
  textFaint: string;
  // Faintest text (the dimmest keycap hint lines).
  textHint: string;

  // --- accents ---
  // Primary accent (titles, command/skill names, the model indicator).
  accent: string;
  // Deep companion to `accent` — the second stop of the SYD logo gradient.
  accentDeep: string;
  // Success (the thinking sprout, "on" state, connected server).
  success: string;
  // Brighter success (diff "+" sign, the approve keycap).
  successBright: string;
  // Dimmer success (a provider's "key ✓" readiness).
  successDim: string;
  // Warning (auto-approve indicator, "verifying…" notices).
  warning: string;
  // Brighter warning (the approve-change panel title).
  warningBright: string;
  // Danger (diff "−" sign, errors, the deny keycap, armed-delete text).
  danger: string;
  // Dimmer danger ("off" state, a disconnected server).
  dangerDim: string;
  // Deep danger (inline error text in the key / login prompts).
  dangerDeep: string;
  // Info (the "syd asks" panel title).
  info: string;
};

export type Theme = {
  // Stable id: what's stored in config.json and typed after /theme.
  name: string;
  // Display name shown in the picker.
  label: string;
  // One-line description / attribution shown under the highlighted theme.
  blurb: string;
  tokens: ThemeTokens;
};

// --- syd (default) ----------------------------------------------------------
// The original hand-picked palette — cool near-black blues with a soft blue
// accent. Kept byte-for-byte identical to the pre-theming hardcoded colors so
// the default look is unchanged.
const syd: Theme = {
  name: "syd",
  label: "syd",
  blurb: "the original — cool near-black blues",
  tokens: {
    appBg: "#0f1117",
    transcriptBg: "#000000",
    panelBg: "#141824",
    selectionBg: "#233056",
    userBg: "#12351f",
    border: "#2a3350",
    borderActive: "#191970",
    warnBorder: "#5a4a2a",
    infoBorder: "#2a4a5a",
    diffAddBg: "#1e3a26",
    diffRemoveBg: "#3d2027",
    armedBg: "#4a2530",
    textStrong: "#f3f6ff",
    text: "#dfe8ff",
    textSelected: "#cfe0ff",
    textSecondary: "#9fb2d8",
    textMuted: "#6b7280",
    textDim: "#5b6472",
    textFaint: "#4b5674",
    textHint: "#3d4761",
    accent: "#8bb4ff",
    accentDeep: "#191970",
    success: "#7ee2a8",
    successBright: "#8ce8b0",
    successDim: "#5fae7f",
    warning: "#c9a24f",
    warningBright: "#e8c477",
    danger: "#ff9aa8",
    dangerDim: "#e08a9a",
    dangerDeep: "#b3564f",
    info: "#77c7e8",
  },
};

// --- Solarized Osaka (dark) --------------------------------------------------
// Ethan Schoonover's Solarized accent ramp on the deeper teal-black base the
// "Osaka" variant favors. Famously low-contrast by design.
const solarizedOsaka: Theme = {
  name: "solarized-osaka",
  label: "Solarized Osaka",
  blurb: "Ethan Schoonover · low-contrast teal dark (MIT)",
  tokens: {
    appBg: "#002b36", // base03
    transcriptBg: "#00212b", // deeper base for the transcript
    panelBg: "#073642", // base02
    selectionBg: "#0a4b57",
    userBg: "#053d2c",
    border: "#164952",
    borderActive: "#268bd2", // blue
    warnBorder: "#5a4a12",
    infoBorder: "#164e5a",
    diffAddBg: "#0a3320",
    diffRemoveBg: "#3a1213",
    armedBg: "#3a1213",
    textStrong: "#eee8d5", // base2
    text: "#93a1a1", // base1
    textSelected: "#eee8d5", // base2
    textSecondary: "#839496", // base0
    textMuted: "#657b83", // base00
    textDim: "#586e75", // base01
    textFaint: "#495e66",
    textHint: "#3b5058",
    accent: "#268bd2", // blue
    accentDeep: "#1a5a8a",
    success: "#859900", // green
    successBright: "#a4b407",
    successDim: "#6b7d00",
    warning: "#b58900", // yellow
    warningBright: "#cb9a1a",
    danger: "#dc322f", // red
    dangerDim: "#cb4b16", // orange
    dangerDeep: "#a5241f",
    info: "#2aa198", // cyan
  },
};

// --- Gruvbox (dark, medium) --------------------------------------------------
// Pavel Pertsev's retro-warm palette: earthy browns with bright pastel accents.
const gruvbox: Theme = {
  name: "gruvbox",
  label: "Gruvbox",
  blurb: "Pavel Pertsev · retro warm dark (MIT)",
  tokens: {
    appBg: "#282828", // bg0
    transcriptBg: "#1d2021", // bg0_h (hard)
    panelBg: "#32302f", // bg0_s
    selectionBg: "#504945", // bg2
    userBg: "#283618",
    border: "#3c3836", // bg1
    borderActive: "#83a598", // bright blue
    warnBorder: "#4d3b17",
    infoBorder: "#26403f",
    diffAddBg: "#32361f",
    diffRemoveBg: "#3c2323",
    armedBg: "#3c2323",
    textStrong: "#fbf1c7", // fg0
    text: "#ebdbb2", // fg1
    textSelected: "#fbf1c7", // fg0
    textSecondary: "#d5c4a1", // fg2
    textMuted: "#a89984", // fg4
    textDim: "#928374", // gray
    textFaint: "#7c6f64", // bg4
    textHint: "#665c54", // bg3
    accent: "#83a598", // bright blue
    accentDeep: "#458588", // neutral blue
    success: "#b8bb26", // bright green
    successBright: "#c8cb4a",
    successDim: "#98971a", // neutral green
    warning: "#fabd2f", // bright yellow
    warningBright: "#fdd45f",
    danger: "#fb4934", // bright red
    dangerDim: "#fe8019", // bright orange
    dangerDeep: "#cc241d", // neutral red
    info: "#8ec07c", // bright aqua
  },
};

// --- Catppuccin Mocha --------------------------------------------------------
// The Catppuccin community's soft, pastel dark flavor.
const catppuccin: Theme = {
  name: "catppuccin",
  label: "Catppuccin Mocha",
  blurb: "Catppuccin · soft pastel dark (MIT)",
  tokens: {
    appBg: "#1e1e2e", // base
    transcriptBg: "#11111b", // crust (deepest)
    panelBg: "#181825", // mantle
    selectionBg: "#313244", // surface0
    userBg: "#1e3328",
    border: "#313244", // surface0
    borderActive: "#89b4fa", // blue
    warnBorder: "#4a3f2a",
    infoBorder: "#2a3f4a",
    diffAddBg: "#26332b",
    diffRemoveBg: "#382530",
    armedBg: "#382530",
    textStrong: "#f5e0dc", // rosewater
    text: "#cdd6f4", // text
    textSelected: "#f5e0dc", // rosewater
    textSecondary: "#bac2de", // subtext1
    textMuted: "#a6adc8", // subtext0
    textDim: "#9399b2", // overlay2
    textFaint: "#7f849c", // overlay1
    textHint: "#6c7086", // overlay0
    accent: "#89b4fa", // blue
    accentDeep: "#5a7ac9",
    success: "#a6e3a1", // green
    successBright: "#c1f0bd",
    successDim: "#6cba71",
    warning: "#f9e2af", // yellow
    warningBright: "#fcedc4",
    danger: "#f38ba8", // red
    dangerDim: "#eba0ac", // maroon
    dangerDeep: "#e06c8a",
    info: "#89dceb", // sky
  },
};

// Registry of every bundled theme, keyed by its stable id. Insertion order is
// the order the /theme picker shows them (default first).
export const THEMES: Record<string, Theme> = {
  syd,
  "solarized-osaka": solarizedOsaka,
  gruvbox,
  catppuccin,
};

// The theme applied when config names none / an unknown one.
export const DEFAULT_THEME_NAME = "syd";

// The picker list, in registry order.
export const themeList: Theme[] = Object.values(THEMES);

// True when `name` is a known theme id — used by config parsing to validate the
// stored preference before trusting it.
export function isThemeName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEMES, name);
}

// Resolve a stored/typed name to a concrete Theme, always returning something
// paintable: an unknown or missing name falls back to the default rather than
// leaving the UI without colors.
export function resolveTheme(name: string | undefined): Theme {
  if (name && isThemeName(name)) return THEMES[name];
  return THEMES[DEFAULT_THEME_NAME];
}
