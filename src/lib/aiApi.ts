/**
 * Call the worker's /api/ai/chat endpoint. The worker holds the OLLAMA_API_KEY
 * secret — the desktop app never sees it. No authentication is required.
 *
 * Uses the Tauri HTTP plugin so the desktop webview is not blocked by CORS.
 *
 * Returns { answer, usedTools }.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export async function callAiApi(
  workerUrl: string,
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<{ answer: string; usedTools: string[] }> {
  const res = await tauriFetch(`${workerUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `AI request failed (${res.status})`);
  }
  return res.json();
}
