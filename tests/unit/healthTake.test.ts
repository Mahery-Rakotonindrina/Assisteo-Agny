import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { mockPrescription } from "@/lib/ai/mock";
import type { MedicationPlan } from "@/lib/medication";
import { historyStore } from "@/services/historyStore";
import { markDoseTaken } from "@/services/medicationReminders";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
const plan: MedicationPlan = { start: "2026-11-04", createdAt: 0, courses: [{ name: "Amoxicilline", times: ["08:00", "20:00"], days: 7 }] };

describe("« J'ai pris »", () => {
  it("ticks a dose gone by or within the hour, never tomorrow's", async () => {
    await historyStore.clear();
    await historyStore.rawPut({ id: "rx", createdAt: 1, mode: "auto", thumbnail: "data:image/jpeg;base64,AA", preview: "data:image/jpeg;base64,AA", analysis: mockPrescription("fr"), meta: { model: "demo", demo: true, durationMs: 1 }, medication: plan, updatedAt: 1 } as never);
    expect(await markDoseTaken("rx", at(6, 8), at(5, 9))).toBe(false);
    expect(await markDoseTaken("rx", at(5, 20), at(5, 19))).toBe(true);
    expect(await markDoseTaken("rx", at(5, 8), at(5, 9))).toBe(true);
    expect((await historyStore.get("rx"))?.medication?.taken).toEqual([at(5, 8), at(5, 20)]);
  });
});
