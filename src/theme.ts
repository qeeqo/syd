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
  // Active / focused border (focused editor field, logo accent).
  borderActive: string;
  // The chat input's own border (kept separate from borderActive so the primary
  // prompt can read distinctly from focused editor fields).
  inputBorder: string;
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
  // Ink for text drawn on top of a bright/inverted fill (the session chip under
  // the input). Distinct from `appBg` — which it used to borrow — because a
  // transparent theme has no paintable app background, and zero-alpha text is
  // not drawn at all.
  inverseText: string;

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
  tokens: ThemeTokens;
};

// --- Solarized Osaka (dark)
const solarizedOsaka: Theme = {
  name: "solarized-osaka",
  label: "Solarized Osaka",
  tokens: {
    appBg: "#002b36", // base03
    transcriptBg: "#00212b", // deeper base for the transcript
    panelBg: "#073642", // base02
    selectionBg: "#0a4b57",
    userBg: "#053d2c",
    border: "#164952",
    borderActive: "#268bd2", // blue
    inputBorder: "#268bd2", // blue
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
    inverseText: "#002b36",
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

// --- Gruvbox
const gruvbox: Theme = {
  name: "gruvbox",
  label: "Gruvbox",
  tokens: {
    appBg: "#282828", // bg0
    transcriptBg: "#1d2021", // bg0_h (hard)
    panelBg: "#32302f", // bg0_s
    selectionBg: "#504945", // bg2
    userBg: "#283618",
    border: "#3c3836", // bg1
    borderActive: "#83a598", // bright blue
    inputBorder: "#83a598", // bright blue
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
    inverseText: "#282828",
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

// --- Catppuccin Mocha
const catppuccin: Theme = {
  name: "catppuccin",
  label: "Catppuccin Mocha",
  tokens: {
    appBg: "#1e1e2e", // base
    transcriptBg: "#11111b", // crust (deepest)
    panelBg: "#181825", // mantle
    selectionBg: "#313244", // surface0
    userBg: "#1e3328",
    border: "#313244", // surface0
    borderActive: "#89b4fa", // blue
    inputBorder: "#89b4fa", // blue
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
    inverseText: "#1e1e2e", // base
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

// --- System (transparent)
//
// Paints no surfaces: every background token is "transparent", which OpenTUI
// parses to RGBA(0,0,0,0). With nothing opaque beneath — the renderer's own
// default backgroundColor is "transparent" too — those cells emit no background
// escape, so the terminal's own background shows through, including window
// transparency and blur. That is the whole point of this theme: it is the only
// one that composites with the terminal instead of covering it.
//
// The foregrounds stay explicit hex. OpenTUI can address the terminal's 16-color
// palette (RGBA.fromIndex) which would track a user's terminal theme exactly,
// but ThemeTokens is typed `string` and code like chatMain's mixColor() parses
// these as hex — so indexed colors would need a wider ColorInput refactor. These
// values are picked to read against a dark translucent terminal, which is what
// blur setups almost always are.
const system: Theme = {
  name: "system",
  label: "System",
  tokens: {
    // --- surfaces: the chat area is transparent, which is where blur pays off
    appBg: "transparent",
    transcriptBg: "transparent",
    // The user's own turn keeps its green tint here too. It marks who said what,
    // so it has to be visible — and now that the band hugs the text instead of
    // spanning the column, it covers little enough that the terminal still shows
    // through everywhere around it.
    userBg: "#1b3326",
    // Popups and highlighted rows are the deliberate exceptions. A popup draws
    // *over* the transcript; with no fill, the text beneath shows through its
    // text and both become unreadable. A selected row with no fill has no
    // highlight at all — the affordance disappears. Both stay opaque so the
    // theme is transparent where it helps and solid where it must be.
    panelBg: "#16181d",
    selectionBg: "#2c3340",
    // Diff and armed rows keep a tint — these *must* read as a colored band to
    // do their job, and a transparent diff is an unreadable diff. They are the
    // deliberate exception to the no-surfaces rule.
    diffAddBg: "#1e3a26",
    diffRemoveBg: "#3d2027",
    armedBg: "#4a2530",
    // --- borders carry the structure the backgrounds no longer do
    border: "#5b6472",
    borderActive: "#8bb4ff",
    inputBorder: "#8bb4ff",
    warnBorder: "#b58a4a",
    infoBorder: "#4a9ab5",
    // --- text
    textStrong: "#ffffff",
    text: "#d4d4d4",
    textSelected: "#ffffff",
    textSecondary: "#b0b0b0",
    textMuted: "#909090",
    textDim: "#7a7a7a",
    textFaint: "#6a6a6a",
    textHint: "#5a5a5a",
    inverseText: "#101216",
    // --- accents: standard-ish ANSI hues, so they sit naturally next to
    // whatever palette the terminal itself is using
    accent: "#8bb4ff",
    accentDeep: "#5577bb",
    success: "#7ec87e",
    successBright: "#a5e0a5",
    successDim: "#5a9a5a",
    warning: "#e0c060",
    warningBright: "#f0d890",
    danger: "#e57373",
    dangerDim: "#c86060",
    dangerDeep: "#b04c4c",
    info: "#6cc5dd",
  },
};

export const THEMES: Record<string, Theme> = {
  system,
  "solarized-osaka": solarizedOsaka,
  gruvbox,
  catppuccin,
};

export const DEFAULT_THEME_NAME = "catppuccin";

// Theme ids that shipped once and have since been removed. A config.json out in
// the world can still name one, so they resolve to the default *silently* —
// without them, config parsing would warn "unknown theme" on every launch for
// anyone who had the retired theme selected. Distinct from a genuine typo,
// which should still warn.
const RETIRED_THEME_NAMES = new Set(["syd"]);

export function isRetiredThemeName(name: string): boolean {
  return RETIRED_THEME_NAMES.has(name);
}

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
