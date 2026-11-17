// "Pharmacie de la maison" (Ma santé): the medicines kept at home, for the
// whole household, sorted by their expiry date, with a badge 30 days before
// and once expired. Written by hand or from a scanned box (the expiry read
// when printed). Alerts a month before and on the day, at 9 h (from Lite,
// like the vaccines). Nothing is advised: only what was written, and one
// general sentence near the expired ones. Kept in the settings like the
// vaccines (on the device, then user_settings.data.pharmacy with the
// account): each medicine has its own date and a removal stays as a
// tombstone, so two devices merge one medicine at a time. Pure, so it can be
// tested; the alerts are scheduled by services/pharmacyReminders.ts.

export const PHARMACY_NOTIFICATION_PREFIX = "pharma:";
/** The alerts ring at this hour. */
export const PHARMACY_REMINDER_HOUR = 9;
/** "Bientôt périmé": this many days before. */
export const EXPIRY_SOON_DAYS = 30;
/** A removal is kept this long, so the other devices hear of it, then forgotten. */
export const PHARMACY_TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many live medicines kept (the latest changed); recent removals not counted. */
export const MAX_HOME_MEDICINES = 300;
/** At most this many notifications are kept ahead, the soonest first. */
export const MAX_PHARMACY_REMINDERS = 40;
export const HOME_MEDICINE_TEXT_MAX = 80;
export const HOME_MEDICINE_NOTE_MAX = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

export type HomeMedicine = {
  id: string;
  name: string;
  /** Dosage or form: "500 mg", "sirop"… */
  strength: string;
  /** "1 boîte", "12 comprimés"… */
  quantity: string;
  /** "2027-03" (the end of that month) or "2027-03-15". */
  expiry: string;
  /** "Pour qui": "me" or a relative's profile; none for the whole household. */
  forWho?: string;
  note: string;
  /** The scan it was added from, if any. */
  scanId?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type HomeMedicineDraft = Pick<HomeMedicine, "name" | "strength" | "quantity" | "expiry" | "forWho" | "note" | "scanId">;

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
const pad = (value: number) => String(value).padStart(2, "0");

/** Days in a month (month 1 to 12). */
const daysIn = (year: number, month: number) => new Date(year, month, 0).getDate();

/**
 * An expiry date as kept: "YYYY-MM" or "YYYY-MM-DD", from what is stored or
 * read on a box ("2027-3", "03/2027" and "15/03/2027" too); null when wrong.
 */
export function normalizeExpiry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let year: number, month: number, day: number | null;
  let match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (match) [year, month, day] = [Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null];
  else {
    match = /^(?:(\d{1,2})[/.-])?(\d{1,2})[/.-](\d{4})$/.exec(text);
    if (!match) return null;
    [year, month, day] = [Number(match[3]), Number(match[2]), match[1] ? Number(match[1]) : null];
  }
  if (year < 1990 || year > 2100 || month < 1 || month > 12) return null;
  if (day !== null && (day < 1 || day > daysIn(year, month))) return null;
  return day === null ? `${year}-${pad(month)}` : `${year}-${pad(month)}-${pad(day)}`;
}

/** The last day it may be used (local, at noon): the day written, else the end of the month. */
export function expiryDay(expiry: string): number {
  const [year, month, day] = expiry.split("-").map(Number);
  return new Date(year, month - 1, day || daysIn(year, month), 12).getTime();
}

/** Whether the day was written ("2027-03-15") or only the month ("2027-03"). */
export const hasExpiryDay = (expiry: string) => expiry.length === 10;

/** "2027-03" from a month and a year picked, with the day if one is (none: the end of the month). */
export function expiryFrom(year: number, month: number, day: number | null): string | null {
  return normalizeExpiry(day ? `${year}-${month}-${day}` : `${year}-${month}`);
}

export type ExpiryStatus = "expired" | "lastDay" | "soon" | "ok";

/**
 * The expiry date is the last day it is good: expired the day after,
 * "lastDay" on that day (expired tomorrow), "soon" from 30 days before.
 */
export function expiryStatus(expiry: string, now: number): ExpiryStatus {
  const last = new Date(expiryDay(expiry));
  const start = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime();
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime();
  if (now >= end) return "expired";
  if (now >= start) return "lastDay";
  return end - now <= (EXPIRY_SOON_DAYS + 1) * DAY_MS ? "soon" : "ok";
}

/** One medicine from storage or from the account; null when unusable. */
export function normalizeHomeMedicine(value: unknown): HomeMedicine | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 64) : "";
  const name = clip(raw.name, HOME_MEDICINE_TEXT_MAX);
  const expiry = normalizeExpiry(raw.expiry);
  if (!id || !name || !expiry) return null;
  const deletedAt = time(raw.deletedAt);
  return {
    id,
    name,
    strength: clip(raw.strength, HOME_MEDICINE_TEXT_MAX),
    quantity: clip(raw.quantity, HOME_MEDICINE_TEXT_MAX),
    expiry,
    ...(typeof raw.forWho === "string" && raw.forWho && { forWho: raw.forWho.slice(0, 64) }),
    note: clip(raw.note, HOME_MEDICINE_NOTE_MAX),
    ...(typeof raw.scanId === "string" && raw.scanId && { scanId: raw.scanId.slice(0, 64) }),
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
    ...(deletedAt && { deletedAt }),
  };
}

/** Always the same order (by expiry, then id): two equal lists compare equal. */
const ordered = (list: HomeMedicine[]) => [...list].sort((a, b) => expiryDay(a.expiry) - expiryDay(b.expiry) || a.id.localeCompare(b.id));

/** Old tombstones forgotten (the recent ones kept, not counted), at most MAX_HOME_MEDICINES live ones (the latest changed). */
function prune(list: HomeMedicine[], now: number) {
  const kept = list.filter((item) => !item.deletedAt || now - item.deletedAt < PHARMACY_TOMBSTONE_MS);
  const live = kept.filter((item) => !item.deletedAt);
  if (live.length <= MAX_HOME_MEDICINES) return ordered(kept);
  const dropped = new Set([...live].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(MAX_HOME_MEDICINES).map((item) => item.id));
  return ordered(kept.filter((item) => !dropped.has(item.id)));
}

/** The medicines as stored (null: never written on this device or account). */
export function normalizePharmacy(value: unknown): HomeMedicine[] | null {
  if (!Array.isArray(value)) return null;
  const byId = new Map<string, HomeMedicine>();
  for (const item of value) {
    const medicine = normalizeHomeMedicine(item);
    if (medicine && (byId.get(medicine.id)?.updatedAt ?? -1) < medicine.updatedAt) byId.set(medicine.id, medicine);
  }
  return ordered([...byId.values()]);
}

/** This device's and the account's together: for each medicine, the latest change wins (a removal too). */
export function mergePharmacy(local: unknown, remote: unknown, now: number): HomeMedicine[] | null {
  const a = normalizePharmacy(local);
  const b = normalizePharmacy(remote);
  if (!a && !b) return null;
  return prune(normalizePharmacy([...(a ?? []), ...(b ?? [])]) ?? [], now);
}

/** Added or changed. */
export function saveHomeMedicine(list: HomeMedicine[] | null, id: string | null, draft: HomeMedicineDraft, now: number, newId: () => string): HomeMedicine[] {
  const current = list ?? [];
  const existing = id ? current.find((item) => item.id === id && !item.deletedAt) : undefined;
  const expiry = normalizeExpiry(draft.expiry);
  if (!expiry || !clip(draft.name, HOME_MEDICINE_TEXT_MAX)) return current;
  const fields = {
    name: clip(draft.name, HOME_MEDICINE_TEXT_MAX),
    strength: clip(draft.strength, HOME_MEDICINE_TEXT_MAX),
    quantity: clip(draft.quantity, HOME_MEDICINE_TEXT_MAX),
    expiry,
    ...(draft.forWho && { forWho: draft.forWho }),
    note: clip(draft.note, HOME_MEDICINE_NOTE_MAX),
  };
  // "Pour qui" is set again each time (it may be taken off); the scan it came from stays.
  const base = existing ? (({ forWho: _who, ...rest }) => rest)(existing) : null;
  const next: HomeMedicine = base
    ? { ...base, ...fields, updatedAt: now }
    : { id: newId(), ...fields, ...(draft.scanId && { scanId: draft.scanId }), createdAt: now, updatedAt: now };
  return prune([...current.filter((item) => item.id !== next.id), next], now);
}

/** Thrown away or finished: a tombstone, so the account and the other devices remove it too. */
export function removeHomeMedicine(list: HomeMedicine[] | null, id: string, now: number): HomeMedicine[] {
  return prune(
    (list ?? []).map((item) => (item.id === id && !item.deletedAt ? { ...item, deletedAt: now, updatedAt: now } : item)),
    now,
  );
}

/**
 * "Annuler" after a removal: the medicine back as it was, dated now so the
 * account and the other devices take it over the removal (never a ghost
 * removal left behind).
 */
export function restoreHomeMedicine(list: HomeMedicine[] | null, previous: HomeMedicine, now: number): HomeMedicine[] {
  const { deletedAt: _gone, ...before } = previous;
  // Newer than its removal, even with a clock gone back meanwhile.
  const removal = (list ?? []).find((item) => item.id === previous.id)?.updatedAt ?? previous.updatedAt;
  return prune([...(list ?? []).filter((item) => item.id !== previous.id), { ...before, updatedAt: Math.max(now, removal + 1) }], now);
}

/** All of them removed ("Remettre à zéro"). */
export function removeAllHomeMedicines(list: HomeMedicine[] | null, now: number): HomeMedicine[] {
  return prune(
    (list ?? []).map((item) => (item.deletedAt ? item : { ...item, deletedAt: now, updatedAt: now })),
    now,
  );
}

/** What is at home, the first to expire first. */
export const homeMedicines = (list: HomeMedicine[] | null | undefined) => ordered((list ?? []).filter((item) => !item.deletedAt));

/** A medicine added from a scan: the same id on every device (the scan's and the medicine's place on it), so two devices adding it merge into one. */
export const scanMedicineId = (scanId: string, index: number) => `scan:${scanId}:${index}`.slice(0, 64);

/** Already added from this scan (same name): the button says so. */
export const fromScan = (list: HomeMedicine[] | null | undefined, scanId: string, name: string) =>
  homeMedicines(list).some((item) => item.scanId === scanId && item.name.toLowerCase() === name.trim().toLowerCase());

export type PharmacyReminderKind = "month" | "day";

export type PharmacyReminder = {
  /** What it is kept under on the device: a change of date or of text schedules it again. */
  key: string;
  at: number;
  kind: PharmacyReminderKind;
  medicine: HomeMedicine;
  /** Tapped: "Ma santé", the pharmacy (services/notificationTap.ts). */
  entryId: string;
};

/**
 * The alerts, the soonest first: a month before the last day and on that
 * last day ("périmé demain"), at 9 h, only those still to come. None without
 * the plan.
 */
export function pharmacyReminders(list: HomeMedicine[] | null | undefined, now: number, enabled = true): PharmacyReminder[] {
  if (!enabled) return [];
  const reminders: PharmacyReminder[] = [];
  for (const medicine of homeMedicines(list)) {
    const last = new Date(expiryDay(medicine.expiry));
    const [year, month, day] = [last.getFullYear(), last.getMonth(), last.getDate()];
    // The same day a month before (the 31st of March: the 28th or 29th of February).
    const before = new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate()), PHARMACY_REMINDER_HOUR).getTime();
    const on = new Date(year, month, day, PHARMACY_REMINDER_HOUR).getTime();
    const stamp = `${medicine.expiry}:${medicine.updatedAt}`;
    const entryId = `${PHARMACY_NOTIFICATION_PREFIX}${medicine.id}`;
    if (before > now) reminders.push({ key: `${medicine.id}:month:${stamp}`, at: before, kind: "month", medicine, entryId });
    if (on > now) reminders.push({ key: `${medicine.id}:day:${stamp}`, at: on, kind: "day", medicine, entryId });
  }
  return reminders.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, MAX_PHARMACY_REMINDERS);
}
