// Unicode Control Pictures (U+2400–U+241F) mirror the C0 range at a fixed offset.
const CONTROL_PICTURES = 0x2400;
const DELETE_PICTURE = "␡";

// Newlines keep their break after the marker so multi-line text still reads as
// lines — padding shows up as ⏎ rows instead of blank ones. C1 has no control
// pictures, and some terminals treat 0x9b as a CSI escape, so it is spelled out.
export function visualizeControls(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "\n") out += "⏎\n";
    else if (code < 0x20) out += String.fromCharCode(CONTROL_PICTURES + code);
    else if (code === 0x7f) out += DELETE_PICTURE;
    else if (code >= 0x80 && code <= 0x9f) out += `\\x${code.toString(16)}`;
    else out += ch;
  }
  return out;
}
