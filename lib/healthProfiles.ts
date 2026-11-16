import { normalizeCard, type EmergencyCard } from "./emergencyCard";

// "Pour qui ?" (Ma santé): the people whose health one follows from this
// phone — not accounts, local profiles kept in the synced settings
// (user_settings.data.healthProfiles), merged one by one like the
// appointments (each its own date, a removal kept as a tombstone). "Moi" is
// not stored: it is everything without a profile (all data from before).
// Each relative has their own emergency card, kept in their profile. Pure, so
// it can be tested.

/** "Moi": the default owner of everything, never stored. */
export const ME = "me";

export const relations = ["child", "parent", "partner", "other"] as const;
export type Relation = (typeof relations)[number];

export type HealthProfile = {
  id: string;
  name: string;
  relation: Relation;
  birthYear?: number;
  /** Their emergency card ("Moi"'s is settings.emergencyCard). */
  card?: EmergencyCard;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type ProfileDraft = Pick<HealthProfile, "name" | "relation" | "birthYear">;

/** A removal is kept this long, so the other devices hear of it. */
export const PROFILE_TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many people (a household, not a clinic). */
export const MAX_PROFILES = 30;
export const PROFILE_NAME_MAX = 40;

const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** A birth year that makes sense (else none). */
export function birthYear(value: unknown, now = Date.now()): number | undefined {
  const year = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof year !== "number" || !Number.isInteger(year)) return undefined;
  return year >= 1900 && year <= new Date(now).getFullYear() ? year : undefined;
}

export function normalizeProfile(value: unknown): HealthProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 64) : "";
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, PROFILE_NAME_MAX) : "";
  if (!id || id === ME || !name) return null;
  const relation = (relations as readonly unknown[]).includes(raw.relation) ? (raw.relation as Relation) : "other";
  const year = birthYear(raw.birthYear);
  const card = normalizeCard(raw.card);
  const deletedAt = time(raw.deletedAt);
  return {
    id,
    name,
    relation,
    ...(year && { birthYear: year }),
    ...(card && { card }),
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
    ...(deletedAt && { deletedAt }),
  };
}

/** Always the same order (by creation, then id): two equal lists compare equal. */
const ordered = (list: HealthProfile[]) => [...list].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

export function normalizeProfiles(value: unknown): HealthProfile[] | null {
  if (!Array.isArray(value)) return null;
  const byId = new Map<string, HealthProfile>();
  for (const item of value) {
    const profile = normalizeProfile(item);
    if (profile && (byId.get(profile.id)?.updatedAt ?? -1) < profile.updatedAt) byId.set(profile.id, profile);
  }
  return ordered([...byId.values()]);
}

function prune(list: HealthProfile[], now: number) {
  const kept = list.filter((item) => !item.deletedAt || now - item.deletedAt < PROFILE_TOMBSTONE_MS);
  return ordered(kept.length > MAX_PROFILES * 2 ? [...kept].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROFILES * 2) : kept);
}

/** This device's and the account's: for each person, the latest change wins (a removal too). */
export function mergeProfiles(local: unknown, remote: unknown, now: number): HealthProfile[] | null {
  const a = normalizeProfiles(local);
  const b = normalizeProfiles(remote);
  if (!a && !b) return null;
  return prune(normalizeProfiles([...(a ?? []), ...(b ?? [])]) ?? [], now);
}

export const liveProfiles = (list: HealthProfile[] | null | undefined) => (list ?? []).filter((item) => !item.deletedAt);

/** Whose it is: a living profile, else "Moi" (no profile, removed, or not here yet). */
export function ownerOf(profileId: string | undefined, list: HealthProfile[] | null | undefined): string {
  if (!profileId || profileId === ME) return ME;
  return liveProfiles(list).some((item) => item.id === profileId) ? profileId : ME;
}

/** The first name to put before a notification's text; null for "Moi". */
export function ownerName(profileId: string | undefined, list: HealthProfile[] | null | undefined): string | null {
  const owner = ownerOf(profileId, list);
  return owner === ME ? null : (liveProfiles(list).find((item) => item.id === owner)?.name ?? null);
}

/** Added or changed (a relative's name, relation, birth year). */
export function saveProfile(list: HealthProfile[] | null, id: string | null, draft: ProfileDraft, now: number, newId: () => string): HealthProfile[] {
  const current = list ?? [];
  const existing = id ? current.find((item) => item.id === id && !item.deletedAt) : undefined;
  const year = birthYear(draft.birthYear, now);
  const fields = { name: draft.name.trim().slice(0, PROFILE_NAME_MAX), relation: draft.relation, ...(year && { birthYear: year }) };
  const next: HealthProfile = existing
    ? { ...(({ birthYear: _old, ...rest }) => rest)(existing), ...fields, updatedAt: now }
    : { id: newId(), ...fields, createdAt: now, updatedAt: now };
  return prune([...current.filter((item) => item.id !== next.id), next], now);
}

/** A relative's emergency card written. */
export function saveProfileCard(list: HealthProfile[] | null, id: string, card: EmergencyCard, now: number): HealthProfile[] {
  return prune(
    (list ?? []).map((item) => (item.id === id && !item.deletedAt ? { ...item, card, updatedAt: now } : item)),
    now,
  );
}

/** Removed (their card with them): a tombstone, so the other devices remove them too. */
export function removeProfile(list: HealthProfile[] | null, id: string, now: number): HealthProfile[] {
  return prune(
    (list ?? []).map((item) => {
      if (item.id !== id) return item;
      const { card: _card, ...rest } = item;
      return { ...rest, deletedAt: now, updatedAt: now };
    }),
    now,
  );
}

/** All removed ("Remettre à zéro"). */
export function removeAllProfiles(list: HealthProfile[] | null, now: number): HealthProfile[] {
  return (list ?? []).reduce<HealthProfile[]>((current, item) => (item.deletedAt ? current : removeProfile(current, item.id, now)), list ?? []);
}

/**
 * Whom "Ma santé" opens on, from its link: `pour` (a relative), `appt` (an
 * appointment's notification) or `scan` (a dose notification). Checked: an
 * unknown or removed one is ignored (null), "Moi" included as such.
 */
export function personFromLink(
  query: { pour?: unknown; appt?: unknown; scan?: unknown },
  data: { profiles: HealthProfile[] | null | undefined; appointments?: Array<{ id: string; profileId?: string }> | null; entries?: Array<{ id: string; profileId?: string }> },
): string | null {
  const live = (id: unknown) => (typeof id === "string" && liveProfiles(data.profiles).some((item) => item.id === id) ? id : null);
  if (query.pour === ME) return ME;
  if (typeof query.pour === "string") return live(query.pour);
  if (typeof query.appt === "string") {
    const appointment = data.appointments?.find((item) => item.id === query.appt);
    return appointment ? (live(appointment.profileId) ?? ME) : null;
  }
  if (typeof query.scan === "string") {
    const entry = data.entries?.find((item) => item.id === query.scan);
    return entry ? (live(entry.profileId) ?? ME) : null;
  }
  return null;
}

/** Their age this year, when the birth year is known. */
export const ageOf = (profile: HealthProfile, now: number) => (profile.birthYear ? new Date(now).getFullYear() - profile.birthYear : null);
