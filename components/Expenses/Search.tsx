import { useCallback, useEffect, useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { searchExpenses, type SearchHit } from "@/lib/expenseSearch";
import { monthStart, type ExpenseRecord, type IncomeKind, type SourceItem } from "@/lib/expenses";
import { formatAriary, formatDate, formatMonthYear } from "@/lib/format";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";

/** How long typing pauses before searching. */
const TYPING_DELAY = 200;

type Props = { records: ExpenseRecord[]; sources: SourceItem[]; now: number; onPick: (hit: SearchHit, month: string) => void };

/** The magnifier of the header, and its "Chercher" sheet: every month's expenses and incomes, on the device. */
export function ExpenseSearch({ records, sources, now, onPick }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.iconButton} onClick={() => setOpen(true)} aria-label={t("expenses.search.open")}>
        <SearchIcon size={20} />
      </button>
      <ExpenseSheet open={open} title={t("expenses.search.title")} onClose={() => setOpen(false)}>
        <SearchBody
          records={records}
          sources={sources}
          now={now}
          onPick={(hit, month) => {
            setOpen(false);
            onPick(hit, month);
          }}
        />
      </ExpenseSheet>
    </>
  );
}

function SearchBody({ records, sources, now, onPick }: Props) {
  const { t, locale } = useTranslation();
  const { categoryName, categoryColor } = useExpenseLabels(records);
  const incomeName = useCallback((kind: IncomeKind) => t(`expenses.incomes.${kind}`), [t]);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const money = (value: number) => formatAriary(value, locale);

  useEffect(() => {
    const timer = setTimeout(() => setAsked(query), TYPING_DELAY);
    return () => clearTimeout(timer);
  }, [query]);

  const result = useMemo(() => searchExpenses(records, sources, asked, now, { category: categoryName, income: incomeName }), [records, sources, asked, now, categoryName, incomeName]);

  return (
    <div className={styles.form}>
      <label className={styles.searchField}>
        <SearchIcon size={18} aria-hidden />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("expenses.search.placeholder")} aria-label={t("expenses.search.field")} autoFocus />
      </label>
      {asked.trim() === "" ? (
        <p className={styles.hint}>{t("expenses.search.hint")}</p>
      ) : result.count === 0 ? (
        <p className={styles.hint}>{t("expenses.search.none", { query: asked.trim() })}</p>
      ) : (
        <>
          <p className={styles.pocketsTotal} data-testid="search-count">
            {t("expenses.search.count", { count: result.count, amount: money(result.total) })}
          </p>
          {result.groups.map((group) => (
            <section key={group.month} className={styles.dayGroup} aria-label={formatMonthYear(monthStart(group.month), locale)}>
              <h3 className={styles.day}>{formatMonthYear(monthStart(group.month), locale)}</h3>
              <ul className={styles.entries}>
                {group.hits.map((hit) => (
                  <li key={hit.key} className={styles.entry} data-excluded={hit.excluded || undefined}>
                    <button type="button" className={styles.entryMain} onClick={() => onPick(hit, group.month)}>
                      <i className={styles.dot} style={{ background: hit.flow === "income" ? "var(--success, #2e9e5b)" : categoryColor(hit.category) }} />
                      <span className={styles.entryText}>
                        <strong>{hit.origin === "fees" ? t("expenses.feesLabel") : hit.label || (hit.flow === "income" ? incomeName(hit.category as IncomeKind) : categoryName(hit.category))}</strong>
                        <small>
                          {[formatDate(hit.at, locale), hit.flow === "income" ? t("expenses.search.income") : categoryName(hit.category), hit.origin !== "manual" && t(`expenses.origins.${hit.origin}`)]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                      <span className={styles.amount} data-tone={hit.flow === "income" ? "in" : undefined}>
                        {hit.flow === "income" ? "+" : ""}
                        {money(hit.amountMga)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
