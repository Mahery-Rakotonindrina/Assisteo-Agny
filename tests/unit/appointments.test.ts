import { describe, expect, it } from "vitest";
import {
  appointmentReminders,
  appointmentTime,
  mergeAppointments,
  normalizeAppointments,
  removeAllAppointments,
  remindedKinds,
  removeAppointment,
  saveAppointment,
  splitAppointments,
  TOMBSTONE_MS,
  type Appointment,
} from "@/lib/appointments";
import { healthChanged, healthPayload, mergeHealth, planSettingsSync, type SettingsRow } from "@/lib/healthSync";
import { resetScreens } from "@/lib/screenReset";
import { syncedSettingKeys } from "@/lib/settings/SettingsProvider";
import { reconcileAppointmentReminderState, type ScheduledAppointmentReminders } from "@/services/appointmentReminders";
import { handleNotificationTap, tapTarget } from "@/services/notificationTap";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const appt = (id: string, when: number, patch: Partial<Appointment> = {}): Appointment => ({ id, at: when, who: "Dr Rabe", place: "Analakely", note: "", createdAt: 1, updatedAt: 1, ...patch });
let counter = 0;
const newId = () => `n${++counter}`;

describe("Rendez-vous", () => {
  it("reads what was stored, the latest copy of each, and drops what is unusable", () => {
    expect(normalizeAppointments(undefined)).toBeNull();
    expect(normalizeAppointments({})).toBeNull();
    const list = normalizeAppointments([appt("b", at(14, 9)), appt("a", at(12, 9)), { id: "x" }, null, appt("a", at(13, 10), { updatedAt: 5 }), { ...appt("c", at(15, 9)), who: 3 }])!;
    expect(list.map((item) => [item.id, item.at])).toEqual([
      ["a", at(13, 10)],
      ["b", at(14, 9)],
      ["c", at(15, 9)],
    ]);
    expect(list[2].who).toBe("");
  });

  it("adds, changes and removes, a removal kept as a tombstone", () => {
    const now = at(10, 12);
    const added = saveAppointment(null, null, { at: at(12, 9), who: "  Dr Rabe ", place: "", note: "à jeun" }, now, newId);
    expect(added).toHaveLength(1);
    const [first] = added;
    expect(first).toMatchObject({ who: "Dr Rabe", note: "à jeun", createdAt: now, updatedAt: now });
    const changed = saveAppointment(added, first.id, { at: at(12, 10), who: "Dr Rabe", place: "CHU", note: "" }, now + 1, newId);
    expect(changed).toEqual([{ ...first, at: at(12, 10), place: "CHU", note: "", updatedAt: now + 1 }]);
    const removed = removeAppointment(changed, first.id, now + 2);
    expect(removed[0]).toMatchObject({ deletedAt: now + 2, updatedAt: now + 2 });
    expect(splitAppointments(removed, now).upcoming).toEqual([]);
    // Forgotten once the other devices had time to hear of it.
    expect(removeAppointment(removed, "none", now + 2 + TOMBSTONE_MS)).toEqual([]);
    const all = removeAllAppointments([appt("a", at(12, 9)), appt("b", at(13, 9))], now);
    expect(all.every((item) => item.deletedAt === now)).toBe(true);
  });

  it("merges two devices one appointment at a time: the latest change wins, a removal too", () => {
    const now = at(10, 12);
    const local = [appt("a", at(12, 9), { updatedAt: 10 }), appt("b", at(13, 9), { updatedAt: 10 }), appt("c", at(14, 9))];
    const remote = [appt("a", at(12, 11), { updatedAt: 20 }), appt("b", at(13, 9), { updatedAt: now - 1, deletedAt: now - 1 }), appt("d", at(15, 9))];
    const merged = mergeAppointments(local, remote, now)!;
    expect(merged.map((item) => [item.id, item.at, Boolean(item.deletedAt)])).toEqual([
      ["a", at(12, 11), false],
      ["b", at(13, 9), true],
      ["c", at(14, 9), false],
      ["d", at(15, 9), false],
    ]);
    // An older app wrote the settings without them: this device's stay.
    expect(mergeAppointments(local, undefined, now)).toEqual(normalizeAppointments(local));
    expect(mergeAppointments(null, undefined, now)).toBeNull();
  });

  it("goes with the emergency card in the synced settings, and leaves the account's alone when there is nothing", () => {
    expect(syncedSettingKeys).toContain("appointments");
    expect(resetScreens).toContain("health");
    const local = { emergencyCard: null, appointments: [appt("a", at(12, 9))] };
    const merged = mergeHealth(local, {}, at(10, 12));
    expect(merged.appointments).toEqual(local.appointments);
    expect(healthChanged(local, merged)).toBe(false);
    expect(healthChanged({}, merged)).toBe(true);
    expect(healthPayload({ locale: "fr", emergencyCard: null, appointments: null })).toEqual({ locale: "fr" });
    expect(healthPayload({ appointments: [] })).toEqual({ appointments: [] });
  });

  it("puts the next ones first and the past ones (an hour after) latest first", () => {
    const now = at(12, 10);
    const list = [appt("old", at(1, 9)), appt("late", at(12, 9, 30)), appt("next", at(20, 9)), appt("soon", at(13, 8)), appt("before", at(11, 9)), appt("gone", at(14, 9), { deletedAt: 5 })];
    const { upcoming, past } = splitAppointments(list, now);
    expect(upcoming.map((item) => item.id)).toEqual(["late", "soon", "next"]);
    expect(past.map((item) => item.id)).toEqual(["before", "old"]);
  });

  it("reads the day and the time of the form", () => {
    expect(appointmentTime("2026-11-12", "09:30")).toBe(at(12, 9, 30));
    expect(appointmentTime("", "09:30")).toBeNull();
    expect(appointmentTime("2026-11-12", "")).toBeNull();
  });

  it("reminds the day before at 18 h and 2 h before, only what is still to come, and nothing without the plan", () => {
    const list = [appt("a", at(12, 9, 30)), appt("b", at(20, 19)), appt("early", at(11, 1)), appt("done", at(5, 9)), appt("gone", at(15, 9), { deletedAt: 3 })];
    const now = at(10, 12);
    const reminders = appointmentReminders(list, now);
    expect(reminders.map((reminder) => [reminder.appointment.id, reminder.kind, reminder.at])).toEqual([
      ["early", "eve", at(10, 18)],
      ["early", "soon", at(10, 23)],
      ["a", "eve", at(11, 18)],
      ["a", "soon", at(12, 7, 30)],
      ["b", "eve", at(19, 18)],
      ["b", "soon", at(20, 17)],
    ]);
    expect(reminders[0].entryId).toBe("appt:early");
    // The day before already gone by: only 2 h before.
    expect(appointmentReminders(list, at(11, 19)).filter((reminder) => reminder.appointment.id === "a").map((reminder) => reminder.kind)).toEqual(["soon"]);
    expect(appointmentReminders(list, now, false)).toEqual([]);
    // Changed: a new key, so it is scheduled again.
    const moved = appointmentReminders([appt("a", at(12, 10), { updatedAt: 2 })], now);
    expect(moved[0].key).not.toBe(reminders[2].key);
  });

  it("schedules the missing reminders, cancels the ones no longer wanted, and all of them without the plan", async () => {
    let scheduled: ScheduledAppointmentReminders = { stale: 99 };
    const cancelled: number[] = [];
    const sent: Array<{ title: string; entryId: string }> = [];
    let nextId = 1;
    const deps = {
      permission: async () => "granted",
      notify: async (options: { title: string; body: string; at: Date; entryId: string }) => {
        sent.push({ title: options.title, entryId: options.entryId });
        return nextId++;
      },
      cancel: async (id: number) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => scheduled,
      save: (next: ScheduledAppointmentReminders) => {
        scheduled = next;
      },
    };
    const texts = () => ({ title: "Demain", body: "x" });
    await reconcileAppointmentReminderState([appt("a", at(12, 9))], texts, deps, { now: at(10, 12) });
    expect(cancelled).toEqual([99]);
    expect(sent).toHaveLength(2);
    expect(Object.keys(scheduled)).toHaveLength(2);
    await reconcileAppointmentReminderState([appt("a", at(12, 9))], texts, deps, { now: at(10, 12) });
    expect(sent).toHaveLength(2);
    await reconcileAppointmentReminderState([appt("a", at(12, 9))], texts, deps, { now: at(10, 12), enabled: false });
    expect(cancelled).toEqual([99, 1, 2]);
    expect(scheduled).toEqual({});
  });

  it("opens « Ma santé » on its appointments when the notification is tapped", async () => {
    expect(tapTarget("appt:abc")).toEqual({ pathname: "/sante", query: { show: "appointments", appt: "abc" } });
    const opened: unknown[] = [];
    let snoozed = false;
    await handleNotificationTap("appt:abc", "later-1h", 3, {
      snooze: async () => {
        snoozed = true;
        return 1;
      },
      open: (target) => opened.push(target),
    });
    expect(snoozed).toBe(false);
    expect(opened).toEqual([{ pathname: "/sante", query: { show: "appointments", appt: "abc" } }]);
  });
it("says only what will really ring", () => {
    const now = at(10, 12);
    expect(remindedKinds(appt("a", at(12, 9)), now)).toEqual(["eve", "soon"]);
    expect(remindedKinds(appt("a", at(11, 9)), at(10, 19))).toEqual(["soon"]);
    expect(remindedKinds(appt("a", at(10, 13)), now)).toEqual([]);
    expect(remindedKinds(appt("a", at(9, 13)), now)).toEqual([]);
  });

  it("schedules the reminders again in the new language", async () => {
    let scheduled: ScheduledAppointmentReminders = {};
    const cancelled: number[] = [];
    const titles: string[] = [];
    let nextId = 1;
    const deps = {
      permission: async () => "granted",
      notify: async (options: { title: string }) => {
        titles.push(options.title);
        return nextId++;
      },
      cancel: async (id: number) => {
        cancelled.push(id);
      },
      pending: async () => null,
      load: () => scheduled,
      save: (next: ScheduledAppointmentReminders) => {
        scheduled = next;
      },
    };
    const list = [appt("a", at(12, 9))];
    await reconcileAppointmentReminderState(list, () => ({ title: "Demain", body: "" }), deps, { now: at(10, 12), language: "fr" });
    await reconcileAppointmentReminderState(list, () => ({ title: "Tomorrow", body: "" }), deps, { now: at(10, 12), language: "en" });
    expect(cancelled).toEqual([1, 2]);
    expect(titles).toEqual(["Demain", "Demain", "Tomorrow", "Tomorrow"]);
  });

  it("never loses an appointment between two devices: the account's is read and merged before each send", () => {
    const keys = ["locale", "theme", "emergencyCard", "appointments"];
    const now = at(10, 12);
    let server: SettingsRow = null;
    // Both devices start from the same, then each adds one without seeing the other's.
    const send = (device: Record<string, unknown> & { updatedAt: number }) => {
      const plan = planSettingsSync(device, server, keys, now);
      const next = { ...device, ...(plan.apply?.patch ?? {}), updatedAt: plan.apply?.updatedAt ?? device.updatedAt };
      if (plan.write) server = { data: plan.write.data, updatedAt: plan.write.updatedAt };
      return next;
    };
    let phone: Record<string, unknown> & { updatedAt: number } = { locale: "fr", theme: "system", emergencyCard: null, appointments: [appt("p", at(12, 9), { updatedAt: 100 })], updatedAt: 100 };
    let computer: Record<string, unknown> & { updatedAt: number } = { locale: "fr", theme: "dark", emergencyCard: null, appointments: [appt("c", at(13, 9), { updatedAt: 200 })], updatedAt: 200 };
    phone = send(phone);
    computer = send(computer);
    phone = send(phone);
    const ids = (device: Record<string, unknown>) => (device.appointments as Appointment[]).map((item) => item.id);
    expect(ids(computer)).toEqual(["p", "c"]);
    expect(ids(phone)).toEqual(["p", "c"]);
    expect(((server as unknown as { data: { appointments: Appointment[] } }).data.appointments).map((item) => item.id)).toEqual(["p", "c"]);
    // The plain settings: the newer side wins.
    expect(phone.theme).toBe("dark");
    // A removal on one reaches the other.
    computer = send({ ...computer, appointments: removeAppointment(computer.appointments as Appointment[], "p", now), updatedAt: 300 });
    phone = send(phone);
    expect(splitAppointments(phone.appointments as Appointment[], now).upcoming.map((item) => item.id)).toEqual(["c"]);
  });

  it("sends again what an older app erased from the account, and nothing when all is the same", () => {
    const keys = ["locale", "appointments"];
    const device = { locale: "fr", appointments: [appt("a", at(12, 9))], updatedAt: 100 };
    const erased = planSettingsSync(device, { data: { locale: "en" }, updatedAt: 200 }, keys, at(10, 12));
    expect(erased.apply?.patch).toMatchObject({ locale: "en", appointments: device.appointments });
    expect(erased.write).toEqual({ data: { locale: "en", appointments: device.appointments }, updatedAt: 200 });
    const same = planSettingsSync(device, { data: { locale: "fr", appointments: device.appointments }, updatedAt: 100 }, keys, at(10, 12));
    expect(same).toEqual({ apply: null, write: null });
  });
});
