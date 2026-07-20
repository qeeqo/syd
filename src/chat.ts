// currently gemini supported only

import { generateText } from "ai";
import { google } from "@ai-sdk/google";

const { text } = await generateText({
  model: "google/gemini-2.5-flash",
  prompt: "Hello world",
});
