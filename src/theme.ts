export type ThemeTokens = {
  // --- surfaces ---
  appBg: string;
  transcriptBg: string;
  panelBg: string;
  selectionBg: string;
  userBg: string;

  // --- borders ---
  border: string;
  borderActive: string;
  // Separate from borderActive so the primary prompt reads distinctly from a
  // focused editor field.
  inputBorder: string;
  warnBorder: string;
  infoBorder: string;

  // --- special surfaces ---
  diffAddBg: string;
  diffRemoveBg: string;
  armedBg: string;

  // --- text, brightest → faintest ---
  textStrong: string;
  text: string;
  textSelected: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  textFaint: string;
  textHint: string;
  // Ink on top of an inverted fill. Not appBg, which it used to borrow: a
  // transparent theme has no paintable background, and zero-alpha text isn't
  // drawn at all.
  inverseText: string;

  // --- accents ---
  accent: string;
  // Second stop of the SYD logo gradient.
  accentDeep: string;
  success: string;
  successBright: string;
  successDim: string;
  warning: string;
  warningBright: string;
  danger: string;
  dangerDim: string;
  dangerDeep: string;
  info: string;
};

export type Theme = {
  // Stored in config.json and typed after /theme.
  name: string;
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
// The only theme that composites with the terminal instead of covering it:
// transparent cells emit no background escape, so window transparency and blur
// show through.
//
// Foregrounds stay hex rather than indexed palette colors (which would track the
// user's terminal theme exactly) because ThemeTokens is typed `string` and
// chatMain's mixColor parses them as hex — indexed would need a ColorInput
// refactor. These values are picked to read against a dark translucent
// terminal.
const system: Theme = {
  name: "system",
  label: "System",
  tokens: {
    // --- surfaces
    appBg: "transparent",
    transcriptBg: "transparent",
    // Tinted even here: it marks who said what, and the band hugs the text so
    // it covers little enough for the terminal to still show through.
    userBg: "#1b3326",
    // Popup surfaces preserve the terminal's own transparency in this theme.
    // Selected rows remain opaque below so keyboard focus is still visible.
    panelBg: "transparent",
    selectionBg: "#2c3340",
    // A transparent diff is an unreadable diff.
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
    // --- accents: standard-ish ANSI hues, to sit naturally beside whatever
    // palette the terminal itself uses
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

// Resolve to the default *silently*, so someone who had a since-removed theme
// selected doesn't get an "unknown theme" warning every launch. A genuine typo
// should still warn, which is why this list is explicit.
const RETIRED_THEME_NAMES = new Set(["syd"]);

export function isRetiredThemeName(name: string): boolean {
  return RETIRED_THEME_NAMES.has(name);
}

export const themeList: Theme[] = Object.values(THEMES);

// Used by config parsing to validate the stored preference before trusting it.
export function isThemeName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEMES, name);
}

// Always returns something paintable — an unknown name falls back to the
// default rather than leaving the UI without colors.
export function resolveTheme(name: string | undefined): Theme {
  if (name && isThemeName(name)) return THEMES[name];
  return THEMES[DEFAULT_THEME_NAME];
}
