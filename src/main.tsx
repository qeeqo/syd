import {createCliRenderer} from "@opentui/core";
import {createRoot} from "@opentui/react";
import App from "./App.tsx";
import {applyStoredKeys} from "./auth.ts";

// Surface keys saved via the /provider prompt into process.env before any
// provider code runs. Real env vars (shell / .env) take precedence.
await applyStoredKeys();

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
