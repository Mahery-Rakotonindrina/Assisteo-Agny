import { useEffect, useState } from "react";
import { Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { summaryRequest } from "@/lib/expenseAi";
import type { ExpenseRecord, monthExpenses } from "@/lib/expenses";
import { formatDateTime } from "@/lib/format";
import type { ActivityMonth } from "@/lib/resale";
import type { WalletBook } from "@/lib/wallets";
import { requestReview, savedReview, type SavedReview } from "@/services/expenseReview";
import { ApiError } from "@/types/api";
import styles from "./Expenses.module.scss";

type Props = {
  month: string;
  records: ExpenseRecord[];
  sources: Parameters<typeof monthExpenses>[1];
  /** The pockets and the activity: sent as totals only, never a name. */
  book?: WalletBook;
  activity?: ActivityMonth | null;
};

/** "Bilan du mois": the AI's short review of the month, from its totals only. */
export function MonthReview({ month, records, sources, book, activity }: Props) {
  const { t, locale } = useTranslation();
  const { categoryName } = useExpenseLabels(records);
  const [review, setReview] = useState<SavedReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The last review of this month, kept on the device.
  useEffect(() => {
    let cancelled = false;
    void savedReview(month).then((saved) => {
      if (!cancelled) setReview(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setReview(await requestReview(summaryRequest(records, sources, month, { locale, now: Date.now(), categoryName }, { book, activity })));
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : "unknown";
      setError(t(code === "network" ? "expenses.review.offline" : code === "rate_limited" ? "expenses.review.limit" : "expenses.review.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.review} aria-busy={busy} data-testid="month-review">
      <div className={styles.reviewHead}>
        <h2 className={styles.subTitle}>{t("expenses.review.title")}</h2>
        <Button variant={review ? "ghost" : "secondary"} icon={review ? <RefreshCw /> : <Sparkles />} onClick={() => void ask()} disabled={busy}>
          {busy ? t("expenses.review.loading") : review ? t("expenses.review.again") : t("expenses.review.ask")}
        </Button>
      </div>
      {!review && !busy && !error && <p className={styles.hint}>{t("expenses.review.hint")}</p>}
      {error && (
        <p className={styles.hint} role="alert">
          {error}
        </p>
      )}
      {review && (
        <>
          <ul>
            {review.summary.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
          {review.summary.tips.length > 0 && (
            <>
              <h3 className={styles.subTitle}>
                <Lightbulb size={13} /> {t("expenses.review.tips")}
              </h3>
              <ul>
                {review.summary.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </>
          )}
          <p className={styles.hint}>
            {t(review.demo ? "expenses.review.demoAt" : "expenses.review.at", { date: formatDateTime(review.at, locale) })}
          </p>
        </>
      )}
    </section>
  );
}
