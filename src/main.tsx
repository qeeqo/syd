import {createCliRenderer} from "@opentui/core";
import {createRoot} from "@opentui/react";
import App from "./App.tsx";
import {applyStoredKeys} from "./auth.ts";
import {loadConfig} from "./config.ts";

// Surface keys saved via the /provider prompt into process.env before any
// provider code runs. Real env vars (shell / .env) take precedence.
await applyStoredKeys();

// Load ~/.sydcli/config.json (defaults filled in) to seed the initial
// provider / model / approval mode. Warnings from a malformed file ride along
// and surface as opening system messages.
const {config, warnings} = await loadConfig();

// MCP servers are NOT connected here: a slow or unreachable server would delay
// the first frame (each connect can take up to 20s). App connects them in the
// background on mount instead, so the UI draws instantly and connection status
// arrives as system messages once it settles.
const renderer = await createCliRenderer();
createRoot(renderer).render(
  <App config={config} configWarnings={warnings} />,
);
