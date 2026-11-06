import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";

export function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
}

export async function callModel(
  prompt: string,
  model: string = "gemini-2.5-flash-lite"
): Promise<string> {
  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
  });
  return response.text ?? "";
}

export function loadPrompt(
  path: string,
  vars: Record<string, string> = {}
): string {
  return Object.entries(vars).reduce(
    (template, [key, value]) => template.split(`{${key}}`).join(value),
    readFileSync(path, "utf8")
  );
}

// Example usage
if (require.main === module) {
  callModel(loadPrompt("./prompt.txt", { message: "test message" })).then(console.log);
}