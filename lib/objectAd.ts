import type { Locale } from "@/i18n.config";
import type { Analysis, ObjectAd, ObjectCondition } from "./ai/schema";
import { formatAriary } from "./format";

// Selling an object: the condition guessed from the scan, the ad tidied up,
// and the text to copy or share.

/** Read worst first: "comme neuf" is very good, not new; a broken thing is to repair. */
const conditionWords: Array<[ObjectCondition, RegExp]> = [
  ["toRepair", /cass[ée]|bris[ée]|fissur|f[eê]l[ée]|[àa] r[ée]parer|en panne|hors service|ne (fonctionne|marche) (plus|pas)|broken|cracked|not working|needs? repair|faulty/],
  ["worn", /(^|[^a-z])us[ée]e?s?(?![a-z])|usure|ray[ée]|rayure|ab[iî]m[ée]|t[aâ]ch[ée]|d[ée]lav[ée]|rouill|\bworn\b|scratch|scuff|faded|\brust|\bdents?\b/],
  ["veryGood", /tr[eè]s bon [ée]tat|excellent [ée]tat|comme neuf|parfait [ée]tat|like new|excellent condition|mint condition|very good condition|barely used/],
  ["new", /\bneu(f|ve)s?\b|jamais (servi|utilis)|emballage d.origine|sous blister|brand new|unused|never used|in (its|the) (original )?box/],
];

/** The condition to propose: from what the analysis says, "good" when it says nothing. */
export function guessCondition(analysis: Pick<Analysis, "summary" | "facts" | "tags">): ObjectCondition {
  const about = [
    analysis.summary,
    ...analysis.facts.filter((fact) => /[ée]tat|condition|state|usure|wear/i.test(fact.label)).map((fact) => fact.value),
    ...analysis.tags,
  ]
    .join(" ")
    .toLowerCase()
    // A new price is not a new object.
    .replace(/prix (du )?neuf|neuf (co[uû]te|vaut)|new price|price new|when new/g, "");
  return conditionWords.find(([, words]) => words.test(about))?.[0] ?? "good";
}

/** Rounded as the prompt asks: to 500 Ar under 10 000 Ar, else to 1 000 Ar. */
export function roundPrice(value: number) {
  const step = value < 10_000 ? 500 : 1_000;
  return Math.max(0, Math.round(value / step) * step);
}

/**
 * The AI's ad, made safe to show: prices rounded and in order (low ≤ price ≤
 * high), 3 to 5 distinct keywords without "#", texts trimmed.
 */
export function tidyAd(ad: ObjectAd): ObjectAd {
  const price = roundPrice(Number.isFinite(ad.price) ? ad.price : 0);
  const low = roundPrice(Number.isFinite(ad.priceLow) ? ad.priceLow : price);
  const high = roundPrice(Number.isFinite(ad.priceHigh) ? ad.priceHigh : price);
  const keywords = [...new Set(ad.keywords.map((word) => word.replace(/^#+/, "").trim().toLowerCase()).filter(Boolean))].slice(0, 5);
  const textMg = ad.textMg?.trim();
  return {
    title: ad.title.trim().slice(0, 120),
    text: ad.text.trim(),
    price,
    priceLow: Math.min(low, price),
    priceHigh: Math.max(high, price),
    keywords,
    textMg: textMg ? textMg : null,
  };
}

/** The ad as one text, to copy or share: title, text (and its Malagasy), price, keywords as hashtags. */
export function adShareText(ad: Pick<ObjectAd, "title" | "text" | "price" | "keywords" | "textMg">, priceLabel: string, locale: Locale) {
  const tags = ad.keywords.map((word) => `#${word.replace(/\s+/g, "")}`).join(" ");
  return [ad.title, ad.text, ad.textMg, `${priceLabel} ${formatAriary(ad.price, locale)}`, tags].filter(Boolean).join("\n\n");
}

/** A WhatsApp link with the ad, to pick the chat or the group. */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
