import { describe, expect, it } from "vitest";
import { makeRepeat, nextOccurrence, occurrence, previousOccurrence, parseRepeat, snoozeAt, type ReminderRepeat } from "@/lib/reminderRepeat";

// Madagascar: UTC+3, no daylight saving time.
const MG = 180;
const local = (year: number, month: number, day: number, hours = 9, minutes = 0) => Date.UTC(year, month - 1, day, hours, minutes) - MG * 60_000;
const repeat = (every: ReminderRepeat["every"], from: number): ReminderRepeat => ({ every, from, offset: MG });

describe("occurrence", () => {
  it("keeps the 31st: last day of shorter months, back to the 31st after", () => {
    const monthly = repeat("monthly", local(2026, 1, 31, 9, 30));
    expect(occurrence(monthly, 0)).toBe(local(2026, 1, 31, 9, 30));
    expect(occurrence(monthly, 1)).toBe(local(2026, 2, 28, 9, 30));
    expect(occurrence(monthly, 2)).toBe(local(2026, 3, 31, 9, 30));
    expect(occurrence(monthly, 3)).toBe(local(2026, 4, 30, 9, 30));
    expect(occurrence(monthly, 4)).toBe(local(2026, 5, 31, 9, 30));
    // Leap year.
    expect(occurrence(repeat("monthly", local(2028, 1, 31)), 1)).toBe(local(2028, 2, 29));
  });

  it("puts a 29 February on the 28th in other years", () => {
    const yearly = repeat("yearly", local(2028, 2, 29, 8));
    expect(occurrence(yearly, 1)).toBe(local(2029, 2, 28, 8));
    expect(occurrence(yearly, 4)).toBe(local(2032, 2, 29, 8));
  });

  it("goes over the end of the year", () => {
    expect(occurrence(repeat("monthly", local(2026, 11, 15)), 2)).toBe(local(2027, 1, 15));
  });

  it("keeps the local time even when it falls on another UTC day", () => {
    // 1 March 01:00 in Madagascar is still 28 February in UTC.
    const monthly = repeat("monthly", local(2026, 3, 1, 1));
    expect(occurrence(monthly, 1)).toBe(local(2026, 4, 1, 1));
  });
});

describe("nextOccurrence", () => {
  const monthly = repeat("monthly", local(2026, 1, 31, 9));

  it("is the first occurrence strictly after the given time", () => {
    expect(nextOccurrence(monthly, local(2026, 1, 31, 9))).toBe(local(2026, 2, 28, 9));
    expect(nextOccurrence(monthly, local(2026, 3, 10))).toBe(local(2026, 3, 31, 9));
    expect(nextOccurrence(monthly, local(2025, 6, 1))).toBe(local(2026, 1, 31, 9));
  });

  it("skips the months the app wasn't opened, without overshooting", () => {
    expect(nextOccurrence(monthly, local(2036, 7, 1))).toBe(local(2036, 7, 31, 9));
    expect(nextOccurrence(repeat("yearly", local(2026, 10, 27, 9)), local(2040, 10, 27, 10))).toBe(local(2041, 10, 27, 9));
  });
});

describe("makeRepeat / parseRepeat", () => {
  it("records the device's UTC offset", () => {
    const at = Date.now();
    expect(makeRepeat("yearly", at)).toEqual({ every: "yearly", from: at, offset: -new Date(at).getTimezoneOffset() });
  });

  it("only accepts well-formed values", () => {
    expect(parseRepeat({ every: "monthly", from: 5, offset: 180 })).toEqual({ every: "monthly", from: 5, offset: 180 });
    expect(parseRepeat({ every: "monthly", from: 5 })).toEqual({ every: "monthly", from: 5, offset: 0 });
    expect(parseRepeat({ every: "weekly", from: 5 })).toBeNull();
    expect(parseRepeat({ every: "monthly", from: "x" })).toBeNull();
    expect(parseRepeat(null)).toBeNull();
    expect(parseRepeat("monthly")).toBeNull();
  });
});

describe("snoozeAt", () => {
  const now = new Date(2026, 9, 27, 14, 35).getTime();

  it("puts off by an hour, a day or a week, at the same time of day", () => {
    expect(snoozeAt("hour", now)).toBe(now + 3_600_000);
    expect(snoozeAt("tomorrow", now)).toBe(new Date(2026, 9, 28, 14, 35).getTime());
    expect(snoozeAt("week", now)).toBe(new Date(2026, 10, 3, 14, 35).getTime());
  });
});

describe("previousOccurrence", () => {
  const monthly = repeat("monthly", local(2026, 1, 31, 9));

  it("is the last occurrence strictly before the given time", () => {
    expect(previousOccurrence(monthly, local(2026, 3, 31, 9))).toBe(local(2026, 2, 28, 9));
    expect(previousOccurrence(monthly, local(2026, 3, 31, 10))).toBe(local(2026, 3, 31, 9));
    expect(previousOccurrence(monthly, local(2036, 7, 1))).toBe(local(2036, 6, 30, 9));
  });

  it("is null before the first one", () => {
    expect(previousOccurrence(monthly, local(2026, 1, 31, 9))).toBeNull();
  });
});
