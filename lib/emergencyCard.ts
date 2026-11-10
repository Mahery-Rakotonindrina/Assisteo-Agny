// "Fiche d'urgence" (Ma santé): what someone helping needs to know at once —
// blood group, allergies, long-term illnesses or treatments, who to call.
// Kept in the settings (on the device, readable offline) and synced with the
// account like them (user_settings.data.emergencyCard): no table of its own.
// It never leaves the device otherwise, but by a share the person makes.

export const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;
export type BloodGroup = (typeof bloodGroups)[number];

export type EmergencyCard = {
  bloodGroup: BloodGroup | null;
  /** Free text: "pénicilline, arachide…", shown as tags. */
  allergies: string;
  /** Long-term illnesses or treatments. */
  conditions: string;
  contactName: string;
  /** "ma sœur", "mon mari"… */
  contactRelation: string;
  contactPhone: string;
  note: string;
  /**
   * Last change to the card itself: settles two devices apart from the other
   * settings. An emptied card keeps its date, so the emptying wins too.
   */
  updatedAt: number;
};

/** Longest text kept in a field: a card, not a medical file. */
export const CARD_TEXT_MAX = 500;

export const blankCard = (updatedAt = 0): EmergencyCard => ({
  bloodGroup: null,
  allergies: "",
  conditions: "",
  contactName: "",
  contactRelation: "",
  contactPhone: "",
  note: "",
  updatedAt,
});

const text = (value: unknown, max = CARD_TEXT_MAX) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A card from storage or from the account, whatever came: unknown fields dropped, a bad one empty. */
export function normalizeCard(value: unknown): EmergencyCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const bloodGroup = (bloodGroups as readonly unknown[]).includes(raw.bloodGroup) ? (raw.bloodGroup as BloodGroup) : null;
  return {
    bloodGroup,
    allergies: text(raw.allergies),
    conditions: text(raw.conditions),
    contactName: text(raw.contactName, 80),
    contactRelation: text(raw.contactRelation, 60),
    contactPhone: text(raw.contactPhone, 30),
    note: text(raw.note),
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

/** Nothing written in it (an unknown blood group alone counts as something said). */
export function isCardEmpty(card: EmergencyCard | null | undefined) {
  if (!card) return true;
  return !card.bloodGroup && !card.allergies && !card.conditions && !card.contactName && !card.contactPhone && !card.note;
}

/**
 * The card to keep between this device's and the account's: the newer one.
 * Missing on one side (an older app wrote the settings without it), the other.
 */
export function newerCard(local: unknown, remote: unknown): EmergencyCard | null {
  const a = normalizeCard(local);
  const b = normalizeCard(remote);
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

/** The allergies as tags: split on commas, semicolons and new lines. */
export function allergyTags(allergies: string) {
  return allergies
    .split(/[,;\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** "A−": the real minus sign on screen (stored as "A-"). */
export const bloodLabel = (group: Exclude<BloodGroup, "unknown">) => group.replace("-", "−");

/** A number to call: digits and a leading +, else null. */
export function telHref(phone: string) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The card as a message: only what is filled in, then the date it was written. */
export function cardText(card: EmergencyCard, t: Translate, date: (at: number) => string) {
  const line = (key: string, value: string) => t("health.emergency.share.line", { label: t(`health.emergency.${key}`), value });
  const lines = [t("health.emergency.share.heading")];
  if (card.bloodGroup) lines.push(line("blood", card.bloodGroup === "unknown" ? t("health.emergency.bloodUnknown") : bloodLabel(card.bloodGroup)));
  if (card.allergies) lines.push(line("allergies", allergyTags(card.allergies).join(", ")));
  if (card.conditions) lines.push(line("conditions", card.conditions));
  if (card.contactName || card.contactPhone) {
    const who = [card.contactName, card.contactRelation && `(${card.contactRelation})`, card.contactPhone].filter(Boolean).join(" ");
    lines.push(line("contact", who));
  }
  if (card.note) lines.push(line("note", card.note));
  if (card.updatedAt) lines.push("", t("health.emergency.share.updated", { date: date(card.updatedAt) }));
  return lines.join("\n");
}
