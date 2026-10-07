import type { ErrorEvent } from "@sentry/nextjs";

// Error monitoring with Sentry, off unless a DSN is configured. Shared by the
// browser/app (instrumentation-client.ts) and the server (instrumentation.ts).

/**
 * Never send what users send us: requests can carry their own API keys
 * (x-ai-* headers), session tokens and photos (body).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
  }
  if (event.user) event.user = { id: event.user.id };
  return event;
}

export const sentryOptions = (dsn: string) => ({
  dsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
  release: `assisteo-agny@${process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}`,
  sendDefaultPii: false,
  // Errors only: no performance tracing, to stay within the free plan.
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
});
