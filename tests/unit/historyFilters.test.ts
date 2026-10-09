import { describe, expect, it } from "vitest";
import { cleanFolder, dateRange, folderList, inCollection, inRange } from "@/lib/historyFilters";

describe("favourites and folders", () => {
  const entries = [{ favorite: true, folder: "Maison" }, { folder: "Voiture" }, { folder: "Maison" }, {}];

  it("lists folders with their counts, by name", () => {
    expect(folderList(entries)).toEqual([
      { name: "Maison", count: 2 },
      { name: "Voiture", count: 1 },
    ]);
  });

  it("keeps a collection's scans only", () => {
    expect(entries.filter((entry) => inCollection(entry, "favorites"))).toHaveLength(1);
    expect(entries.filter((entry) => inCollection(entry, "folder:Maison"))).toHaveLength(2);
    expect(entries.filter((entry) => inCollection(entry, "all"))).toHaveLength(4);
  });

  it("cleans a typed folder name", () => {
    expect(cleanFolder("  Papiers   de la  maison ")).toBe("Papiers de la maison");
    expect(cleanFolder("x".repeat(60))).toHaveLength(40);
  });
});

describe("date filter", () => {
  const now = new Date(2026, 9, 9, 15).getTime();
  const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime();
  const keeps = (preset: Parameters<typeof dateRange>[0], timestamp: number, from?: string, to?: string) => inRange(timestamp, dateRange(preset, now, from, to));

  it("covers today, the last 7 and 30 days, and this month", () => {
    expect(dateRange("all", now)).toBeNull();
    expect([keeps("today", at(10, 9, 0)), keeps("today", at(10, 8, 23))]).toEqual([true, false]);
    expect([keeps("week", at(10, 3, 0)), keeps("week", at(10, 2, 23))]).toEqual([true, false]);
    expect([keeps("month", at(9, 10, 0)), keeps("month", at(9, 9, 23))]).toEqual([true, false]);
    expect([keeps("thisMonth", at(10, 1, 0)), keeps("thisMonth", at(9, 30, 23))]).toEqual([true, false]);
  });

  it("takes picked dates, both days included, either one optional", () => {
    expect([keeps("custom", at(9, 1, 0), "2026-09-01", "2026-09-30"), keeps("custom", at(9, 30, 23), "2026-09-01", "2026-09-30")]).toEqual([true, true]);
    expect(keeps("custom", at(10, 1, 0), "2026-09-01", "2026-09-30")).toBe(false);
    expect(keeps("custom", at(1, 1), "", "2026-09-30")).toBe(true);
    expect(keeps("custom", at(12, 31), "2026-09-01")).toBe(true);
  });
});
