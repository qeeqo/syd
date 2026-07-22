// currently gemini supported only

import { streamText, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";

export type StreamChatArgs = {
  model: string;
  messages: ModelMessage[];
  onDelta: (chunk: string) => void;
};

export async function streamChat({ model, messages, onDelta }: StreamChatArgs) {
  const result = streamText({
    model: google(model),
    messages,
  });

  for await (const chunk of result.textStream) {
    onDelta(chunk);
  }
}
