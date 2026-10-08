import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanIcon } from "@/components/PlanBadge";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, formatNumber } from "@/lib/format";
import { planPerks } from "@/lib/planPerks";
import styles from "./PlanSettings.module.scss";

/** "Mon offre" in the settings: the plan in its colours, until when, what is left and what it includes. */
export function PlanSettings() {
  const { t, locale } = useTranslation();
  const { plan, id, has } = usePlan();
  if (!plan) return <div className={styles.wrap} aria-busy />;

  const paid = id !== "free";
  const validity = !paid ? t("plans.trial") : plan.endsAt === null ? t("plans.noEnd") : t("plans.until", { date: formatDate(plan.endsAt - 1, locale) });

  return (
    <div className={styles.wrap} data-plan={id}>
      <div className={styles.hero}>
        <span className={styles.icon}>
          <PlanIcon plan={id} size={22} />
        </span>
        <div className={styles.text}>
          <strong>{t(`plans.names.${id}`)}</strong>
          <span>{validity}</span>
        </div>
      </div>

      {plan.enabled && id !== "unlimited" && (
        <div className={styles.meters}>
          <Meter label={paid ? t("plans.scansMonth") : t("plans.scansTrial")} used={plan.usage.scans} limit={plan.limits.scans} />
          <Meter label={t("plans.questionsToday")} used={plan.usage.questionsToday} limit={plan.limits.questionsPerDay} />
          {has("deepAnalysis") && <Meter label={t("plans.deepMonth")} used={plan.usage.deep ?? 0} limit={plan.limits.deepPerMonth ?? 0} />}
        </div>
      )}

      <ul className={styles.perks} aria-label={t("plans.includes")}>
        {planPerks(id, plan.limits, t, locale).map((perk) => (
          <li key={perk}>
            <Check size={14} /> {perk}
          </li>
        ))}
      </ul>

      {!plan.signedIn && <p className={styles.hint}>{t("plans.signInHint")}</p>}

      {id !== "unlimited" && (
        <Button href="/plans" block variant={paid ? "secondary" : "primary"} icon={<Sparkles />}>
          {paid ? t("plans.seeOffers") : t("plans.choose")}
        </Button>
      )}
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t, locale } = useTranslation();
  const unlimited = limit === 0;
  const shown = Math.min(used, limit || used);
  return (
    <div className={styles.meter} data-full={!unlimited && used >= limit ? "" : undefined}>
      <div className={styles.meterText}>
        <span>{label}</span>
        <strong>{unlimited ? t("plans.unlimited") : `${formatNumber(shown, locale)} / ${formatNumber(limit, locale)}`}</strong>
      </div>
      {!unlimited && (
        <div className={styles.track} aria-hidden>
          <span style={{ width: `${Math.min(100, (shown / limit) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
