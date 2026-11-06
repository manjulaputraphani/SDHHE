/**
 * AI polish (Phase 15) — the pure rules shared by the Worker and the tests.
 *
 * The owner turns polish on per group; in those groups a message is rewritten
 * professionally BEFORE it is sent — as a suggestion the sender confirms.
 * The AI text is never stored unless the member sends it.
 */

/** The system prompt the polish endpoint sends to the model (the plan's wording). */
export const POLISH_SYSTEM_PROMPT = `Rewrite this team message for a coffee trading business group so it is clear,
polite and professional. Keep the SAME meaning, language, names, numbers, amounts, dates and
emojis. Keep line breaks and lists. Do not add new facts, greetings or signatures that are not
there. If it is already fine, return it unchanged. Return only the message text.`;

/**
 * Why the AI is skipped for this text (null = polish it).
 *
 * Tiny texts and emoji-only texts go out as they are — the AI has nothing to
 * improve. A receipt never reaches this check: the client does not ask for a
 * polish when a file is attached.
 */
export function polishSkipReason(text: string): "short" | "emoji" | null {
  const trimmed = text.trim();
  if (trimmed.length < 15) return "short";
  // Only emojis, whitespace and punctuation — not one letter or digit.
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return "emoji";
  return null;
}

/** Every number token of the text, commas and decimals normalised away. */
function numberTokens(text: string): string[] {
  const matches = text.match(/\d[\d.,]*\d|\d/g) ?? [];
  const normalised = matches.map((token) => token.replace(/[.,]/g, "")).filter(Boolean);
  return [...new Set(normalised)];
}

/**
 * Did the polished text keep every number of the original?
 *
 * Amounts are the heart of a trade message — if the rewrite drops or writes
 * out a number, the original stands and the sender sees
 * "Kept original — numbers changed".
 */
export function keptAllNumbers(original: string, polished: string): boolean {
  const wanted = numberTokens(original);
  if (wanted.length === 0) return true;
  const got = new Set(numberTokens(polished));
  return wanted.every((token) => got.has(token));
}
