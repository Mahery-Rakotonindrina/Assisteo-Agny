import { describe, expect, it } from "vitest";
import { mockMedicineBox, mockPrescription } from "@/lib/ai/mock";
import { z } from "zod";
import { AnalysisSchema, normalizeStoredAnalysis } from "@/lib/ai/schema";
import { healthPayload, mergeHealth, noHealth } from "@/lib/healthSync";
import {
  expiryDay,
  expiryFrom,
  expiryStatus,
  fromScan,
  homeMedicines,
  mergePharmacy,
  MAX_HOME_MEDICINES,
  normalizeExpiry,
  normalizePharmacy,
  PHARMACY_TOMBSTONE_MS,
  pharmacyReminders,
  removeAllHomeMedicines,
  removeHomeMedicine,
  restoreHomeMedicine,
  scanMedicineId,
  saveHomeMedicine,
  type HomeMedicine,
} from "@/lib/pharmacy";
import { syncedSettingKeys } from "@/lib/settings/SettingsProvider";
import type { ScheduledAppointmentReminders } from "@/services/appointmentReminders";
import { tapTarget } from "@/services/notificationTap";
import { reconcilePharmacyReminderState } from "@/services/pharmacyReminders";

const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime();
const med = (id: string, expiry: string, patch: Partial<HomeMedicine> = {}): HomeMedicine => ({ id, name: "Paracétamol", strength: "500 mg", quantity: "", expiry, note: "", createdAt: 1, updatedAt: 1, ...patch });
let counter = 0;
const newId = () => `m${++counter}`;
const draft = (patch: Partial<HomeMedicine> = {}) => ({ name: "Paracétamol", strength: "500 mg", quantity: "1 boîte", expiry: "2027-03", note: "", ...patch });

describe("Pharmacie de la maison", () => {
  it("reads an expiry as written: month and year, the day if given, the usual box formats", () => {
    expect(normalizeExpiry("2027-03")).toBe("2027-03");
    expect(normalizeExpiry("2027-3-5")).toBe("2027-03-05");
    expect(normalizeExpiry("03/2027")).toBe("2027-03");
    expect(normalizeExpiry("15.03.2027")).toBe("2027-03-15");
    expect(normalizeExpiry("2027-02-30")).toBeNull();
    expect(normalizeExpiry("2027-13")).toBeNull();
    expect(normalizeExpiry("")).toBeNull();
    expect(normalizeExpiry(null)).toBeNull();
    expect(expiryFrom(2028, 2, null)).toBe("2028-02");
    expect(expiryFrom(2027, 2, 29)).toBeNull();
  });

  it("takes the end of the month without a day, leap years included", () => {
    expect(expiryDay("2027-03")).toBe(at(2027, 3, 31));
    expect(expiryDay("2028-02")).toBe(at(2028, 2, 29));
    expect(expiryDay("2027-02")).toBe(at(2027, 2, 28));
    expect(expiryDay("2027-04-10")).toBe(at(2027, 4, 10));
  });

  it("is « bientôt périmé » 30 days before, « périmé » the day after its last day", () => {
    expect(expiryStatus("2027-03", at(2027, 1, 15))).toBe("ok");
    expect(expiryStatus("2027-03", at(2027, 3, 2))).toBe("soon");
    // The date written is the last good day: that day, expired tomorrow.
    expect(expiryStatus("2027-03", at(2027, 3, 30, 23))).toBe("soon");
    expect(expiryStatus("2027-03", at(2027, 3, 31, 0))).toBe("lastDay");
    expect(expiryStatus("2027-03", at(2027, 3, 31, 23))).toBe("lastDay");
    expect(expiryStatus("2027-04-10", at(2027, 4, 10, 9))).toBe("lastDay");
    expect(expiryStatus("2027-03", at(2027, 4, 1, 0))).toBe("expired");
    expect(expiryStatus("2027-04-10", at(2027, 3, 11))).toBe("soon");
    expect(expiryStatus("2027-04-10", at(2027, 3, 10))).toBe("ok");
  });

  it("adds, changes and removes (thrown or finished), the first to expire first", () => {
    const now = at(2026, 11, 17);
    let list = saveHomeMedicine(null, null, draft({ expiry: "2027-06" }), now, newId);
    list = saveHomeMedicine(list, null, draft({ name: " Sirop ", expiry: "2027-01-15", forWho: "me" }), now, newId);
    expect(homeMedicines(list).map((item) => [item.name, item.expiry])).toEqual([
      ["Sirop", "2027-01-15"],
      ["Paracétamol", "2027-06"],
    ]);
    const sirop = homeMedicines(list)[0];
    const changed = saveHomeMedicine(list, sirop.id, draft({ name: "Sirop", expiry: "2027-01-15" }), now + 1, newId);
    expect(changed.find((item) => item.id === sirop.id)?.forWho).toBeUndefined();
    // Nothing saved without a name or a good expiry.
    expect(saveHomeMedicine(list, null, draft({ name: " " }), now, newId)).toEqual(list);
    expect(saveHomeMedicine(list, null, draft({ expiry: "2027-02-31" }), now, newId)).toEqual(list);
    const removed = removeHomeMedicine(changed, sirop.id, now + 2);
    expect(homeMedicines(removed).map((item) => item.name)).toEqual(["Paracétamol"]);
    expect(removed.find((item) => item.id === sirop.id)).toMatchObject({ deletedAt: now + 2, updatedAt: now + 2 });
    expect(removeHomeMedicine(removed, "none", now + 2 + PHARMACY_TOMBSTONE_MS)).toHaveLength(1);
    expect(homeMedicines(removeAllHomeMedicines(removed, now + 3))).toEqual([]);
  });

  it("puts a removed medicine back as it was with « Annuler », and the other device follows (no ghost removal)", () => {
    const now = at(2026, 11, 17);
    const before = [med("a", "2027-05", { quantity: "1 boîte", note: "cuisine", forWho: "me", updatedAt: 10 }), med("b", "2027-06")];
    const removed = removeHomeMedicine(before, "a", now);
    const restored = restoreHomeMedicine(removed, before[0], now + 1000);
    const back = restored.find((item) => item.id === "a")!;
    expect(back).toEqual({ ...before[0], updatedAt: now + 1000 });
    expect(homeMedicines(restored).map((item) => item.id)).toEqual(["a", "b"]);
    // The account still has the removal: the restored copy is newer, it wins both ways.
    expect(homeMedicines(mergePharmacy(removed, restored, now + 2000)).map((item) => item.id)).toEqual(["a", "b"]);
    expect(homeMedicines(mergePharmacy(restored, removed, now + 2000)).map((item) => item.id)).toEqual(["a", "b"]);
    // Even with a clock behind the removal's: still newer.
    expect(restoreHomeMedicine(removed, before[0], now - 5).find((item) => item.id === "a")!.updatedAt).toBeGreaterThan(now);
  });

  it("reads what was stored, the latest copy of each, and drops what is unusable", () => {
    expect(normalizePharmacy(undefined)).toBeNull();
    const list = normalizePharmacy([med("a", "2027-05"), med("a", "2027-06", { updatedAt: 5 }), { id: "x", name: "X" }, { ...med("b", "2027-02"), quantity: 3 }, null])!;
    expect(list.map((item) => [item.id, item.expiry, item.quantity])).toEqual([
      ["b", "2027-02", ""],
      ["a", "2027-06", ""],
    ]);
  });

  it("merges two devices one medicine at a time: the latest change wins, a removal too", () => {
    const now = at(2026, 11, 17);
    const local = [med("a", "2027-01", { updatedAt: 10 }), med("b", "2027-02", { updatedAt: 10 }), med("c", "2027-03")];
    const remote = [med("a", "2027-01", { quantity: "2 boîtes", updatedAt: 20 }), med("b", "2027-02", { updatedAt: now - 1, deletedAt: now - 1 }), med("d", "2027-04")];
    const merged = mergePharmacy(local, remote, now)!;
    expect(merged.map((item) => [item.id, item.quantity, Boolean(item.deletedAt)])).toEqual([
      ["a", "2 boîtes", false],
      ["b", "", true],
      ["c", "", false],
      ["d", "", false],
    ]);
    expect(mergePharmacy(null, undefined, now)).toBeNull();
    // In the synced settings, like the vaccines.
    expect(syncedSettingKeys).toContain("pharmacy");
    expect(noHealth.pharmacy).toBeNull();
    expect(mergeHealth({ pharmacy: local }, { pharmacy: remote }, now).pharmacy).toEqual(merged);
    expect("pharmacy" in healthPayload({ pharmacy: null })).toBe(false);
  });

  it("keeps at most 300 live medicines, the recent removals not counted", () => {
    const now = at(2026, 11, 17);
    const live = Array.from({ length: MAX_HOME_MEDICINES + 1 }, (_, index) => med(`l${index}`, "2027-05", { updatedAt: 100 + index }));
    const removed = Array.from({ length: 20 }, (_, index) => med(`d${index}`, "2027-05", { updatedAt: now - 1, deletedAt: now - 1 }));
    const merged = mergePharmacy(live, removed, now)!;
    expect(homeMedicines(merged)).toHaveLength(MAX_HOME_MEDICINES);
    expect(merged.some((item) => item.id === "l0")).toBe(false);
    expect(merged.filter((item) => item.deletedAt)).toHaveLength(20);
  });

  it("alerts a month before and on the day at 9 h, only what is still to come", () => {
    const list = [med("a", "2027-03"), med("b", "2027-04-10")];
    const reminders = pharmacyReminders(list, at(2027, 1, 1));
    expect(reminders.map((item) => [item.medicine.id, item.kind, item.at])).toEqual([
      ["a", "month", at(2027, 2, 28, 9)],
      ["b", "month", at(2027, 3, 10, 9)],
      ["a", "day", at(2027, 3, 31, 9)],
      ["b", "day", at(2027, 4, 10, 9)],
    ]);
    expect(reminders[0].entryId).toBe("pharma:a");
    expect(pharmacyReminders(list, at(2027, 3, 5)).map((item) => [item.medicine.id, item.kind])).toEqual([
      ["b", "month"],
      ["a", "day"],
      ["b", "day"],
    ]);
    expect(pharmacyReminders(list, at(2027, 1, 1), false)).toEqual([]);
    expect(pharmacyReminders([med("a", "2027-03", { deletedAt: 5 })], at(2027, 1, 1))).toEqual([]);
  });

  it("schedules and cancels the alerts like the vaccines', and opens « Ma santé » on the pharmacy", async () => {
    let scheduled: ScheduledAppointmentReminders = {};
    const cancelled: number[] = [];
    let nextId = 1;
    const deps = {
      permission: async () => "granted",
      notify: async () => nextId++,
      cancel: async (id: number) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => scheduled,
      save: (next: ScheduledAppointmentReminders) => {
        scheduled = next;
      },
    };
    const texts = () => ({ title: "x", body: "y" });
    await reconcilePharmacyReminderState([med("a", "2027-03")], texts, deps, { now: at(2027, 1, 1) });
    expect(Object.keys(scheduled)).toHaveLength(2);
    await reconcilePharmacyReminderState([med("a", "2027-03")], texts, deps, { now: at(2027, 1, 1), enabled: false });
    expect(cancelled).toEqual([1, 2]);
    expect(tapTarget("pharma:a")).toEqual({ pathname: "/sante", query: { show: "pharmacy" } });
  });

  it("says the truth on the last good day: the alert of that day reads « périmé demain »", async () => {
    const fr = (await import("@/locales/fr.json")).default as { health: { pharmacy: { lastDay: string; reminders: { dayTitle: string; dayBody: string } } } };
    const en = (await import("@/locales/en.json")).default as typeof fr;
    expect(fr.health.pharmacy.lastDay).toBe("Dernier jour : périmé demain");
    expect(fr.health.pharmacy.reminders.dayTitle).toBe("Dernier jour : {name}");
    expect(fr.health.pharmacy.reminders.dayBody).toContain("Périmé demain");
    expect(en.health.pharmacy.lastDay).toBe("Last day: expired tomorrow");
    // Still rung on that last day at 9 h.
    const day = pharmacyReminders([med("a", "2027-03")], at(2027, 3, 1)).find((item) => item.kind === "day")!;
    expect(day.at).toBe(at(2027, 3, 31, 9));
    expect(expiryStatus("2027-03", day.at)).toBe("lastDay");
  });

  it("gives a medicine added from a scan the same id on every device, so two adds merge into one", () => {
    const now = at(2026, 11, 17);
    expect(scanMedicineId("scan1", 0)).toBe("scan:scan1:0");
    const fromScanDraft = { ...draft({ expiry: "2028-03" }), scanId: "scan1" };
    const phone = saveHomeMedicine(null, null, fromScanDraft, now, () => scanMedicineId("scan1", 0));
    const tablet = saveHomeMedicine(null, null, { ...fromScanDraft, quantity: "2 boîtes" }, now + 5, () => scanMedicineId("scan1", 0));
    const merged = homeMedicines(mergePharmacy(phone, tablet, now + 10));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "scan:scan1:0", quantity: "2 boîtes" });
    // By hand: a new id each time.
    expect(homeMedicines([...saveHomeMedicine(null, null, draft(), now, newId), ...saveHomeMedicine(null, null, draft(), now, newId)])).toHaveLength(2);
  });

  it("takes a provider's answer without the expiry as none read, still asked for in the JSON schema", () => {
    const answer = structuredClone(mockMedicineBox("fr")) as unknown as { medicine: { items: Array<Record<string, unknown>> } };
    delete answer.medicine.items[0].expiry;
    expect(AnalysisSchema.parse(answer).medicine?.items[0].expiry).toBeNull();
    const schema = JSON.stringify(z.toJSONSchema(AnalysisSchema));
    expect(schema).toContain('"expiry"');
    const item = (z.toJSONSchema(AnalysisSchema) as unknown as { properties: { medicine: { anyOf: Array<{ properties?: { items: { items: { required: string[] } } } }> } } }).properties.medicine.anyOf.find((part) => part.properties)!;
    expect(item.properties!.items.items.required).toContain("expiry");
  });

  it("reads the expiry on a scanned box; older scans and prescriptions have none", () => {
    expect(AnalysisSchema.parse(mockMedicineBox("fr")).medicine?.items[0].expiry).toBe("2028-03");
    expect(AnalysisSchema.parse(mockPrescription("fr")).medicine?.items.every((item) => item.expiry === null)).toBe(true);
    const old = structuredClone(mockMedicineBox("fr")) as unknown as { medicine: { items: Array<Record<string, unknown>> } };
    delete old.medicine.items[0].expiry;
    expect(AnalysisSchema.parse(normalizeStoredAnalysis(old)).medicine?.items[0].expiry).toBeNull();
    // Added once from a scan: the button says so.
    expect(fromScan([med("a", "2028-03", { scanId: "s1" })], "s1", "paracétamol ")).toBe(true);
    expect(fromScan([med("a", "2028-03", { scanId: "s1" })], "s2", "Paracétamol")).toBe(false);
  });
});
