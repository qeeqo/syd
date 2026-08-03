import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import App from "./App.tsx";
import { applyStoredKeys } from "./auth.ts";
import { loadConfig } from "./config.ts";

await applyStoredKeys(); // secrets -> env

const { config, warnings } = await loadConfig(); // read config.json

const renderer = await createCliRenderer(); // build the renderer

// mount react into it
createRoot(renderer).render(<App config={config} configWarnings={warnings} />);
