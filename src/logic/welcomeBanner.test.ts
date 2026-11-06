/**
 * The welcome-banner flag (Phase 15 fix): the banner is shown only right
 * after a real login, never on refresh / tab change / new tab.
 *
 * The flag lives in sessionStorage under one key, so a new tab (which gets
 * a fresh sessionStorage) never sees it — and it is cleared the moment the
 * banner consumes it, so a later refresh in the SAME tab does not show it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  WELCOME_FLAG_KEY,
  clearWelcomeFlag,
  consumeWelcomeFlag,
  setWelcomeFlag,
} from "./welcomeBanner";

describe("the welcome flag", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("is set by the login success handler and read once", () => {
    expect(consumeWelcomeFlag()).toBe(false);
    setWelcomeFlag();
    expect(window.sessionStorage.getItem(WELCOME_FLAG_KEY)).toBe("1");
    // The banner consumes it: the first read is true, the second is not.
    expect(consumeWelcomeFlag()).toBe(true);
    expect(consumeWelcomeFlag()).toBe(false);
    expect(window.sessionStorage.getItem(WELCOME_FLAG_KEY)).toBeNull();
  });

  it("clearWelcomeFlag removes a set flag (logout)", () => {
    setWelcomeFlag();
    clearWelcomeFlag();
    expect(consumeWelcomeFlag()).toBe(false);
  });

  it("a new tab (fresh storage) never sees the flag", () => {
    // sessionStorage is per-tab: clearing it simulates opening a new tab.
    setWelcomeFlag();
    window.sessionStorage.clear();
    expect(consumeWelcomeFlag()).toBe(false);
  });
});
