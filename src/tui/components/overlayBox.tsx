import { BoxRenderable, RGBA } from "@opentui/core";
import type { OptimizedBuffer } from "@opentui/core";
import { extend } from "@opentui/react";

const EMPTY = RGBA.fromValues(0, 0, 0, 0);

export class OverlayBoxRenderable extends BoxRenderable {
  protected renderSelf(buffer: OptimizedBuffer): void {
    const left = Math.max(this.x, 0);
    const top = Math.max(this.y, 0);
    const right = Math.min(this.x + this.width, buffer.width);
    const bottom = Math.min(this.y + this.height, buffer.height);

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        buffer.setCell(x, y, " ", EMPTY, EMPTY);
      }
    }

    super.renderSelf(buffer);
  }
}

extend({ "overlay-box": OverlayBoxRenderable });

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "overlay-box": typeof OverlayBoxRenderable;
  }
}
