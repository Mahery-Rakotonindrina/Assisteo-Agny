import { describe, expect, it } from "vitest";
import { addDays, daysBetween, groupByDay, localDay } from "@/lib/agenda/days";
import { agendaSources, collectAgenda } from "@/lib/agenda/sources";
import { expensesSource } from "@/lib/agenda/sources/expenses";
import { garageSource } from "@/lib/agenda/sources/garage";
import { healthSource } from "@/lib/agenda/sources/health";
import { homeSource } from "@/lib/agenda/sources/home";
import { loansSource } from "@/lib/agenda/sources/loans";
import { LATE_PAPER_DAYS, papersSource } from "@/lib/agenda/sources/papers";
import { parcelsSource } from "@/lib/agenda/sources/parcels";
import { plantsSource } from "@/lib/agenda/sources/plants";
import { remindersSource } from "@/lib/agenda/sources/reminders";
import type { AgendaContext, AgendaData, AgendaItem, AgendaSource } from "@/lib/agenda/types";
import { mockAnalysis } from "@/lib/ai/mock";
import type { Analysis } from "@/lib/ai/schema";
import { occurrenceKey, type ExpenseRecord } from "@/lib/expenses";
import type { PlanFeature } from "@/lib/plans";
import { makeRepeat } from "@/lib/reminderRepeat";
import { dayString } from "@/lib/papers";
import type { HistoryEntry } from "@/types/history";

// Monday 16 November 2026, 10:00 (the device's own time zone, like the app).
const now = new Date(2026, 10, 16, 10).getTime();
const day = (month: number, date: number, hour = 0, minute = 0) => new Date(2026, month - 1, date, hour, minute).getTime();
const ymd = (at: number) => dayString(at);

const emptyData: AgendaData = { entries: [], appointments: [], profiles: [], loans: [], records: [], parcels: [], vehicles: [], homeItems: [], plants: [] };
const ALL: PlanFeature[] = ["reminders", "expenses", "loans", "garage", "inventory", "plants"];
const context = (data: Partial<AgendaData>, options: { features?: PlanFeature[]; days?: number } = {}): AgendaContext => {
  const from = localDay(now);
  return { now, from, to: addDays(from, options.days ?? 30), has: (feature) => (options.features ?? ALL).includes(feature), data: { ...emptyData, ...data } };
};
const keys = (items: AgendaItem[]) => items.map((item) => item.key).sort();

const entry = (id: string, extra: Partial<HistoryEntry> = {}, analysis: Partial<Analysis> = {}): HistoryEntry =>
  ({ id, createdAt: 1, mode: "auto", thumbnail: "", preview: "", analysis: { ...mockAnalysis("document", "fr"), ...analysis }, meta: { model: "m", demo: true, durationMs: 0 }, ...extra }) as HistoryEntry;

describe("agenda: days", () => {
  it("groups by local day, in order", () => {
    const items = [
      { key: "b", domain: "x", at: day(11, 18, 23, 30), timed: true },
      { key: "a", domain: "x", at: day(11, 17, 8), timed: true },
      { key: "c", domain: "x", at: day(11, 18, 0, 15), timed: true },
    ] as AgendaItem[];
    const days = groupByDay(items);
    expect(days.map((group) => ymd(group.day))).toEqual(["2026-11-17", "2026-11-18"]);
    // 23:30 and 00:15 are on the same local day only if the device says so: here both are the 18th.
    expect(days[1].items.map((item) => item.key)).toEqual(["c", "b"]);
  });

  it("puts the things of a whole day before the timed ones", () => {
    const items = [
      { key: "timed", domain: "x", at: day(11, 17, 8), timed: true },
      { key: "all", domain: "x", at: day(11, 17), timed: false },
    ] as AgendaItem[];
    expect(groupByDay(items)[0].items.map((item) => item.key)).toEqual(["all", "timed"]);
  });

  it("passes from one month to the next", () => {
    const items = [
      { key: "dec", domain: "x", at: day(12, 1, 7), timed: true },
      { key: "nov", domain: "x", at: day(11, 30, 22), timed: true },
    ] as AgendaItem[];
    expect(groupByDay(items).map((group) => ymd(group.day))).toEqual(["2026-11-30", "2026-12-01"]);
    expect(ymd(addDays(day(11, 30, 22), 1))).toBe("2026-12-01");
    expect(ymd(addDays(day(12, 31), 1))).toBe("2027-01-01");
    expect(daysBetween(day(11, 30, 23), day(12, 2, 1))).toBe(2);
  });

  it("counts calendar days across a clock change", () => {
    // Whatever the time zone, 30 calendar days later is the same wall-clock midnight.
    const start = localDay(day(3, 1));
    expect(new Date(addDays(start, 30)).getHours()).toBe(0);
    expect(new Date(addDays(localDay(day(10, 1)), 30)).getHours()).toBe(0);
  });

  it("shows nothing for nothing", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("agenda: scan reminders", () => {
  it("lists the reminders of the window, with their time", () => {
    const items = remindersSource.collect(
      context({ entries: [entry("a", { reminderAt: day(11, 20, 9, 30) }, { title: "Facture JIRAMA", reminder: null } as Partial<Analysis>), entry("b", { reminderAt: day(12, 30, 9) }), entry("c", { reminderAt: day(11, 12, 9) }), entry("d")] }),
    );
    expect(keys(items)).toEqual([`reminder:a:${day(11, 20, 9, 30)}`]);
    expect(items[0]).toMatchObject({ domain: "reminders", timed: true, href: "/result?id=a", label: { params: { text: "Facture JIRAMA" } } });
  });

  it("uses the reminder's own title", () => {
    const items = remindersSource.collect(context({ entries: [entry("a", { reminderAt: day(11, 20, 9) }, { reminder: { title: "Payer le loyer", at: null } } as unknown as Partial<Analysis>)] }));
    expect(items[0].label.params?.text).toBe("Payer le loyer");
  });

  it("follows a monthly reminder through the window", () => {
    const repeat = makeRepeat("monthly", day(10, 20, 9));
    const items = remindersSource.collect(context({ entries: [entry("a", { reminderAt: day(11, 20, 9), reminderRepeat: repeat })] }, { days: 60 }));
    expect(items.map((item) => ymd(item.at))).toEqual(["2026-11-20", "2026-12-20"]);
  });

  it("is paused below Lite", () => {
    expect(remindersSource.collect(context({ entries: [entry("a", { reminderAt: day(11, 20, 9) })] }, { features: [] }))).toEqual([]);
  });
});

describe("agenda: health", () => {
  it("lists appointments with the person's first name", () => {
    const items = healthSource.collect(
      context({
        appointments: [
          { id: "a1", at: day(11, 18, 14), who: "Dr Rakoto", place: "", note: "", profileId: "p1", createdAt: 1, updatedAt: 1 },
          { id: "a2", at: day(11, 19, 8), who: "Dentiste", place: "", note: "", createdAt: 1, updatedAt: 1 },
          { id: "a3", at: day(11, 19, 9), who: "Supprimé", place: "", note: "", createdAt: 1, updatedAt: 1, deletedAt: 5 },
          { id: "a4", at: day(11, 10, 9), who: "Passé", place: "", note: "", createdAt: 1, updatedAt: 1 },
        ],
        profiles: [{ id: "p1", name: "Miora Rasoa", relation: "child", createdAt: 1, updatedAt: 1 }],
      }),
    );
    expect(keys(items)).toEqual(["appointment:a1", "appointment:a2"]);
    expect(items.find((item) => item.key === "appointment:a1")).toMatchObject({ detail: { params: { name: "Miora" } }, href: "/sante?appt=a1", timed: true });
    expect(items.find((item) => item.key === "appointment:a2")?.detail).toBeUndefined();
  });

  const treatment = entry("t1", { medication: { start: "2026-11-16", createdAt: 1, courses: [{ name: "Amoxicilline", times: ["08:00", "20:00"], days: 3 }, { name: "Paracétamol", times: ["08:00", "20:00"], days: 2 }] } });

  it("gives one line a day for a treatment, never one a dose", () => {
    const items = healthSource.collect(context({ entries: [treatment] })).filter((item) => item.key.startsWith("doses:"));
    // Today only the evening doses are still to come (it is 10:00); then 2 doses on the 17th and on the 18th.
    expect(items).toHaveLength(3);
    const byDay = Object.fromEntries(items.map((item) => [ymd(item.at), item.label.params]));
    expect(byDay["2026-11-16"]).toMatchObject({ count: 1 });
    expect(byDay["2026-11-17"]).toMatchObject({ count: 2, names: "Amoxicilline, Paracétamol" });
    expect(byDay["2026-11-18"]).toMatchObject({ count: 2, names: "Amoxicilline" });
  });

  it("says which day is the last", () => {
    const items = healthSource.collect(context({ entries: [treatment] })).filter((item) => item.key.startsWith("doses:"));
    const lastLines = items.filter((item) => item.detail?.key === "agenda.items.lastDay");
    expect(lastLines.map((item) => ymd(item.at))).toEqual(["2026-11-18"]);
  });

  it("does not count a dose already ticked", () => {
    const ticked = entry("t2", { medication: { ...treatment.medication!, taken: [day(11, 17, 8)] } });
    const items = healthSource.collect(context({ entries: [ticked] }));
    expect(items.find((item) => ymd(item.at) === "2026-11-17")?.label.params).toMatchObject({ count: 1 });
  });
});

describe("agenda: loans", () => {
  const loan = (id: string, extra: Record<string, unknown>) => ({ id, direction: "lent", person: "Rado", amountMga: 100000, at: day(10, 1), repayments: [], updatedAt: 1, ...extra }) as never;

  it("lists the day a loan is due, with what is left", () => {
    const items = loansSource.collect(context({ loans: [loan("l1", { dueAt: day(11, 25), repayments: [{ id: "r", at: day(11, 2), amountMga: 40000 }] }), loan("l2", { dueAt: day(12, 30) })] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "loan:l1", amountMga: 60000, href: "/loans?person=rado", label: { key: "agenda.items.loanLent" } });
  });

  it("makes a late loan one late line, and borrowed ones open the right tab", () => {
    const items = loansSource.collect(context({ loans: [loan("l3", { direction: "borrowed", person: "Hery", dueAt: day(11, 10) })] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "loan-late:l3", late: true, amountMga: 100000, href: "/loans?person=hery&dir=borrowed", label: { key: "agenda.items.loanBorrowed" } });
  });

  it("lists each installment of a schedule, and one late line for the late ones", () => {
    const schedule = [
      { id: "i1", dueAt: day(11, 5), amountMga: 30000 },
      { id: "i2", dueAt: day(11, 8), amountMga: 30000 },
      { id: "i3", dueAt: day(11, 20), amountMga: 30000 },
      { id: "i4", dueAt: day(12, 10), amountMga: 10000 },
    ];
    const items = loansSource.collect(context({ loans: [loan("l4", { schedule })] }));
    expect(keys(items)).toEqual(["loan-late:l4", "loan:l4:i3", "loan:l4:i4"].sort());
    expect(items.find((item) => item.key === "loan-late:l4")).toMatchObject({ amountMga: 60000, late: true });
  });

  it("ignores a loan paid back or deleted", () => {
    const items = loansSource.collect(context({ loans: [loan("l5", { dueAt: day(11, 25), repayments: [{ id: "r", at: 1, amountMga: 100000 }] }), loan("l6", { dueAt: day(11, 25), deletedAt: 3 })] }));
    expect(items).toEqual([]);
  });
});

describe("agenda: fixed expenses", () => {
  const recurring = (extra: Record<string, unknown> = {}) =>
    ({ kind: "recurring", id: "r1", flow: "expense", label: "Loyer", amountMga: 150000, category: "rent", day: 5, startMonth: "2026-01", remind: "none", skipped: [], createdAt: 1, updatedAt: 1, ...extra }) as unknown as ExpenseRecord;

  it("lists the days of a fixed expense, over a change of month", () => {
    const items = expensesSource.collect(context({ records: [recurring()] }, { days: 60 }));
    expect(items.map((item) => ymd(item.at))).toEqual(["2026-12-05", "2027-01-05"]);
    expect(items[0]).toMatchObject({ amountMga: 150000, timed: false, href: "/expenses?tab=recurring", label: { params: { text: "Loyer" } } });
  });

  it("skips a month marked 'not this month'", () => {
    expect(expensesSource.collect(context({ records: [recurring({ skipped: ["2026-12"] })] }))).toEqual([]);
  });

  it("skips an occurrence already entered", () => {
    const paid = { kind: "expense", id: "e1", at: day(12, 5), amountMga: 150000, category: "rent", sourceKey: occurrenceKey("r1", "2026-12"), createdAt: 1, updatedAt: 1 } as unknown as ExpenseRecord;
    expect(expensesSource.collect(context({ records: [recurring(), paid] }))).toEqual([]);
  });

  it("ignores one that ended, and tells an income apart", () => {
    expect(expensesSource.collect(context({ records: [recurring({ endMonth: "2026-11" })] }))).toEqual([]);
    const income = expensesSource.collect(context({ records: [recurring({ flow: "income", label: "Salaire", day: 28 })] }));
    expect(income[0]).toMatchObject({ detail: { key: "agenda.items.incomeDue" } });
    expect(ymd(income[0].at)).toBe("2026-11-28");
  });

  it("follows the plan of Mes dépenses", () => {
    expect(expensesSource.collect(context({ records: [recurring()] }, { features: [] }))).toEqual([]);
  });
});

describe("agenda: parcels", () => {
  const parcel = (id: string, estimated: string | null, extra: Record<string, unknown> = {}) => ({ id, title: `Colis ${id}`, info: { status: "shipped", estimatedDelivery: estimated, items: [] }, scanIds: [], timeline: [], createdAt: 1, updatedAt: 1, ...extra }) as never;

  it("lists a parcel on its expected day", () => {
    const items = parcelsSource.collect(context({ parcels: [parcel("a", "2026-11-20"), parcel("b", "2027-02-01"), parcel("c", null)] }));
    expect(keys(items)).toEqual(["parcel:a"]);
    expect(items[0]).toMatchObject({ href: "/parcels?open=a", timed: false });
    expect(ymd(items[0].at)).toBe("2026-11-20");
  });

  it("makes a parcel past its day, still awaited, a late line", () => {
    const items = parcelsSource.collect(context({ parcels: [parcel("a", "2026-11-10")] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "parcel-late:a", late: true });
  });

  it("forgets a parcel already received or deleted", () => {
    expect(parcelsSource.collect(context({ parcels: [parcel("a", "2026-11-20", { receivedAt: now }), parcel("b", "2026-11-20", { deletedAt: 1 })] }))).toEqual([]);
  });
});

describe("agenda: garage", () => {
  const vehicle = { id: "v1", name: "La Corolla", kind: "car", insuranceUntil: "2026-11-25", inspectionUntil: "2027-06-01", scanIds: [], noticeDays: 5, odometer: [{ at: day(10, 1), km: 90000 }], maintenance: [], fuel: [], expenses: [], createdAt: 1, updatedAt: 1 };

  it("lists the insurance date, not the day its notice comes, and never the odometer", () => {
    const items = garageSource.collect(context({ vehicles: [vehicle as never] }));
    expect(keys(items)).toEqual(["vehicle:v1:insurance"]);
    expect(ymd(items[0].at)).toBe("2026-11-25");
    expect(items[0]).toMatchObject({ href: "/garage?open=v1", label: { key: "agenda.items.insurance", params: { name: "La Corolla" } } });
  });

  it("lists the estimated oil change", () => {
    const serviced = { ...vehicle, insuranceUntil: undefined, inspectionUntil: undefined, odometer: [], oilIntervalMonths: 6, maintenance: [{ id: "m", at: day(5, 20), kind: "oil", km: 80000 }] };
    const items = garageSource.collect(context({ vehicles: [serviced as never] }, { days: 120 }));
    expect(keys(items)).toEqual(["vehicle:v1:oilChange"]);
    expect(ymd(items[0].at)).toBe("2026-11-20");
  });

  it("follows the garage's plan", () => {
    expect(garageSource.collect(context({ vehicles: [vehicle as never] }, { features: [] }))).toEqual([]);
  });
});

describe("agenda: home", () => {
  it("lists the end of a warranty", () => {
    const item = (id: string, warrantyUntil: string | undefined, extra: Record<string, unknown> = {}) => ({ id, name: `Objet ${id}`, warrantyUntil, scanIds: [], createdAt: 1, updatedAt: 1, ...extra }) as never;
    const items = homeSource.collect(context({ homeItems: [item("a", "2026-12-01"), item("b", "2027-12-01"), item("c", undefined), item("d", "2026-12-01", { deletedAt: 1 })] }));
    expect(keys(items)).toEqual(["warranty:a"]);
    expect(items[0]).toMatchObject({ href: "/inventory?open=a", label: { params: { name: "Objet a" } } });
    expect(homeSource.collect(context({ homeItems: [item("a", "2026-12-01")] }, { features: [] }))).toEqual([]);
  });
});

describe("agenda: papers", () => {
  const paper = (id: string, expiresOn: string | undefined) => entry(id, { expiresOn }, { title: `Papier ${id}`, document: { type: "id", dates: [], expiresOn: null, isInsurance: false, paper: "id_card" } as unknown as Analysis["document"] });

  it("lists a paper on the day it expires, and an expired one as late", () => {
    const items = papersSource.collect(context({ entries: [paper("a", "2026-11-30"), paper("b", "2026-11-01"), paper("c", "2028-01-01"), paper("d", undefined)] }));
    expect(keys(items)).toEqual(["paper-late:b", "paper:a"]);
    expect(items.find((item) => item.key === "paper-late:b")).toMatchObject({ late: true, href: "/result?id=b" });
  });

  it("keeps an expired paper late for 90 days, then drops it from the agenda", () => {
    expect(LATE_PAPER_DAYS).toBe(90);
    const daysAgo = (count: number) => ymd(addDays(localDay(now), -count));
    const items = papersSource.collect(context({ entries: [paper("recent", daysAgo(89)), paper("edge", daysAgo(90)), paper("old", daysAgo(91)), paper("older", daysAgo(400))] }));
    expect(keys(items)).toEqual(["paper-late:edge", "paper-late:recent"]);
  });

  it("counts a paper expiring today as to come, not late", () => {
    const items = papersSource.collect(context({ entries: [paper("a", "2026-11-16")] }));
    expect(items).toHaveLength(1);
    expect(items[0].late).toBeUndefined();
  });
});

describe("agenda: plants", () => {
  const plant = (id: string, name: string, lastWateredAt: number, waterEveryDays: number, extra: Record<string, unknown> = {}) => ({ id, name, lastWateredAt, waterEveryDays, place: "indoor", scanIds: [], checks: [], createdAt: day(1, 1), updatedAt: 1, ...extra }) as never;

  it("groups the watering of a day in one line", () => {
    const items = plantsSource.collect(context({ plants: [plant("a", "Basilic", day(11, 14), 7), plant("b", "Menthe", day(11, 14), 7), plant("c", "Aloès", day(11, 14), 14)] }));
    const byDay = Object.fromEntries(items.map((item) => [ymd(item.at), item.label.params?.count]));
    // 21 November: the basil and the mint; 28 November: again; 28 November also for the aloe (every 14 days).
    expect(byDay["2026-11-21"]).toBe(2);
    expect(byDay["2026-11-28"]).toBe(3);
    expect(items.find((item) => ymd(item.at) === "2026-11-21")?.detail?.params?.text).toBe("Basilic, Menthe");
  });

  it("puts a late plant on today", () => {
    const items = plantsSource.collect(context({ plants: [plant("a", "Basilic", day(11, 1), 7)] }));
    expect(ymd(items[0].at)).toBe("2026-11-16");
  });

  it("forgets a deleted plant and follows the plants' plan", () => {
    expect(plantsSource.collect(context({ plants: [plant("a", "Basilic", day(11, 14), 7, { deletedAt: 1 })] }))).toEqual([]);
    expect(plantsSource.collect(context({ plants: [plant("a", "Basilic", day(11, 14), 7)] }, { features: [] }))).toEqual([]);
  });
});

describe("agenda: the whole", () => {
  it("collects every source, and one failing does not hide the others", () => {
    const broken: AgendaSource = { id: "broken", domain: "x", collect: () => { throw new Error("boom"); } };
    const fine: AgendaSource = { id: "fine", domain: "y", collect: () => [{ key: "k", domain: "y", at: now, timed: false, label: { key: "agenda.plain" }, href: "/" }] };
    expect(collectAgenda(context({}), [broken, fine]).map((item) => item.key)).toEqual(["k"]);
  });

  it("has a source for each domain, each with its own id", () => {
    expect(new Set(agendaSources.map((source) => source.id)).size).toBe(agendaSources.length);
    expect(agendaSources.map((source) => source.domain)).toEqual(["reminders", "health", "vaccines", "pharmacy", "loans", "expenses", "parcels", "garage", "home", "papers", "plants"]);
  });

  it("gives an empty agenda for no data", () => {
    expect(collectAgenda(context({}))).toEqual([]);
  });
});
