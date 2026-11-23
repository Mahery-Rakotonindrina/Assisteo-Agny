import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { healthPayload, mergeHealth, noHealth } from "@/lib/healthSync";
import { personFromLink, ME } from "@/lib/healthProfiles";
import { syncedSettingKeys } from "@/lib/settings/SettingsProvider";
import {
  mergeVaccines,
  nextDoses,
  normalizeVaccines,
  removeVaccinesOf,
  removeOrphanVaccines,
  vaccineOwner,
  vaccinesOf,
  MAX_VACCINES,
  removeAllVaccines,
  removeVaccine,
  sameVaccine,
  saveVaccine,
  vaccineDay,
  vaccineHistory,
  vaccineReminders,
  vaccinesText,
  VACCINE_TOMBSTONE_MS,
  type Vaccine,
} from "@/lib/vaccines";
import type { ScheduledAppointmentReminders } from "@/services/appointmentReminders";
import { tapTarget } from "@/services/notificationTap";
import { reconcileVaccineReminderState } from "@/services/vaccineReminders";

const translate = (texts: object) => (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], texts);
  if (typeof text !== "string") throw new Error(`missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};
const day = (d: number, month = 10, hour = 12) => new Date(2026, month, d, hour).getTime();
const vax = (id: string, name: string, at: number, patch: Partial<Vaccine> = {}): Vaccine => ({ id, name, at, dose: "", place: "", lot: "", note: "", createdAt: 1, updatedAt: 1, ...patch });
let counter = 0;
const newId = () => `v${++counter}`;
const liveIds = (list: Vaccine[] | null) => (list ?? []).filter((item) => !item.deletedAt).map((item) => item.id);
const date = (at: number) => new Date(at).toISOString().slice(0, 10);

describe("Carnet de vaccination", () => {
  it("reads what was stored, the latest copy of each, and drops what is unusable", () => {
    expect(normalizeVaccines(undefined)).toBeNull();
    const list = normalizeVaccines([vax("b", "Polio", day(14)), vax("a", "BCG", day(12)), { id: "x", at: day(3) }, null, vax("a", "BCG", day(13), { updatedAt: 5 }), { ...vax("c", "HPV", day(15)), dose: 3, profileId: "me" }])!;
    expect(list.map((item) => [item.id, item.at])).toEqual([
      ["a", day(13)],
      ["b", day(14)],
      ["c", day(15)],
    ]);
    expect(list[2].dose).toBe("");
    expect(list[2].profileId).toBeUndefined();
  });

  it("reads a date field as that day at noon, and refuses a wrong one", () => {
    expect(vaccineDay("2026-03-12")).toBe(new Date(2026, 2, 12, 12).getTime());
    expect(vaccineDay("2026-02-31")).toBeNull();
    expect(vaccineDay("")).toBeNull();
  });

  it("adds, changes (the next dose may be taken off) and removes, a removal kept as a tombstone", () => {
    const now = day(10);
    const added = saveVaccine(null, null, { name: " BCG ", at: day(2, 10, 8), dose: "1", place: "CSB", lot: "", note: "", nextAt: day(20, 10, 23), profileId: "rado" }, now, newId);
    expect(added[0]).toMatchObject({ name: "BCG", at: day(2), nextAt: day(20), profileId: "rado", createdAt: now, updatedAt: now });
    const changed = saveVaccine(added, added[0].id, { name: "BCG", at: day(2), dose: "1", place: "CSB", lot: "A1", note: "", profileId: ME }, now + 1, newId);
    expect(changed[0].nextAt).toBeUndefined();
    expect(changed[0].profileId).toBeUndefined();
    expect(changed[0].lot).toBe("A1");
    const removed = removeVaccine(changed, changed[0].id, now + 2);
    expect(removed[0]).toMatchObject({ deletedAt: now + 2, updatedAt: now + 2 });
    expect(vaccineHistory(removed)).toEqual([]);
    expect(removeVaccine(removed, "none", now + 2 + VACCINE_TOMBSTONE_MS)).toEqual([]);
    expect(removeAllVaccines([vax("a", "BCG", day(1)), vax("b", "Polio", day(2))], now).every((item) => item.deletedAt === now)).toBe(true);
  });

  it("merges two devices one vaccine at a time: the latest change wins, a removal too", () => {
    const now = day(10);
    const local = [vax("a", "BCG", day(1), { updatedAt: 10 }), vax("b", "Polio", day(2), { updatedAt: 10 }), vax("c", "HPV", day(3))];
    const remote = [vax("a", "BCG", day(1), { lot: "X", updatedAt: 20 }), vax("b", "Polio", day(2), { updatedAt: now - 1, deletedAt: now - 1 }), vax("d", "Typhoïde", day(4))];
    const merged = mergeVaccines(local, remote, now)!;
    expect(merged.map((item) => [item.id, item.lot, Boolean(item.deletedAt)])).toEqual([
      ["a", "X", false],
      ["b", "", true],
      ["c", "", false],
      ["d", "", false],
    ]);
    expect(mergeVaccines(null, undefined, now)).toBeNull();
    expect(mergeVaccines(null, remote, now)).toHaveLength(3);
  });

  it("goes with the synced settings, merged like the appointments", () => {
    expect(syncedSettingKeys).toContain("vaccines");
    expect(noHealth.vaccines).toBeNull();
    const merged = mergeHealth({ vaccines: [vax("a", "BCG", day(1))] }, { vaccines: [vax("b", "Polio", day(2))] }, day(10));
    expect(merged.vaccines?.map((item) => item.id)).toEqual(["a", "b"]);
    // Nothing written yet: the account's stays.
    expect("vaccines" in healthPayload({ vaccines: null })).toBe(false);
  });

  it("lists the next doses: done once a later one of the same vaccine is written, late ones said so", () => {
    const now = day(15);
    const list = [
      vax("rr1", "Rougeole-Rubéole", day(1), { nextAt: day(20) }),
      vax("p1", "Polio", day(1), { nextAt: day(5) }),
      vax("b1", "BCG", day(1)),
      vax("h1", "Hépatite B", day(1), { nextAt: day(10) }),
      vax("h2", "hepatite b", day(11)),
      vax("gone", "HPV", day(1), { nextAt: day(25), deletedAt: 3 }),
    ];
    expect(nextDoses(list, now).map(({ vaccine, overdue }) => [vaccine.id, overdue])).toEqual([
      ["p1", true],
      ["rr1", false],
    ]);
    expect(sameVaccine("Rougeole rubeole", "Rougeole-Rubéole")).toBe(true);
    // The day itself is not late yet.
    expect(nextDoses([vax("a", "BCG", day(1), { nextAt: day(15) })], day(15, 10, 20))[0].overdue).toBe(false);
  });

  it("reminds the day before the next dose at 9 h, only when still to come and with the plan", () => {
    const list = [vax("rr1", "Rougeole-Rubéole", day(1), { nextAt: day(20) }), vax("p1", "Polio", day(1), { nextAt: day(16) })];
    const reminders = vaccineReminders(list, day(15, 10, 10));
    expect(reminders.map((item) => [item.vaccine.id, item.at, item.entryId])).toEqual([["rr1", day(19, 10, 9), "vax:rr1"]]);
    expect(vaccineReminders(list, day(15, 10, 8)).map((item) => item.vaccine.id)).toEqual(["p1", "rr1"]);
    expect(vaccineReminders(list, day(15, 10, 8), false)).toEqual([]);
    // A change of day schedules it again.
    expect(vaccineReminders([{ ...list[0], nextAt: day(21) }], day(15))[0].key).not.toBe(reminders[0].key);
  });

  it("schedules and cancels the reminders like the appointments'", async () => {
    let scheduled: ScheduledAppointmentReminders = { stale: 9 };
    const cancelled: number[] = [];
    const sent: string[] = [];
    let nextId = 1;
    const deps = {
      permission: async () => "granted",
      notify: async (options: { title: string; entryId: string }) => {
        sent.push(options.entryId);
        return nextId++;
      },
      cancel: async (id: number) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => scheduled,
      save: (next: ScheduledAppointmentReminders) => {
        scheduled = next;
      },
    };
    const list = [vax("rr1", "Rougeole-Rubéole", day(1), { nextAt: day(20) })];
    const texts = () => ({ title: "Vaccin demain", body: "x" });
    await reconcileVaccineReminderState(list, texts, deps, { now: day(15) });
    expect(sent).toEqual(["vax:rr1"]);
    expect(cancelled).toEqual([9]);
    await reconcileVaccineReminderState(list, texts, deps, { now: day(15) });
    expect(sent).toHaveLength(1);
    await reconcileVaccineReminderState(list, texts, deps, { now: day(15), enabled: false });
    expect(cancelled).toEqual([9, 1]);
    expect(scheduled).toEqual({});
  });

  it("opens « Ma santé » on that person's vaccines when tapped", () => {
    expect(tapTarget("vax:rr1")).toEqual({ pathname: "/sante", query: { show: "vaccines", vax: "rr1" } });
    const profiles = [{ id: "rado", name: "Rado", relation: "child" as const, createdAt: 1, updatedAt: 1 }];
    const vaccines = [vax("rr1", "BCG", day(1), { profileId: "rado" }), vax("m1", "BCG", day(1)), vax("old", "BCG", day(1), { profileId: "gone" })];
    expect(personFromLink({ vax: "rr1" }, { profiles, vaccines })).toBe("rado");
    expect(personFromLink({ vax: "m1" }, { profiles, vaccines })).toBe(ME);
    // Its relative gone: never "Moi"'s, the link is ignored.
    expect(personFromLink({ vax: "old" }, { profiles, vaccines })).toBeNull();
    expect(personFromLink({ vax: "none" }, { profiles, vaccines })).toBeNull();
  });

  it("removes a removed relative's vaccines with them, and the other device does not bring them back", () => {
    const now = day(10);
    const before = [vax("a", "BCG", day(1), { profileId: "rado" }), vax("b", "Polio", day(2)), vax("c", "HPV", day(3), { profileId: "rado" }), vax("d", "Typhoïde", day(4), { profileId: "mia" })];
    const after = removeVaccinesOf(before, "rado", now)!;
    expect(after.map((item) => [item.id, item.profileId, item.deletedAt, item.updatedAt])).toEqual([
      ["a", "rado", now, now],
      ["b", undefined, undefined, 1],
      ["c", "rado", now, now],
      ["d", "mia", undefined, 1],
    ]);
    // Never "Moi"'s: gone from every record.
    expect(vaccineHistory(after).map((item) => item.id)).toEqual(["d", "b"]);
    // The other device still has them, older: the removal wins, both ways.
    expect(liveIds(mergeVaccines(before, after, now + 1))).toEqual(["b", "d"]);
    expect(liveIds(mergeVaccines(after, before, now + 1))).toEqual(["b", "d"]);
    expect(liveIds(mergeHealth({ vaccines: before }, { vaccines: after }, now + 1).vaccines)).toEqual(["b", "d"]);
    expect(removeVaccinesOf(null, "rado", 1)).toBeNull();
  });

  it("shows an orphan vaccine (its relative not on this device) nowhere, never in « Moi »'s record", () => {
    const profiles = [
      { id: "rado", deletedAt: undefined },
      { id: "gone", deletedAt: 5 },
    ];
    const list = [vax("m", "BCG", day(1)), vax("r", "Polio", day(2), { profileId: "rado" }), vax("g", "HPV", day(3), { profileId: "gone", nextAt: day(25) }), vax("u", "Typhoïde", day(4), { profileId: "unknown", nextAt: day(25) })];
    expect(vaccineOwner(list[0], profiles)).toBe("me");
    expect(vaccineOwner(list[1], profiles)).toBe("rado");
    expect(vaccineOwner(list[2], profiles)).toBeNull();
    expect(vaccineOwner(list[3], profiles)).toBeNull();
    expect(vaccinesOf(list, ME, profiles).map((item) => item.id)).toEqual(["m"]);
    expect(vaccinesOf(list, "rado", profiles).map((item) => item.id)).toEqual(["r"]);
    // Nor do they ring.
    expect(vaccineReminders(list, day(15), true, profiles)).toEqual([]);
  });

  it("removes the vaccines of a relative known to be removed, and only those, so the account follows", () => {
    const now = day(10);
    const profiles = [
      { id: "rado", deletedAt: undefined },
      { id: "gone", deletedAt: 5 },
    ];
    const list = [vax("m", "BCG", day(1)), vax("r", "Polio", day(2), { profileId: "rado" }), vax("g", "HPV", day(3), { profileId: "gone" }), vax("u", "Typhoïde", day(4), { profileId: "not-yet-received" })];
    const cleaned = removeOrphanVaccines(list, profiles, now)!;
    expect(cleaned.map((item) => [item.id, item.deletedAt, item.updatedAt])).toEqual([
      ["m", undefined, 1],
      ["r", undefined, 1],
      ["g", now, now],
      // A relative merely not received yet: kept (hidden only).
      ["u", undefined, 1],
    ]);
    // Nothing to do: null (no write, no loop).
    expect(removeOrphanVaccines(cleaned, profiles, now + 1)).toBeNull();
    expect(removeOrphanVaccines(list, null, now)).toBeNull();
    expect(removeOrphanVaccines(null, profiles, now)).toBeNull();
    // The other device's older live copy does not bring it back.
    expect(mergeVaccines(list, cleaned, now + 1)!.find((item) => item.id === "g")?.deletedAt).toBe(now);
  });

  it("counts only the live vaccines in the limit, the recent removals kept for the other devices", () => {
    const now = day(10);
    const live = Array.from({ length: MAX_VACCINES }, (_, index) => vax(`l${index}`, "BCG", day(1), { updatedAt: 100 + index }));
    const removed = Array.from({ length: 50 }, (_, index) => vax(`d${index}`, "Polio", day(1), { updatedAt: now - 1, deletedAt: now - 1 }));
    const merged = mergeVaccines(live, removed, now)!;
    expect(merged.filter((item) => !item.deletedAt)).toHaveLength(MAX_VACCINES);
    expect(merged.filter((item) => item.deletedAt)).toHaveLength(50);
    // One more live: the oldest changed goes, the removals stay.
    const more = saveVaccine(merged, null, { name: "HPV", at: day(2), dose: "", place: "", lot: "", note: "" }, now, newId);
    expect(more.filter((item) => !item.deletedAt)).toHaveLength(MAX_VACCINES);
    expect(more.some((item) => item.id === "l0")).toBe(false);
    expect(more.filter((item) => item.deletedAt)).toHaveLength(50);
    // Old removals forgotten.
    expect(mergeVaccines(removed, null, now + VACCINE_TOMBSTONE_MS)).toEqual([]);
  });

  it("says what goes with a relative, with the right plural", () => {
    expect(translate(fr)("health.profiles.goneVaccines", { count: 4 })).toBe("Ses 4 vaccins seront supprimés");
    expect(translate(fr)("health.profiles.goneVaccinesOne")).toBe("Son vaccin sera supprimé");
    expect(translate(en)("health.profiles.goneVaccines", { count: 4 })).toBe("Their 4 vaccines will be deleted");
  });

  it("shares the record as text: next doses, then the vaccines from the oldest, only what is written", () => {
    const list = [vax("b", "BCG", day(1), { dose: "1", place: "CSB Analakely", lot: "AB12" }), vax("rr", "Rougeole-Rubéole", day(3), { note: "un peu de fièvre", nextAt: day(20) })];
    const text = vaccinesText(list, translate(fr), date, day(15), "Rado");
    expect(text.split("\n")).toEqual([
      "Carnet de vaccination de Rado",
      "Recopié du carnet, au 2026-11-15",
      "",
      "Prochaines doses",
      "- Rougeole-Rubéole le 2026-11-20",
      "",
      "Vaccins faits",
      "- 2026-11-01 : BCG, dose 1, CSB Analakely, lot AB12",
      "- 2026-11-03 : Rougeole-Rubéole (un peu de fièvre)",
    ]);
    expect(vaccinesText(list, translate(en), date, day(25)).split("\n").slice(0, 5)).toEqual(["My vaccination record", "Copied from the booklet, on 2026-11-25", "", "Next doses", "- Rougeole-Rubéole on 2026-11-20 (date gone by)"]);
  });
});
