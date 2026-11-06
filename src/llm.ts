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
  model: string = "gemini-3.5-flash-lite",
  options: { temperature?: number } = { temperature: 0 }
): Promise<string> {
  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
    config: { temperature: options.temperature },
  });
  return response.text ?? "";
}

/** callModel with exponential backoff; 3 retries; rethrows last error */
export async function callModelWithRetry(
  prompt: string,
  model: string = "gemini-3.5-flash-lite",
  options: { temperature?: number } = { temperature: 0 }
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      return await callModel(prompt, model, options);
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
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
