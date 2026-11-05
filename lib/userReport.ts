import { z } from "zod";

// "Give my feedback / Report a problem" (Settings). The message travels with
// the screen, the app version and the device, never a screenshot (too heavy for 3G).

export const REPORT_MESSAGE_MAX = 1000;
export const reportKinds = ["idea", "problem"] as const;
export const reportStatuses = ["new", "read", "done"] as const;
export type ReportKind = (typeof reportKinds)[number];
export type ReportStatus = (typeof reportStatuses)[number];

export const UserReportSchema = z.object({
  kind: z.enum(reportKinds),
  message: z.string().trim().min(5).max(REPORT_MESSAGE_MAX),
  /** Optional way to answer when nobody is signed in. */
  contact: z.string().trim().max(120).optional(),
  /** The screen the person came from, e.g. "/parcels". */
  screen: z.string().trim().max(60).optional(),
  appVersion: z.string().trim().max(40).optional(),
  device: z.string().trim().max(120).optional(),
});
export type UserReportRequest = z.infer<typeof UserReportSchema>;

export type UserReport = {
  id: string;
  at: number;
  status: ReportStatus;
  kind: ReportKind;
  message: string;
  /** The signed-in account's confirmed e-mail, if any. */
  email: string | null;
  contact: string | null;
  screen: string | null;
  appVersion: string | null;
  device: string | null;
};

export type AdminReportsResponse = { reports: UserReport[] };
export const ReportStatusSchema = z.object({ id: z.string().min(1).max(60), status: z.enum(reportStatuses) });

/** A short, readable device label from a user agent: "Android 14 · Chrome". */
export function deviceLabel(userAgent: string, platform: string): string {
  // Most specific first: an Android user agent also says "Linux", an Edge one also says "Chrome".
  const first = (patterns: RegExp[]) => patterns.map((pattern) => userAgent.match(pattern)?.[0]).find(Boolean);
  const os = first([/Android [\d.]+/, /iPhone OS [\d_]+/, /Windows NT [\d.]+/, /Mac OS X [\d_.]+/, /Linux/])?.replace(/_/g, ".") ?? "";
  const browser = [
    [/Edg\//, "Edge"],
    [/OPR\//, "Opera"],
    [/Firefox\//, "Firefox"],
    [/Chrome\//, "Chrome"],
    [/Safari\//, "Safari"],
  ].find(([pattern]) => (pattern as RegExp).test(userAgent))?.[1] as string | undefined ?? "";
  return [platform, os, browser].filter(Boolean).join(" · ").slice(0, 120);
}
