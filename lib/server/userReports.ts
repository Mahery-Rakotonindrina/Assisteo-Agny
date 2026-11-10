import { randomBytes } from "node:crypto";
import { redis } from "./redis";
import type { ReportStatus, UserReport } from "@/lib/userReport";

// Feedback and problem reports, read in Admin. A Redis hash (id -> report) so
// one report can change state; process memory without Redis. Kept 12 months
// at most (they hold an e-mail or a contact), capped, and erased with the
// account that sent them.

const KEY = "reports:items";
export const REPORTS_MAX = 300;
/** A report older than this is erased (when the list is read or grows). */
export const REPORTS_KEEP_MS = 365 * 24 * 60 * 60_000;

/** A report as stored: the account that sent it (to erase it with the account), never shown in Admin. */
export type StoredReport = UserReport & { accountId: string | null };

let memory = new Map<string, StoredReport>();

const parse = (item: StoredReport | string) => (typeof item === "string" ? (JSON.parse(item) as StoredReport) : item);

/** Newest-first order: the id starts with the time. */
const newestFirst = (a: StoredReport, b: StoredReport) => b.at - a.at || (a.id < b.id ? 1 : -1);

/** What Admin gets: the report without the account id. */
export const publicReport = ({ accountId: _accountId, ...report }: StoredReport): UserReport => report;

async function readAll(): Promise<StoredReport[]> {
  if (!redis) return [...memory.values()];
  const all = await redis.hgetall<Record<string, StoredReport | string>>(KEY);
  return Object.values(all ?? {}).map(parse);
}

async function remove(ids: string[]) {
  if (ids.length === 0) return;
  if (!redis) {
    for (const id of ids) memory.delete(id);
    return;
  }
  await redis.hdel(KEY, ...ids);
}

/** Beyond the cap, the ones handled go first (done, then read), the unread ones last: a flood can't push out what nobody has seen. */
const evictionRank = { done: 0, read: 1, new: 2 } as const;

/** Erases the reports older than 12 months, and beyond the cap the handled ones first, the oldest first. Returns the ones kept, newest first. */
async function prune(now: number): Promise<StoredReport[]> {
  const all = (await readAll()).sort(newestFirst);
  const fresh = all.filter((report) => report.at > now - REPORTS_KEEP_MS);
  const evicted = new Set(
    [...fresh]
      .sort((a, b) => evictionRank[a.status] - evictionRank[b.status] || a.at - b.at)
      .slice(0, Math.max(0, fresh.length - REPORTS_MAX))
      .map((report) => report.id),
  );
  const kept = fresh.filter((report) => !evicted.has(report.id));
  const keptIds = new Set(kept.map((report) => report.id));
  await remove(all.filter((report) => !keptIds.has(report.id)).map((report) => report.id));
  return kept;
}

export async function addUserReport(fields: Omit<StoredReport, "id" | "at" | "status">, at = Date.now()): Promise<UserReport> {
  const report: StoredReport = { id: `${at}-${randomBytes(3).toString("hex")}`, at, status: "new", ...fields };
  if (redis) await redis.hset(KEY, { [report.id]: report });
  else memory.set(report.id, report);
  await prune(Date.now());
  return publicReport(report);
}

/** Every report kept, newest first (without the account id). */
export async function readUserReports(now = Date.now()): Promise<UserReport[]> {
  return (await prune(now)).map(publicReport);
}

/** Changes a report's state; false when it is gone. */
export async function setUserReportStatus(id: string, status: ReportStatus): Promise<boolean> {
  if (!redis) {
    const report = memory.get(id);
    if (!report) return false;
    memory.set(id, { ...report, status });
    return true;
  }
  const found = await redis.hget<StoredReport | string>(KEY, id);
  if (!found) return false;
  await redis.hset(KEY, { [id]: { ...parse(found), status } });
  return true;
}

/** The reports sent by an account (for the copy of its data), newest first. */
export async function userReportsOf(accountId: string): Promise<UserReport[]> {
  const mine = (await readAll()).filter((report) => report.accountId === accountId).sort(newestFirst);
  return mine.map(publicReport);
}

/** Erases every report sent by an account (account deletion). */
export async function deleteUserReportsOf(accountId: string) {
  const mine = (await readAll()).filter((report) => report.accountId === accountId);
  await remove(mine.map((report) => report.id));
}

/** Tests only: forget the in-memory reports. */
export function resetUserReports() {
  memory = new Map();
}
