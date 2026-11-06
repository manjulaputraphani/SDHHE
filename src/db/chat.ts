/**
 * Team Chat + receipt approvals (Phase 12) — database access.
 *
 * The live room is a Cloudflare Durable Object; these functions own the
 * durable half: the message history in `chat_messages` and the receipt
 * approval records in `receipt_requests`.
 *
 * Money is integer paise. The receipt file itself lives in R2 — only its key
 * is stored here.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, TxDb } from "./client";
import { chatMessages, receiptRequests } from "./schema";
import { logActivity } from "./activity";
import {
  CHAT_ROOM_DEFAULT,
  MAX_MESSAGE_CHARS,
  MAX_RECEIPT_BYTES,
  isReceiptMimeAllowed,
} from "../logic/chat";

export const CHAT_ROOM = CHAT_ROOM_DEFAULT;

export type ChatMessageKind = "text" | "receipt" | "system";
export type ReceiptStatus = "pending" | "approved" | "rejected";

export type ChatMessage = {
  id: number;
  room: string;
  userId: number | null;
  author: string;
  role: string;
  kind: ChatMessageKind;
  body: string;
  receiptId: number | null;
  createdAt: string;
  /** When the message was last edited (if edited). */
  editedAt?: string;
  /** The sender accepted the AI polish suggestion (Phase 15). */
  aiPolished?: boolean;
  /** Who has received it (Phase 14). */
  deliveredBy?: number[];
  /** Who has read it (Phase 14). */
  readBy?: number[];
};

export type ReceiptRequest = {
  id: number;
  submittedBy: number | null;
  submitterName: string;
  title: string;
  amountPaise: number;
  note: string | null;
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: ReceiptStatus;
  decidedBy: number | null;
  deciderName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  messageId: number | null;
  createdAt: string;
};

// ---------------------------------------------------------------- validation

const receiptFileSchema = z.object({
  r2Key: z
    .string({ error: "Receipt file is required" })
    .trim()
    .min(1, "Receipt file is required")
    .max(300),
  filename: z
    .string({ error: "Receipt file is required" })
    .trim()
    .min(1, "Receipt file is required")
    .max(200),
  mime: z
    .string({ error: "Receipt file is required" })
    .trim()
    .min(1, "Receipt file is required")
    .max(120),
  sizeBytes: z
    .number({ error: "Receipt file size is required" })
    .int("Receipt file size must be a whole number")
    .min(0, "Receipt file size cannot be negative")
    .max(MAX_RECEIPT_BYTES, "Receipt file must be 4 MB or smaller"),
});

const receiptPayloadSchema = receiptFileSchema.extend({
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(120, "Title is too long"),
  amountPaise: z
    .number({ error: "Amount is required" })
    .int("Amount must be a whole number of paise")
    .min(1, "Amount must be more than 0"),
  note: z.string().trim().max(500, "Note is too long").optional(),
});

export type ReceiptPayload = z.infer<typeof receiptPayloadSchema>;

const messageInputSchema = z.object({
  kind: z.enum(["text", "receipt"], { error: "Message kind must be text or receipt" }),
  body: z
    .string({ error: "Message is required" })
    .trim()
    .max(MAX_MESSAGE_CHARS, `Message is too long (max ${MAX_MESSAGE_CHARS})`),
  receipt: receiptPayloadSchema.optional(),
  /** The sender accepted the AI polish suggestion (Phase 15) — text only. */
  aiPolished: z.boolean().optional().catch(false),
});

export type MessageInput = {
  kind: "text" | "receipt";
  body: string;
  receipt?: ReceiptPayload;
  aiPolished?: boolean;
};

/** Validate a message that a member sent. Throws with a user-facing message. */
export function parseMessageInput(input: unknown): MessageInput {
  const result = messageInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid message");
  }
  const data = result.data;
  if (data.kind === "text") {
    if (!data.body) throw new Error("Message cannot be empty");
    return { kind: "text", body: data.body, aiPolished: data.aiPolished === true };
  }
  if (!data.receipt) throw new Error("Receipt details are required");
  if (!data.receipt.mime || !isReceiptMimeAllowed(data.receipt.mime)) {
    throw new Error("Receipt must be an image or PDF");
  }
  return {
    kind: "receipt",
    body: data.body,
    aiPolished: false,
    receipt: {
      ...data.receipt,
      title: data.receipt.title.trim(),
      amountPaise: data.receipt.amountPaise,
      note: data.receipt.note?.trim() || undefined,
    },
  };
}

/** Validate the receipt itself (used when the file is already in R2). */
export function parseReceiptInput(input: unknown): ReceiptPayload {
  const result = receiptPayloadSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid receipt");
  }
  if (!isReceiptMimeAllowed(result.data.mime)) {
    throw new Error("Receipt must be an image or PDF");
  }
  return {
    ...result.data,
    title: result.data.title.trim(),
    amountPaise: result.data.amountPaise,
    note: result.data.note?.trim() || undefined,
  };
}

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"], {
    message: "Decision must be approve or reject",
  }),
  note: z.string().trim().max(500, "Note is too long").optional(),
});

export type DecisionInput = { decision: "approved" | "rejected"; note?: string };

/** Validate an approve/reject decision. */
export function parseDecision(input: unknown): DecisionInput {
  const raw = input as { decision?: unknown; note?: unknown } | null;
  const word = String(raw?.decision ?? "").trim().toLowerCase();
  const mapped =
    word === "approve" || word === "approved"
      ? "approved"
      : word === "reject" || word === "rejected"
        ? "rejected"
        : null;
  const result = decisionSchema.safeParse({
    decision: mapped,
    note: raw?.note === undefined ? undefined : String(raw.note),
  });
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid decision");
  }
  return { decision: result.data.decision, note: result.data.note?.trim() || undefined };
}

// --------------------------------------------------------------- row mapping

/** The row shape drizzle returns (camelCase property names). */
type MessageRow = {
  id: number;
  room: string;
  userId: number | null;
  author: string;
  role: string;
  kind: string;
  body: string;
  receiptId: number | null;
  createdAt: Date;
  editedAt: Date;
  aiPolished: boolean;
};

type ReceiptRow = {
  id: number;
  submittedBy: number | null;
  submitterName: string;
  title: string;
  amountPaise: number;
  note: string | null;
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: string;
  decidedBy: number | null;
  deciderName: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  messageId: number | null;
  createdAt: Date;
};

/** Map a `chat_messages` row to the shape the API returns. */
export function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    room: row.room,
    userId: row.userId,
    author: row.author,
    role: row.role,
    kind: row.kind as ChatMessageKind,
    body: row.body,
    receiptId: row.receiptId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt.getTime() > row.createdAt.getTime() ? row.editedAt.toISOString() : undefined,
    aiPolished: Boolean(row.aiPolished),
  };
}

/** Map a `receipt_requests` row to the shape the API returns. */
export function toReceipt(row: ReceiptRow): ReceiptRequest {
  return {
    id: row.id,
    submittedBy: row.submittedBy,
    submitterName: row.submitterName,
    title: row.title,
    amountPaise: row.amountPaise,
    note: row.note,
    r2Key: row.r2Key,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    status: row.status as ReceiptStatus,
    decidedBy: row.decidedBy,
    deciderName: row.deciderName,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    messageId: row.messageId,
    createdAt: row.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ messages

/**
 * The room history, oldest first. `limit` keeps the NEWEST rows (a chat that
 * has been running for a month still opens on the latest messages).
 */
export async function listMessages(
  db: Db,
  options: { room?: string; limit?: number } = {},
): Promise<ChatMessage[]> {
  const room = options.room ?? CHAT_ROOM;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = (await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.room, room))
    .orderBy(desc(chatMessages.id))
    .limit(limit)) as MessageRow[];
  return rows.reverse().map(toMessage);
}

/** Append one message to the room. */
export async function insertMessage(
  db: Db | TxDb,
  input: {
    room?: string;
    userId: number | null;
    author: string;
    role?: string;
    kind: ChatMessageKind;
    body: string;
    receiptId?: number | null;
    /** The sender accepted the AI polish suggestion (Phase 15). */
    aiPolished?: boolean;
  },
): Promise<ChatMessage> {
  const [created] = (await db
    .insert(chatMessages)
    .values({
      room: input.room ?? CHAT_ROOM,
      userId: input.userId ?? null,
      author: input.author,
      role: input.role ?? "staff",
      kind: input.kind,
      body: input.body,
      receiptId: input.receiptId ?? null,
      aiPolished: input.aiPolished === true,
    })
    .returning()) as MessageRow[];
  return toMessage(created);
}

/** Input for updating a message. */
export type MessageEditInput = {
  body: string;
};

/** Validate a message edit input. */
export function parseMessageEditInput(input: unknown): MessageEditInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid message edit input');
  }
  const body = String((input as any).body ?? '').trim();
  if (!body) {
    throw new Error('Message cannot be empty');
  }
  if (body.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Message is too long (max ${MAX_MESSAGE_CHARS})`);
  }
  return { body };
}

/** Update a message's body and set the edited timestamp. */
export async function updateMessage(
  db: Db | TxDb,
  messageId: number,
  input: {
    userId: number | null; // For authorization check
    body: string;
  },
): Promise<ChatMessage> {
  const { body } = parseMessageEditInput(input);
  const { userId } = input;

  // Verify the message exists and check authorization (basic check - full auth in API layer)
  const [existing] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);

  if (!existing) {
    throw new Error('Message not found');
  }

  // Additional authorization: only the message author can edit it
  // (Full authorization with roles/permissions should happen in the API layer)
  if (userId !== null && existing.userId !== null && userId !== existing.userId) {
    throw new Error('Not authorized to edit this message');
  }

  const [updated] = await db
    .update(chatMessages)
    .set({
      body: body,
      editedAt: new Date(),
    })
    .where(eq(chatMessages.id, messageId))
    .returning() as MessageRow[];

  if (!updated) {
    throw new Error('Failed to update message');
  }

  await logActivity(db, {
    event: 'message.update',
    summary: `Message #${messageId} updated`,
    entity: 'chat_messages',
    entityId: messageId,
  });

  return toMessage(updated);
}

/** Point a receipt at the message that shows it. */
export async function linkReceiptMessage(
  db: Db | TxDb,
  receiptId: number,
  messageId: number,
): Promise<void> {
  await db
    .update(receiptRequests)
    .set({ messageId })
    .where(eq(receiptRequests.id, receiptId));
}

// ------------------------------------------------------------------ receipts

/** Receipts, newest first. `status` filters (e.g. only "pending"). */
export async function listReceipts(
  db: Db,
  options: { status?: ReceiptStatus; limit?: number; room?: string } = {},
): Promise<ReceiptRequest[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const filters = [
    options.status ? eq(receiptRequests.status, options.status) : undefined,
    options.room
      ? sql`${receiptRequests.messageId} in (select ${chatMessages.id} from ${chatMessages} where ${chatMessages.room} = ${options.room})`
      : undefined,
  ].filter(Boolean) as ReturnType<typeof eq>[];
  const rows = (await db
    .select()
    .from(receiptRequests)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(receiptRequests.id))
    .limit(limit)) as ReceiptRow[];
  return rows.map(toReceipt);
}

/** The room a receipt belongs to (the room of the message that shows it). */
export async function receiptRoom(db: Db, receiptId: number): Promise<string | null> {
  const [row] = await db
    .select({ room: chatMessages.room })
    .from(receiptRequests)
    .innerJoin(chatMessages, eq(chatMessages.id, receiptRequests.messageId))
    .where(eq(receiptRequests.id, receiptId))
    .limit(1);
  return row?.room ?? null;
}

/** The room a message belongs to. */
export async function messageRoom(db: Db, messageId: number): Promise<string | null> {
  const [row] = await db
    .select({ room: chatMessages.room })
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  return row?.room ?? null;
}

/** One receipt by id. */
export async function getReceipt(db: Db | TxDb, id: number): Promise<ReceiptRequest | null> {
  const rows = (await db
    .select()
    .from(receiptRequests)
    .where(eq(receiptRequests.id, id))
    .limit(1)) as ReceiptRow[];
  return rows[0] ? toReceipt(rows[0]) : null;
}

/** How many receipts are still waiting for a decision. */
export async function pendingReceiptCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(receiptRequests)
    .where(eq(receiptRequests.status, "pending"));
  return row?.total ?? 0;
}

/** Create a receipt that is waiting for approval. */
export async function createReceipt(
  db: Db | TxDb,
  input: {
    submittedBy: number | null;
    submitterName: string;
    receipt: ReceiptPayload;
  },
): Promise<ReceiptRequest> {
  const data = parseReceiptInput(input.receipt);
  const [created] = (await db
    .insert(receiptRequests)
    .values({
      submittedBy: input.submittedBy ?? null,
      submitterName: input.submitterName,
      title: data.title,
      amountPaise: data.amountPaise,
      note: data.note ?? null,
      r2Key: data.r2Key,
      filename: data.filename,
      mime: data.mime,
      sizeBytes: data.sizeBytes,
      status: "pending",
    })
    .returning()) as ReceiptRow[];
  await logActivity(db, {
    event: "receipt.create",
    summary: `Receipt #${created.id} submitted: ${data.title} (₹${(data.amountPaise / 100).toFixed(2)})`,
    entity: "receipt",
    entityId: created.id,
  });
  return toReceipt(created);
}

/**
 * Approve or reject a receipt. A receipt can only be decided once — the
 * update only matches a row that is still pending.
 */
export async function decideReceipt(
  db: Db | TxDb,
  id: number,
  input: { decision: string; note?: string },
  decider: { userId: number | null; name: string },
): Promise<ReceiptRequest> {
  const decision = parseDecision(input);
  const [updated] = (await db
    .update(receiptRequests)
    .set({
      status: decision.decision,
      decidedBy: decider.userId ?? null,
      deciderName: decider.name,
      decisionNote: decision.note ?? null,
      decidedAt: new Date(),
    })
    .where(and(eq(receiptRequests.id, id), eq(receiptRequests.status, "pending")))
    .returning()) as ReceiptRow[];
  if (!updated) {
    const existing = await getReceipt(db, id);
    if (!existing) throw new Error("Receipt not found");
    throw new Error("This receipt was already decided");
  }
  await logActivity(db, {
    event: decision.decision === "approved" ? "receipt.approve" : "receipt.reject",
    summary: `Receipt #${id} ${decision.decision} by ${decider.name}${
      decision.note ? ` — ${decision.note}` : ""
    }`,
    entity: "receipt",
    entityId: id,
  });
  return toReceipt(updated);
}
