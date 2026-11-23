// "Vaccins" (Ma santé): each person's vaccination record, written by hand —
// the vaccine, its day, and if one likes the dose, the place, the batch, a
// note and the "prochaine dose" read on the paper booklet. No schedule is
// worked out and nothing is advised: only what was written. A reminder the
// day before the next dose at 9 h (from Lite, like the appointments). Kept in
// the settings like the appointments (on the device, then
// user_settings.data.vaccines with the account): each one has its own date
// and a removal stays as a tombstone, so two devices merge one vaccine at a
// time. A removed relative's vaccines are removed with them. Pure, so it can be tested; the reminders are scheduled by
// services/vaccineReminders.ts.

export const VACCINE_NOTIFICATION_PREFIX = "vax:";
/** The day before the next dose, at this hour. */
export const VACCINE_REMINDER_HOUR = 9;
/** A removal is kept this long, so the other devices hear of it, then forgotten. */
export const VACCINE_TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many kept (the latest changed), tombstones included. */
export const MAX_VACCINES = 400;
/** At most this many notifications are kept ahead, the soonest first. */
export const MAX_VACCINE_REMINDERS = 30;
/** Longest note. */
export const VACCINE_NOTE_MAX = 300;
/** Longest name, place or batch. */
export const VACCINE_TEXT_MAX = 80;
export const VACCINE_DOSE_MAX = 20;

export type Vaccine = {
  id: string;
  /** "Rougeole-Rubéole", free text (suggestions only). */
  name: string;
  /** The day it was given (local noon: the day never shifts with the time zone). */
  at: number;
  /** "1", "2e", "rappel"… */
  dose: string;
  place: string;
  /** Batch number, as on the booklet. */
  lot: string;
  note: string;
  /** "Prochaine dose", written by hand (local noon); none when not said. */
  nextAt?: number;
  /** "Pour qui ?": a relative's profile (lib/healthProfiles.ts); none for "Moi". */
  profileId?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type VaccineDraft = Pick<Vaccine, "name" | "at" | "dose" | "place" | "lot" | "note" | "nextAt" | "profileId">;

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** A day as kept: that day at noon, local. */
export const dayAt = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();
};

/** "2026-11-12" (a date field) to that day at noon, local; null when missing or wrong. */
export function vaccineDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) || date.getDate() !== Number(match[3]) ? null : date.getTime();
}

/** One vaccine from storage or from the account; null when unusable. */
export function normalizeVaccine(value: unknown): Vaccine | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 64) : "";
  const at = time(raw.at);
  const name = clip(raw.name, VACCINE_TEXT_MAX);
  if (!id || !at || !name) return null;
  const nextAt = time(raw.nextAt);
  const deletedAt = time(raw.deletedAt);
  return {
    id,
    name,
    at,
    dose: clip(raw.dose, VACCINE_DOSE_MAX),
    place: clip(raw.place, VACCINE_TEXT_MAX),
    lot: clip(raw.lot, VACCINE_TEXT_MAX),
    note: clip(raw.note, VACCINE_NOTE_MAX),
    ...(nextAt && { nextAt }),
    ...(typeof raw.profileId === "string" && raw.profileId && raw.profileId !== "me" && { profileId: raw.profileId.slice(0, 64) }),
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
    ...(deletedAt && { deletedAt }),
  };
}

/** Always the same order (by day, then id): two equal lists compare equal. */
const ordered = (list: Vaccine[]) => [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

/**
 * Old tombstones forgotten (the recent ones kept for the other devices, not
 * counted), at most MAX_VACCINES live ones kept (the latest changed).
 */
function prune(list: Vaccine[], now: number) {
  const kept = list.filter((item) => !item.deletedAt || now - item.deletedAt < VACCINE_TOMBSTONE_MS);
  const live = kept.filter((item) => !item.deletedAt);
  if (live.length <= MAX_VACCINES) return ordered(kept);
  const dropped = new Set([...live].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(MAX_VACCINES).map((item) => item.id));
  return ordered(kept.filter((item) => !dropped.has(item.id)));
}

/** The vaccines as stored (null: never written on this device or account). */
export function normalizeVaccines(value: unknown): Vaccine[] | null {
  if (!Array.isArray(value)) return null;
  const byId = new Map<string, Vaccine>();
  for (const item of value) {
    const vaccine = normalizeVaccine(item);
    if (vaccine && (byId.get(vaccine.id)?.updatedAt ?? -1) < vaccine.updatedAt) byId.set(vaccine.id, vaccine);
  }
  return ordered([...byId.values()]);
}

/**
 * This device's and the account's vaccines together: for each one, the
 * latest change wins (a removal too). Missing on one side (an older app wrote
 * the settings without them), the other's.
 */
export function mergeVaccines(local: unknown, remote: unknown, now: number): Vaccine[] | null {
  const a = normalizeVaccines(local);
  const b = normalizeVaccines(remote);
  if (!a && !b) return null;
  return prune(normalizeVaccines([...(a ?? []), ...(b ?? [])]) ?? [], now);
}

/** Added or changed. */
export function saveVaccine(list: Vaccine[] | null, id: string | null, draft: VaccineDraft, now: number, newId: () => string): Vaccine[] {
  const current = list ?? [];
  const existing = id ? current.find((item) => item.id === id && !item.deletedAt) : undefined;
  const fields = {
    name: clip(draft.name, VACCINE_TEXT_MAX),
    at: dayAt(draft.at),
    dose: clip(draft.dose, VACCINE_DOSE_MAX),
    place: clip(draft.place, VACCINE_TEXT_MAX),
    lot: clip(draft.lot, VACCINE_TEXT_MAX),
    note: clip(draft.note, VACCINE_NOTE_MAX),
    ...(draft.nextAt && { nextAt: dayAt(draft.nextAt) }),
    ...(draft.profileId && draft.profileId !== "me" && { profileId: draft.profileId }),
  };
  // Who it is for and the next dose are set again each time (both may be taken off).
  const base = existing ? (({ profileId: _owner, nextAt: _next, ...rest }) => rest)(existing) : null;
  const next: Vaccine = base ? { ...base, ...fields, updatedAt: now } : { id: newId(), ...fields, createdAt: now, updatedAt: now };
  return prune([...current.filter((item) => item.id !== next.id), next], now);
}

/** Removed: a tombstone, so the account and the other devices remove it too. */
export function removeVaccine(list: Vaccine[] | null, id: string, now: number): Vaccine[] {
  return prune(
    (list ?? []).map((item) => (item.id === id ? { ...item, deletedAt: now, updatedAt: now } : item)),
    now,
  );
}

/** All of them removed ("Remettre à zéro"). */
export function removeAllVaccines(list: Vaccine[] | null, now: number): Vaccine[] {
  return prune(
    (list ?? []).map((item) => (item.deletedAt ? item : { ...item, deletedAt: now, updatedAt: now })),
    now,
  );
}

/**
 * A relative removed: their vaccines go with them (a record is one person's
 * story, never mixed with "Moi"'s), as tombstones so the other devices
 * remove them too. Unlike the appointments, which come back to "Moi".
 */
export function removeVaccinesOf(list: Vaccine[] | null, profileId: string, now: number): Vaccine[] | null {
  if (!list) return list;
  return prune(
    list.map((item) => (item.profileId === profileId && !item.deletedAt ? { ...item, deletedAt: now, updatedAt: now } : item)),
    now,
  );
}

export const liveVaccines = (list: Vaccine[] | null | undefined) => (list ?? []).filter((item) => !item.deletedAt);

type Profiles = Array<{ id: string; deletedAt?: number }> | null | undefined;

/**
 * Whose record a vaccine is in: its relative's, "me" without one, null when
 * the relative is not (or no longer) on this device: an orphan, shown
 * nowhere, never "Moi"'s (a record is one person's story).
 */
export function vaccineOwner(vaccine: Pick<Vaccine, "profileId">, profiles: Profiles): string | null {
  if (!vaccine.profileId) return "me";
  return (profiles ?? []).some((item) => item.id === vaccine.profileId && !item.deletedAt) ? vaccine.profileId : null;
}

/** One person's live vaccines ("me" for "Moi"): the orphans in no one's. */
export const vaccinesOf = (list: Vaccine[] | null | undefined, owner: string, profiles: Profiles) => liveVaccines(list).filter((item) => vaccineOwner(item, profiles) === owner);

/**
 * The vaccines of a relative known to be removed (their tombstone is here:
 * removed from an older app, or a vaccine written offline after the removal)
 * removed in turn, dated so the other devices follow; null when there is none.
 * A relative merely not received yet (no tombstone) is left alone: hidden only.
 */
export function removeOrphanVaccines(list: Vaccine[] | null | undefined, profiles: Profiles, now: number): Vaccine[] | null {
  const removed = new Set((profiles ?? []).filter((item) => item.deletedAt).map((item) => item.id));
  const live = new Set((profiles ?? []).filter((item) => !item.deletedAt).map((item) => item.id));
  const orphans = liveVaccines(list).filter((item) => item.profileId && removed.has(item.profileId) && !live.has(item.profileId));
  if (!list || orphans.length === 0) return null;
  const ids = new Set(orphans.map((item) => item.id));
  return prune(
    list.map((item) => (ids.has(item.id) ? { ...item, deletedAt: now, updatedAt: now } : item)),
    now,
  );
}

/** Names compared without accents, case or spaces ("rougeole rubeole" = "Rougeole-Rubéole"). */
export const sameVaccine = (a: string, b: string) => {
  const key = (name: string) =>
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  return key(a) === key(b);
};

/** The history, the latest first. */
export const vaccineHistory = (list: Vaccine[] | null | undefined) => liveVaccines(list).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));

export type NextDose = {
  vaccine: Vaccine;
  /** The day written (local noon). */
  at: number;
  /** Gone by without a later one of the same vaccine written. */
  overdue: boolean;
};

/**
 * The next doses still to note, the soonest first: each vaccine's "prochaine
 * dose", unless a later one of the same name was written since (it is done).
 * Late ones (the day gone by) are kept and said so.
 */
export function nextDoses(list: Vaccine[] | null | undefined, now: number): NextDose[] {
  const live = liveVaccines(list);
  const today = dayAt(now);
  return live
    .filter((item) => item.nextAt && !live.some((other) => other.id !== item.id && other.at > item.at && sameVaccine(other.name, item.name)))
    .map((vaccine) => ({ vaccine, at: vaccine.nextAt!, overdue: vaccine.nextAt! < today }))
    .sort((a, b) => a.at - b.at || a.vaccine.id.localeCompare(b.vaccine.id));
}

export type VaccineReminder = {
  /** What it is kept under on the device: a change of day or of text schedules it again. */
  key: string;
  at: number;
  vaccine: Vaccine;
  /** Tapped: "Ma santé", its vaccines (services/notificationTap.ts). */
  entryId: string;
};

/** The day before the next dose at 9 h, only those still to come. None without the plan. */
export function vaccineReminders(list: Vaccine[] | null | undefined, now: number, enabled = true, profiles?: Profiles): VaccineReminder[] {
  if (!enabled) return [];
  const reminders: VaccineReminder[] = [];
  for (const { vaccine, at } of nextDoses(list, now)) {
    // An orphan's (relative not on this device) never rings.
    if (profiles !== undefined && vaccineOwner(vaccine, profiles) === null) continue;
    const day = new Date(at);
    const eve = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, VACCINE_REMINDER_HOUR).getTime();
    if (eve <= now) continue;
    reminders.push({ key: `${vaccine.id}:eve:${at}:${vaccine.updatedAt}`, at: eve, vaccine, entryId: `${VACCINE_NOTIFICATION_PREFIX}${vaccine.id}` });
  }
  return reminders.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, MAX_VACCINE_REMINDERS);
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One vaccine as a line: "12 mars 2026 — BCG, dose 1, CSB Analakely, lot AB12". */
export function vaccineLine(vaccine: Vaccine, t: Translate, date: (at: number) => string) {
  const details = [
    vaccine.dose && t("health.vaccines.share.dose", { dose: vaccine.dose }),
    vaccine.place,
    vaccine.lot && t("health.vaccines.share.lot", { lot: vaccine.lot }),
  ].filter(Boolean);
  const line = t("health.vaccines.share.line", { date: date(vaccine.at), name: [vaccine.name, ...details].join(", ") });
  return vaccine.note ? `${line} (${vaccine.note})` : line;
}

/** The record as shared: the heading, the next doses, then every vaccine (the oldest first, as on a booklet). */
export function vaccineReport(list: Vaccine[] | null | undefined, t: Translate, date: (at: number) => string, now: number, name: string | null = null) {
  const title = name ? t("health.vaccines.share.headingOf", { name }) : t("health.vaccines.share.heading");
  const next = nextDoses(list, now).map(({ vaccine, at, overdue }) => t(overdue ? "health.vaccines.share.nextLate" : "health.vaccines.share.next", { name: vaccine.name, date: date(at) }));
  const done = [...vaccineHistory(list)].reverse().map((vaccine) => vaccineLine(vaccine, t, date));
  return { title, next, done, caption: t("health.vaccines.share.caption", { date: date(now) }) };
}

/** The record as a message. */
export function vaccinesText(list: Vaccine[] | null | undefined, t: Translate, date: (at: number) => string, now: number, name: string | null = null) {
  const report = vaccineReport(list, t, date, now, name);
  const lines = [report.title, report.caption];
  if (report.next.length) lines.push("", t("health.vaccines.share.nextTitle"), ...report.next.map((line) => `- ${line}`));
  lines.push("", t("health.vaccines.share.doneTitle"), ...report.done.map((line) => `- ${line}`));
  return lines.join("\n");
}
