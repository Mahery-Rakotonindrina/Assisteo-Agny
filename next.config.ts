import type { NextConfig } from "next";
import { locales, defaultLocale } from "./i18n.config";

const nextConfig: NextConfig = {
  i18n: {
    locales: [...locales],
    defaultLocale,
  },
};

export default nextConfig;
