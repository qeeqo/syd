// UI-agnostic wrapper around the AI SDK's streamText. The provider registry
// (providers.ts) decides how a model id becomes a LanguageModel; this module
// stays the single choke point for the model call (tools/MCP land here later).

import { streamText, type ModelMessage } from "ai";
import { providers, type ProviderId } from "./providers";

export type StreamChatArgs = {
  provider: ProviderId;
  model: string;
  messages: ModelMessage[];
  onDelta: (chunk: string) => void;
};

export async function streamChat({
  provider,
  model,
  messages,
  onDelta,
}: StreamChatArgs) {
  const result = streamText({
    model: providers[provider].resolve(model),
    messages,
  });

  for await (const chunk of result.textStream) {
    onDelta(chunk);
  }
}
