import { mergeAppointments, type Appointment } from "./appointments";
import { newerCard, type EmergencyCard } from "./emergencyCard";

// "Ma santé" in the synced settings (user_settings.data): the emergency card
// and the appointments go by their own dates, apart from the other settings,
// since an older app writes the settings without them. Pure, so it can be
// tested; used by lib/account/AccountProvider.tsx.

export type HealthSettings = { emergencyCard: EmergencyCard | null; appointments: Appointment[] | null };

/** This device's and the account's together: the newer card, the appointments merged one by one. */
export function mergeHealth(local: Partial<HealthSettings>, remote: Partial<HealthSettings>, now: number): HealthSettings {
  return {
    emergencyCard: newerCard(local.emergencyCard, remote.emergencyCard),
    appointments: mergeAppointments(local.appointments, remote.appointments, now),
  };
}

/** Whether merging changed what this device has. */
export const healthChanged = (local: Partial<HealthSettings>, merged: HealthSettings) =>
  JSON.stringify(local.emergencyCard ?? null) !== JSON.stringify(merged.emergencyCard) || JSON.stringify(local.appointments ?? null) !== JSON.stringify(merged.appointments);

/** What goes to the account: nothing written yet (null) is left out, so the account's stays. */
export function healthPayload<T extends Partial<HealthSettings>>(data: T): T {
  const payload = { ...data };
  if (!payload.emergencyCard) delete payload.emergencyCard;
  if (!payload.appointments) delete payload.appointments;
  return payload;
}

/** Nothing of "Ma santé" left on the device (signed out, account deleted). */
export const noHealth: HealthSettings = { emergencyCard: null, appointments: null };
