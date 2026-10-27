import type { NextApiRequest, NextApiResponse } from "next";
import { config } from "@/lib/config";
import { sitemapXml } from "@/lib/seo";

/** Served at /sitemap.xml (rewrite in next.config.ts). */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.status(200).send(sitemapXml(config.siteUrl));
}
