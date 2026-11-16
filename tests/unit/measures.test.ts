import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import { EXPORT_DATABASES } from "@/lib/dataExport";
import { formatMeasure } from "@/lib/format";
import { ME, type HealthProfile } from "@/lib/healthProfiles";
import { change, cleanMeasure, measuresOf, measuresText, periodStart, readMeasure, readNumber, valuesOf, yRange, type Measure } from "@/lib/measures";
import { RESTORE_KEYS } from "@/scripts/lib/backup.mjs";

const day = (d: number, h = 8) => new Date(2026, 10, d, h).getTime();
const now = day(11, 12);
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr);
  if (typeof text !== "string") throw new Error(`missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};
const m = (id: string, patch: Partial<Measure>): Measure => ({ id, kind: "weight", at: day(1), weight: 64, createdAt: 1, updatedAt: 1, ...patch });
const rado: HealthProfile = { id: "rado", name: "Rado", relation: "child", createdAt: 1, updatedAt: 1 };

describe("Mes mesures", () => {
  it("reads numbers written either way, within wide bounds", () => {
    expect(readNumber("1,05", [0.1, 8], 2)).toBe(1.05);
    expect(readNumber(" 64.55 ", [0.5, 400], 1)).toBe(64.6);
    expect(readNumber("12a", [0, 100], 0)).toBeNull();
    expect(readNumber("-3", [0, 100], 0)).toBeNull();
    expect(readNumber("900", [0.5, 400], 1)).toBeNull();
  });

  it("checks the form: both pressure numbers (the first bigger), a pulse only if written, the moment of a blood sugar", () => {
    const at = day(10);
    expect(cleanMeasure({ kind: "pressure", at, systolic: "128", diastolic: "82", pulse: "" })).toEqual({ fields: { kind: "pressure", at, systolic: 128, diastolic: 82 }, wrong: [] });
    expect(cleanMeasure({ kind: "pressure", at, systolic: "128", diastolic: "82", pulse: "70", profileId: "rado", note: " bras gauche " }).fields).toMatchObject({ pulse: 70, profileId: "rado", note: "bras gauche" });
    expect(cleanMeasure({ kind: "pressure", at, systolic: "80", diastolic: "120" }).wrong).toEqual(["diastolic"]);
    expect(cleanMeasure({ kind: "pressure", at, systolic: "", diastolic: "82", pulse: "x" }).wrong).toEqual(["systolic", "pulse"]);
    expect(cleanMeasure({ kind: "glucose", at, glucose: "1,05", moment: "fasting" }).fields).toEqual({ kind: "glucose", at, glucose: 1.05, moment: "fasting" });
    expect(cleanMeasure({ kind: "glucose", at, glucose: "105" }).wrong).toEqual(["glucose"]);
    expect(cleanMeasure({ kind: "weight", at, weight: "64,5", profileId: ME }).fields).toEqual({ kind: "weight", at, weight: 64.5 });
    expect(cleanMeasure({ kind: "weight", at: Number.NaN, weight: "64" }).wrong).toEqual(["at"]);
    expect(readMeasure(m("x", { weight: undefined }))).toBeNull();
  });

  it("picks one person's measures of a kind in the period, oldest first ('Moi' keeps those of a relative removed)", () => {
    const list = [m("a", { at: day(9) }), m("b", { at: day(2), profileId: "rado" }), m("c", { at: day(5) }), m("old", { at: day(1) - 40 * 86_400_000 }), m("gone", { at: day(6), deletedAt: 2 }), m("lost", { at: day(7), profileId: "removed" }), m("g", { kind: "glucose", glucose: 1 })];
    const since = periodStart("30d", now);
    expect(measuresOf(list, "weight", ME, [rado], since, now).map((item) => item.id)).toEqual(["c", "lost", "a"]);
    expect(measuresOf(list, "weight", "rado", [rado], since, now).map((item) => item.id)).toEqual(["b"]);
    expect(measuresOf(list, "weight", ME, [rado]).map((item) => item.id)).toEqual(["old", "c", "lost", "a"]);
    expect(periodStart("3m", now)).toBe(new Date(2026, 7, 11, 12).getTime());
    expect(periodStart("1y", now)).toBe(new Date(2025, 10, 11, 12).getTime());
  });

  it("gives the change over the period and a y range that is never flat, with no word of judgement", () => {
    const pressure = [m("1", { kind: "pressure", systolic: 130, diastolic: 85, weight: undefined }), m("2", { kind: "pressure", systolic: 124, diastolic: 86, weight: undefined, at: day(5) })];
    expect(valuesOf(pressure[0])).toEqual([130, 85]);
    expect(change(pressure)).toEqual([-6, 1]);
    expect(change(pressure.slice(0, 1))).toBeNull();
    expect(yRange([m("1", { weight: 64 })])).toEqual([60.8, 67.2]);
    const [min, max] = yRange(pressure);
    expect(min).toBeLessThan(85);
    expect(max).toBeGreaterThan(130);
    // Nothing that sounds like an opinion, anywhere in the texts of the measures.
    expect(JSON.stringify(fr.health.measures)).not.toMatch(/normal|danger|élev|bas|risque|bon|mauvais/i);
  });

  it("writes the period's measures for the doctor, kind by kind, with the neutral line", () => {
    const list = [
      m("w1", { at: day(3), weight: 64.5 }),
      m("p1", { kind: "pressure", at: day(4, 9), systolic: 128, diastolic: 82, pulse: 70, weight: undefined, note: "bras gauche" }),
      m("g1", { kind: "glucose", at: day(5), glucose: 1.05, moment: "fasting", weight: undefined }),
      m("r1", { at: day(6), weight: 20, profileId: "rado" }),
    ];
    const format = { date: (at: number) => new Date(at).toISOString().slice(0, 10), dateTime: (at: number) => new Date(at).toISOString().slice(0, 13), number: (value: number, decimals: number) => formatMeasure(value, decimals, "fr") };
    const text = measuresText(list, { person: ME, profiles: [rado], since: day(1), until: day(11), name: null }, t, format);
    expect(text.split("\n")).toEqual([
      "Mes mesures",
      `Du ${format.date(day(1))} au ${format.date(day(11))}`,
      "",
      "Tension",
      `- ${format.dateTime(day(4, 9))} : 128/82 mmHg · pouls 70 (bras gauche)`,
      "",
      "Glycémie",
      `- ${format.dateTime(day(5))} : 1,05 g/L · à jeun`,
      "",
      "Poids",
      `- ${format.dateTime(day(3))} : 64,5 kg`,
      "",
      "Montre ces valeurs à ton médecin.",
    ]);
    expect(measuresText(list, { person: "rado", profiles: [rado], since: day(1), until: day(11), name: "Rado" }, t, format)).toMatch(/^Mesures de Rado\n/);
  });

  it("is kept in its own table, backed up, and in the copy of one's data", () => {
    expect(RESTORE_KEYS).toHaveProperty("health_measures");
    const sql = readFileSync("supabase/migrations/0024_mesures_sante.sql", "utf8");
    expect(sql).toMatch(/create table if not exists public\.health_measures/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/using \(user_id = auth\.uid\(\)\)/);
    expect(EXPORT_DATABASES["assisteo-measures"]).toEqual({ store: "measures", file: "sante" });
  });
});
