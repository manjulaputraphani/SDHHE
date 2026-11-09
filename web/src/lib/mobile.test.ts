import { describe, expect, it } from "vitest";
import { formatTabBadge, getImmersive, setImmersive, subscribeChrome } from "./mobile";

describe("formatTabBadge", () => {
  it("shows the count, 99+ above 99 and nothing at 0", () => {
    expect(formatTabBadge(0)).toBe("");
    expect(formatTabBadge(-3)).toBe("");
    expect(formatTabBadge(7)).toBe("7");
    expect(formatTabBadge(99)).toBe("99");
    expect(formatTabBadge(100)).toBe("99+");
    expect(formatTabBadge(1200)).toBe("99+");
  });
});

describe("immersive chrome store", () => {
  it("flips the flag and notifies subscribers", () => {
    setImmersive(false);
    const seen: boolean[] = [];
    const off = subscribeChrome(() => seen.push(getImmersive()));
    setImmersive(true);
    setImmersive(true); // no change — no second call
    setImmersive(false);
    off();
    expect(seen).toEqual([true, false]);
    expect(getImmersive()).toBe(false);
  });
});
