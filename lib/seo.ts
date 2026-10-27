import { LEGAL_UPDATED_AT } from "@/lib/legal";

/** Share preview image (npm run icons), 1200 × 630 as Facebook and WhatsApp expect. */
export const OG_IMAGE = { path: "/og-image.png", width: 1200, height: 630 } as const;

/**
 * Pages worth finding from a search engine. Every other screen shows the
 * user's own data (history, parcels, settings…) and is marked noindex.
 */
export const PUBLIC_PAGES: { path: string; updated?: string }[] = [
  { path: "/" },
  { path: "/plans" },
  { path: "/privacy", updated: LEGAL_UPDATED_AT },
  { path: "/terms", updated: LEGAL_UPDATED_AT },
];

/** Absolute URL of a path on the public site, or null when its address is unknown (local dev). */
export function absoluteUrl(siteUrl: string, path: string) {
  return siteUrl ? `${siteUrl}${path === "/" ? "" : path}` : null;
}

export function robotsTxt(siteUrl: string) {
  const lines = ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /admin"];
  if (siteUrl) lines.push("", `Sitemap: ${siteUrl}/sitemap.xml`);
  return `${lines.join("\n")}\n`;
}

export function sitemapXml(siteUrl: string) {
  const urls = PUBLIC_PAGES.map(({ path, updated }) => {
    const lastmod = updated ? `<lastmod>${updated}</lastmod>` : "";
    return `  <url><loc>${absoluteUrl(siteUrl, path) ?? path}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** JSON for a <script type="application/ld+json">, "<" escaped so the data can never close the tag. */
export function jsonLd(data: object) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** schema.org description of the app for the home page: its name in results, what it is, free to start. */
export function appStructuredData(siteUrl: string, description: string) {
  const url = absoluteUrl(siteUrl, "/") ?? undefined;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "Assisteo Agny", alternateName: "Assisteo", url, inLanguage: "fr" },
      {
        "@type": "WebApplication",
        name: "Assisteo Agny",
        url,
        description,
        image: absoluteUrl(siteUrl, OG_IMAGE.path) ?? undefined,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Android, iOS, Web",
        inLanguage: ["fr", "en"],
        offers: { "@type": "Offer", price: "0", priceCurrency: "MGA" },
      },
    ],
  };
}
