export const config = {
  // Empty on the web build (same-origin API routes); the deployed web URL on
  // the mobile build, whose static export has no API routes.
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, ""),
  // Injected at build time by next.config.ts (see there for the sources).
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  appCommit: process.env.NEXT_PUBLIC_APP_COMMIT ?? "",
  // Shown on the privacy policy and terms (required by the app stores).
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
  // Who publishes the app, as it should appear publicly (e.g. "Jane Doe, Antananarivo, Madagascar").
  publisher: process.env.NEXT_PUBLIC_PUBLISHER ?? "",
} as const;
