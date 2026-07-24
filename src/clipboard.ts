// System clipboard — pure module, no React, no TUI.
//
// Security invariant: the text is piped to the clipboard tool's stdin and the
// command is an argv ARRAY (no shell involved), so clipboard content can never
// be interpreted as shell syntax — `$(...)`, backticks, quotes are all inert.

function clipboardCommand(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["pbcopy"];
    case "win32":
      return ["clip"];
    default:
      // Linux/BSD: Wayland ships wl-copy; X11 setups typically have xclip.
      return process.env.WAYLAND_DISPLAY
        ? ["wl-copy"]
        : ["xclip", "-selection", "clipboard"];
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  const cmd = clipboardCommand();

  // Type left to inference: Bun.spawn's return is generic over its options,
  // so `stdin: "pipe"` is what narrows proc.stdin to a writable FileSink.
  let proc;
  try {
    proc = Bun.spawn(cmd, {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    throw new Error(`clipboard tool not found: ${cmd[0]}`);
  }

  proc.stdin.write(text);
  await proc.stdin.end();

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${cmd[0]} exited with code ${exitCode}`);
  }
}
