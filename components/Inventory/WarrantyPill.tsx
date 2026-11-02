import { ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import type { WarrantyStatus } from "@/lib/inventory";
import styles from "./Inventory.module.scss";

/** "Sous garantie" or "Garantie finie". */
export function WarrantyPill({ status }: { status: WarrantyStatus }) {
  const { t } = useTranslation();
  return (
    <span className={styles.pill} data-status={status}>
      {status === "active" ? <ShieldCheck size={13} /> : <ShieldOff size={13} />} {t(`inventory.warranty.${status}`)}
    </span>
  );
}
