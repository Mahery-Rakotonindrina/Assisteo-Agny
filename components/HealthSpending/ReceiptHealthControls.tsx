import { useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useHealthSpending } from "@/hooks/useHealthSpending";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary } from "@/lib/format";
import { receiptSpend, receiptSpendId } from "@/lib/healthSpending";
import { haptics } from "@/services/device";
import { healthSpendStore } from "@/services/healthSpendStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./HealthSpending.module.scss";

/**
 * Under a pharmacy or doctor's receipt scanned, without "Mes dépenses" (with
 * it, the receipt counts there on its own, and so in Ma santé):
 * "Ajouter aux dépenses de santé", once. Nothing for any other scan.
 */
export function ReceiptHealthControls({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { spends, isLoading } = useHealthSpending();
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const spend = receiptSpend(entry);
  if (!spend || isLoading) return null;
  const added = spends.some((item) => item.scanId === entry.id);

  // Once: the button waits for the write, and the line's id comes from the scan (added again, it is rewritten).
  const add = async () => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    haptics.success();
    try {
      await healthSpendStore.add(spend, receiptSpendId(entry.id));
      toast(t("health.spending.added"));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };

  return (
    <div className={styles.receipt} data-testid="health-spending-receipt">
      <p>{t("health.spending.receipt", { amount: formatAriary(spend.amountMga, locale) })}</p>
      {added ? (
        <Button href="/sante#spending" variant="secondary" size="md" icon={<Check />}>
          {t("health.spending.receiptAdded")}
        </Button>
      ) : (
        <Button variant="secondary" size="md" icon={<Plus />} onClick={() => void add()} disabled={working} data-testid="health-spending-receipt-add">
          {t("health.spending.receiptAdd")}
        </Button>
      )}
    </div>
  );
}
