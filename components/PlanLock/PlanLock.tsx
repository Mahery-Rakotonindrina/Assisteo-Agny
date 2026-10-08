import Link from "next/link";
import { PlanBadge } from "@/components/PlanBadge";
import { useTranslation } from "@/hooks/useTranslation";
import type { PlanId } from "@/lib/plans";
import styles from "./PlanLock.module.scss";

/** In place of a feature the user's plan doesn't include: the plan that has it, and where to get it. */
export function PlanLock({ plan, text }: { plan: PlanId; text: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.lock} data-plan={plan}>
      <PlanBadge plan={plan} />
      <p>
        {text} <Link href="/plans">{t("trial.seeOffers")}</Link>
      </p>
    </div>
  );
}
