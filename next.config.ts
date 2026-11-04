import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { bootScript, scriptHash } from "./lib/bootScript";

// Version shown in Settings: the APK's own version name on CI mobile builds
// (1.0.<run>), otherwise package.json, plus the deployed commit when known.
const packageVersion = JSON.parse(readFileSync("./package.json", "utf8")).version as string;
const appVersion = process.env.ANDROID_VERSION_NAME ?? packageVersion;
const appCommit = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "").slice(0, 7);
// Public address used in canonical links, share previews and the sitemap:
// NEXT_PUBLIC_SITE_URL when set, else the Vercel production domain (a custom
// domain once one is added), else the API URL of the mobile build.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

// Two build targets share one codebase:
// - "web" (default): a regular Next.js server that also hosts the AI API routes.
// - "mobile": a static export bundled into the Capacitor shell. API routes are
//   skipped by the exporter, so the app calls the deployed web build instead
//   (see NEXT_PUBLIC_API_URL).
const isMobileBuild = process.env.BUILD_TARGET === "mobile";
const isDev = process.env.NODE_ENV === "development";

/** Origin of an optional URL setting, or null. */
function originOf(value: string | undefined) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

// Content Security Policy for the web app. No inline script runs but the
// one of pages/_document.tsx, allowed by its hash: the Pages Router's own
// data (__NEXT_DATA__) is JSON, never run. A nonce would need every page
// rendered per request. Inline styles stay allowed: motion writes them.
// Network access is limited to our API, Supabase (auth, data, photos,
// realtime) and Sentry when configured.
function contentSecurityPolicy() {
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const sentry = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN?.replace(/\/\/[^@]+@/, "//"));
  const connect = ["'self'", supabase, supabase?.replace(/^https:/, "wss:"), sentry, isDev && "ws:"].filter(Boolean);
  const directives = {
    "default-src": ["'self'"],
    // 'wasm-unsafe-eval' lets the QR code reader compile its WebAssembly (not JavaScript eval).
    // In development, Next's own tooling still runs inline scripts.
    "script-src": ["'self'", isDev ? "'unsafe-inline'" : scriptHash(bootScript), "'wasm-unsafe-eval'", isDev && "'unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabase],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.filter(Boolean).join(" ")}`)
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_COMMIT: appCommit,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  },
  // Static exports can't set headers (and the native app isn't served over HTTP).
  ...(!isMobileBuild && {
    async headers() {
      return [
        { source: "/(.*)", headers: securityHeaders },
        // The service worker (public/sw.js): always checked again, so a new build takes over at the next visit.
        // Its scope is the whole site; worker-src 'self' above allows it.
        {
          source: "/sw.js",
          headers: [
            { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
            { key: "Service-Worker-Allowed", value: "/" },
          ],
        },
      ];
    },
    // Search engines look for these at the root; the API routes build them.
    async rewrites() {
      return [
        { source: "/robots.txt", destination: "/api/seo/robots" },
        { source: "/sitemap.xml", destination: "/api/seo/sitemap" },
      ];
    },
  }),
  ...(isMobileBuild && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
