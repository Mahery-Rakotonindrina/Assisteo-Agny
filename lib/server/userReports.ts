import { randomBytes } from "node:crypto";
import { redis } from "./redis";
import type { ReportStatus, UserReport } from "@/lib/userReport";

// Feedback and problem reports, read in Admin. A Redis hash (id -> report) so
// one report can change state; process memory without Redis. Capped: the
// oldest drop off, so a flood never fills the database.

const KEY = "reports:items";
export const REPORTS_MAX = 300;

let memory = new Map<string, UserReport>();

const parse = (item: UserReport | string) => (typeof item === "string" ? (JSON.parse(item) as UserReport) : item);

/** Newest-first order: the id starts with the time. */
const newestFirst = (a: UserReport, b: UserReport) => b.at - a.at || (a.id < b.id ? 1 : -1);

export async function addUserReport(fields: Omit<UserReport, "id" | "at" | "status">, at = Date.now()): Promise<UserReport> {
  const report: UserReport = { id: `${at}-${randomBytes(3).toString("hex")}`, at, status: "new", ...fields };
  if (!redis) {
    memory.set(report.id, report);
    const extra = [...memory.values()].sort(newestFirst).slice(REPORTS_MAX);
    for (const old of extra) memory.delete(old.id);
    return report;
  }
  await redis.hset(KEY, { [report.id]: report });
  if ((await redis.hlen(KEY)) > REPORTS_MAX) {
    const ids = (await redis.hkeys(KEY)).sort().slice(0, -REPORTS_MAX);
    if (ids.length > 0) await redis.hdel(KEY, ...ids);
  }
  return report;
}

/** Every report kept, newest first. */
export async function readUserReports(): Promise<UserReport[]> {
  if (!redis) return [...memory.values()].sort(newestFirst);
  const all = await redis.hgetall<Record<string, UserReport | string>>(KEY);
  return Object.values(all ?? {}).map(parse).sort(newestFirst);
}

/** Changes a report's state; false when it is gone. */
export async function setUserReportStatus(id: string, status: ReportStatus): Promise<boolean> {
  if (!redis) {
    const report = memory.get(id);
    if (!report) return false;
    memory.set(id, { ...report, status });
    return true;
  }
  const found = await redis.hget<UserReport | string>(KEY, id);
  if (!found) return false;
  await redis.hset(KEY, { [id]: { ...parse(found), status } });
  return true;
}

/** Tests only: forget the in-memory reports. */
export function resetUserReports() {
  memory = new Map();
}
