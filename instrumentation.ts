import type { Instrumentation } from "next";

// Server error monitoring, only when SENTRY_DSN (or the public DSN) is set.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  const [Sentry, { sentryOptions }] = await Promise.all([import("@sentry/nextjs"), import("@/lib/monitoring")]);
  Sentry.init(sentryOptions(dsn));
}

/** Errors thrown while rendering pages or running API routes. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
