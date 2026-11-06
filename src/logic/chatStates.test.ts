import { describe, expect, it } from "vitest";
import { summarise, tickState } from "./chatStates";

describe("tickState", () => {
  it("is 'sent' while nobody has received the message", () => {
    expect(tickState([], [4])).toBe("sent");
  });

  it("is 'delivered' when the other member got it but has not read it", () => {
    expect(tickState([{ userId: 4, delivered: true, read: false }], [4])).toBe("delivered");
  });

  it("is 'read' when the other member has read it", () => {
    expect(tickState([{ userId: 4, delivered: true, read: true }], [4])).toBe("read");
  });

  it("ignores my own state", () => {
    expect(tickState([{ userId: 1, delivered: true, read: true }], [4])).toBe("sent");
  });

  it("is 'read' when everybody else has read it", () => {
    expect(
      tickState(
        [
          { userId: 4, delivered: true, read: true },
          { userId: 5, delivered: true, read: true },
        ],
        [4, 5],
      ),
    ).toBe("read");
  });

  it("is only 'delivered' when somebody is still behind", () => {
    expect(
      tickState(
        [
          { userId: 4, delivered: true, read: true },
          { userId: 5, delivered: true, read: false },
        ],
        [4, 5],
      ),
    ).toBe("delivered");
  });

  it("is 'sent' when the other member has not received it yet", () => {
    expect(tickState([{ userId: 4, delivered: false, read: false }], [4])).toBe("sent");
  });
});

describe("summarise", () => {
  it("counts the other members", () => {
    expect(
      summarise(
        [
          { userId: 4, delivered: true, read: true },
          { userId: 5, delivered: true, read: false },
          { userId: 1, delivered: true, read: true },
        ],
        [4, 5],
      ),
    ).toEqual({ delivered: 2, read: 1, total: 2 });
  });

  it("handles a chat with nobody else", () => {
    expect(summarise([], [])).toEqual({ delivered: 0, read: 0, total: 0 });
  });
});
