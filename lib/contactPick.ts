import { personKey } from "@/lib/loans";

// "Choisir dans mes contacts" for "Prêts": what the phone's contact picker
// gives back, turned into what the loan form wants. Only the contact chosen
// is ever read (no permission), and nothing leaves the device.

/** The one contact chosen: a name and a number, as they would have been typed. */
export type PickedContact = { name: string; phone?: string };

/** Where the picker comes from: the app's own plugin (Android), the browser's (Chrome on Android), or none (button hidden). */
export type ContactPickerKind = "native" | "web" | null;

export function contactPickerKind(env: { plugin: boolean; webApi: boolean }): ContactPickerKind {
  if (env.plugin) return "native";
  if (env.webApi) return "web";
  return null;
}

/**
 * A contact's number written like the WhatsApp reminder reads it best:
 * "+261 34 12 345 67", "0341234567" and "34 12 345 67" all become
 * "034 12 345 67". A foreign number is kept as written; undefined when empty.
 */
export function contactPhone(raw: string | undefined) {
  const trimmed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("00")) digits = digits.slice(2);
  const plus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let local: string | undefined;
  if (/^261[23]\d{8}$/.test(digits) && (plus || digits.length === 12)) local = `0${digits.slice(3)}`;
  else if (!plus && /^0[23]\d{8}$/.test(digits)) local = digits;
  else if (!plus && /^[23]\d{8}$/.test(digits)) local = `0${digits}`;
  if (!local) return trimmed.slice(0, 24);
  return `${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 8)} ${local.slice(8)}`;
}

/** The person already in the loans with that name (same rule as the names offered), else the contact's own name. */
export function contactPerson(knownNames: string[], name: string) {
  const key = personKey(name);
  if (!key) return name.trim();
  return knownNames.find((known) => personKey(known) === key) ?? name.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** What a picker answered (the plugin's `{ name, phone }`, or the web API's lists), or null when cancelled or empty. */
export function pickedContact(raw: { name?: unknown; phone?: unknown; tel?: unknown } | null | undefined): PickedContact | null {
  if (!raw) return null;
  const first = (value: unknown) => (Array.isArray(value) ? value.find((item) => typeof item === "string" && item.trim()) : value);
  const name = first(raw.name);
  const tel = first(raw.phone ?? raw.tel);
  const phone = contactPhone(typeof tel === "string" ? tel : undefined);
  const cleanName = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!cleanName && !phone) return null;
  return { name: cleanName, ...(phone && { phone }) };
}
