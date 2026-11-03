// An e-mail is an identity (plan, family seat, admin) only once Supabase says
// it was confirmed: with "Confirm email" off, anyone could sign up with a
// password for an address that is not theirs and inherit what it was given.
// The sign-in by code confirms it by itself, so the app's own users pass.

const CONFIRMED_MS = 10 * 60_000;
const UNCONFIRMED_MS = 30_000;

type Entry = { confirmed: boolean; until: number };
const cache = new Map<string, Entry>();

/**
 * Whether the account's e-mail is confirmed, by `lookup` (the Auth admin API),
 * remembered for a few minutes. If the lookup fails, a confirmation seen
 * before still counts; otherwise the e-mail is not trusted.
 */
export async function emailConfirmed(userId: string, lookup: (userId: string) => Promise<boolean>, now = Date.now()) {
  const known = cache.get(userId);
  if (known && known.until > now) return known.confirmed;
  try {
    const confirmed = await lookup(userId);
    if (cache.size > 5000) for (const [key, entry] of cache) if (entry.until <= now) cache.delete(key);
    cache.set(userId, { confirmed, until: now + (confirmed ? CONFIRMED_MS : UNCONFIRMED_MS) });
    return confirmed;
  } catch {
    return known?.confirmed === true;
  }
}

/** For the tests. */
export function forgetConfirmations() {
  cache.clear();
}
