import { describe, expect, it } from "vitest";
import { normalizeAppointments, reassignAppointments, saveAppointment, type Appointment } from "@/lib/appointments";
import { blankCard } from "@/lib/emergencyCard";
import {
  ageOf,
  birthYear,
  liveProfiles,
  ME,
  mergeProfiles,
  normalizeProfiles,
  ownerName,
  ownerOf,
  personFromLink,
  removeAllProfiles,
  removeProfile,
  saveProfile,
  saveProfileCard,
  type HealthProfile,
} from "@/lib/healthProfiles";
import { healthPayload, mergeHealth, noHealth, planSettingsSync, type SettingsRow } from "@/lib/healthSync";
import { syncedSettingKeys } from "@/lib/settings/SettingsProvider";
import { tapTarget } from "@/services/notificationTap";

const now = new Date(2026, 10, 10, 12).getTime();
let counter = 0;
const newId = () => `p${++counter}`;
const rado = (patch: Partial<HealthProfile> = {}): HealthProfile => ({ id: "rado", name: "Rado", relation: "child", createdAt: 1, updatedAt: 1, ...patch });
const appt = (id: string, patch: Partial<Appointment> = {}): Appointment => ({ id, at: now + 86_400_000, who: "Dr Rabe", place: "", note: "", createdAt: 1, updatedAt: 1, ...patch });

describe("Pour qui ?", () => {
  it("keeps only real relatives: a name, a known relation, a sensible birth year, never « Moi »", () => {
    expect(normalizeProfiles(undefined)).toBeNull();
    const list = normalizeProfiles([rado({ birthYear: 2019 }), { id: "me", name: "Moi" }, { id: "x", name: "  " }, { id: "m", name: "Maman", relation: "aunt", birthYear: 1850 }])!;
    expect(list.map((item) => [item.id, item.relation, item.birthYear])).toEqual([
      ["m", "other", undefined],
      ["rado", "child", 2019],
    ]);
    expect(birthYear("2019", now)).toBe(2019);
    expect(birthYear(2030, now)).toBeUndefined();
    expect(ageOf(rado({ birthYear: 2019 }), now)).toBe(7);
  });

  it("adds, edits and removes a relative, their card going with them", () => {
    const added = saveProfile(null, null, { name: " Rado ", relation: "child", birthYear: 2019 }, now, newId);
    expect(added).toHaveLength(1);
    const id = added[0].id;
    expect(added[0]).toMatchObject({ name: "Rado", birthYear: 2019, createdAt: now });
    const edited = saveProfile(added, id, { name: "Rado", relation: "child", birthYear: undefined }, now + 1, newId);
    expect(edited[0].birthYear).toBeUndefined();
    const withCard = saveProfileCard(edited, id, { ...blankCard(now + 2), bloodGroup: "A+" }, now + 2);
    expect(withCard[0].card?.bloodGroup).toBe("A+");
    const removed = removeProfile(withCard, id, now + 3);
    expect(removed[0]).toMatchObject({ deletedAt: now + 3 });
    expect(removed[0].card).toBeUndefined();
    expect(liveProfiles(removed)).toEqual([]);
    expect(liveProfiles(removeAllProfiles([rado(), rado({ id: "b", name: "B" })], now))).toEqual([]);
  });

  it("gives everything without a profile, or with one removed or not here yet, to « Moi »", () => {
    const list = [rado(), rado({ id: "gone", name: "Gone", deletedAt: now })];
    expect(ownerOf(undefined, list)).toBe(ME);
    expect(ownerOf("rado", list)).toBe("rado");
    expect(ownerOf("gone", list)).toBe(ME);
    expect(ownerOf("elsewhere", list)).toBe(ME);
    expect(ownerName("rado", list)).toBe("Rado");
    expect(ownerName(undefined, list)).toBeNull();
  });

  it("gives a relative's appointments back to « Moi », and lets an appointment change person", () => {
    const list = [appt("a", { profileId: "rado" }), appt("b")];
    const back = reassignAppointments(list, "rado", now)!;
    expect(back.find((item) => item.id === "a")).toEqual({ ...appt("a"), updatedAt: now });
    expect(reassignAppointments(null, "rado", now)).toBeNull();
    const forRado = saveAppointment(list, "b", { at: appt("b").at, who: "Dr Rabe", place: "", note: "", profileId: "rado" }, now, newId);
    expect(forRado.find((item) => item.id === "b")?.profileId).toBe("rado");
    const forMe = saveAppointment(forRado, "b", { at: appt("b").at, who: "Dr Rabe", place: "", note: "", profileId: ME }, now + 1, newId);
    expect(forMe.find((item) => item.id === "b")?.profileId).toBeUndefined();
    // An appointment of before (no profile) is "Moi"'s.
    expect(normalizeAppointments([appt("c", { profileId: "me" })])![0].profileId).toBeUndefined();
  });

  it("merges the relatives of two devices one by one, a removal too, and syncs them with the settings", () => {
    expect(syncedSettingKeys).toContain("healthProfiles");
    const merged = mergeProfiles([rado({ updatedAt: 10 }), rado({ id: "m", name: "Maman", updatedAt: 5 })], [rado({ name: "Rado K.", updatedAt: 20 }), rado({ id: "m", name: "Maman", updatedAt: now, deletedAt: now })], now)!;
    expect(merged.map((item) => [item.id, item.name, Boolean(item.deletedAt)])).toEqual([
      ["m", "Maman", true],
      ["rado", "Rado K.", false],
    ]);
    expect(mergeHealth({}, {}, now)).toEqual(noHealth);
    expect(healthPayload({ locale: "fr", healthProfiles: null })).toEqual({ locale: "fr" });

    // Two devices each add someone without seeing the other: nobody is lost.
    const keys = ["locale", "healthProfiles"];
    let server: SettingsRow = null;
    const send = (device: Record<string, unknown> & { updatedAt: number }): Record<string, unknown> & { updatedAt: number } => {
      const plan = planSettingsSync(device, server, keys, now);
      if (plan.write) server = { data: plan.write.data, updatedAt: plan.write.updatedAt };
      return { ...device, ...(plan.apply?.patch ?? {}), updatedAt: plan.apply?.updatedAt ?? device.updatedAt };
    };
    let phone: Record<string, unknown> & { updatedAt: number } = { locale: "fr", healthProfiles: [rado({ updatedAt: 100 })], updatedAt: 100 };
    const tablet = send({ locale: "fr", healthProfiles: [rado({ id: "m", name: "Maman", createdAt: 2, updatedAt: 200 })], updatedAt: 200 });
    phone = send(phone);
    expect((tablet.healthProfiles as HealthProfile[]).map((item) => item.name)).toEqual(["Maman"]);
    expect((phone.healthProfiles as HealthProfile[]).map((item) => item.name)).toEqual(["Rado", "Maman"]);
  });
  it("opens « Ma santé » on the person of a tapped notification, and ignores what it does not know", () => {
    const profiles = [rado(), rado({ id: "gone", name: "Gone", deletedAt: now })];
    const appointments = [appt("a1", { profileId: "rado" }), appt("a2"), appt("a3", { profileId: "gone" })];
    const entries = [{ id: "rx", profileId: "rado" }, { id: "mine" }];
    const data = { profiles, appointments, entries };
    const person = (entryId: string) => personFromLink(tapTarget(entryId).query ?? {}, data);
    expect(tapTarget("appt:a1")).toEqual({ pathname: "/sante", query: { show: "appointments", appt: "a1" } });
    expect(tapTarget("med:rx@1762236000000")).toEqual({ pathname: "/sante", query: { scan: "rx" } });
    expect(person("appt:a1")).toBe("rado");
    expect(person("med:rx@1762236000000")).toBe("rado");
    expect(person("med:rx")).toBe("rado");
    expect(person("appt:a2")).toBe(ME);
    expect(person("med:mine@1")).toBe(ME);
    // A relative removed since: "Moi".
    expect(person("appt:a3")).toBe(ME);
    // Unknown: ignored, the screen stays as it was.
    expect(person("appt:nope")).toBeNull();
    expect(person("med:nope@1")).toBeNull();
    expect(personFromLink({ pour: "rado" }, data)).toBe("rado");
    expect(personFromLink({ pour: "me" }, data)).toBe(ME);
    expect(personFromLink({ pour: "gone" }, data)).toBeNull();
    expect(personFromLink({ pour: ["rado"] }, data)).toBeNull();
    expect(personFromLink({}, data)).toBeNull();
  });
});
