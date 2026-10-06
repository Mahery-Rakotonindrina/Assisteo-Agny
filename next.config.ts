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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_COMMIT: appCommit,
  },
  ...(isMobileBuild && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
