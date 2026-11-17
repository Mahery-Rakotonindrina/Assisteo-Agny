import type { SearchResult } from "@/lib/expenseSearch";
import { monthKey } from "@/lib/expenses";
import { isHealthScan } from "@/lib/health";
import { liveAppointments, type Appointment } from "@/lib/appointments";
import type { Vehicle } from "@/lib/garage";
import { liveProfiles, type HealthProfile } from "@/lib/healthProfiles";
import type { HealthSpend } from "@/lib/healthSpending";
import type { HomeItem } from "@/lib/inventory";
import { personKey, type Loan } from "@/lib/loans";
import { paperKind } from "@/lib/papers";
import type { Plant } from "@/lib/plants";
import type { SavedList } from "@/services/listStore";
import type { Parcel } from "@/services/parcelStore";
import type { HistoryEntry } from "@/types/history";

// "Rechercher" (/recherche): one bar that looks everywhere on the device, with no
// server and no AI. Each source (scans, papers, parcels…) turns what its screen
// already reads into plain items; one engine compares them. Pure, so it can be tested.

export const searchDomains = ["scans", "papers", "parcels", "lists", "expenses", "loans", "health", "garage", "plants", "home"] as const;
export type SearchDomain = (typeof searchDomains)[number];

/** A thing that can be found: the pieces of text it is found by, where it opens, and the amounts it holds. */
export type SearchItem = {
  key: string;
  title: string;
  /** A short line under the title ("12 Nov 2026"). */
  sub?: string;
  parts: Array<string | number | null | undefined>;
  /** Amounts in ariary: "45000" finds 45 000 Ar. */
  amounts?: number[];
  href: string;
  /** For the order: the latest first. */
  at?: number;
};

export type SearchSource = { domain: SearchDomain; items: SearchItem[] };

/** A piece of an excerpt, in bold when it is what was found. */
export type Segment = { text: string; bold: boolean };

export type SearchHit = { key: string; title: string; sub?: string; excerpt?: Segment[]; href: string };
export type DomainResult = { domain: SearchDomain; count: number; hits: SearchHit[] };

/** The results shown for each domain. */
export const HITS_PER_DOMAIN = 5;
/** Shorter than this, a query finds too much to be useful. */
export const MIN_QUERY = 2;

// ---- Comparing ----------------------------------------------------------------------

/** Lower case and without accents, with exactly the same length as the text (so a place found in one is valid in the other). */
export function foldKeep(text: string) {
  let out = "";
  for (const char of text) {
    const plain = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += plain.length === char.length ? plain : char;
  }
  return out.replace(/[  ]/g, " ");
}

/** "Électricité  Mars" -> "electricite mars". */
export const normalize = (text: string) => foldKeep(text).replace(/\s+/g, " ").trim();

/** The words of a query, each of which has to be found. */
export const queryWords = (query: string) => normalize(query).split(" ").filter(Boolean);

/** "45 000" and "1.500.000" become "45000" and "1500000". */
const collapseNumbers = (text: string) => text.replace(/(\d)[ .,](?=\d{3}(?!\d))/g, "$1");

const joined = (parts: SearchItem["parts"]) => parts.filter((part) => part !== null && part !== undefined && part !== "").join(" | ");

/** What an item is searched in: its texts, the same with numbers written without spaces, and its amounts. */
function haystackOf(item: SearchItem) {
  const text = foldKeep(joined(item.parts));
  return `${text} ${collapseNumbers(text)} ${(item.amounts ?? []).join(" ")}`;
}

// Read once per list of items (each time the data change), not at each key typed.
const haystacks = new WeakMap<SearchItem[], string[]>();
function haystacksOf(items: SearchItem[]) {
  let known = haystacks.get(items);
  if (!known) {
    known = items.map(haystackOf);
    haystacks.set(items, known);
  }
  return known;
}

/** A short piece of the first text the words are found in, with them in bold. */
export function excerptOf(parts: SearchItem["parts"], words: string[], radius = 36): Segment[] | undefined {
  for (const part of parts) {
    if (typeof part !== "string" || !part) continue;
    const folded = foldKeep(part);
    const found = words.map((word) => folded.indexOf(word)).filter((index) => index >= 0);
    if (found.length === 0) continue;
    const first = Math.min(...found);
    const start = Math.max(0, first - radius);
    const end = Math.min(part.length, first + radius * 2);
    // Where every word falls in that window, merged into bold runs.
    const marks: Array<[number, number]> = [];
    for (const word of words) {
      for (let at = folded.indexOf(word, start); at >= 0 && at < end; at = folded.indexOf(word, at + word.length)) marks.push([at, Math.min(at + word.length, part.length)]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    const runs: Array<[number, number]> = [];
    for (const mark of marks) {
      const last = runs[runs.length - 1];
      if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
      else runs.push([mark[0], mark[1]]);
    }
    const segments: Segment[] = [];
    let at = start;
    if (start > 0) segments.push({ text: "…", bold: false });
    for (const [from, to] of runs) {
      if (from > at) segments.push({ text: part.slice(at, from), bold: false });
      segments.push({ text: part.slice(from, to), bold: true });
      at = to;
    }
    if (at < end) segments.push({ text: part.slice(at, end), bold: false });
    if (end < part.length) segments.push({ text: "…", bold: false });
    return segments;
  }
  return undefined;
}

/** Every word is found in the item (any order, anywhere in its texts or amounts). */
export const matches = (haystack: string, words: string[]) => words.length > 0 && words.every((word) => haystack.includes(word));

/** Looks for the query in every source; the domains with nothing found are left out. */
export function searchSources(sources: SearchSource[], query: string, limit = HITS_PER_DOMAIN): DomainResult[] {
  const words = queryWords(query);
  if (normalize(query).length < MIN_QUERY) return [];
  const results: DomainResult[] = [];
  for (const { domain, items } of sources) {
    const known = haystacksOf(items);
    const found: SearchItem[] = [];
    let count = 0;
    items.forEach((item, index) => {
      if (!matches(known[index], words)) return;
      count += 1;
      found.push(item);
    });
    if (count === 0) continue;
    // Only the ones shown are put in order and cut.
    const top = found.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
    results.push({
      domain,
      count,
      hits: top.map((item) => ({ key: item.key, title: item.title, sub: item.sub, excerpt: excerptOf(item.parts.slice(1), words) ?? excerptOf(item.parts, words), href: item.href })),
    });
  }
  return results;
}

// ---- Sources ------------------------------------------------------------------------

type Fmt = { date: (at: number) => string };

const withQuery = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;

/** The texts a scan is found by (older scans may lack some fields: read with care). */
export function scanParts(entry: HistoryEntry): SearchItem["parts"] {
  const { analysis } = entry;
  return [
    analysis.title,
    analysis.summary,
    entry.transcript?.text,
    ...(analysis.tags ?? []),
    ...(analysis.facts ?? []).flatMap((fact) => [fact.label, fact.value]),
    analysis.document?.type,
    entry.folder,
    ...(analysis.medicine?.items ?? []).flatMap((medicine) => [medicine.name, medicine.strength, medicine.dose]),
    ...(entry.chat ?? []).map((message) => message.content),
  ];
}

const scanAmounts = (entry: HistoryEntry) => (entry.expense?.amountMga ? [entry.expense.amountMga] : undefined);

// The history's own search reads the same texts as this screen, folded once per scan.
const scanHaystacks = new WeakMap<HistoryEntry, string>();

/**
 * The history's filter for a query: the same scans as "Rechercher" finds (no accents
 * nor capitals, every word, the same texts and amounts). Every scan matches an empty query.
 */
export function scanMatcher(query: string): (entry: HistoryEntry) => boolean {
  const words = queryWords(query);
  if (words.length === 0) return () => true;
  return (entry) => {
    let haystack = scanHaystacks.get(entry);
    if (haystack === undefined) {
      haystack = haystackOf({ key: entry.id, title: "", parts: scanParts(entry), amounts: scanAmounts(entry), href: "" });
      scanHaystacks.set(entry, haystack);
    }
    return matches(haystack, words);
  };
}

/** The scans, apart: papers (a kept paper), health (a prescription or medicine box) and the others. A scan is in one place only. */
export function scanSources(entries: HistoryEntry[], fmt: Fmt): Record<"scans" | "papers" | "health", SearchItem[]> {
  const out: Record<"scans" | "papers" | "health", SearchItem[]> = { scans: [], papers: [], health: [] };
  for (const entry of entries) {
    if (entry.deletedAt) continue;
    const { analysis } = entry;
    const item: SearchItem = {
      key: entry.id,
      title: analysis.title,
      sub: fmt.date(entry.createdAt),
      parts: scanParts(entry),
      amounts: scanAmounts(entry),
      href: `/result?id=${encodeURIComponent(entry.id)}`,
      at: entry.createdAt,
    };
    if (isHealthScan(entry)) out.health.push(item);
    else if (paperKind(entry) !== null) out.papers.push(item);
    else out.scans.push(item);
  }
  return out;
}

export function parcelItems(parcels: Parcel[], fmt: Fmt): SearchItem[] {
  return parcels.map((parcel) => {
    const { info } = parcel;
    return {
      key: parcel.id,
      title: parcel.title,
      sub: fmt.date(parcel.createdAt),
      parts: [
        parcel.title,
        parcel.client,
        info.statusLabel,
        info.carrier,
        info.trackingNumber,
        info.orderNumber,
        info.platform,
        info.seller,
        info.destinationCity,
        info.total,
        info.lastEvent?.description,
        info.lastEvent?.location,
        ...(info.items ?? []).flatMap((item) => [item.name, item.variant, item.price]),
        ...(parcel.timeline ?? []).flatMap((entry) => [entry.event?.description, entry.event?.location]),
        ...(parcel.fees ?? []).map((fee) => fee.label),
        parcel.lot?.name,
        parcel.freight?.forwarder,
      ],
      amounts: [parcel.priceMga, parcel.salePriceMga, parcel.paidMga, ...(parcel.fees ?? []).map((fee) => fee.amountMga)].filter((value): value is number => typeof value === "number"),
      href: withQuery("/parcels", { open: parcel.id }),
      at: parcel.updatedAt,
    };
  });
}

export function listItems(lists: SavedList[], fmt: Fmt): SearchItem[] {
  return lists
    .filter((list) => !list.deletedAt)
    .map((list) => ({
      key: list.id,
      title: list.title,
      sub: fmt.date(list.updatedAt),
      parts: [list.title, ...list.items.flatMap((item) => [item.text, item.quantity])],
      amounts: list.items.map((item) => item.priceMga).filter((value): value is number => typeof value === "number"),
      href: withQuery("/lists", { open: list.id }),
      at: list.updatedAt,
    }));
}

export function loanItems(loans: Loan[], fmt: Fmt): SearchItem[] {
  return loans
    .filter((loan) => !loan.deletedAt)
    .map((loan) => ({
      key: loan.id,
      title: loan.person,
      sub: fmt.date(loan.at),
      parts: [loan.person, loan.note, loan.phone],
      amounts: [loan.amountMga],
      href: withQuery("/loans", { person: personKey(loan.person), dir: loan.direction }),
      at: loan.at,
    }));
}

export type HealthNames = { relation: (relation: HealthProfile["relation"]) => string; spend: (kind: HealthSpend["kind"]) => string; person: (profileId?: string) => string | undefined };

/** Appointments, relatives and health expenses (the prescriptions are in `scanSources`). */
export function healthItems(data: { appointments: Appointment[] | null | undefined; profiles: HealthProfile[] | null | undefined; spends: HealthSpend[] }, names: HealthNames, fmt: Fmt): SearchItem[] {
  const items: SearchItem[] = [];
  for (const appointment of liveAppointments(data.appointments)) {
    items.push({
      key: `appt:${appointment.id}`,
      title: appointment.who || appointment.place || appointment.note,
      sub: fmt.date(appointment.at),
      parts: [appointment.who, appointment.place, appointment.note, names.person(appointment.profileId)],
      href: withQuery("/sante", { appt: appointment.id }),
      at: appointment.at,
    });
  }
  for (const profile of liveProfiles(data.profiles)) {
    items.push({
      key: `profile:${profile.id}`,
      title: profile.name,
      sub: names.relation(profile.relation),
      parts: [profile.name, names.relation(profile.relation), profile.card?.allergies, profile.card?.conditions, profile.card?.note],
      href: withQuery("/sante", { pour: profile.id }),
      at: profile.updatedAt,
    });
  }
  for (const spend of data.spends) {
    if (spend.deletedAt) continue;
    items.push({
      key: `spend:${spend.id}`,
      title: spend.note || names.spend(spend.kind),
      sub: fmt.date(spend.at),
      parts: [spend.note, names.spend(spend.kind), names.person(spend.profileId)],
      amounts: [spend.amountMga],
      href: withQuery("/sante", { pour: spend.profileId ?? "me" }),
      at: spend.at,
    });
  }
  return items;
}

export function garageItems(vehicles: Vehicle[], fmt: Fmt): SearchItem[] {
  return vehicles
    .filter((vehicle) => !vehicle.deletedAt)
    .map((vehicle) => ({
      key: vehicle.id,
      title: vehicle.name,
      sub: [vehicle.make, vehicle.model].filter(Boolean).join(" ") || fmt.date(vehicle.createdAt),
      parts: [
        vehicle.name,
        vehicle.make,
        vehicle.model,
        vehicle.plate,
        vehicle.vin,
        vehicle.year,
        ...(vehicle.advice ?? []).map((advice) => advice.task),
        ...(vehicle.maintenance ?? []).flatMap((entry) => [entry.note, entry.garage]),
        ...(vehicle.expenses ?? []).map((expense) => expense.label),
      ],
      amounts: [...(vehicle.maintenance ?? []).map((entry) => entry.costMga), ...(vehicle.fuel ?? []).map((entry) => entry.amountMga), ...(vehicle.expenses ?? []).map((expense) => expense.amountMga)].filter(
        (value): value is number => typeof value === "number",
      ),
      href: withQuery("/garage", { open: vehicle.id }),
      at: vehicle.updatedAt,
    }));
}

export function plantItems(plants: Plant[], fmt: Fmt): SearchItem[] {
  return plants
    .filter((plant) => !plant.deletedAt)
    .map((plant) => ({
      key: plant.id,
      title: plant.name,
      sub: plant.species || fmt.date(plant.createdAt),
      parts: [plant.name, plant.species, plant.notes],
      href: withQuery("/plants", { open: plant.id }),
      at: plant.updatedAt,
    }));
}

export function homeItems(items: HomeItem[], fmt: Fmt): SearchItem[] {
  return items
    .filter((item) => !item.deletedAt)
    .map((item) => ({
      key: item.id,
      title: item.name,
      sub: item.store || fmt.date(item.createdAt),
      parts: [item.name, item.store, item.serial, item.note, item.room, item.category],
      amounts: typeof item.priceMga === "number" ? [item.priceMga] : undefined,
      href: withQuery("/inventory", { open: item.id }),
      at: item.updatedAt,
    }));
}

/**
 * "Mes dépenses" has its own search (lib/expenseSearch.ts: every month's lines,
 * computed ones included): its result becomes this screen's, the latest first.
 */
export function expenseDomain(result: SearchResult, text: { title: (hit: SearchResult["groups"][number]["hits"][number]) => string; sub: (hit: SearchResult["groups"][number]["hits"][number]) => string }): DomainResult | null {
  if (result.count === 0) return null;
  const hits = result.groups.flatMap((group) => group.hits).slice(0, HITS_PER_DOMAIN);
  return {
    domain: "expenses",
    count: result.count,
    hits: hits.map((hit) => ({
      key: hit.key,
      title: text.title(hit),
      sub: text.sub(hit),
      // A typed-in line opens in its form; any other is shown in its month.
      href: hit.recordId ? withQuery("/expenses", { open: hit.recordId }) : withQuery("/expenses", { month: monthKey(hit.at), tab: hit.flow === "income" ? "income" : "month", focus: hit.key }),
    })),
  };
}

/** Where "Voir tout" goes: the domain's screen, with the search filled in when the screen has one. */
export function seeAllHref(domain: SearchDomain, query: string): string {
  const q = query.trim();
  switch (domain) {
    case "scans":
      return withQuery("/history", { q });
    case "parcels":
      return withQuery("/parcels", { q });
    case "papers":
      return "/papers";
    case "lists":
      return "/lists";
    case "expenses":
      return "/expenses";
    case "loans":
      return "/loans";
    case "health":
      return "/sante";
    case "garage":
      return "/garage";
    case "plants":
      return "/plants";
    case "home":
      return "/inventory";
  }
}

// ---- Recent searches ----------------------------------------------------------------

export const MAX_RECENT = 5;

/** What was stored, as a safe list (damaged or foreign values are dropped). */
export function readRecent(raw: string | null | undefined): string[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** The query put first; the same one asked again (whatever its accents or capitals) moves up instead of being doubled. */
export function addRecent(list: string[], query: string): string[] {
  const clean = query.trim().replace(/\s+/g, " ").slice(0, 60);
  if (normalize(clean).length < MIN_QUERY) return list;
  const key = normalize(clean);
  return [clean, ...list.filter((item) => normalize(item) !== key)].slice(0, MAX_RECENT);
}
