import { clear, createStore, del, get, set, values } from "idb-keyval";
import { config } from "@/lib/config";
import { sameSnapshot, shareSnapshot, shareUrl, type LoanShareAction, type LoanShareSnapshot, type LoanShareStatus } from "@/lib/loanShare";
import { personKey, type Loan } from "@/lib/loans";
import { ApiError } from "@/types/api";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";

// "Partager ce qu'il reste à rendre" on the lender's device: the live links
// (asked to the server, pages/api/loans/share.ts), the token of each link made
// here (the server keeps only its hash: the link can be shown again on this
// device only), and the copy written again whenever that person's loans change.

export type SharingState =
  /** Not asked yet, or offline. */
  | { kind: "unknown" }
  | { kind: "signedOut" }
  /** The account's plan has no "Prêts". */
  | { kind: "off" }
  /** Migration 0012 not applied: "bientôt disponible". */
  | { kind: "soon"; household: boolean }
  | { kind: "ready"; household: boolean; live: Record<string, { lender: string }> };

/** A link made on this device. */
type LocalShare = { person: string; token: string; lender: string; createdAt: number };

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-loan-shares", "shares"));

let state: SharingState = { kind: "unknown" };
let asking: Promise<void> | null = null;
let askedFor: string | null = null;
// The copy last written for each person in this session.
const written = new Map<string, LoanShareSnapshot>();
// The people seen with money lent on this device in this session: once all
// their loans are gone (removed here, or synced from another device), the
// device knows it is a removal and not a list not synced yet.
const seen = new Set<string>();
const listeners = new Set<() => void>();

function publish(next: SharingState) {
  state = next;
  listeners.forEach((listener) => listener());
}

const post = async <T>(action: LoanShareAction) => httpClient.post<T>("/api/loans/share", action, { headers: await authHeaders() });

/** Where the links point: the public site (also from the app, whose own pages aren't on the web). */
function linkBase() {
  return config.siteUrl || config.apiBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
}

const isSoon = (error: unknown) => error instanceof ApiError && error.code === "unavailable";

export const loanSharing = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => state,

  /** Asks the server once per account (again with `force`). Offline, the state stays unknown. */
  ensure(userId: string | null, force = false) {
    if (!userId) {
      askedFor = null;
      if (state.kind !== "signedOut") publish({ kind: "signedOut" });
      return Promise.resolve();
    }
    if (!force && askedFor === userId && (asking || state.kind !== "unknown")) return asking ?? Promise.resolve();
    askedFor = userId;
    asking = (async () => {
      try {
        const status = await post<LoanShareStatus>({ action: "status" });
        publish(status.ready ? { kind: "ready", household: status.household, live: Object.fromEntries(status.shares.map((share) => [share.person, { lender: share.lender }])) } : { kind: "soon", household: status.household });
      } catch (error) {
        if (error instanceof ApiError && error.code === "sign_in_required") publish({ kind: "signedOut" });
        else if (isSoon(error)) publish({ kind: "soon", household: false });
        else if (error instanceof ApiError && error.code === "plan_required") publish({ kind: "off" });
        // Offline: asked again next time.
        else publish({ kind: "unknown" });
      } finally {
        asking = null;
      }
    })();
    return asking;
  },

  /** The link made on this device for that person, if still live. */
  async link(person: string) {
    const local = await get<LocalShare>(person, db()).catch(() => undefined);
    if (!local || state.kind !== "ready" || !state.live[person]) return null;
    return shareUrl(linkBase(), local.token);
  },

  /** A new link (an earlier one stops working). Throws an ApiError the screen explains; "unavailable": not yet. */
  async create(person: string, lender: string, loans: Loan[]) {
    const snapshot = shareSnapshot(loans, person, lender, Date.now());
    if (!snapshot) return null;
    try {
      const { token } = await post<{ token: string }>({ action: "create", person, snapshot });
      await set(person, { person, token, lender: snapshot.lender, createdAt: Date.now() } satisfies LocalShare, db());
      written.set(person, snapshot);
      if (state.kind === "ready") publish({ ...state, live: { ...state.live, [person]: { lender: snapshot.lender } } });
      return shareUrl(linkBase(), token);
    } catch (error) {
      if (isSoon(error) && state.kind !== "soon") publish({ kind: "soon", household: state.kind === "ready" && state.household });
      throw error;
    }
  },

  /** "Arrêter le partage": the link then says it is no longer active. */
  async stop(person: string) {
    await post({ action: "revoke", person });
    await del(person, db()).catch(() => undefined);
    written.delete(person);
    if (state.kind === "ready") {
      const live = { ...state.live };
      delete live[person];
      publish({ ...state, live });
    }
  },

  /**
   * "Remettre à zéro" of the loans: every live link stopped, like "Arrêter le
   * partage". False when the server can't be reached (offline) while links may
   * be live: nothing should be removed then. Signed out, or before migration
   * 0012, there is no link to stop.
   */
  async stopAll() {
    // Asked again: a link may have been made on another device since.
    await loanSharing.ensure(askedFor ?? "device", true);
    // Unknown: offline (the server alone knows the links).
    if (state.kind === "unknown") return false;
    if (state.kind !== "ready") return true;
    const results = await Promise.allSettled(Object.keys(state.live).map((person) => loanSharing.stop(person)));
    return results.every((result) => result.status === "fulfilled");
  },

  /** The loans on the device when the app starts: who has money lent, before anything changes. */
  saw(loans: Loan[]) {
    for (const loan of loans) if (!loan.deletedAt && loan.direction === "lent") seen.add(personKey(loan.person));
  },

  /**
   * The loans changed (here, or synced from another device): each link shows
   * the new copy. A person with no money lent left (their loans removed,
   * renamed, or turned into "Je dois") has their link stopped. When the device
   * has no loan at all, only if it knew that person's loans (seen in this
   * session, or the link made here): a device signed in for the first time,
   * before its loans are synced, stops nothing.
   */
  async refresh(loans: Loan[]) {
    if (state.kind !== "ready") return;
    for (const [person, { lender }] of Object.entries(state.live)) {
      // A copy without the lender's name can't be written again: left as it is.
      if (!lender.trim()) continue;
      const snapshot = shareSnapshot(loans, person, lender, Date.now());
      try {
        if (!snapshot) {
          const known = loans.length > 0 || written.has(person) || seen.has(person) || Boolean(await get<LocalShare>(person, db()).catch(() => undefined));
          if (known) await loanSharing.stop(person);
          continue;
        }
        seen.add(person);
        if (sameSnapshot(snapshot, written.get(person))) continue;
        await post({ action: "update", person, snapshot });
        written.set(person, snapshot);
      } catch (error) {
        console.warn("[loan shares]", error instanceof Error ? error.message : error);
        return;
      }
    }
  },

  /** Signing out or deleting the account. */
  async wipe() {
    written.clear();
    seen.clear();
    askedFor = null;
    await clear(db()).catch(() => undefined);
    publish({ kind: "signedOut" });
  },

  /** For the tests. */
  localShares: () => values<LocalShare>(db()),
};
