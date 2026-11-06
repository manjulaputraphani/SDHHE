/**
 * Delivery and read marks for a chat message (Phase 14).
 *
 * `sent` = the server has it, `delivered` = the other device got it, `read`
 * = the other person has seen it. The rules are pure so the screens and the
 * Worker agree on what a tick means.
 */

/** The state of one message for one member. */
export type MemberState = {
  userId: number;
  delivered: boolean;
  read: boolean;
};

export type TickState = "sent" | "delivered" | "read";

/**
 * The tick to show on my own message.
 *
 * The other members decide: everybody received it → ✓✓, everybody read it →
 * ✓✓✓ (blue). My own state never counts.
 */
export function tickState(states: MemberState[], otherMemberIds: number[]): TickState {
  const others = otherMemberIds.filter((id) => states.some((state) => state.userId === id));
  if (others.length === 0) return "sent";
  const allDelivered = others.every((id) => {
    const state = states.find((entry) => entry.userId === id);
    return Boolean(state?.delivered);
  });
  if (!allDelivered) return "sent";
  const allRead = others.every((id) => {
    const state = states.find((entry) => entry.userId === id);
    return Boolean(state?.read);
  });
  return allRead ? "read" : "delivered";
}

/** How many of the other members got / read the message. */
export function summarise(
  states: MemberState[],
  otherMemberIds: number[],
): { delivered: number; read: number; total: number } {
  const others = otherMemberIds.filter((id) => id > 0);
  let delivered = 0;
  let read = 0;
  for (const id of others) {
    const state = states.find((entry) => entry.userId === id);
    if (state?.delivered) delivered += 1;
    if (state?.read) read += 1;
  }
  return { delivered, read, total: others.length };
}
