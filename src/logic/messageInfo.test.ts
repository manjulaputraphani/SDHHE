import { describe, expect, it } from "vitest";
import {
  directTimes,
  pendingRecipients,
  receiptTimeLabel,
  receiptUserLabel,
  type MessageInfo,
} from "./messageInfo";

const NOW = new Date(2026, 10, 9, 18, 0, 0);
/** A local-time ISO string (the panel shows the shop's local clock). */
const READ_AT = new Date(2026, 10, 9, 16, 20, 0).toISOString();

const info: MessageInfo = {
  recipients: [
    { id: 2, name: "Chaluvaraj", initials: "CH", avatar: null },
    { id: 3, name: null, initials: null, avatar: null },
  ],
  receipts: [
    { userId: 2, user: { id: 2, name: "Chaluvaraj", initials: "CH", avatar: null }, deliveredAt: READ_AT, readAt: READ_AT },
  ],
};

describe("message info", () => {
  it("names a receipt user — and never shows a raw #id", () => {
    expect(receiptUserLabel({ name: "Chaluvaraj" })).toBe("Chaluvaraj");
    expect(receiptUserLabel({ name: "  " })).toBe("Unknown member");
    expect(receiptUserLabel({ name: null })).toBe("Unknown member");
    expect(receiptUserLabel(null)).toBe("Unknown member");
  });

  it("formats a receipt time as 'Today, 04:20 PM' — or '—' when missing", () => {
    expect(receiptTimeLabel(READ_AT, NOW)).toBe("Today, 04:20 PM");
    expect(receiptTimeLabel(null, NOW)).toBe("—");
    expect(receiptTimeLabel(undefined, NOW)).toBe("—");
    expect(receiptTimeLabel("not a date", NOW)).toBe("—");
  });

  it("lists the recipients still waiting — delivered AND read people leave it", () => {
    expect(pendingRecipients(info).map((entry) => entry.id)).toEqual([3]);
    expect(pendingRecipients({ recipients: [], receipts: [] })).toEqual([]);
  });

  it("reads the two times of a 1:1 chat from the ONE recipient's receipt", () => {
    expect(directTimes(info)).toEqual({ deliveredAt: READ_AT, readAt: READ_AT });
    // Nothing has happened yet — both rows show "—".
    expect(
      directTimes({ recipients: [{ id: 2, name: "Chaluvaraj", initials: null, avatar: null }], receipts: [] }),
    ).toEqual({ deliveredAt: null, readAt: null });
  });
});
