import { describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import en from "@/locales/en.json";
import { isSummaryDay, nextSummaryAt, summaryIsEmpty, weekStart, weekSummary } from "@/lib/weeklySummary";
import { reconcileWeeklyState, WEEKLY_ENTRY_ID, type ScheduledWeekly, type WeeklyDeps } from "@/services/weeklySummary";
import { tapTarget } from "@/services/notificationTap";

// 2026-11-01 is a Sunday.
const local = (day: number, hour = 12, month = 10) => new Date(2026, month, day, hour, 0).getTime();

describe("the Sunday time", () => {
  it("is today at 17:00 until it passes, then the next Sunday", () => {
    expect(nextSummaryAt(local(1, 10))).toBe(local(1, 17));
    expect(nextSummaryAt(local(1, 17))).toBe(local(8, 17));
    expect(nextSummaryAt(local(1, 20))).toBe(local(8, 17));
    expect(nextSummaryAt(local(2, 9))).toBe(local(8, 17));
    expect(nextSummaryAt(local(7, 23))).toBe(local(8, 17));
  });

  it("knows Sundays, and the Monday the week starts", () => {
    expect(isSummaryDay(local(1))).toBe(true);
    expect(isSummaryDay(local(2))).toBe(false);
    expect(weekStart(local(1, 17))).toBe(local(26, 0, 9));
    expect(weekStart(local(2, 0))).toBe(local(2, 0));
  });
});

describe("the week's summary", () => {
  const at = local(1, 17);
  const parcel = (extra: object) => ({ updatedAt: local(1, 0, 9), info: { status: "in_transit" }, ...extra });

  it("adds up the week's spending, left-out lines excepted, nothing from last week", () => {
    const summary = weekSummary({
      at,
      spending: [
        { at: local(26, 8, 9), amountMga: 1000 },
        { at: local(30, 8, 9), amountMga: 2500 },
        { at: local(25, 20, 9), amountMga: 9999 },
        { at: local(31, 8, 9), amountMga: 700, excluded: true },
      ],
      parcels: [],
      reminders: [],
    });
    expect(summary.spentMga).toBe(3500);
  });

  it("has no spending without the feature", () => {
    expect(weekSummary({ at, spending: null, parcels: [], reminders: [] }).spentMga).toBeNull();
  });

  it("counts only the parcels marked as received this week, not the delivered status nor updates", () => {
    const summary = weekSummary({
      at,
      spending: null,
      parcels: [parcel({ receivedAt: local(28, 12, 9) }), parcel({ info: { status: "delivered" }, updatedAt: local(29, 12, 9) }), parcel({ updatedAt: local(30, 12, 9) }), parcel({ receivedAt: local(20, 12, 9) }), parcel({})],
      reminders: [],
    });
    expect(summary.arrived).toBe(1);
  });

  it("counts the reminders of the 7 days after, not the past ones", () => {
    const summary = weekSummary({ at, spending: null, parcels: [], reminders: [local(1, 9), local(3, 12), local(8, 16), local(8, 18)] });
    expect(summary.upcoming).toBe(2);
  });

  it("counts the reminders later the same day when asked from the card opening", () => {
    const endOfSunday = new Date(2026, 10, 1, 23, 59).getTime();
    const opened = new Date(2026, 10, 1, 10).getTime();
    const reminders = [new Date(2026, 10, 1, 8).getTime(), new Date(2026, 10, 1, 18).getTime(), new Date(2026, 10, 3, 9).getTime()];
    expect(weekSummary({ at: endOfSunday, spending: null, parcels: [], reminders }).upcoming).toBe(1);
    expect(weekSummary({ at: endOfSunday, spending: null, parcels: [], reminders, upcomingFrom: opened }).upcoming).toBe(2);
  });

  it("is empty when there is nothing to tell", () => {
    expect(summaryIsEmpty(weekSummary({ at, spending: [], parcels: [], reminders: [] }))).toBe(true);
    expect(summaryIsEmpty({ spentMga: 0, arrived: 1, upcoming: 0 })).toBe(false);
  });
});

function fakeDeps(initial: ScheduledWeekly | null = null, { permission = "granted", pending = true }: { permission?: string; pending?: boolean } = {}) {
  const log: string[] = [];
  let stored = initial;
  let next = 100;
  const deps: WeeklyDeps = {
    permission: async () => permission,
    notify: async ({ at, body, entryId }) => {
      log.push(`notify ${at.getTime()} ${body} ${entryId}`);
      return (next += 1);
    },
    cancel: async (id) => void log.push(`cancel ${id}`),
    pending: async () => (pending ? new Set(stored ? [stored.id] : []) : new Set()),
    load: () => stored,
    save: (scheduled) => void (stored = scheduled),
  };
  return { deps, log, stored: () => stored };
}

describe("scheduling the Sunday notification", () => {
  const wanted = { at: local(1, 17), title: "Ta semaine", body: "Dépenses : 3 500 Ar." };

  it("schedules once, then leaves it alone while nothing changes", async () => {
    const { deps, log, stored } = fakeDeps();
    await reconcileWeeklyState(wanted, deps);
    expect(log).toEqual([`notify ${wanted.at} ${wanted.body} ${WEEKLY_ENTRY_ID}`]);
    expect(stored()).toMatchObject({ at: wanted.at, body: wanted.body });
    await reconcileWeeklyState(wanted, deps);
    expect(log).toHaveLength(1);
  });

  it("replaces it when the text changes, and cancels it when nothing is wanted", async () => {
    const { deps, log, stored } = fakeDeps({ id: 7, at: wanted.at, body: "old" });
    await reconcileWeeklyState(wanted, deps);
    expect(log[0]).toBe("cancel 7");
    expect(log[1]).toContain("notify");
    await reconcileWeeklyState(null, deps);
    expect(log.at(-1)).toBe("cancel 101");
    expect(stored()).toBeNull();
  });

  it("schedules again when the system lost it", async () => {
    const { deps, log } = fakeDeps({ id: 7, at: wanted.at, body: wanted.body }, { pending: false });
    await reconcileWeeklyState(wanted, deps);
    expect(log).toHaveLength(2);
  });

  it("schedules nothing without the permission", async () => {
    const { deps, log } = fakeDeps(null, { permission: "denied" });
    await reconcileWeeklyState(wanted, deps);
    expect(log).toEqual([]);
  });

  it("opens the home screen when tapped", () => {
    expect(tapTarget(WEEKLY_ENTRY_ID)).toEqual({ pathname: "/" });
  });
});

describe("texts", () => {
  it("exist in both languages with the same placeholders", () => {
    for (const dictionary of [fr, en]) {
      expect(dictionary.weekly.arrived.one).toContain("{count}");
      expect(dictionary.weekly.upcoming.other).toContain("{count}");
      expect(dictionary.weekly.spent).toContain("{amount}");
      expect(dictionary.weekly.locked).toContain("{plan}");
    }
  });
});
