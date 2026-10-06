import type { NextConfig } from "next";

// Two build targets share one codebase:
// - "web" (default): a regular Next.js server that also hosts the AI API routes.
// - "mobile": a static export bundled into the Capacitor shell. API routes are
//   skipped by the exporter, so the app calls the deployed web build instead
//   (see NEXT_PUBLIC_API_URL).
const isMobileBuild = process.env.BUILD_TARGET === "mobile";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isMobileBuild && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
