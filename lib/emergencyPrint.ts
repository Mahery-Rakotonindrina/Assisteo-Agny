import { allergyTags, bloodLabel, isCardEmpty, type EmergencyCard } from "./emergencyCard";

// "Imprimer la carte" and "Fond d'écran" (fiche d'urgence): what goes on the
// wallet card and on the lock-screen picture, and how its lines are laid out
// in a fixed space. Only what is filled in; pure, so it can be tested (the
// drawing itself, jsPDF or a canvas, lives in services/emergencyPrint.ts).

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type PrintRow = { label: string; value: string };

export type PrintableCard = {
  /** "Fiche d'urgence de Hery", or "Fiche d'urgence" for "Moi". */
  title: string;
  /** A relative's first name, null for "Moi". */
  name: string | null;
  /** "O−", "Je ne sais pas", or null when not filled. */
  blood: string | null;
  bloodLabel: string;
  /** Allergies, then illnesses or treatments: each only when filled. */
  rows: PrintRow[];
  contact: { label: string; who: string; phone: string } | null;
  note: PrintRow | null;
  /** "Mise à jour le 16 nov. 2026", or null for a card never dated. */
  updated: string | null;
};

/** What the card and the picture show; null for an empty card (nothing to print). */
export function printableCard(card: EmergencyCard | null | undefined, t: Translate, date: (at: number) => string, name: string | null = null): PrintableCard | null {
  if (!card || isCardEmpty(card)) return null;
  const rows: PrintRow[] = [];
  if (card.allergies) rows.push({ label: t("health.emergency.allergies"), value: allergyTags(card.allergies).join(", ") });
  if (card.conditions) rows.push({ label: t("health.emergency.conditions"), value: card.conditions });
  const who = [card.contactName, card.contactRelation && `(${card.contactRelation})`].filter(Boolean).join(" ");
  return {
    title: name ? t("health.emergency.titleOf", { name }) : t("health.emergency.title"),
    name,
    blood: !card.bloodGroup ? null : card.bloodGroup === "unknown" ? t("health.emergency.bloodUnknown") : bloodLabel(card.bloodGroup),
    bloodLabel: t("health.emergency.blood"),
    rows,
    contact: card.contactName || card.contactPhone ? { label: t("health.emergency.contact"), who, phone: card.contactPhone } : null,
    note: card.note ? { label: t("health.emergency.note"), value: card.note } : null,
    updated: card.updatedAt ? t("health.emergency.updated", { date: date(card.updatedAt) }) : null,
  };
}

/** Width of a text in the drawing's unit (mm for the PDF, pixels for the picture). */
export type Measure = (text: string) => number;

/** The text's characters as seen on screen: an emoji or an accent never cut in two. */
export function characters(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return Array.from(text);
}

/** Splits a word too wide for a line into pieces that fit (a long phone number, a URL). */
function breakWord(word: string, maxWidth: number, measure: Measure) {
  const pieces: string[] = [];
  let piece = "";
  for (const char of characters(word)) {
    if (piece && measure(piece + char) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else piece += char;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** The text's lines at this width: new lines kept, words never cut unless one alone is too wide. */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) line = word;
      else {
        const pieces = breakWord(word, maxWidth, measure);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? "";
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** At most `max` lines; the last one kept ends with "…" (shortened to fit) when some were dropped. */
export function clampLines(lines: string[], max: number, maxWidth: number, measure: Measure): string[] {
  if (lines.length <= max) return lines;
  if (max <= 0) return [];
  const kept = lines.slice(0, max);
  const last = characters(kept[max - 1]);
  while (last.length && measure(`${last.join("")}…`) > maxWidth) {
    last.pop();
    while (last.length && !last[last.length - 1].trim()) last.pop();
  }
  kept[max - 1] = `${last.join("")}…`;
  return kept;
}

export type StackedRow = { label: string; lines: string[] };

/**
 * Label/value rows stacked in a fixed height: each label takes `labelHeight`,
 * each value line `lineHeight`, `gap` between rows. A row whose label and
 * first line no longer fit is dropped (with the ones after it); the last row
 * shown is cut with "…" when its value is too long.
 */
export function stackRows(
  rows: PrintRow[],
  room: { width: number; height: number; labelHeight: number; lineHeight: number; gap: number },
  measure: Measure,
): StackedRow[] {
  const stacked: StackedRow[] = [];
  let left = room.height;
  for (const row of rows) {
    const needed = room.labelHeight + room.lineHeight;
    if (left < needed) break;
    const lines = wrapText(row.value, room.width, measure);
    const fit = Math.max(1, Math.floor((left - room.labelHeight + 1e-9) / room.lineHeight));
    const shown = clampLines(lines, fit, room.width, measure);
    stacked.push({ label: row.label, lines: shown });
    left -= room.labelHeight + shown.length * room.lineHeight + room.gap;
  }
  return stacked;
}

/** A file name for the picture, from the PDF one ("Fiche-d-urgence.pdf" → ".png"). */
export const pictureFileName = (pdfName: string) => pdfName.replace(/\.pdf$/, ".png");
