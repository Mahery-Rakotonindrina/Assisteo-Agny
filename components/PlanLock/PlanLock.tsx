import Link from "next/link";
import { Lock } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import styles from "./PlanLock.module.scss";

/** In place of a feature the user's plan doesn't include: what it needs, and where to get it. */
export function PlanLock({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <p className={styles.lock}>
      <Lock size={15} />
      <span>
        {text} <Link href="/plans">{t("trial.seeOffers")}</Link>
      </span>
    </p>
  );
}
