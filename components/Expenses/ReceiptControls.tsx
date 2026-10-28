import Link from "next/link";
import { useState } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenses } from "@/hooks/useExpenses";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { receiptDraft, receiptDuplicate } from "@/lib/expenseAi";
import { formatAriary } from "@/lib/format";
import { haptics } from "@/services/device";
import type { HistoryEntry } from "@/types/history";
import { ExpenseForm } from "./ExpenseForm";
import styles from "./Expenses.module.scss";

/**
 * Under a scanned till receipt or Mobile Money confirmation: "Add to my
 * expenses" opens the expense form, filled in. Admin only while tested, and
 * hidden from the other plans. The same transaction is never added twice.
 */
export function ReceiptControls({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { has } = usePlan();
  const { records, isLoading } = useExpenses();
  const [open, setOpen] = useState(false);

  const draft = receiptDraft(entry);
  if (!has("expenses") || !draft || isLoading) return null;

  const duplicate = receiptDuplicate(records, entry);
  if (duplicate && !open) {
    return (
      <p className={styles.receiptStatus}>
        <Receipt size={15} />
        <span>
          {t("expenses.receipt.already", { amount: formatAriary(duplicate.amountMga, locale) })}{" "}
          <Link href={{ pathname: "/expenses", query: { open: duplicate.id } }}>{t("expenses.receipt.open")}</Link>
        </span>
      </p>
    );
  }

  if (open)
    return (
      <ExpenseForm
        records={records}
        initial={draft}
        links={[]}
        onSaved={() => toast(t("expenses.receipt.saved"))}
        onDone={() => setOpen(false)}
      />
    );

  return (
    <div className={styles.row}>
      <Button
        icon={<Receipt />}
        onClick={() => {
          haptics.tap();
          setOpen(true);
        }}
      >
        {t("expenses.receipt.add")}
      </Button>
    </div>
  );
}
