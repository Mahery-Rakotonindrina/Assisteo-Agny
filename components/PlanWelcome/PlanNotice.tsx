import Link from "next/link";
import { motion } from "motion/react";
import { RefreshCw, X } from "lucide-react";
import { PlanIcon } from "@/components/PlanBadge";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import type { PlanId } from "@/lib/plans";
import { rise } from "@/lib/motion";
import { planMemoryKeys, rememberPlan, usePlanMemory } from "@/services/planMemory";
import { isSoldPlan } from "./PlanWelcome";
import styles from "./PlanNotice.module.scss";

const DAY_MS = 24 * 3600 * 1000;
/** How long before the end the reminder shows. */
const NOTICE_DAYS = 3;

/**
 * Home screen banner in the plan's colours: the plan ends within three days,
 * or it has ended. Both lead to the offers to renew; both can be dismissed.
 */
export function PlanNotice() {
  const { t, locale } = useTranslation();
  const { plan, id, fresh } = usePlan();
  const now = useNow(60_000);
  const lastPaid = usePlanMemory(planMemoryKeys.lastPaid);
  const dismissed = usePlanMemory(planMemoryKeys.noticeDismissed);
  if (!plan || !fresh || !plan.signedIn) return null;

  const endsSoon = isSoldPlan(id) && plan.endsAt !== null && plan.endsAt > now && plan.endsAt - now <= NOTICE_DAYS * DAY_MS;
  const endKey = `end:${plan.endsAt}`;
  if (endsSoon && dismissed !== endKey) {
    const days = Math.ceil((plan.endsAt! - now) / DAY_MS);
    return (
      <Banner
        plan={id}
        title={t("plans.notice.endingTitle", { plan: t(`plans.names.${id}`) })}
        body={
          days <= 1
            ? t("plans.notice.endingTomorrow", { date: formatDate(plan.endsAt! - 1, locale) })
            : t("plans.notice.ending", { days, date: formatDate(plan.endsAt! - 1, locale) })
        }
        onDismiss={() => rememberPlan(planMemoryKeys.noticeDismissed, endKey)}
      />
    );
  }

  if (id === "free" && isSoldPlan(lastPaid)) {
    return (
      <Banner
        plan={lastPaid}
        title={t("plans.notice.endedTitle", { plan: t(`plans.names.${lastPaid}`) })}
        body={t("plans.notice.ended")}
        onDismiss={() => rememberPlan(planMemoryKeys.lastPaid, null)}
      />
    );
  }
  return null;
}

function Banner({ plan, title, body, onDismiss }: { plan: PlanId; title: string; body: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div variants={rise} initial="hidden" animate="show" className={styles.banner} data-plan={plan} role="status">
      <span className={styles.icon}>
        <PlanIcon plan={plan} size={18} />
      </span>
      <div className={styles.text}>
        <strong>{title}</strong>
        <p>{body}</p>
        <Link href="/plans" className={styles.renew}>
          <RefreshCw size={14} /> {t("plans.notice.renew")}
        </Link>
      </div>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label={t("plans.notice.dismiss")}>
        <X size={16} />
      </button>
    </motion.div>
  );
}
