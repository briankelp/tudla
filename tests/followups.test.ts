import { describe, expect, it } from "vitest";
import { isFollowUpDue, localDate } from "../apps/web/src/followups.js";

describe("follow-up dates", () => {
  const prospect = (followUpOn: string | null, stage = "New") => ({
    followUpOn,
    stage,
  });

  it("marks yesterday and today due, but leaves tomorrow upcoming", () => {
    expect(isFollowUpDue(prospect("2026-10-17"), "2026-10-18")).toBe(true);
    expect(isFollowUpDue(prospect("2026-10-18"), "2026-10-18")).toBe(true);
    expect(isFollowUpDue(prospect("2026-10-19"), "2026-10-18")).toBe(false);
  });

  it("does not treat missing dates or closed prospects as due", () => {
    expect(isFollowUpDue(prospect(null), "2026-10-18")).toBe(false);
    expect(
      isFollowUpDue(prospect("2026-10-17", "Not a fit"), "2026-10-18"),
    ).toBe(false);
  });

  it("formats a date from local calendar components", () => {
    const date = new Date(2026, 9, 3, 0, 30);
    expect(localDate(date)).toBe("2026-10-03");
  });
});
