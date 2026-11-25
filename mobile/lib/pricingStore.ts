/**
 * On-device storage for the Green Coffee Pricing Calculator.
 *
 * The calculator itself is pure and runs offline. This module only keeps:
 *   1. the last-used inputs (so the next quote starts where the last one did),
 *   2. a local queue of saved quotes, including ones that have not reached the
 *      backend yet.
 *
 * A saved quote is written to AsyncStorage FIRST. Only then do we try the
 * backend, so a dropped connection can never lose a field quote. Pending rows
 * are retried whenever the device comes back online.
 *
 * Formulas are never duplicated here — inputs are saved as-is and the shared
 * `calculatePricing` result is stored alongside them for offline history.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PricingInputs, PricingResult } from "../../src/logic/pricing";
import { api, type PricingCalculation } from "./api";

const DRAFT_KEY = "sdhhe_pricing_draft_v1";
const QUEUE_KEY = "sdhhe_pricing_queue_v1";

export type PricingDraft = {
  /** Raw field text, so half-typed/blank fields survive an app restart. */
  form: Record<string, string>;
  grade: string;
  note: string;
};

export type SavedPricingQuote = {
  /** Local identity — stable while the quote waits in the queue. */
  localId: string;
  /** Set once the backend accepted the quote. */
  serverId: number | null;
  grade: string;
  note: string | null;
  inputs: PricingInputs;
  results: PricingResult;
  createdByName: string;
  createdAt: string;
  status: "pending" | "synced";
  /** A non-network rejection (permission/validation) so the UI can explain it. */
  syncError: string | null;
};

export type SyncSummary = {
  synced: number;
  pending: number;
  /** True when the retry stopped because the device is offline. */
  offline: boolean;
  error: string | null;
};

/** The current device time in the same ISO shape the API returns. */
function nowIso(): string {
  return new Date().toISOString();
}

function newLocalId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Did the request fail before it could reach the server? */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /network request failed|failed to fetch|network error|internet|offline|timed? ?out|econn|socket/i.test(
    message,
  );
}

function asQuote(value: unknown): SavedPricingQuote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SavedPricingQuote>;
  if (
    typeof row.localId !== "string" ||
    typeof row.grade !== "string" ||
    typeof row.createdAt !== "string" ||
    (row.status !== "pending" && row.status !== "synced") ||
    !row.inputs ||
    !row.results
  ) {
    return null;
  }
  return {
    localId: row.localId,
    serverId: typeof row.serverId === "number" ? row.serverId : null,
    grade: row.grade,
    note: typeof row.note === "string" ? row.note : null,
    inputs: row.inputs as PricingInputs,
    results: row.results as PricingResult,
    createdByName: typeof row.createdByName === "string" ? row.createdByName : "",
    createdAt: row.createdAt,
    status: row.status,
    syncError: typeof row.syncError === "string" ? row.syncError : null,
  };
}

async function readQueue(): Promise<SavedPricingQuote[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(asQuote).filter((row): row is SavedPricingQuote => row !== null);
  } catch {
    // Storage unavailable or a half-written value — start clean rather than
    // crashing the calculator on a field phone.
    return [];
  }
}

async function writeQueue(rows: SavedPricingQuote[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  } catch {
    // Keep the in-memory caller working; the next save retries the write.
  }
}

/** Serialise queue writes so two quick saves cannot overwrite each other. */
let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queueLock.then(task, task);
  queueLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sortNewestFirst(rows: SavedPricingQuote[]): SavedPricingQuote[] {
  return [...rows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// ---- Last-used inputs ----

export async function loadPricingDraft(): Promise<PricingDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PricingDraft>;
    if (!parsed || typeof parsed !== "object" || !parsed.form) return null;
    return {
      form: parsed.form as Record<string, string>,
      grade: typeof parsed.grade === "string" ? parsed.grade : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
    };
  } catch {
    return null;
  }
}

export async function savePricingDraft(draft: PricingDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Remembering inputs is a convenience, never a blocker.
  }
}

// ---- Saved quotes + offline queue ----

export async function loadSavedPricingQuotes(): Promise<SavedPricingQuote[]> {
  return sortNewestFirst(await readQueue());
}

export async function pendingPricingCount(): Promise<number> {
  const rows = await readQueue();
  return rows.filter((row) => row.status === "pending").length;
}

/**
 * Write a brand-new quote locally and return it. The caller can then call
 * `syncPendingPricingQuotes()` without risking the quote if the network dies.
 */
export async function enqueuePricingQuote(entry: {
  grade: string;
  note: string | null;
  inputs: PricingInputs;
  results: PricingResult;
  createdByName: string;
}): Promise<SavedPricingQuote> {
  const quote: SavedPricingQuote = {
    localId: newLocalId(),
    serverId: null,
    grade: entry.grade,
    note: entry.note,
    inputs: entry.inputs,
    results: entry.results,
    createdByName: entry.createdByName,
    createdAt: nowIso(),
    status: "pending",
    syncError: null,
  };

  return withQueueLock(async () => {
    const rows = await readQueue();
    rows.push(quote);
    await writeQueue(sortNewestFirst(rows));
    return quote;
  });
}

function fromServer(row: PricingCalculation): SavedPricingQuote {
  return {
    localId: `server-${row.id}`,
    serverId: row.id,
    grade: row.grade,
    note: row.note,
    inputs: row.inputs,
    results: row.results,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    status: "synced",
    syncError: null,
  };
}

/**
 * Merge the backend history into the local queue. Rows the device already has
 * (matched by server id) keep their local copy — including a pending row that
 * was saved while offline and has since synced.
 */
export async function mergeServerPricingQuotes(
  serverRows: PricingCalculation[],
): Promise<SavedPricingQuote[]> {
  return withQueueLock(async () => {
    const local = await readQueue();
    const knownIds = new Set(
      local.map((row) => row.serverId).filter((id): id is number => typeof id === "number"),
    );
    const additions = serverRows.filter((row) => !knownIds.has(row.id)).map(fromServer);
    const merged = sortNewestFirst([...local, ...additions]);
    await writeQueue(merged);
    return merged;
  });
}

/**
 * Push every pending quote, oldest first. Stops on a network failure (the rest
 * stay queued) and records non-network rejections so the row is not silently
 * retried forever.
 */
export async function syncPendingPricingQuotes(): Promise<SyncSummary> {
  return withQueueLock(async () => {
    const rows = sortNewestFirst(await readQueue()).reverse(); // oldest first
    let synced = 0;
    let error: string | null = null;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.status !== "pending") continue;

      try {
        const { calculation } = await api.savePricingCalculation({
          grade: row.grade,
          note: row.note ?? undefined,
          inputs: row.inputs,
        });
        rows[index] = {
          ...row,
          serverId: calculation.id,
          results: calculation.results,
          createdAt: calculation.createdAt,
          status: "synced",
          syncError: null,
        };
        synced += 1;
        // Persist after each success so a crash cannot re-send the whole queue.
        await writeQueue(sortNewestFirst(rows));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isNetworkError(err)) {
          await writeQueue(sortNewestFirst(rows));
          return {
            synced,
            pending: rows.filter((entry) => entry.status === "pending").length,
            offline: true,
            error: null,
          };
        }

        rows[index] = { ...row, syncError: message };
        error = message;
        await writeQueue(sortNewestFirst(rows));

        // These failures will repeat for every queued quote — stop early.
        if (/not allowed|session|sign in|owner only|expired/i.test(message)) break;
      }
    }

    return {
      synced,
      pending: rows.filter((entry) => entry.status === "pending").length,
      offline: false,
      error,
    };
  });
}
