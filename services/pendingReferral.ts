import { inviteCodeFrom } from "@/lib/offers";

// A referral code received by an invitation link (/plans?ref=CODE), kept on
// this device until the person is signed in and has entered it. It is only
// ever shown in the "I have a code" field: the server judges it.

const KEY = "pending-referral.v1";

/** Keeps a code that passed the format check. */
export function keepPendingReferral(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Private mode: the code stays in the address until the page is closed.
  }
}

/** The kept code (checked again when read), or null. */
export async function pendingReferral(): Promise<string | null> {
  try {
    return inviteCodeFrom(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearPendingReferral() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}
