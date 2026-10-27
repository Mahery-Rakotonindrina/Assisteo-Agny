import type { NextApiRequest, NextApiResponse } from "next";
import { config } from "@/lib/config";
import { robotsTxt } from "@/lib/seo";

/** Served at /robots.txt (rewrite in next.config.ts). */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.status(200).send(robotsTxt(config.siteUrl));
}
