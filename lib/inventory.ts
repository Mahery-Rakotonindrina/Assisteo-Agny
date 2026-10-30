import type { Analysis } from "@/lib/ai/schema";
import { parseDay } from "@/lib/papers";

// "Ma maison": the things of the home (fridge, TV, sofa…) with their purchase,
// their warranty and the papers that prove them (invoices, till receipts,
// warranty cards picked among the scans). Useful after a theft, a fire or a
// flood: the inventory exports with the photos and the total value. Pure, so
// it is shared by the store, the screens, the exports and the tests.

export const homeRooms = ["living", "kitchen", "bedroom", "bathroom", "office", "outside", "other"] as const;
export type HomeRoom = (typeof homeRooms)[number];

export const homeCategories = ["appliance", "electronics", "furniture", "kitchenware", "tools", "jewellery", "other"] as const;
export type HomeCategory = (typeof homeCategories)[number];

/** One thing of the home. Synced as one row of "home_items". */
export type HomeItem = {
  id: string;
  name: string;
  /** Small JPEG data URL (from the scan, or a photo taken here). */
  thumbnail?: string;
  room?: HomeRoom;
  category?: HomeCategory;
  /** The day it was bought, YYYY-MM-DD. */
  boughtOn?: string;
  /** What it cost, in ariary. */
  priceMga?: number;
  store?: string;
  /** The last day under warranty, YYYY-MM-DD. */
  warrantyUntil?: string;
  serial?: string;
  /** The object scan it was made from, if any. */
  fromScanId?: string;
  /** The papers that go with it: scans of the history (invoice, till receipt, warranty card). */
  scanIds: string[];
  note?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
};

/** At most this many papers per thing. */
export const MAX_PAPERS = 6;

/** The warranty reminder comes this many days before its end, at 9:00. */
export const WARRANTY_NOTICE_DAYS = 30;
export const WARRANTY_REMINDER_HOUR = 9;

// ---- Warranty -------------------------------------------------------------------

export type WarrantyStatus = "active" | "ended";

/** "Sous garantie" until the end of its last day, "Garantie finie" after; null without a date. */
export function warrantyStatus(item: Pick<HomeItem, "warrantyUntil">, now: number): WarrantyStatus | null {
  const end = parseDay(item.warrantyUntil);
  if (end === null) return null;
  const lastMoment = new Date(end);
  lastMoment.setDate(lastMoment.getDate() + 1);
  return now < lastMoment.getTime() ? "active" : "ended";
}

/** When the warranty reminder comes: 30 days before its end, at 9:00 (local time); null without a date. */
export function warrantyReminderAt(item: Pick<HomeItem, "warrantyUntil">) {
  const end = parseDay(item.warrantyUntil);
  if (end === null) return null;
  const date = new Date(end);
  date.setDate(date.getDate() - WARRANTY_NOTICE_DAYS);
  date.setHours(WARRANTY_REMINDER_HOUR, 0, 0, 0);
  return date.getTime();
}

/** The reminders wanted now, by item id: only those still to come, none while not `enabled` (plan, reminders). */
export function plannedWarrantyReminders(items: HomeItem[], now: number, enabled = true) {
  const planned = new Map<string, { item: HomeItem; at: number; endsAt: number }>();
  if (!enabled) return planned;
  for (const item of items) {
    const at = warrantyReminderAt(item);
    const endsAt = parseDay(item.warrantyUntil);
    if (at !== null && endsAt !== null && at > now) planned.set(item.id, { item, at, endsAt });
  }
  return planned;
}

// ---- Totals and rooms -----------------------------------------------------------

/** The value of the home: the sum of the prices known, and how many things have none. */
export function inventoryTotals(items: Pick<HomeItem, "priceMga">[]) {
  let totalMga = 0;
  let unpriced = 0;
  for (const item of items) {
    if (item.priceMga && item.priceMga > 0) totalMga += item.priceMga;
    else unpriced += 1;
  }
  return { count: items.length, totalMga, unpriced };
}

/** The things room by room, in the order of `homeRooms` (no room: "other"), each by name. */
export function itemsByRoom<T extends Pick<HomeItem, "room" | "name" | "priceMga">>(items: T[]) {
  const groups = new Map<HomeRoom, T[]>();
  for (const item of items) {
    const room = item.room ?? "other";
    groups.set(room, [...(groups.get(room) ?? []), item]);
  }
  return homeRooms
    .filter((room) => groups.has(room))
    .map((room) => {
      const list = [...groups.get(room)!].sort((a, b) => a.name.localeCompare(b.name));
      return { room, items: list, totalMga: inventoryTotals(list).totalMga };
    });
}

// ---- Papers ---------------------------------------------------------------------

/** The list with one more paper; null when full, or when this scan is linked already. */
export function withPaper(scanIds: string[] | undefined, scanId: string): string[] | null {
  const current = scanIds ?? [];
  if (!scanId || current.includes(scanId) || current.length >= MAX_PAPERS) return null;
  return [...current, scanId];
}

/** An invoice, a till receipt or a warranty card: a paper that can go with a thing of the home. */
export function isHomePaper(analysis: Pick<Analysis, "category" | "document">) {
  const document = analysis.document;
  if (analysis.category !== "document" || !document) return false;
  if (document.receipt || document.paper === "warranty") return true;
  return /factur|invoice|ticket|re[çc]u|receipt|garantie|warranty|bon de livraison/i.test(document.type);
}

/** A thing of the home can be made from an object scan (a plant has its own place). */
export const canAddToHome = (analysis: Pick<Analysis, "category">) => analysis.category === "object";

const isMga = (currency: string | null | undefined) => !currency || /^(MGA|AR|ARIARY)$/i.test(currency.trim());

/** What a paper tells about the purchase: the day, the price in ariary, the shop, the warranty end. */
export function purchaseFieldsFrom(analysis: Pick<Analysis, "document">): Partial<Pick<HomeItem, "boughtOn" | "priceMga" | "store" | "warrantyUntil">> {
  const document = analysis.document;
  if (!document) return {};
  const receipt = document.receipt;
  const bill = document.bill;
  const fields: Partial<Pick<HomeItem, "boughtOn" | "priceMga" | "store" | "warrantyUntil">> = {};
  const day = receipt?.date ?? null;
  if (parseDay(day) !== null) fields.boughtOn = day!;
  const total = receipt?.total ?? null;
  if (total !== null && total > 0 && isMga(receipt?.currency)) fields.priceMga = Math.round(total);
  else if (bill?.amount && bill.amount > 0 && isMga(bill.currency)) fields.priceMga = Math.round(bill.amount);
  const store = receipt?.merchant?.trim() || bill?.issuer?.trim();
  if (store) fields.store = store.slice(0, 80);
  if (document.paper === "warranty" && parseDay(document.expiresOn) !== null) fields.warrantyUntil = document.expiresOn!;
  return fields;
}

/** Fills in what the thing doesn't have yet with what a paper read (the user's own values stay). */
export function fillFromPaper(item: HomeItem, analysis: Pick<Analysis, "document">): HomeItem {
  const fields = purchaseFieldsFrom(analysis);
  return {
    ...item,
    boughtOn: item.boughtOn ?? fields.boughtOn,
    priceMga: item.priceMga ?? fields.priceMga,
    store: item.store ?? fields.store,
    warrantyUntil: item.warrantyUntil ?? fields.warrantyUntil,
  };
}

// ---- From an object scan --------------------------------------------------------

// Keywords of the title and tags, French and English (and a few Malagasy words), first match wins.
const categoryWords: Array<[HomeCategory, RegExp]> = [
  ["appliance", /frigo|r[ée]frig[ée]rateur|fridge|cong[ée]lateur|freezer|lave-linge|machine [àa] laver|washing|climatiseur|air condition|ventilateur|\bfan\b|micro-ondes|microwave|four\b|oven|cuisini[èe]re|stove|aspirateur|vacuum|fer [àa] repasser|\biron\b|chauffe-eau|water heater|groupe [ée]lectrog[èe]ne|generator|mixeur|blender/i],
  ["electronics", /t[ée]l[ée]|tv\b|television|t[ée]l[ée]phone|phone|smartphone|ordinateur|computer|laptop|tablette|tablet|imprimante|printer|enceinte|speaker|radio|console|cam[ée]ra|appareil photo|routeur|router|d[ée]codeur|panneau solaire|solar|batterie|battery|casque|headphone|montre connect/i],
  ["furniture", /canap[ée]|sofa|couch|lit\b|\bbed\b|matelas|mattress|armoire|wardrobe|table|chaise|chair|bureau|desk|commode|dresser|[ée]tag[èe]re|shelf|buffet|fauteuil|armchair/i],
  ["kitchenware", /casserole|marmite|vilany|po[êe]le|\bpan\b|\bpot\b|vaisselle|dishes|assiette|plate|verre|glass|couteau|knife|ustensile|utensil|bouilloire|kettle|cafeti[èe]re|coffee/i],
  ["tools", /perceuse|drill|marteau|hammer|tournevis|screwdriver|scie|\bsaw\b|outil|tool|cl[ée] [àa] molette|wrench|pompe|pump|tondeuse|mower|[ée]chelle|ladder/i],
  ["jewellery", /bijou|jewel|bague|\bring\b|collier|necklace|bracelet|montre|watch|\bor\b|\bgold\b|argent massif|silver/i],
];

const roomOf: Partial<Record<HomeCategory, HomeRoom>> = { appliance: "kitchen", kitchenware: "kitchen", electronics: "living", furniture: "living", jewellery: "bedroom", tools: "outside" };

// The fridge, the washing machine and the like go to the kitchen, unless it's laundry or cooling.
const appliancePlace: Array<[HomeRoom, RegExp]> = [
  ["bathroom", /lave-linge|machine [àa] laver|washing|s[èe]che-linge|dryer|chauffe-eau|water heater/i],
  ["living", /climatiseur|air condition|ventilateur|\bfan\b|aspirateur|vacuum/i],
  ["outside", /groupe [ée]lectrog[èe]ne|generator/i],
];

/** The category a scan most likely shows, from its title and tags; undefined when unsure. */
export function guessCategory(analysis: Pick<Analysis, "title" | "tags">): HomeCategory | undefined {
  const text = [analysis.title, ...analysis.tags].join(" ");
  return categoryWords.find(([, words]) => words.test(text))?.[0];
}

/** The room it most likely stands in, from its category (and a few words for appliances). */
export function guessRoom(analysis: Pick<Analysis, "title" | "tags">, category: HomeCategory | undefined): HomeRoom | undefined {
  if (!category) return undefined;
  const text = [analysis.title, ...analysis.tags].join(" ");
  if (category === "appliance") return appliancePlace.find(([, words]) => words.test(text))?.[0] ?? "kitchen";
  return roomOf[category];
}

const factValue = (analysis: Pick<Analysis, "facts">, label: RegExp) => analysis.facts.find((fact) => label.test(fact.label))?.value.trim() || undefined;

/** What an object scan fills in: the name, the category, the room, the serial number if one was read. */
export function itemFieldsFrom(analysis: Pick<Analysis, "title" | "tags" | "facts">): Pick<HomeItem, "name"> & Partial<Pick<HomeItem, "category" | "room" | "serial">> {
  const category = guessCategory(analysis);
  const room = guessRoom(analysis, category);
  const serial = factValue(analysis, /s[ée]rie|serial|\bs\/n\b|\bsn\b|imei/i);
  return {
    name: analysis.title.trim().slice(0, 60),
    ...(category && { category }),
    ...(room && { room }),
    ...(serial && /\d/.test(serial) && { serial: serial.slice(0, 40) }),
  };
}

