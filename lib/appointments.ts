// "Rendez-vous" (Ma santé): medical appointments, the next ones first, with a
// reminder the day before at 18 h and another 2 h before (from Lite, like
// every reminder). Kept in the settings like the emergency card (on the
// device, then user_settings.data.appointments with the account): each one
// has its own date and a removal stays as a tombstone, so two devices merge
// one appointment at a time. Pure, so it can be tested; the reminders are
// scheduled by services/appointmentReminders.ts.

export const APPOINTMENT_NOTIFICATION_PREFIX = "appt:";
/** The day before, at this hour. */
export const APPOINTMENT_EVE_HOUR = 18;
/** And this long before. */
export const APPOINTMENT_SOON_MS = 2 * 60 * 60 * 1000;
/** A removal is kept this long, so the other devices hear of it, then forgotten. */
export const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many kept (the latest), tombstones included. */
export const MAX_APPOINTMENTS = 300;
/** At most this many notifications are kept ahead, the soonest first. */
export const MAX_APPOINTMENT_REMINDERS = 40;
/** Longest text kept in a field. */
export const APPOINTMENT_TEXT_MAX = 300;

export type Appointment = {
  id: string;
  /** Day and time, local. */
  at: number;
  /** Doctor or department. */
  who: string;
  place: string;
  /** Reason or note. */
  note: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type AppointmentDraft = Pick<Appointment, "at" | "who" | "place" | "note">;

const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, APPOINTMENT_TEXT_MAX) : "");
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** One appointment from storage or from the account; null when unusable. */
export function normalizeAppointment(value: unknown): Appointment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 64) : "";
  const at = time(raw.at);
  if (!id || !at) return null;
  const deletedAt = time(raw.deletedAt);
  return {
    id,
    at,
    who: text(raw.who),
    place: text(raw.place),
    note: text(raw.note),
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
    ...(deletedAt && { deletedAt }),
  };
}

/** Always the same order (by time, then id): two equal lists compare equal. */
const ordered = (list: Appointment[]) => [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

/** Old tombstones forgotten, at most MAX_APPOINTMENTS kept (the latest changed). */
function prune(list: Appointment[], now: number) {
  const kept = list.filter((item) => !item.deletedAt || now - item.deletedAt < TOMBSTONE_MS);
  const latest = kept.length > MAX_APPOINTMENTS ? [...kept].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_APPOINTMENTS) : kept;
  return ordered(latest);
}

/** The appointments as stored (null: never written on this device or account). */
export function normalizeAppointments(value: unknown): Appointment[] | null {
  if (!Array.isArray(value)) return null;
  const byId = new Map<string, Appointment>();
  for (const item of value) {
    const appointment = normalizeAppointment(item);
    if (appointment && (byId.get(appointment.id)?.updatedAt ?? -1) < appointment.updatedAt) byId.set(appointment.id, appointment);
  }
  return ordered([...byId.values()]);
}

/**
 * This device's and the account's appointments together: for each one, the
 * latest change wins (a removal too). Missing on one side (an older app wrote
 * the settings without them), the other's.
 */
export function mergeAppointments(local: unknown, remote: unknown, now: number): Appointment[] | null {
  const a = normalizeAppointments(local);
  const b = normalizeAppointments(remote);
  if (!a && !b) return null;
  return prune(normalizeAppointments([...(a ?? []), ...(b ?? [])]) ?? [], now);
}

/** Added or changed. */
export function saveAppointment(list: Appointment[] | null, id: string | null, draft: AppointmentDraft, now: number, newId: () => string): Appointment[] {
  const current = list ?? [];
  const existing = id ? current.find((item) => item.id === id && !item.deletedAt) : undefined;
  const fields = { at: draft.at, who: text(draft.who), place: text(draft.place), note: text(draft.note) };
  const next: Appointment = existing ? { ...existing, ...fields, updatedAt: now } : { id: newId(), ...fields, createdAt: now, updatedAt: now };
  return prune([...current.filter((item) => item.id !== next.id), next], now);
}

/** Removed: a tombstone, so the account and the other devices remove it too. */
export function removeAppointment(list: Appointment[] | null, id: string, now: number): Appointment[] {
  return prune(
    (list ?? []).map((item) => (item.id === id ? { ...item, deletedAt: now, updatedAt: now } : item)),
    now,
  );
}

/** All of them removed ("Remettre à zéro"). */
export function removeAllAppointments(list: Appointment[] | null, now: number): Appointment[] {
  return prune(
    (list ?? []).map((item) => (item.deletedAt ? item : { ...item, deletedAt: now, updatedAt: now })),
    now,
  );
}

export const liveAppointments = (list: Appointment[] | null | undefined) => (list ?? []).filter((item) => !item.deletedAt);

/**
 * "À venir" (the soonest first) and "Passés" (the latest first). One still
 * counts as to come for an hour after its time: one is often kept waiting.
 */
export function splitAppointments(list: Appointment[] | null | undefined, now: number) {
  const live = liveAppointments(list);
  const upcoming = live.filter((item) => item.at > now - 60 * 60 * 1000).sort((a, b) => a.at - b.at);
  const past = live.filter((item) => item.at <= now - 60 * 60 * 1000).sort((a, b) => b.at - a.at);
  return { upcoming, past };
}

/** "2026-11-12" and "09:30" (local) to a time; null when either is missing or wrong. */
export function appointmentTime(day: string, hour: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const h = /^(\d{2}):(\d{2})$/.exec(hour);
  if (!d || !h) return null;
  const date = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export type AppointmentReminderKind = "eve" | "soon";

export type AppointmentReminder = {
  /** What it is kept under on the device: a change of time or of text schedules it again. */
  key: string;
  at: number;
  kind: AppointmentReminderKind;
  appointment: Appointment;
  /** Tapped: "Ma santé" (services/notificationTap.ts). */
  entryId: string;
};

/** What will really ring for one appointment: the day before and/or 2 h before (what its card says). */
export function remindedKinds(appointment: Appointment, now: number): AppointmentReminderKind[] {
  return appointmentReminders([appointment], now).map((reminder) => reminder.kind);
}

/**
 * The notifications to ring, the soonest first: the day before at 18 h and
 * 2 h before, only those still to come. None without the plan.
 */
export function appointmentReminders(list: Appointment[] | null | undefined, now: number, enabled = true): AppointmentReminder[] {
  if (!enabled) return [];
  const reminders: AppointmentReminder[] = [];
  for (const appointment of liveAppointments(list)) {
    if (appointment.at <= now) continue;
    const day = new Date(appointment.at);
    const eve = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, APPOINTMENT_EVE_HOUR).getTime();
    const soon = appointment.at - APPOINTMENT_SOON_MS;
    const stamp = `${appointment.at}:${appointment.updatedAt}`;
    const entryId = `${APPOINTMENT_NOTIFICATION_PREFIX}${appointment.id}`;
    if (eve > now && eve < soon) reminders.push({ key: `${appointment.id}:eve:${stamp}`, at: eve, kind: "eve", appointment, entryId });
    if (soon > now) reminders.push({ key: `${appointment.id}:soon:${stamp}`, at: soon, kind: "soon", appointment, entryId });
  }
  return reminders.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, MAX_APPOINTMENT_REMINDERS);
}
