import { describe, expect, it } from "vitest";
import { cleanFolder, folderList, inCollection } from "@/lib/historyFilters";

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
