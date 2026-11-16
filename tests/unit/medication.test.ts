import { describe, expect, it } from "vitest";
import { mockPrescription } from "@/lib/ai/mock";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { canTake, cleanCourse, defaultTimes, doseReminders, endingCourses, mergeTaken, hasReadableName, isActive, lastDayNotice, MAX_TAKEN, planEnd, todayDoses, unreadableNote, weekAdherence, withTaken, type MedicationPlan } from "@/lib/medication";
import { medicationLink, reconcileMedicationState, type MedicationReminderDeps, type ScheduledDoses } from "@/services/medicationReminders";
import { tapTarget } from "@/services/notificationTap";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

const plan: MedicationPlan = {
  start: "2026-11-04",
  createdAt: 0,
  courses: [
    { name: "Amoxicilline", dose: "1 gélule matin et soir", times: ["08:00", "20:00"], days: 7 },
    { name: "Vitamine C", times: ["08:00"], days: 2 },
  ],
};

describe("the shared contract", () => {
  it("gives older scans no medicine, and the demo prescription is valid", () => {
    const old = { ...mockPrescription("en") } as Record<string, unknown>;
    delete old.medicine;
    expect(AnalysisSchema.parse(normalizeStoredAnalysis(old)).medicine).toBeNull();
    const demo = AnalysisSchema.parse(mockPrescription("fr"));
    expect(demo.medicine?.items.map((item) => [item.name, item.timesPerDay, item.durationDays])).toEqual([
      ["Amoxicilline", 2, 7],
      ["Paracétamol", null, null],
    ]);
    expect(demo.suggestions.some((suggestion) => suggestion.kind === "warning")).toBe(true);
  });

  it("asks the engine never to invent a dose, to say what it cannot read, and not to recommend", () => {
    expect(SYSTEM_PROMPT).toMatch(/never deduce, complete or invent one/);
    expect(SYSTEM_PROMPT).toMatch(/cannot be read with certainty, say what in the unreadable field/);
    expect(SYSTEM_PROMPT).toMatch(/never replace it with a plausible or similar medicine: set its name to an empty string/);
    expect(SYSTEM_PROMPT).toMatch(/Never recommend, add, replace or advise against a medicine/);
    expect(SYSTEM_PROMPT).toMatch(/general information about the medicine, never advice for this person/);
  });
});

describe("dose reminders", () => {
  it("offers usual times for the number of doses a day", () => {
    expect(defaultTimes(2)).toEqual(["08:00", "20:00"]);
    expect(defaultTimes(3)).toEqual(["08:00", "13:00", "20:00"]);
    expect(defaultTimes(null)).toEqual(["08:00"]);
  });

  it("saves a course only with a name, valid times and a duration", () => {
    expect(cleanCourse({ name: " Amoxicilline ", times: ["20:00", "8:00", "8:00", "25:00"], days: 7 })).toEqual({ name: "Amoxicilline", times: ["08:00", "20:00"], days: 7 });
    expect(cleanCourse({ name: "A", times: ["08:00"], days: 0 })).toBeNull();
    expect(cleanCourse({ name: "A", times: ["08:00"], days: 91 })).toBeNull();
    expect(cleanCourse({ name: "", times: ["08:00"], days: 3 })).toBeNull();
    expect(cleanCourse({ name: "A", times: ["x"], days: 3 })).toBeNull();
  });

  it("never offers a medicine whose name is unreadable", () => {
    expect(hasReadableName("")).toBe(false);
    expect(hasReadableName("  ")).toBe(false);
    expect(hasReadableName("Amoxicilline")).toBe(true);
    expect(cleanCourse({ name: "  ", times: ["08:00"], days: 3 })).toBeNull();
  });

  it("writes what could not be read without doubling its punctuation", () => {
    expect(unreadableNote("Le nom de la 2e ligne.")).toBe("Le nom de la 2e ligne");
    expect(unreadableNote("Le nom de la 2e ligne")).toBe("Le nom de la 2e ligne");
    expect(unreadableNote(" la dose ... ")).toBe("la dose");
  });

  it("ends with the last dose", () => {
    expect(planEnd(plan)).toBe(at(10, 20));
    expect(isActive(plan, at(10, 19))).toBe(true);
    expect(isActive(plan, at(10, 20))).toBe(false);
  });

  it("schedules the next 7 days, one notification per moment, none in the past nor once disabled", () => {
    const reminders = doseReminders([{ id: "scan", medication: plan }, { id: "other" }], at(4, 9));
    // 4 Nov 09:00: the 08:00 doses of that day are past.
    expect(reminders[0]).toEqual({ entryId: "scan", at: at(4, 20), medicines: [{ name: "Amoxicilline", dose: "1 gélule matin et soir" }] });
    expect(reminders[1]).toEqual({ entryId: "scan", at: at(5, 8), medicines: [{ name: "Amoxicilline", dose: "1 gélule matin et soir" }, { name: "Vitamine C" }] });
    expect(reminders.at(-1)?.at).toBe(at(10, 20));
    // 13 doses, and the evening before the last day.
    expect(reminders).toHaveLength(14);
    expect(reminders.filter((reminder) => reminder.kind === "lastDay")).toEqual([
      // Vitamin C ended on the 5th: only the amoxicillin ends on the last day.
      { entryId: "scan", at: at(9, 19), kind: "lastDay", medicines: [{ name: "Amoxicilline" }] },
    ]);
    expect(doseReminders([{ id: "scan", medication: plan }], at(4, 9), false)).toEqual([]);
  });

  it("schedules once, cancels what is no longer wanted, never asks for the permission", async () => {
    let saved: ScheduledDoses = {};
    const scheduled: number[] = [];
    const cancelled: number[] = [];
    let next = 1;
    const deps: MedicationReminderDeps = {
      permission: async () => "granted",
      notify: async ({ entryId, actionTypeId }) => {
        // A dose: its moment in the link and the "J'ai pris" button; the last-day notice: the scan alone.
        if (actionTypeId) expect(entryId).toMatch(/^med:scan@\d+$/);
        else expect(entryId).toBe("med:scan");
        scheduled.push(next);
        return next++;
      },
      cancel: async (id) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => saved,
      save: (value) => {
        saved = value;
      },
    };
    const texts = () => ({ title: "Médicament", body: "Amoxicilline" });
    const entries = [{ id: "scan", medication: plan }];
    await reconcileMedicationState(entries, texts, deps, { now: at(4, 9) });
    expect(scheduled).toHaveLength(14);
    await reconcileMedicationState(entries, texts, deps, { now: at(4, 9) });
    expect(scheduled).toHaveLength(14);
    // Stopped: everything cancelled.
    await reconcileMedicationState([{ id: "scan" }], texts, deps, { now: at(4, 9) });
    expect(cancelled).toHaveLength(14);
    expect(saved).toEqual({});
  });

  it("opens « Ma santé » when a dose notification is tapped, and reads the dose's moment in its link", () => {
    expect(tapTarget("med:abc")).toEqual({ pathname: "/sante", query: { scan: "abc" } });
    expect(tapTarget("med:abc@1762236000000")).toEqual({ pathname: "/sante", query: { scan: "abc" } });
    expect(medicationLink("med:abc@1762236000000")).toEqual({ scanId: "abc", at: 1762236000000 });
    expect(medicationLink("med:abc")).toEqual({ scanId: "abc", at: null });
    expect(medicationLink("plant:x")).toBeNull();
  });

  it("ticks « J'ai pris »: counts the week's doses, shows today's gently, keeps a bounded list", () => {
    // 6 Nov 21:00: the doses of 4 Nov 08:00 to 6 Nov 20:00 are due (6 + 2 of vitamin C at the same moments).
    const now = at(6, 21);
    expect(weekAdherence(plan, now)).toEqual({ due: 6, taken: 0 });
    let ticked = withTaken(plan, at(5, 8));
    ticked = withTaken(ticked, at(5, 8));
    ticked = withTaken(ticked, at(6, 8));
    expect(ticked.taken).toEqual([at(5, 8), at(6, 8)]);
    expect(weekAdherence(ticked, now)).toEqual({ due: 6, taken: 2 });
    expect(todayDoses(ticked, now).map((dose) => [dose.at, dose.state])).toEqual([
      [at(6, 8), "taken"],
      [at(6, 20), "missed"],
    ]);
    expect(todayDoses(ticked, at(6, 9)).map((dose) => dose.state)).toEqual(["taken", "upcoming"]);
    let many = plan;
    for (let i = 0; i < MAX_TAKEN + 20; i += 1) many = withTaken(many, i);
    expect(many.taken).toHaveLength(MAX_TAKEN);
    expect(many.taken?.[0]).toBe(20);
  });

  it("says the last day the evening before, and to buy more when the prescription is renewed", () => {
    expect(lastDayNotice(plan)).toBe(at(9, 19));
    const [notice] = doseReminders([{ id: "scan", medication: { ...plan, renew: true } }], at(9, 9)).filter((reminder) => reminder.kind === "lastDay");
    expect(notice).toMatchObject({ at: at(9, 19), renew: true });
    // A one-day treatment: no notice.
    expect(lastDayNotice({ start: "2026-11-04", createdAt: 0, courses: [{ name: "A", times: ["08:00"], days: 1 }] })).toBeNull();
  });
});

describe("ticking a dose safely", () => {
  it("never rings a moment already ticked, and only ticks a dose gone by or within the hour", () => {
    const ticked = withTaken(plan, at(5, 8));
    const moments = doseReminders([{ id: "scan", medication: ticked }], at(4, 21)).map((reminder) => reminder.at);
    expect(moments).not.toContain(at(5, 8));
    expect(moments).toContain(at(5, 20));
    expect(canTake(at(5, 8), at(5, 7, 1))).toBe(true);
    expect(canTake(at(5, 8), at(5, 6, 59))).toBe(false);
    expect(canTake(at(6, 8), at(5, 8))).toBe(false);
    // Today's list says which ones can be ticked now.
    expect(todayDoses(plan, at(5, 9)).map((dose) => [dose.state, dose.canTake])).toEqual([
      ["missed", true],
      ["upcoming", false],
    ]);
  });

  it("keeps the doses ticked on two devices when the plan is the same, not those of an older plan", () => {
    const here = { ...plan, createdAt: 5, taken: [at(5, 8)] };
    const there = { ...plan, createdAt: 5, taken: [at(5, 20), at(5, 8)] };
    expect(mergeTaken(here, there)?.taken).toEqual([at(5, 8), at(5, 20)]);
    // Nothing new: the same object (nothing to write, nothing to send back).
    expect(mergeTaken(there, here)).toBe(there);
    const older = { ...plan, createdAt: 1, taken: [at(4, 8)] };
    expect(mergeTaken(here, older)).toBe(here);
    expect(mergeTaken(undefined, there)).toBeUndefined();
  });

  it("does not count the doses before the plan was made", () => {
    const madeAt9 = { ...plan, createdAt: at(4, 21) };
    expect(weekAdherence(madeAt9, at(5, 9))).toEqual({ due: 1, taken: 0 });
    expect(todayDoses(madeAt9, at(4, 22))).toEqual([]);
  });

  it("names on the last-day notice only the medicines that really end that day", () => {
    const mixed: MedicationPlan = { ...plan, courses: [{ name: "Amoxicilline", times: ["08:00"], days: 7 }, { name: "Paracétamol", times: ["08:00"], days: 3 }] };
    expect(endingCourses(mixed).map((course) => course.name)).toEqual(["Amoxicilline"]);
    const [notice] = doseReminders([{ id: "scan", medication: mixed }], at(9, 9)).filter((reminder) => reminder.kind === "lastDay");
    expect(notice.medicines).toEqual([{ name: "Amoxicilline" }]);
  });
});
