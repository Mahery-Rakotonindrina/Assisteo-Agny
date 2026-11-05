import { z } from "zod";

// Lists and parcels shared with the household (table "household_shares",
// migration 0023). A shared list moves out of the personal ones while shared
// (every member ticks and adds); a shared parcel is a copy kept up to date by
// its author, read only for the others and without what it cost. Pure, so it
// can be tested; the stores are services/sharedLists.ts and sharedParcels.ts.

export const LIST_SHARE_PREFIX = "list:";
export const PARCEL_SHARE_PREFIX = "parcel:";

/** The row of a list shared: "list:<id>". */
export const listShareId = (listId: string) => (listId.startsWith(LIST_SHARE_PREFIX) ? listId : `${LIST_SHARE_PREFIX}${listId}`);
/** Back to the personal list's id. */
export const listIdOfShare = (shareId: string) => (shareId.startsWith(LIST_SHARE_PREFIX) ? shareId.slice(LIST_SHARE_PREFIX.length) : shareId);
export const parcelShareId = (parcelId: string) => `${PARCEL_SHARE_PREFIX}${parcelId}`;

/** Whether this shared record is the user's own (the only one who stops sharing it). */
export function isOwnShare(record: { userId?: string }, me: string | null) {
  return !record.userId || record.userId === me;
}

const item = z.object({
  id: z.string().max(80),
  text: z.string().max(200),
  quantity: z.string().max(60).optional(),
  priceMga: z.number().nonnegative().optional(),
  done: z.boolean(),
});

const sharedListSchema = z.object({
  id: z.string().startsWith(LIST_SHARE_PREFIX).max(120),
  title: z.string().max(200),
  kind: z.enum(["shopping", "todo", "other"]),
  items: z.array(item).max(500),
  thumbnail: z.string().max(60_000).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  householdId: z.string().optional(),
  userId: z.string().optional(),
  dirty: z.boolean().optional(),
});

export type SharedListRecord = z.infer<typeof sharedListSchema>;

/** A list read from another member: kept only when well formed (the scan link stays theirs). */
export function acceptSharedList(record: unknown): SharedListRecord | null {
  const parsed = sharedListSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

const timelineEntry = z.object({
  at: z.number(),
  status: z.string(),
  statusLabel: z.string().max(200),
  event: z.object({ description: z.string().max(400), location: z.string().max(200).nullable(), at: z.string().max(40).nullable() }).nullable(),
});

const sharedParcelSchema = z.object({
  id: z.string().startsWith(PARCEL_SHARE_PREFIX).max(120),
  sourceId: z.string().max(80),
  title: z.string().max(200),
  shippingMode: z.enum(["air", "sea"]).optional(),
  thumbnail: z.string().max(60_000).optional(),
  info: z.record(z.string(), z.unknown()),
  timeline: z.array(timelineEntry).max(200),
  receivedAt: z.number().optional(),
  createdAt: z.number(),
  /** When the author's parcel last changed: the copy is written again after. */
  sourceUpdatedAt: z.number(),
  updatedAt: z.number(),
  householdId: z.string().optional(),
  userId: z.string().optional(),
  dirty: z.boolean().optional(),
});

export type SharedParcelRecord = z.infer<typeof sharedParcelSchema>;

export function acceptSharedParcel(record: unknown): SharedParcelRecord | null {
  const parsed = sharedParcelSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

type ParcelLike = {
  id: string;
  title: string;
  shippingMode?: "air" | "sea";
  thumbnail?: string;
  info: object;
  timeline: Array<{ at: number; status: string; statusLabel: string; event: { description: string; location: string | null; at: string | null } | null }>;
  receivedAt?: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * What the household sees of a parcel: where it is. Never what it cost
 * (price, fees, sale, payments), the reseller's client (name, number), nor
 * the links to the author's scans.
 */
export function parcelSnapshot(parcel: ParcelLike, householdId: string, me: string): Omit<SharedParcelRecord, "updatedAt"> {
  return {
    id: parcelShareId(parcel.id),
    sourceId: parcel.id,
    title: parcel.title,
    ...(parcel.shippingMode && { shippingMode: parcel.shippingMode }),
    ...(parcel.thumbnail && parcel.thumbnail.length <= 60_000 && { thumbnail: parcel.thumbnail }),
    info: { ...parcel.info } as Record<string, unknown>,
    timeline: parcel.timeline.map(({ at, status, statusLabel, event }) => ({ at, status, statusLabel, event })),
    ...(parcel.receivedAt && { receivedAt: parcel.receivedAt }),
    createdAt: parcel.createdAt,
    sourceUpdatedAt: parcel.updatedAt,
    householdId,
    userId: me,
  };
}

/**
 * What the author's device does with its shared copies after a change of
 * its parcels: write again those whose parcel changed, stop those whose
 * parcel is gone. The others' copies are left alone.
 */
export function parcelShareUpdates<T extends ParcelLike>(shares: SharedParcelRecord[], parcels: T[], me: string | null) {
  const byId = new Map(parcels.map((parcel) => [parcel.id, parcel]));
  const rewrite: T[] = [];
  const stop: string[] = [];
  for (const share of shares) {
    if (!isOwnShare(share, me)) continue;
    const parcel = byId.get(share.sourceId);
    if (!parcel) stop.push(share.id);
    else if (parcel.updatedAt > share.sourceUpdatedAt) rewrite.push(parcel);
  }
  return { rewrite, stop };
}
