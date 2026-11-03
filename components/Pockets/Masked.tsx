import { BALANCE_MASK } from "@/lib/balanceMask";
import { useTranslation } from "@/hooks/useTranslation";
import styles from "./Pockets.module.scss";

type Props = {
  hidden: boolean;
  /** What shows when visible. */
  children: string;
  /** What shows when hidden, when the stars sit inside a sentence ("Solde : ************"). */
  masked?: string;
};

/** A balance, or `************` for the eye, and "Solde masqué" for a screen reader. */
export function Masked({ hidden, children, masked = BALANCE_MASK }: Props) {
  const { t } = useTranslation();
  if (!hidden) return <>{children}</>;
  return (
    <>
      <span aria-hidden>{masked}</span>
      <span className={styles.srOnly}>{t("expenses.pockets.hiddenBalance")}</span>
    </>
  );
}
