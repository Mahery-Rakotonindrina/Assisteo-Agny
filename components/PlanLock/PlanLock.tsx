import Link from "next/link";
import { PlanBadge } from "@/components/PlanBadge";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlan } from "@/hooks/usePlan";
import { createdPlanInfo } from "@/lib/customPlans";
import type { AnyPlanId } from "@/lib/plans";
import styles from "./PlanLock.module.scss";

/**
 * In place of a feature the user's plan doesn't include: the plan that has
 * it, and where to get it. No plan offers it now (in test, switched off):
 * just that, without the offers.
 */
export function PlanLock({ plan, text }: { plan: AnyPlanId | null; text: string }) {
  const { t } = useTranslation();
  const { plan: state } = usePlan();
  if (plan === null) {
    return (
      <div className={styles.lock}>
        <p>{t("plans.unavailable")}</p>
      </div>
    );
  }
  return (
    <div className={styles.lock} data-plan={plan} data-plan-color={createdPlanInfo(plan, state)?.color}>
      <PlanBadge plan={plan} />
      <p>
        {text} <Link href="/plans">{t("trial.seeOffers")}</Link>
      </p>
    </div>
  );
}
