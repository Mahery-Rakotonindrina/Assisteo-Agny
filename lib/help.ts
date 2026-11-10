// The "Aide" page: which topics, questions and guides exist (texts are in locales "help.*").
import type { PlanFeature } from "@/lib/plans";

export const helpTopics = [
  { id: "scan", questions: ["what", "blurry", "pages"] },
  { id: "plans", questions: ["free", "pay", "limit"] },
  { id: "parcels", questions: ["add", "status", "costs"] },
  { id: "health", questions: ["where", "appointments", "family"] },
  // Expenses and loans are Admin-only for now: the page shows them only to a plan that opens them (public page, no promise nobody can use).
  { id: "expenses", questions: ["add", "budget", "share"], feature: "expenses" },
  { id: "loans", questions: ["add", "repay", "remind"], feature: "loans" },
  { id: "account", questions: ["need", "lost", "delete"] },
  { id: "offline", questions: ["works", "queue", "data"] },
] as const;

export type HelpTopicId = (typeof helpTopics)[number]["id"];

/** Guides in a few steps; every step has its icon (see the page). */
export const helpGuides = ["scan", "parcel", "expense", "account"] as const;
export type HelpGuideId = (typeof helpGuides)[number];

/** The feature a guide needs, when it is a plan's feature (hidden while the plan does not open it). */
export const helpGuideFeature: Partial<Record<HelpGuideId, PlanFeature>> = { expense: "expenses" };

/** Lower case without accents, so "facture" finds "Facture" and "reseau" finds "réseau". */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** The items whose text holds every word of the query (all items for an empty query). */
export function searchHelp<T extends { text: string }>(items: T[], query: string): T[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const text = normalizeSearch(item.text);
    return words.every((word) => text.includes(word));
  });
}
