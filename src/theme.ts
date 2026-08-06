export type ThemeTokens = {
  appBg: string;
  transcriptBg: string;
  panelBg: string;
  selectionBg: string;
  userBg: string;

  border: string;
  borderActive: string;
  // Separate from borderActive so the primary prompt reads distinctly from a
  // focused editor field.
  inputBorder: string;
  warnBorder: string;
  infoBorder: string;

  diffAddBg: string;
  diffRemoveBg: string;
  armedBg: string;

  textStrong: string;
  text: string;
  textSelected: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  textFaint: string;
  textHint: string;
  // Keep this opaque when appBg is transparent; zero-alpha text is not drawn.
  inverseText: string;

  accent: string;
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
  name: string;
  label: string;
  tokens: ThemeTokens;
};

const solarized: Theme = {
  name: "solarized",
  label: "Solarized",
  tokens: {
    appBg: "#002b36",
    transcriptBg: "#00212b",
    panelBg: "#073642",
    selectionBg: "#0a4b57",
    userBg: "#053d2c",
    border: "#164952",
    borderActive: "#268bd2",
    inputBorder: "#268bd2",
    warnBorder: "#5a4a12",
    infoBorder: "#164e5a",
    diffAddBg: "#0a3320",
    diffRemoveBg: "#3a1213",
    armedBg: "#3a1213",
    textStrong: "#eee8d5",
    text: "#93a1a1",
    textSelected: "#eee8d5",
    textSecondary: "#839496",
    textMuted: "#657b83",
    textDim: "#586e75",
    textFaint: "#495e66",
    textHint: "#3b5058",
    inverseText: "#002b36",
    accent: "#268bd2",
    accentDeep: "#1a5a8a",
    success: "#859900",
    successBright: "#a4b407",
    successDim: "#6b7d00",
    warning: "#b58900",
    warningBright: "#cb9a1a",
    danger: "#dc322f",
    dangerDim: "#cb4b16",
    dangerDeep: "#a5241f",
    info: "#2aa198",
  },
};

const gruvbox: Theme = {
  name: "gruvbox",
  label: "Gruvbox",
  tokens: {
    appBg: "#282828",
    transcriptBg: "#1d2021",
    panelBg: "#32302f",
    selectionBg: "#504945",
    userBg: "#283618",
    border: "#3c3836",
    borderActive: "#83a598",
    inputBorder: "#83a598",
    warnBorder: "#4d3b17",
    infoBorder: "#26403f",
    diffAddBg: "#32361f",
    diffRemoveBg: "#3c2323",
    armedBg: "#3c2323",
    textStrong: "#fbf1c7",
    text: "#ebdbb2",
    textSelected: "#fbf1c7",
    textSecondary: "#d5c4a1",
    textMuted: "#a89984",
    textDim: "#928374",
    textFaint: "#7c6f64",
    textHint: "#665c54",
    inverseText: "#282828",
    accent: "#83a598",
    accentDeep: "#458588",
    success: "#b8bb26",
    successBright: "#c8cb4a",
    successDim: "#98971a",
    warning: "#fabd2f",
    warningBright: "#fdd45f",
    danger: "#fb4934",
    dangerDim: "#fe8019",
    dangerDeep: "#cc241d",
    info: "#8ec07c",
  },
};

const catppuccin: Theme = {
  name: "catppuccin",
  label: "Catppuccin Mocha",
  tokens: {
    appBg: "#1e1e2e",
    transcriptBg: "#11111b",
    panelBg: "#181825",
    selectionBg: "#313244",
    userBg: "#1e3328",
    border: "#313244",
    borderActive: "#89b4fa",
    inputBorder: "#89b4fa",
    warnBorder: "#4a3f2a",
    infoBorder: "#2a3f4a",
    diffAddBg: "#26332b",
    diffRemoveBg: "#382530",
    armedBg: "#382530",
    textStrong: "#f5e0dc",
    text: "#cdd6f4",
    textSelected: "#f5e0dc",
    textSecondary: "#bac2de",
    textMuted: "#a6adc8",
    textDim: "#9399b2",
    textFaint: "#7f849c",
    textHint: "#6c7086",
    inverseText: "#1e1e2e",
    accent: "#89b4fa",
    accentDeep: "#5a7ac9",
    success: "#a6e3a1",
    successBright: "#c1f0bd",
    successDim: "#6cba71",
    warning: "#f9e2af",
    warningBright: "#fcedc4",
    danger: "#f38ba8",
    dangerDim: "#eba0ac",
    dangerDeep: "#e06c8a",
    info: "#89dceb",
  },
};

const system: Theme = {
  name: "system",
  label: "System",
  tokens: {
    appBg: "transparent",
    transcriptBg: "transparent",
    userBg: "#1b3326",
    panelBg: "transparent",
    selectionBg: "#2c3340",
    diffAddBg: "#1e3a26",
    diffRemoveBg: "#3d2027",
    armedBg: "#4a2530",
    border: "#5b6472",
    borderActive: "#8bb4ff",
    inputBorder: "#8bb4ff",
    warnBorder: "#b58a4a",
    infoBorder: "#4a9ab5",
    textStrong: "#ffffff",
    text: "#d4d4d4",
    textSelected: "#ffffff",
    textSecondary: "#b0b0b0",
    textMuted: "#909090",
    textDim: "#7a7a7a",
    textFaint: "#6a6a6a",
    textHint: "#5a5a5a",
    inverseText: "#101216",
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
  solarized,
  gruvbox,
  catppuccin,
};

export const DEFAULT_THEME_NAME = "catppuccin";

// Retired names fall back silently; genuinely unknown names still warn.
const RETIRED_THEME_NAMES = new Set(["syd"]);

export function isRetiredThemeName(name: string): boolean {
  return RETIRED_THEME_NAMES.has(name);
}

export const themeList: Theme[] = Object.values(THEMES);

export function isThemeName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEMES, name);
}

// Unknown persisted names fail soft to a paintable default.
export function resolveTheme(name: string | undefined): Theme {
  if (name && isThemeName(name)) return THEMES[name];
  return THEMES[DEFAULT_THEME_NAME];
}
