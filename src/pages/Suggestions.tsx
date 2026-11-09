import { useCallback, useEffect, useState } from "react";
import { getAiSuggestions, shouldAutoRefresh, type AiSuggestion } from "../ai/suggest";
import LoadingMark from "../components/LoadingMark";
import { getAiConfig } from "../db/settings";
import {
  listStoredSuggestions,
  loadRuleStats,
  replaceStoredSuggestions,
} from "../db/suggestions";
import { useDb } from "../lib/db-context";
import { getSecret, SECRET_KEYS } from "../lib/secrets";
import { useSuggestions } from "../lib/useSuggestions";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const TONE: Record<number, string> = {
  1: "border-error/40 bg-error-soft",
  2: "border-accent/40 bg-accent-soft",
  3: "border-line bg-surface",
};

export default function Suggestions() {
  const db = useDb();
  const month = currentMonth();
  const { suggestions, loading, error, reload, dismiss } = useSuggestions(db, month);
  const [aiItems, setAiItems] = useState<AiSuggestion[] | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const refreshAi = useCallback(async () => {
    setAiBusy(true);
    setAiNotice(null);
    try {
      const config = await getAiConfig(db);
      if (!config.enabled) {
        setAiNotice("AI is off - enable it in Settings");
        setAiItems(null);
        return;
      }
      const apiKey =
        config.mode === "cloud" ? await getSecret(SECRET_KEYS.OLLAMA_API_KEY) : null;
      const stats = await loadRuleStats(db, month);
      const result = await getAiSuggestions(stats, { ...config, apiKey });
      setAiItems(result.suggestions);
      setAiNotice(result.notice);
      if (result.suggestions) {
        await replaceStoredSuggestions(
          db,
          result.suggestions.map((s) => ({
            type: s.type,
            itemId: null,
            message: s.message,
            priority: s.priority,
          })),
        );
      }
    } catch (err) {
      setAiNotice(err instanceof Error ? err.message : String(err));
      setAiItems(null);
    } finally {
      setAiBusy(false);
    }
  }, [db, month]);

  // Auto-refresh at most once per day, and only when AI is switched on.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await getAiConfig(db);
        if (!config.enabled || cancelled) return;
        const stored = await listStoredSuggestions(db);
        if (shouldAutoRefresh(stored[0]?.createdAt ?? null) && !cancelled) {
          await refreshAi();
        }
      } catch {
        /* fall back to rule suggestions */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, refreshAi]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="page-title">Suggestions</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="input text-sm"
            onClick={() => void reload()}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void refreshAi()}
            disabled={aiBusy}
          >
            {aiBusy ? "Asking AI…" : "Refresh AI suggestions"}
          </button>
        </div>
      </header>

      <p className="text-sm text-muted">
        Calculated from your own numbers — no AI involved.
      </p>

      {error && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}

      {aiNotice && (
        <p role="status" className="rounded bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          {aiNotice}
        </p>
      )}

      {aiItems && aiItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Explained by AI
          </h2>
          <ul className="space-y-2">
            {aiItems.map((item, index) => (
              <li key={index} className="card p-3 text-sm">
                {item.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <LoadingMark />}

      {!loading && suggestions.length === 0 && (
        <section className="rounded border border-dashed border-line p-6 text-center text-muted">
          Nothing to flag right now.
        </section>
      )}

      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <li
            key={`${suggestion.type}:${suggestion.itemId ?? "all"}`}
            className={`flex items-start justify-between gap-3 rounded border p-3 ${TONE[suggestion.priority]}`}
          >
            <div>
              <p className="text-sm">{suggestion.message}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                {suggestion.type.replace("_", " ")}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded border border-line px-2 py-1 text-xs"
              onClick={() => void dismiss(suggestion)}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
