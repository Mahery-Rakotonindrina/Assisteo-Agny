import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

// Error monitoring with Sentry, off unless a DSN is configured. Shared by the
// browser/app (instrumentation-client.ts) and the server (instrumentation.ts).

/**
 * An address without its "?query" and "#fragment": they carry loan-link tokens,
 * e-mails and codes. Works on relative addresses too.
 */
export function stripQuery(url: string) {
  return url.replace(/[?#][^]*$/, "");
}

const URL_KEYS = ["url", "from", "to"];

/** A breadcrumb (page change, fetch call) with its addresses cleaned. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data) {
    const data = { ...breadcrumb.data };
    for (const key of URL_KEYS) if (typeof data[key] === "string") data[key] = stripQuery(data[key]);
    breadcrumb.data = data;
  }
  // Some breadcrumbs carry the address in the message ("GET /api/x?t=…").
  if (breadcrumb.message) breadcrumb.message = breadcrumb.message.replace(/[?#]\S*/g, "");
  return breadcrumb;
}

/**
 * Never send what users send us: requests can carry their own API keys
 * (x-ai-* headers), session tokens and photos (body).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = stripQuery(event.request.url);
  }
  if (event.transaction) event.transaction = stripQuery(event.transaction);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
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
  beforeBreadcrumb: scrubBreadcrumb,
});
