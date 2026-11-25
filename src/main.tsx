import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import App from "./tui/App.tsx";
import { applyStoredKeys } from "./core/auth.ts";
import { loadConfig } from "./core/config.ts";

await applyStoredKeys();

const { config, warnings } = await loadConfig();

const renderer = await createCliRenderer();

createRoot(renderer).render(<App config={config} configWarnings={warnings} />);
