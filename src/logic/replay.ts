import { allocateFifo, type FifoBatch } from "./fifo";
import { computeUsage } from "./stockCheck";
import { ReplayConflictError } from "./errors";

export type ReplayBatch = {
  id: number;
  qtyOriginal: number;
  unitPricePaise: number;
  purchaseDate: string;
};

export type ReplayMovement = {
  id: number;
  type: "PURCHASE" | "STOCK_CHECK" | "USAGE" | "WASTAGE" | "ADJUSTMENT" | "ROASTING";
  movementDate: string;
  qtyChange: number;
  enteredQtyLeft: number | null;
};

export type ReplayResult = {
  batches: { id: number; qtyRemaining: number }[];
  movements: { id: number; qtyChange: number; costPaise: number }[];
  links: {
    movementId: number;
    batchId: number;
    qtyTaken: number;
    unitPricePaise: number;
    costPaise: number;
  }[];
};

const REPLAYED = new Set<ReplayMovement["type"]>(["STOCK_CHECK", "USAGE", "WASTAGE", "ROASTING"]);

/**
 * Recompute every consumption movement for one item after a purchase changed
 * or was deleted (docs/BLUEPRINT.md §6). Pure: no DB, no mutation of inputs.
 *
 * Batches start from their full `qtyOriginal`; movements are replayed oldest
 * first, allocating FIFO exactly like the real save path. Any movement that no
 * longer fits throws ReplayConflictError naming its date.
 */
export function replayItem(
  batches: readonly ReplayBatch[],
  movements: readonly ReplayMovement[],
  factor = 1000,
): ReplayResult {
  const remaining = new Map<number, number>(batches.map((b) => [b.id, b.qtyOriginal]));

  const ordered = movements
    .filter((m) => REPLAYED.has(m.type))
    .slice()
    .sort((a, b) => a.movementDate.localeCompare(b.movementDate) || a.id - b.id);

  const outMovements: ReplayResult["movements"] = [];
  const links: ReplayResult["links"] = [];

  for (const movement of ordered) {
    const current = [...remaining.values()].reduce((sum, qty) => sum + qty, 0);

    if (movement.type === "STOCK_CHECK" && movement.enteredQtyLeft === null) {
      throw new ReplayConflictError(
        movement.id,
        movement.movementDate,
        "stock check has no 'stock left' value",
      );
    }

    let used: number;
    try {
      used =
        movement.type === "STOCK_CHECK"
          ? computeUsage(current, movement.enteredQtyLeft as number)
          : Math.abs(movement.qtyChange);
    } catch (err) {
      throw new ReplayConflictError(
        movement.id,
        movement.movementDate,
        err instanceof Error ? err.message : String(err),
      );
    }

    const pool: FifoBatch[] = batches.map((batch) => ({
      id: batch.id,
      qtyRemaining: remaining.get(batch.id) ?? 0,
      unitPricePaise: batch.unitPricePaise,
      purchaseDate: batch.purchaseDate,
    }));

    let allocation;
    try {
      allocation = allocateFifo(pool, used, factor);
    } catch (err) {
      throw new ReplayConflictError(
        movement.id,
        movement.movementDate,
        err instanceof Error ? err.message : String(err),
      );
    }

    for (const take of allocation.takes) {
      remaining.set(take.batchId, (remaining.get(take.batchId) ?? 0) - take.qty);
      links.push({
        movementId: movement.id,
        batchId: take.batchId,
        qtyTaken: take.qty,
        unitPricePaise: take.unitPricePaise,
        costPaise: take.costPaise,
      });
    }

    outMovements.push({
      id: movement.id,
      qtyChange: -used,
      costPaise: allocation.totalCostPaise,
    });
  }

  return {
    batches: batches.map((batch) => ({
      id: batch.id,
      qtyRemaining: remaining.get(batch.id) ?? 0,
    })),
    movements: outMovements,
    links,
  };
}
