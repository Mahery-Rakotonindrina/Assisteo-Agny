import { z } from "zod";

// "Invite a friend: you each win some scans". The settings (set in Admin) and
// the pure rules; the server keeps the counters (lib/server/referralBonus.ts).

export type ReferralConfig = {
  /** Scans each of the two people wins (0 = the bonus is off). */
  scans: number;
  /** Friends a referrer can be rewarded for, per month (0 = none). */
  capPerMonth: number;
};

export const defaultReferralConfig: ReferralConfig = { scans: 5, capPerMonth: 10 };

export const ReferralConfigSchema = z.object({
  scans: z.number().int().min(0).max(100),
  capPerMonth: z.number().int().min(0).max(1000),
});

/** Rewards given for one address over 30 days: a mobile network puts many people behind one, so a few, not one. */
export const REWARDS_PER_IP = 3;

/** What the referrer's screen shows (Offers page). */
export type ReferralSummary = {
  /** Friends who entered the code. */
  invited: number;
  /** Of them, those who scanned (and so won). */
  rewarded: number;
  /** Scans won in total, as a referrer or as a friend. */
  scansWon: number;
  /** Scans still to use. */
  scansLeft: number;
  /** What each of the two wins, as set in Admin (0: the bonus is off). */
  scansEach: number;
  /** Friends a referrer is rewarded for, per month (Admin). */
  capPerMonth: number;
  /** This month's cap is reached: friends still win, the referrer no more until next month. */
  capReached: boolean;
};

/** Why a first scan did not give the bonus (for tests and the counters). */
export type ReferralRefusal = "no_referrer" | "off" | "already" | "self" | "install" | "ip";
