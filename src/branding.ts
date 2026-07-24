// Pure ASCII wordmark for syd, shown at the top of every new session.
// Kept as a UI-agnostic module (not baked into a component) so the CLI,
// future headless core, and neovim plugin can all reuse the same mark.
// Every line is padded to the same width so it can be centered cleanly.
export const SYD_BANNER = [
  " ___    \\   /    ___ ",
  "/ __|    \\ /    |   \\",
  "\\__ \\     |     | | |",
  "|___/     |     |__/ ",
];

export const SYD_TAGLINE = "your terminal coding companion";
