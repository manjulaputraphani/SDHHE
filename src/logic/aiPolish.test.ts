import { describe, expect, it } from "vitest";
import { keptAllNumbers, POLISH_SYSTEM_PROMPT, polishSkipReason } from "./aiPolish";

describe("polishSkipReason", () => {
  it("skips a text under 15 characters", () => {
    expect(polishSkipReason("ok boss")).toBe("short");
    expect(polishSkipReason("")).toBe("short");
    expect(polishSkipReason("send it 👍")).toBe("short");
  });

  it("does not skip a text of 15 characters or more", () => {
    expect(polishSkipReason("pls send 20 bags tmrw")).toBeNull();
    expect(polishSkipReason("123456789012345")).toBeNull();
  });

  it("skips a text that is only emojis and punctuation", () => {
    expect(polishSkipReason("👍👍👍 🙏🎉 ✨✨✨✨")).toBe("emoji");
    expect(polishSkipReason("......... !!!!!!!")).toBe("emoji");
  });

  it("keeps an emoji-heavy text that still has words", () => {
    expect(polishSkipReason("👍👍👍 stock ready tmrw 🙏")).toBeNull();
  });
});

describe("keptAllNumbers", () => {
  it("passes when every number survived", () => {
    expect(keptAllNumbers("pls send 20 bags tmrw", "Please send 20 bags by tomorrow.")).toBe(true);
    expect(keptAllNumbers("rate is ₹96/kg", "The rate is ₹ 96 per kg.")).toBe(true);
  });

  it("fails when a number was dropped or written out", () => {
    expect(keptAllNumbers("pls send 20 bags tmrw", "Please send twenty bags by tomorrow.")).toBe(
      false,
    );
    expect(keptAllNumbers("2 kg and 500 g", "2 kg")).toBe(false);
  });

  it("tolerates re-formatted Indian amounts", () => {
    expect(keptAllNumbers("paid 1,20,000 today", "Paid ₹120000 today.")).toBe(true);
  });

  it("passes when the original has no numbers at all", () => {
    expect(keptAllNumbers("sir stock is ready", "Sir, the stock is ready.")).toBe(true);
  });
});

describe("POLISH_SYSTEM_PROMPT", () => {
  it("carries the plan's wording", () => {
    expect(POLISH_SYSTEM_PROMPT).toContain("coffee trading business");
    expect(POLISH_SYSTEM_PROMPT).toContain("Return only the message text");
  });
});
