import {createCliRenderer} from "@opentui/core";
import {createRoot} from "@opentui/react";
import App from "./App.tsx";
import {applyStoredKeys} from "./auth.ts";
import {loadConfig} from "./config.ts";
import {connectMcpServers} from "./mcp.ts";

// Surface keys saved via the /provider prompt into process.env before any
// provider code runs. Real env vars (shell / .env) take precedence.
await applyStoredKeys();

// Load ~/.sydcli/config.json (defaults filled in) to seed the initial
// provider / model / approval mode. Warnings from a malformed file ride along
// and surface as opening system messages.
const {config, warnings} = await loadConfig();

// Connect any configured MCP servers before the first render so their tools are
// ready on the first prompt. Runs after applyStoredKeys so ${VAR} references in
// server env/headers can resolve credentials the store just loaded. Fail-soft:
// a server that can't connect adds a warning and is skipped, never blocking
// startup. Its warnings join the config warnings as opening system messages.
const mcp = await connectMcpServers(config.mcpServers);

const renderer = await createCliRenderer();
createRoot(renderer).render(
  <App
    config={config}
    configWarnings={[...warnings, ...mcp.warnings]}
    initialMcp={mcp}
  />,
);
