import type { NextApiRequest, NextApiResponse } from "next";
import { AnalysisError } from "@/lib/ai/errors";
import { mockPlantDiagnosis } from "@/lib/ai/plantDiagnosisDemo";
import { activeProvider, diagnosePlant } from "@/lib/ai/provider";
import { PlantDiagnosisRequestSchema, type PlantDiagnosisResponse } from "@/lib/ai/schema";
import { applyCors, clientIp, sendError } from "@/lib/server/http";
import { limitsFor, resolvePlan } from "@/lib/server/plan";
import { rateLimit } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/reportError";
import { track } from "@/lib/server/stats";
import { countServerCall, releasePlanScan, releaseServerCall, reservePlanScan } from "@/lib/server/trialStore";

export const config = {
  // A resized JPEG is usually < 1 MB, but leave room for the 5 MB image cap.
  api: { bodyParser: { sizeLimit: "7mb" } },
  maxDuration: 60,
};

const DEMO_LATENCY_MS = 1000;

/**
 * "Mes plantes": what is wrong with a plant, from a photo of a leaf or of the
 * plant. Signed in with the "plants" feature; it counts as one of the
 * month's scans, given back when the AI fails. The photo is read and forgotten.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<PlantDiagnosisResponse | unknown>) {
  if (applyCors(req, res, ["POST"])) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendError(res, 405, "method_not_allowed", "Use POST.");
  }

  const burst = await rateLimit(`plant-diagnosis:${clientIp(req)}`, 6, 60_000);
  if (!burst.ok) {
    res.setHeader("Retry-After", String(burst.retryAfterS));
    return sendError(res, 429, "rate_limited", "Too many photos, try again in a moment.");
  }

  const parsed = PlantDiagnosisRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");

  // Demo mode (no AI key on the server): a sample diagnosis, like the demo scans.
  if (activeProvider === "demo") {
    await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
    return res.status(200).json({ diagnosis: mockPlantDiagnosis(parsed.data.locale), model: "demo", demo: true } satisfies PlantDiagnosisResponse);
  }

  const { account, current, features, quotas } = await resolvePlan(req);
  if (!account) return sendError(res, 401, "sign_in_required", "Sign in to check a plant.");
  if (!features.has("plants")) return sendError(res, 403, "plan_required", "My plants are not part of your plan.");

  // One of the month's scans (none is refused on the Admin plan).
  const { scans } = await limitsFor(current.plan, undefined, quotas, features);
  const quota = await reservePlanScan(account.id, scans);
  if (!quota) {
    await track({ type: "error", route: "plant-diagnosis", code: "plan_limit" });
    return sendError(res, 403, "plan_limit", "This month's scans are used up.");
  }
  await countServerCall();

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { diagnosis, model, usage } = await diagnosePlant(parsed.data, abort.signal);
    if (usage) await track({ type: "ai", kind: "plant", model, ...usage });
    return res.status(200).json({ diagnosis, model, demo: false, quota } satisfies PlantDiagnosisResponse);
  } catch (error) {
    // A failed or cancelled diagnosis gives the month's scan back.
    await Promise.all([releasePlanScan(account.id), releaseServerCall()]).catch(() => undefined);
    if (abort.signal.aborted) return;
    await track({ type: "error", route: "plant-diagnosis", code: error instanceof AnalysisError ? error.code : "upstream_error" });
    if (error instanceof AnalysisError) {
      if (error.code === "invalid_key") return sendError(res, 503, "unavailable", "The AI service is not configured correctly.");
      if (error.status >= 500) {
        console.error(`[plant-diagnosis:${activeProvider}]`, error.message);
        await reportError(error, { route: "plant-diagnosis", engine: activeProvider, code: error.code });
      }
      return sendError(res, error.status, error.code, error.message);
    }
    console.error("[plant-diagnosis] unexpected", error instanceof Error ? error.message : error);
    await reportError(error, { route: "plant-diagnosis", kind: "unexpected" });
    return sendError(res, 500, "upstream_error", "Something went wrong.");
  }
}
