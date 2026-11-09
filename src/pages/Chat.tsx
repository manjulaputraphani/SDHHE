import { useState, type FormEvent } from "react";
import { type ChatTurn } from "../ai/chat";
import { getAiConfig, getChatWorkerUrl } from "../db/settings";
import { useDb } from "../lib/db-context";
import { callAiApi } from "../lib/aiApi";

const CHIPS = [
  "How much rice did I use this month?",
  "What should I buy this week?",
  "Which item price went up most?",
];

type Bubble = { role: "user" | "assistant"; content: string };

export default function Chat() {
  const db = useDb();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setBubbles((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    try {
      const config = await getAiConfig(db);
      if (!config.enabled) {
        setError("AI is off - enable it in Settings");
        return;
      }
      const workerUrl = await getChatWorkerUrl(db);
      if (!workerUrl) {
        setError("AI worker URL is not set — ask the owner to configure it.");
        return;
      }
      const result = await callAiApi(workerUrl, text, history);
      setBubbles((prev) => [...prev, { role: "assistant", content: result.answer }]);
      setHistory((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: result.answer },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Ask about your shop</h1>
      <p className="text-sm text-muted">
        The assistant can only read your data. It cannot add, change or delete anything.
      </p>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="rounded-full border border-line px-3 py-1 text-xs"
            onClick={() => void send(chip)}
            disabled={busy}
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="min-h-48 space-y-2 card p-3">
        {bubbles.length === 0 && <p className="text-sm text-muted">Ask a question to start.</p>}
        {bubbles.map((bubble, index) => (
          <p
            key={index}
            className={`max-w-[80%] rounded px-3 py-2 text-sm ${
              bubble.role === "user"
                ? "ml-auto bg-nav text-nav-text"
                : "bg-surface-2 text-ink"
            }`}
          >
            {bubble.content}
          </p>
        ))}
        {busy && <p className="text-sm text-muted">Thinking…</p>}
      </div>

      {error && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}

      <form className="flex gap-2" onSubmit={onSubmit}>
        <input
          className="flex-1 input"
          placeholder="Ask about stock, prices or spending…"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={busy}
        >
          Send
        </button>
      </form>
    </div>
  );
}
