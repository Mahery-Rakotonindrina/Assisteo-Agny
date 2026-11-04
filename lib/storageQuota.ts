// The account's photo storage has a limit, kept by the database (migration
// 0020_quota_photos.sql): an upload past it, or a file over the size of one,
// is refused by Supabase Storage. The app then keeps the photo on the device
// and says so, instead of retrying forever or failing the whole sync.

export type StorageRefusal = "full" | "too_large";

/**
 * Whether an upload error means "the account's storage is full" (the quota
 * policy answers "new row violates row-level security policy"; a bare 403,
 * like an expired session's, is not taken for it) or "this file is too big" (413),
 * as supabase-js reports a StorageError. Anything else (network, session) is
 * not a refusal and null: the sync fails and tries again as usual.
 */
export function storageRefusal(error: unknown): StorageRefusal | null {
  if (!error || typeof error !== "object") return null;
  const { message, status, statusCode } = error as { message?: unknown; status?: unknown; statusCode?: unknown };
  const code = Number(status ?? statusCode);
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (code === 413 || text.includes("exceeded the maximum allowed size") || text.includes("payload too large")) return "too_large";
  if (text.includes("row-level security") || text.includes("row level security")) return "full";
  return null;
}
