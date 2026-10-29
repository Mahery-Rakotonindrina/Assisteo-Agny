import { useMemo, useState } from "react";
import { ChevronRight, EyeOff, Package, RotateCcw, Store } from "lucide-react";
import { Button } from "@/components/Button";
import { Toggle } from "@/components/Toggle";
import { useParcels } from "@/hooks/useParcels";
import { useTranslation } from "@/hooks/useTranslation";
import { monthStart, type ExpenseRecord, type SourceItem } from "@/lib/expenses";
import { formatAriary, formatDate, formatMonthYear } from "@/lib/format";
import { activityLines, activityMonth, excludedKeys, separatesActivity, type ActivityLine, type ActivityMonth } from "@/lib/resale";
import { lineWallet, type WalletBook } from "@/lib/wallets";
import { expenseStore } from "@/services/expenseStore";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";
import { WalletChips, type PocketChoice } from "./WalletChips";

type Props = { month: string; records: ExpenseRecord[]; sources: SourceItem[]; book: WalletBook; pockets: PocketChoice };

/**
 * Resellers (shown by the caller with the reseller tools only): under "Il te
 * reste", the month's profit from reselling, once a parcel is to resell.
 * Opens "Mon activité", where the activity can be kept apart from the budget.
 */
export function Activity({ month, records, sources, book, pockets }: Props) {
  const { t, locale } = useTranslation();
  const { parcels } = useParcels();
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => activityMonth(parcels, month, excludedKeys(records)), [parcels, month, records]);
  const separate = separatesActivity(records);
  // Kept apart, the purchases and sales are not in the month's lists: shown here instead.
  const lines = useMemo(() => (separate ? activityLines(records, sources, month) : []), [separate, records, sources, month]);
  if (!summary.active) return null;
  const profit = summary.profitMga;

  return (
    <>
      <button type="button" className={styles.pocketsLine} onClick={() => setOpen(true)} data-testid="activity-line">
        <Store size={18} aria-hidden />
        <span>
          {t("expenses.activity.line")}{" "}
          <strong data-tone={profit < 0 ? "bad" : undefined}>
            {profit > 0 ? "+" : profit < 0 ? "−" : ""}
            {formatAriary(Math.abs(profit), locale)}
          </strong>
        </span>
        <ChevronRight size={18} aria-hidden />
      </button>
      <ExpenseSheet open={open} title={t("expenses.activity.title", { month: formatMonthYear(monthStart(month), locale) })} onClose={() => setOpen(false)}>
        {open && <ActivitySheet summary={summary} separate={separate} lines={lines} book={book} pockets={pockets} />}
      </ExpenseSheet>
    </>
  );
}

type SheetProps = { summary: ActivityMonth; separate: boolean; lines: ActivityLine[]; book: WalletBook; pockets: PocketChoice };

function ActivitySheet({ summary, separate, lines, book, pockets }: SheetProps) {
  const { t, locale } = useTranslation();
  const money = (value: number) => formatAriary(value, locale);

  return (
    <div className={styles.form} data-testid="activity-sheet">
      <div className={styles.stats}>
        <span>
          <small>{t("expenses.activity.bought")}</small>
          <strong>{money(summary.boughtMga)}</strong>
          <em>{t("expenses.activity.parcels", { count: summary.bought })}</em>
        </span>
        <span>
          <small>{t("expenses.activity.sales")}</small>
          <strong>{money(summary.salesMga)}</strong>
          <em>{t("expenses.activity.parcels", { count: summary.sold })}</em>
        </span>
        <span>
          <small>{t("expenses.activity.profit")}</small>
          <strong data-tone={summary.profitMga < 0 ? "bad" : undefined} data-testid="activity-profit">
            {money(summary.profitMga)}
          </strong>
          <em>{t("expenses.activity.profitHint")}</em>
        </span>
        <span>
          <small>{t("expenses.activity.toCollect")}</small>
          <strong>{money(summary.toCollectMga)}</strong>
          <em>{t("expenses.activity.toCollectHint")}</em>
        </span>
        <span>
          <small>{t("expenses.activity.stock")}</small>
          <strong>{money(summary.stockMga)}</strong>
          <em>{t("expenses.activity.parcels", { count: summary.stock })}</em>
        </span>
      </div>

      {summary.topClients.length > 0 && (
        <section aria-labelledby="activity-clients">
          <h3 id="activity-clients" className={styles.subTitle}>
            {t("expenses.activity.topClients")}
          </h3>
          <ul className={styles.entries}>
            {summary.topClients.map((client) => (
              <li key={client.name} className={styles.entry}>
                <span className={styles.entryMain}>
                  <span className={styles.entryText}>
                    <strong>{client.name}</strong>
                    <small>{t("expenses.activity.clientDetail", { count: client.parcels, profit: money(client.profitMga) })}</small>
                  </span>
                  <span className={styles.amount}>{money(client.salesMga)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lines.length > 0 && <ActivityLines lines={lines} book={book} pockets={pockets} />}

      <div className={styles.switchRow}>
        <span>
          <strong id="activity-separate">{t("expenses.activity.separate")}</strong>
          <small className={styles.hint}>{t(separate ? "expenses.activity.separateOn" : "expenses.activity.separateOff")}</small>
        </span>
        <Toggle checked={separate} onChange={(value) => void expenseStore.setActivitySeparate(value)} label={t("expenses.activity.separate")} />
      </div>

      <div className={styles.row}>
        <Button variant="secondary" href="/parcels" icon={<Package />}>
          {t("expenses.activity.parcelsLink")}
        </Button>
      </div>
    </div>
  );
}

/** The month's purchases and sales of parcels to resell: touched, a line picks its pocket or is left out (out of the profit too). */
function ActivityLines({ lines, book, pockets }: { lines: ActivityLine[]; book: WalletBook; pockets: PocketChoice }) {
  const { t, locale } = useTranslation();
  const [opened, setOpened] = useState<string | null>(null);
  const money = (value: number) => formatAriary(value, locale);

  return (
    <section aria-labelledby="activity-lines">
      <h3 id="activity-lines" className={styles.subTitle}>
        {t("expenses.activity.lines")}
      </h3>
      <ul className={styles.entries}>
        {lines.map(({ flow, item }) => {
          const open = opened === item.key;
          const title = t(flow === "income" ? "expenses.income.sale" : "expenses.activity.purchase", { title: item.label ?? "" });
          return (
            <li key={item.key} data-key={item.key} className={styles.entry} data-excluded={item.excluded || undefined} data-testid="activity-entry">
              <button type="button" className={styles.entryMain} aria-expanded={open} onClick={() => setOpened(open ? null : item.key)}>
                <span className={styles.entryText}>
                  <strong>{title}</strong>
                  <small>{[formatDate(item.at, locale), item.excluded && t("expenses.excluded")].filter(Boolean).join(" · ")}</small>
                </span>
                <span className={styles.amount}>
                  {flow === "income" ? "+" : "−"}
                  {money(item.amountMga)}
                </span>
              </button>
              {open && (
                <div className={styles.actions}>
                  <Button variant="ghost" icon={item.excluded ? <RotateCcw /> : <EyeOff />} onClick={() => void expenseStore.setExcluded(item.key, !item.excluded)}>
                    {t(item.excluded ? "expenses.include" : "expenses.exclude")}
                  </Button>
                  {pockets.wallets.length > 0 && (
                    <div className={styles.linePocket}>
                      <WalletChips
                        label={t(flow === "income" ? "expenses.pockets.lineWalletIn" : "expenses.pockets.lineWallet")}
                        wallets={pockets.wallets}
                        value={lineWallet(book.context, item) ?? ""}
                        onChange={(id) => void expenseStore.setWalletPick(item.key, id)}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
