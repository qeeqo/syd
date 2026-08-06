// Security invariant: text goes to the tool's stdin and the command is an argv
// array (no shell), so clipboard content can never be read as shell syntax.

function clipboardCommand(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["pbcopy"];
    case "win32":
      return ["clip"];
    default:
      return process.env.WAYLAND_DISPLAY
        ? ["wl-copy"]
        : ["xclip", "-selection", "clipboard"];
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  const cmd = clipboardCommand();

  // Type left to inference: `stdin: "pipe"` is what narrows proc.stdin to a
  // writable FileSink.
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
