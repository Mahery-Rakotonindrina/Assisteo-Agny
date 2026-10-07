import type { NextApiRequest, NextApiResponse } from "next";
import { getAppVersionConfig, type AppVersionConfig } from "@/lib/server/appVersionStore";
import { applyCors, sendError } from "@/lib/server/http";

export type AppVersionResponse = AppVersionConfig;

/** Public: the minimum and latest app versions, checked by the native apps at launch. */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AppVersionResponse | unknown>) {
  if (applyCors(req, res, ["GET"])) return;
  if (req.method !== "GET") return sendError(res, 405, "method_not_allowed", "Use GET.");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  return res.status(200).json(await getAppVersionConfig());
}
