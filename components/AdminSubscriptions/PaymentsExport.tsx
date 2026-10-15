import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { XLSX_TYPE } from "@/lib/excel";
import { formatAriary, formatDate, formatMonthYear, toDateInput } from "@/lib/format";
import { inPaymentPeriod, paymentPeriods, payments, paymentsWorkbook, type PaymentPeriod } from "@/lib/paymentExport";
import type { Subscription } from "@/lib/plans";
import { shareFile } from "@/services/fileShare";
import styles from "./AdminSubscriptions.module.scss";

/** The payments of a period as an Excel workbook, for the accounts. */
export function PaymentsExport({ rows, now }: { rows: Subscription[]; now: number }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [period, setPeriod] = useState<PaymentPeriod>("month");
  const [working, setWorking] = useState(false);
  const chosen = payments(rows.filter((row) => inPaymentPeriod(row, period, now)));
  const total = chosen.reduce((sum, row) => sum + (row.amountMga ?? 0), 0);

  const exportPayments = async () => {
    setWorking(true);
    const date = new Date(now);
    const lastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    const { suffix, label } =
      period === "month"
        ? { suffix: toDateInput(now).slice(0, 7), label: formatMonthYear(now, locale) }
        : period === "lastMonth"
          ? { suffix: toDateInput(lastMonth).slice(0, 7), label: formatMonthYear(lastMonth, locale) }
          : period === "year"
            ? { suffix: String(date.getFullYear()), label: String(date.getFullYear()) }
            : { suffix: `tout-${toDateInput(now)}`, label: t("admin.export.periods.all") };
    try {
      const bytes = await paymentsWorkbook(chosen, t, {
        title: `${t("admin.export.title")} · ${label}`,
        subtitle: t("admin.export.exportedOn", { date: formatDate(now, locale) }),
      });
      const result = await shareFile(`paiements-${suffix}.xlsx`, bytes, XLSX_TYPE, t("admin.export.title"));
      if (result === "downloaded") toast(t("admin.export.downloaded"));
    } catch {
      toast(t("admin.error"), "error");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={styles.export}>
      <h3>
        <FileSpreadsheet size={16} /> {t("admin.export.heading")}
      </h3>
      <div className={styles.filters} role="group" aria-label={t("admin.export.heading")}>
        {paymentPeriods.map((value) => (
          <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>
            {t(`admin.export.periods.${value}`)}
          </button>
        ))}
      </div>
      <p>{t("admin.export.summary", { count: chosen.length, amount: formatAriary(total, locale) })}</p>
      <Button variant="secondary" icon={<FileSpreadsheet />} onClick={() => void exportPayments()} disabled={chosen.length === 0 || working}>
        {working ? t("admin.export.working") : t("admin.export.button")}
      </Button>
    </div>
  );
}
