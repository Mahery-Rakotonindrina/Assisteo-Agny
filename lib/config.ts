export const config = {
  // Empty on the web build (same-origin API routes); the deployed web URL on
  // the mobile build, whose static export has no API routes.
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, ""),
  appVersion: "1.0.0",
} as const;
