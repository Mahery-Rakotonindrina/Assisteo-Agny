// Sends a handled server error to Sentry (when configured) and waits briefly
// for delivery: serverless functions may freeze right after responding.
const enabled = Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN);

export async function reportError(error: unknown, tags: Record<string, string>) {
  if (!enabled) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { tags });
    await Sentry.flush(2000);
  } catch {
    // Monitoring must never break a request.
  }
}
