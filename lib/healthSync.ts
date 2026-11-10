import { pick } from "./account/pick";
import { mergeAppointments, type Appointment } from "./appointments";
import { newerCard, type EmergencyCard } from "./emergencyCard";
import { mergeProfiles, type HealthProfile } from "./healthProfiles";

// "Ma santé" in the synced settings (user_settings.data): the emergency card
// and the appointments go by their own dates, apart from the other settings,
// since an older app writes the settings without them. Pure, so it can be
// tested; used by lib/account/AccountProvider.tsx.

export type HealthSettings = { emergencyCard: EmergencyCard | null; appointments: Appointment[] | null; healthProfiles: HealthProfile[] | null };

/** This device's and the account's together: the newer card, the appointments merged one by one. */
export function mergeHealth(local: Partial<HealthSettings>, remote: Partial<HealthSettings>, now: number): HealthSettings {
  return {
    emergencyCard: newerCard(local.emergencyCard, remote.emergencyCard),
    appointments: mergeAppointments(local.appointments, remote.appointments, now),
    healthProfiles: mergeProfiles(local.healthProfiles, remote.healthProfiles, now),
  };
}

/** Whether merging changed what this device has. */
export const healthChanged = (local: Partial<HealthSettings>, merged: HealthSettings) =>
  JSON.stringify(local.emergencyCard ?? null) !== JSON.stringify(merged.emergencyCard) ||
  JSON.stringify(local.appointments ?? null) !== JSON.stringify(merged.appointments) ||
  JSON.stringify(local.healthProfiles ?? null) !== JSON.stringify(merged.healthProfiles);

/** What goes to the account: nothing written yet (null) is left out, so the account's stays. */
export function healthPayload<T extends Partial<HealthSettings>>(data: T): T {
  const payload = { ...data };
  if (!payload.emergencyCard) delete payload.emergencyCard;
  if (!payload.appointments) delete payload.appointments;
  if (!payload.healthProfiles) delete payload.healthProfiles;
  return payload;
}

/** Nothing of "Ma santé" left on the device (signed out, account deleted). */
export const noHealth: HealthSettings = { emergencyCard: null, appointments: null, healthProfiles: null };

/** The account's row of settings, as read: its data and the date of its last change. */
export type SettingsRow = { data: unknown; updatedAt: number } | null;

/** The settings a device has: the synced keys and the date of their last change. */
type LocalSettings = Partial<HealthSettings> & Record<string, unknown> & { updatedAt: number };

export type SettingsSyncPlan = {
  /** What this device takes (from the account, or the merged health only), with the account's date when it is newer. */
  apply: { patch: Record<string, unknown>; updatedAt?: number } | null;
  /** What the account gets, and its date. */
  write: { data: Record<string, unknown>; updatedAt: number } | null;
};

/**
 * One reconciliation of the settings with the account's, done before each
 * send, at sign-in and when the app comes back: the newer side wins for the
 * plain settings, the card and the appointments are merged first, so a
 * device left open never erases what another one wrote meanwhile.
 */
export function planSettingsSync(local: LocalSettings, row: SettingsRow, keys: readonly string[], now: number): SettingsSyncPlan {
  const remote = pick((row?.data ?? {}) as Record<string, unknown>, keys) as Record<string, unknown> & Partial<HealthSettings>;
  const remoteAt = row?.updatedAt ?? 0;
  const health = mergeHealth(local, remote, now);
  const remoteNewer = row !== null && remoteAt > local.updatedAt;
  const localNewer = local.updatedAt > remoteAt;
  const apply = remoteNewer ? { patch: { ...remote, ...health }, updatedAt: remoteAt } : healthChanged(local, health) ? { patch: { ...health } } : null;
  // The account lacks something merged here (or an older app erased it): sent again.
  const write =
    localNewer || healthChanged(remote, health)
      ? { data: healthPayload({ ...(remoteNewer ? remote : pick(local, keys)), ...health } as Record<string, unknown> & Partial<HealthSettings>), updatedAt: Math.max(local.updatedAt, remoteAt) }
      : null;
  return { apply, write };
}
