export const config = {
  // Empty on the web build (same-origin API routes); the deployed web URL on
  // the mobile build, whose static export has no API routes.
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, ""),
  // Public web address (canonical links, share previews, sitemap); empty in local dev.
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""),
  // Injected at build time by next.config.ts (see there for the sources).
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  appCommit: process.env.NEXT_PUBLIC_APP_COMMIT ?? "",
  // Shown on the privacy policy and terms (required by the app stores).
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
  // Who publishes the app, as it should appear publicly (e.g. "Jane Doe, Antananarivo, Madagascar").
  publisher: process.env.NEXT_PUBLIC_PUBLISHER ?? "",
  // Google Search Console ownership check (HTML tag method). Public by design:
  // Google reads it in the page. The owner's token unless the variable replaces it.
  googleSiteVerification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "D2MVTKdAVrBWA57VU87vxc1S1lACXHBkd4hjvEf52no",
} as const;
