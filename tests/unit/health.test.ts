import { describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import { mockPrescription } from "@/lib/ai/mock";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { healthOverview, isHealthScan, treatmentsText } from "@/lib/health";
import type { MedicationPlan } from "@/lib/medication";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

// The real French texts, to read the shared list as it is sent.
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr);
  if (typeof text !== "string") throw new Error(`missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};

const plan: MedicationPlan = { start: "2026-11-04", createdAt: 0, courses: [{ name: "Amoxicilline", dose: "1 gélule", times: ["08:00", "20:00"], days: 7 }] };
const scan = (id: string, createdAt: number, patch: object = {}) => ({ id, createdAt, analysis: { title: `Ordonnance ${id}`, medicine: { items: [] } }, ...patch });

describe("Ma santé", () => {
  it("lists the prescriptions, the latest first, and the treatments in progress with their next dose and days left", () => {
    const entries = [
      scan("old", 1),
      scan("now", 3, { medication: plan }),
      scan("done", 2, { medication: { ...plan, start: "2026-10-01" } }),
      { id: "food", createdAt: 4, analysis: { title: "Salade", medicine: null } },
    ];
    const { scans, treatments } = healthOverview(entries, at(6, 9));
    expect(scans.map((entry) => entry.id)).toEqual(["now", "done", "old"]);
    expect(treatments).toHaveLength(1);
    expect(treatments[0]).toMatchObject({ end: at(10, 20), daysLeft: 5, next: { at: at(6, 20) } });
    // The next dose is a dose, never the last-day notice.
    expect(healthOverview(entries, at(9, 19, 30)).treatments[0].next?.at).toBe(at(9, 20));
    expect(isHealthScan({ analysis: { medicine: null } } as never)).toBe(false);
  });

  it("shares only the treatments' medicines, doses, times and end, with the medical warning", () => {
    const { treatments } = healthOverview([scan("now", 3, { medication: plan, analysis: { title: "Ordonnance du Dr Rabe", medicine: { items: [] }, summary: "secret" } })], at(6, 9));
    const text = treatmentsText(treatments, t, () => "10 nov. 2026");
    expect(text).toBe(
      [
        "Mes traitements en cours",
        "Ordonnance du Dr Rabe\n- Amoxicilline : 1 gélule, à 08:00, 20:00, jusqu’au 10 nov. 2026",
        fr.medicine.disclaimer,
      ].join("\n\n"),
    );
    expect(text).not.toContain("secret");
  });

  it("reads the renewal on a prescription; older scans say nothing", () => {
    expect(AnalysisSchema.parse(mockPrescription("fr")).medicine?.renewal).toBe(false);
    const old = { ...mockPrescription("fr"), medicine: { ...mockPrescription("fr").medicine } } as Record<string, unknown>;
    delete (old.medicine as Record<string, unknown>).renewal;
    expect(AnalysisSchema.parse(normalizeStoredAnalysis(old)).medicine?.renewal).toBeNull();
  });
});
