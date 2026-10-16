import type { RedeemResponse } from "@/pages/api/offers/redeem";
import type { TrialResponse } from "@/pages/api/offers/trial";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";
import { planStore } from "./plan";

// The offers page's actions for a signed-in account: the Premium trial and
// "I have a code". The server decides; the plan is then fetched again.

export async function startPremiumTrial() {
  const result = await httpClient.post<TrialResponse>("/api/offers/trial", {}, { headers: await authHeaders() });
  await planStore.refresh();
  return result;
}

export async function redeemCode(code: string) {
  const result = await httpClient.post<RedeemResponse>("/api/offers/redeem", { code }, { headers: await authHeaders() });
  if (result.ok) await planStore.refresh();
  return result;
}
