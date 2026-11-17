import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { addDays, localDay } from "@/lib/agenda/days";
import { agendaSources } from "@/lib/agenda/sources";
import { pharmacySource } from "@/lib/agenda/sources/pharmacy";
import { LATE_VACCINE_DAYS, vaccinesSource } from "@/lib/agenda/sources/vaccines";
import type { AgendaContext, AgendaData, AgendaItem } from "@/lib/agenda/types";
import { healthItems, searchSources, type SearchItem, type SearchSource } from "@/lib/globalSearch";
import type { HealthProfile } from "@/lib/healthProfiles";
import type { HomeMedicine } from "@/lib/pharmacy";
import type { Vaccine } from "@/lib/vaccines";

// Monday 16 November 2026, 10:00 (the device's own time zone, like the app).
const now = new Date(2026, 10, 16, 10).getTime();
const noon = (month: number, date: number, year = 2026) => new Date(year, month - 1, date, 12).getTime();
const midnight = (month: number, date: number, year = 2026) => new Date(year, month - 1, date).getTime();

const emptyData: AgendaData = { entries: [], appointments: [], profiles: [], loans: [], records: [], parcels: [], vehicles: [], homeItems: [], plants: [] };
// No plan at all: these two sources are for everyone.
const context = (data: Partial<AgendaData>, days = 30): AgendaContext => {
  const from = localDay(now);
  return { now, from, to: addDays(from, days), has: () => false, data: { ...emptyData, ...data } };
};
const brief = (items: AgendaItem[]) => items.map((item) => [item.key, item.at, item.label.key, item.label.params?.name, item.detail?.key, item.detail?.params?.name, item.late ?? false, item.href]);

const profiles = [
  { id: "rado", name: "Rado Rakoto", relation: "child", createdAt: 1, updatedAt: 1 },
  { id: "gone", name: "Lala", relation: "child", createdAt: 1, updatedAt: 1, deletedAt: 5 },
] as HealthProfile[];
const vax = (id: string, name: string, at: number, patch: Partial<Vaccine> = {}): Vaccine => ({ id, name, at, dose: "", place: "", lot: "", note: "", createdAt: 1, updatedAt: 1, ...patch });
const med = (id: string, name: string, expiry: string, patch: Partial<HomeMedicine> = {}): HomeMedicine => ({ id, name, strength: "", quantity: "", expiry, note: "", createdAt: 1, updatedAt: 1, ...patch });

describe("agenda: vaccines", () => {
  it("shows each next dose on its day with the first name, late ones for 90 days, never an orphan's or a done one", () => {
    const vaccines = [
      vax("rr", "Rougeole-Rubéole", noon(9, 1), { profileId: "rado", nextAt: noon(11, 20) }),
      vax("me", "Tétanos", noon(1, 1), { nextAt: noon(12, 1) }),
      vax("late", "Polio", noon(5, 1), { profileId: "rado", nextAt: noon(11, 10) }),
      vax("old", "BCG", noon(1, 1), { nextAt: addDays(midnight(11, 16), -LATE_VACCINE_DAYS - 1) + 12 * 3_600_000 }),
      vax("lala", "HPV", noon(1, 1), { profileId: "gone", nextAt: noon(11, 25) }),
      vax("far", "Typhoïde", noon(1, 1), { nextAt: noon(3, 1, 2027) }),
      // Done: a later Hépatite B written since.
      vax("h1", "Hépatite B", noon(1, 1), { nextAt: noon(11, 18) }),
      vax("h2", "hepatite b", noon(11, 2)),
    ];
    expect(brief(vaccinesSource.collect(context({ vaccines, profiles })))).toEqual(expectedOrder());
  });

  it("is late until 90 days, then leaves the agenda", () => {
    const at = (back: number) => addDays(localDay(now), -back) + 12 * 3_600_000;
    const keysFor = (back: number) => vaccinesSource.collect(context({ vaccines: [vax("v", "Polio", noon(1, 1), { nextAt: at(back) })] })).map((item) => item.key);
    expect(keysFor(1)).toEqual(["vaccine-late:v"]);
    expect(keysFor(LATE_VACCINE_DAYS)).toEqual(["vaccine-late:v"]);
    expect(keysFor(LATE_VACCINE_DAYS + 1)).toEqual([]);
    // Today is not late yet.
    expect(keysFor(0)).toEqual(["vaccine:v"]);
  });
});

/** The order the source gives: as the next doses, the soonest first. */
function expectedOrder() {
  return [
    ["vaccine-late:late", midnight(11, 10), "agenda.items.vaccine", "Polio", "agenda.items.vaccineLateFor", "Rado", true, "/sante?vax=late"],
    ["vaccine:rr", midnight(11, 20), "agenda.items.vaccine", "Rougeole-Rubéole", "agenda.items.forPerson", "Rado", false, "/sante?vax=rr"],
    ["vaccine:me", midnight(12, 1), "agenda.items.vaccine", "Tétanos", undefined, undefined, false, "/sante?vax=me"],
  ];
}

describe("agenda: home pharmacy", () => {
  it("shows the last good day of each medicine, an expired one late until it is removed", () => {
    const pharmacy = [
      med("p", "Paracétamol", "2026-11", { forWho: "rado" }),
      med("s", "Sirop", "2026-12-05"),
      med("old", "Ibuprofène", "2025-01"),
      med("far", "Vitamine C", "2027-06"),
      med("gone", "Amoxicilline", "2026-11-20", { deletedAt: 3 }),
    ];
    expect(brief(pharmacySource.collect(context({ pharmacy, profiles })))).toEqual([
      ["medicine-late:old", midnight(1, 31, 2025), "agenda.items.medicineExpired", "Ibuprofène", undefined, undefined, true, "/sante?med=old"],
      ["medicine:p", midnight(11, 30), "agenda.items.medicineLastDay", "Paracétamol", "agenda.items.forPerson", "Rado", false, "/sante?med=p"],
      ["medicine:s", midnight(12, 5), "agenda.items.medicineLastDay", "Sirop", undefined, undefined, false, "/sante?med=s"],
    ]);
    // On its last day it is still to come, not late.
    expect(pharmacySource.collect(context({ pharmacy: [med("t", "Sirop", "2026-11-16")] })).map((item) => [item.key, item.late ?? false])).toEqual([["medicine:t", false]]);
  });

  it("is listed with the other sources, each domain with its texts", () => {
    expect(agendaSources).toContain(vaccinesSource);
    expect(agendaSources).toContain(pharmacySource);
    for (const texts of [fr, en]) {
      expect(texts.agenda.domains.vaccines).toBeTruthy();
      expect(texts.agenda.domains.pharmacy).toBeTruthy();
      for (const key of ["vaccine", "vaccineLate", "vaccineLateFor", "medicineLastDay", "medicineExpired"]) expect((texts.agenda.items as Record<string, string>)[key]).toBeTruthy();
    }
    // Nothing written: nothing, no error.
    expect(vaccinesSource.collect(context({}))).toEqual([]);
    expect(pharmacySource.collect(context({}))).toEqual([]);
  });
});

describe("search: vaccines and home medicines", () => {
  const fmt = { date: (at: number) => `d${at}` };
  const names = { relation: String, spend: String, person: (id?: string) => (id === "rado" ? "Rado Rakoto" : undefined) };
  const one = (items: SearchItem[]): SearchSource[] => [{ domain: "health", items }];
  // Only the vaccines and the medicines (a relative's name finds the relative too).
  const keys = (sources: SearchSource[], query: string) =>
    searchSources(sources, query)
      .flatMap((result) => result.hits.map((hit) => hit.key))
      .filter((key) => !key.startsWith("profile:"));

  it("finds a vaccine by its name, place, batch, note or first name, and opens it", () => {
    const vaccines = [vax("v1", "Rougeole-Rubéole", noon(9, 1), { place: "CSB Analakely", lot: "AB12", note: "un peu de fièvre", profileId: "rado" }), vax("v2", "HPV", noon(1, 1), { profileId: "gone" }), vax("v3", "BCG", noon(1, 1), { deletedAt: 4 })];
    const sources = one(healthItems({ appointments: [], profiles, spends: [], vaccines }, names, fmt));
    for (const query of ["rougeole", "analakely", "ab12", "fievre", "rakoto"]) expect(keys(sources, query)).toEqual(["vax:v1"]);
    // An orphan's or a removed one: nowhere.
    expect(keys(sources, "hpv")).toEqual([]);
    expect(keys(sources, "bcg")).toEqual([]);
    expect(sources[0].items.find((item) => item.key === "vax:v1")?.href).toBe("/sante?vax=v1");
  });

  it("finds a home medicine by its name, dosage, note or for whom, and opens it", () => {
    const pharmacy = [med("m1", "Paracétamol", "2027-03", { strength: "500 mg", note: "armoire de la cuisine", forWho: "rado" }), med("m2", "Sirop", "2027-01", { deletedAt: 4 })];
    const sources = one(healthItems({ appointments: [], profiles, spends: [], pharmacy }, names, fmt));
    for (const query of ["paracetamol", "500 mg", "cuisine", "rado"]) expect(keys(sources, query)).toEqual(["med:m1"]);
    expect(keys(sources, "sirop")).toEqual([]);
    expect(sources[0].items.find((item) => item.key === "med:m1")).toMatchObject({ title: "Paracétamol 500 mg", href: "/sante?med=m1" });
  });
});
