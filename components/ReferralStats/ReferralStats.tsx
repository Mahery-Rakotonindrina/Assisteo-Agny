import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ReferralSummary } from "@/lib/referralBonus";
import { authHeaders } from "@/services/account";
import { httpClient } from "@/services/httpClient";

/** Friends invited and scans won, under the referral code (a signed-in account). Nothing while the numbers load or fail. */
export function ReferralStats({ onSummary }: { onSummary?: (summary: ReferralSummary) => void }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const latest = useRef(onSummary);

  useEffect(() => {
    latest.current = onSummary;
  }, [onSummary]);

  useEffect(() => {
    let cancelled = false;
    void authHeaders()
      .then((headers) => httpClient.get<ReferralSummary>("/api/referral", { headers }))
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        latest.current?.(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary || (summary.invited === 0 && summary.scansWon === 0)) return null;
  return (
    <div data-testid="referral-stats">
      <p>{t("referralBonus.friends", { invited: summary.invited, rewarded: summary.rewarded })}</p>
      <p>{t("referralBonus.won", { won: summary.scansWon, left: summary.scansLeft })}</p>
    </div>
  );
}
