import { describe, expect, it } from "vitest";
import { mockPrescription } from "@/lib/ai/mock";
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { cleanCourse, defaultTimes, doseReminders, hasReadableName, isActive, planEnd, unreadableNote, type MedicationPlan } from "@/lib/medication";
import { reconcileMedicationState, type MedicationReminderDeps, type ScheduledDoses } from "@/services/medicationReminders";
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
    expect(reminders).toHaveLength(13);
    expect(doseReminders([{ id: "scan", medication: plan }], at(4, 9), false)).toEqual([]);
  });

  it("schedules once, cancels what is no longer wanted, never asks for the permission", async () => {
    let saved: ScheduledDoses = {};
    const scheduled: number[] = [];
    const cancelled: number[] = [];
    let next = 1;
    const deps: MedicationReminderDeps = {
      permission: async () => "granted",
      notify: async ({ entryId }) => {
        expect(entryId).toBe("med:scan");
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
    expect(scheduled).toHaveLength(13);
    await reconcileMedicationState(entries, texts, deps, { now: at(4, 9) });
    expect(scheduled).toHaveLength(13);
    // Stopped: everything cancelled.
    await reconcileMedicationState([{ id: "scan" }], texts, deps, { now: at(4, 9) });
    expect(cancelled).toHaveLength(13);
    expect(saved).toEqual({});
  });

  it("opens the prescription's scan when a dose notification is tapped", () => {
    expect(tapTarget("med:abc")).toEqual({ pathname: "/result", query: { id: "abc" } });
  });
});
