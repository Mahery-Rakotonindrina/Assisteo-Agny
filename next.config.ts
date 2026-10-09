import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Version shown in Settings: the APK's own version name on CI mobile builds
// (1.0.<run>), otherwise package.json, plus the deployed commit when known.
const packageVersion = JSON.parse(readFileSync("./package.json", "utf8")).version as string;
const appVersion = process.env.ANDROID_VERSION_NAME ?? packageVersion;
const appCommit = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "").slice(0, 7);

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

// Content Security Policy for the web app. Inline scripts and styles stay
// allowed: the Pages Router, styled-jsx and motion need them (Next's
// "without nonces" setup). Network access is limited to our API, Supabase
// (auth, data, photos, realtime) and Sentry when configured.
function contentSecurityPolicy() {
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const sentry = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN?.replace(/\/\/[^@]+@/, "//"));
  const connect = ["'self'", supabase, supabase?.replace(/^https:/, "wss:"), sentry, isDev && "ws:"].filter(Boolean);
  const directives = {
    "default-src": ["'self'"],
    // 'wasm-unsafe-eval' lets the QR code reader compile its WebAssembly (not JavaScript eval).
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", isDev && "'unsafe-eval'"],
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
  },
  // Static exports can't set headers (and the native app isn't served over HTTP).
  ...(!isMobileBuild && {
    async headers() {
      return [{ source: "/(.*)", headers: securityHeaders }];
    },
  }),
  ...(isMobileBuild && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
