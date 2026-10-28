import { useEffect, useState } from "react";
import { AlertTriangle, LogIn, Plus, RefreshCw } from "lucide-react";
import { AccountSheet } from "@/components/AccountSheet";
import { Button } from "@/components/Button";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useHousehold, useHouseholdExpenses } from "@/hooks/useHousehold";
import { useTranslation } from "@/hooks/useTranslation";
import type { ExpenseRecord } from "@/lib/expenses";
import { householdMonth, isMine, type HouseholdExpense, type HouseholdInfo } from "@/lib/household";
import { formatAriary, formatDate } from "@/lib/format";
import { householdStore } from "@/services/household";
import { ExpenseForm } from "./ExpenseForm";
import { HouseholdJoin } from "./HouseholdJoin";
import { HouseholdManage } from "./HouseholdManage";
import styles from "./Expenses.module.scss";

type Props = {
  month: string;
  /** The personal records (for the categories' names). */
  records: ExpenseRecord[];
  /** May create a household (Admin plan while tested). */
  canCreate: boolean;
  /** May move a shared expense back to the personal ones (sees them: Admin plan). */
  canMove: boolean;
  /** A code from an invitation link ("?join="). */
  joinCode?: string;
};

/** "Foyer": the household's month, shared by its members, or how to join or create one. */
export function HouseholdPanel({ month, records, canCreate, canMove, joinCode }: Props) {
  const { t } = useTranslation();
  const snapshot = useHousehold();
  const [signingIn, setSigningIn] = useState(false);

  // Fresh when opened (a code may have been used, a member removed…).
  useEffect(() => {
    void householdStore.refresh();
  }, []);

  if (!snapshot) return <p className={styles.hint}>{t("expenses.household.loading")}</p>;

  if (snapshot.signedOut)
    return (
      <section className={styles.householdCard}>
        <h2 className={styles.subTitle}>{t("expenses.household.signInTitle")}</h2>
        <p className={styles.hint}>{t("expenses.household.signInBody")}</p>
        <div className={styles.row}>
          <Button icon={<LogIn />} onClick={() => setSigningIn(true)}>
            {t("account.signIn")}
          </Button>
        </div>
        <AccountSheet open={signingIn} onClose={() => setSigningIn(false)} />
      </section>
    );

  const stale = snapshot.stale && (
    <p className={styles.hint} role="status">
      {t(snapshot.household ? "expenses.household.stale" : "expenses.household.unreachable")}{" "}
      <button type="button" className={styles.linkButton} onClick={() => void householdStore.refresh()}>
        <RefreshCw size={13} /> {t("expenses.household.retry")}
      </button>
    </p>
  );

  if (!snapshot.household)
    return (
      <div className={styles.panel}>
        {stale}
        <HouseholdJoin canCreate={canCreate} initialCode={joinCode} />
      </div>
    );

  return (
    <div className={styles.panel}>
      {stale}
      <HouseholdMonth key={month} month={month} records={records} household={snapshot.household} me={snapshot.userId} canMove={canMove} />
      <HouseholdManage household={snapshot.household} me={snapshot.userId} />
    </div>
  );
}

function HouseholdMonth({ month, records, household, me, canMove }: { month: string; records: ExpenseRecord[]; household: HouseholdInfo; me: string | null; canMove: boolean }) {
  const { t, locale } = useTranslation();
  const { categoryName, categoryColor } = useExpenseLabels(records);
  const { expenses } = useHouseholdExpenses();
  const [editing, setEditing] = useState<Partial<HouseholdExpense> | null>(null);
  const view = householdMonth(expenses, month, household.budget, me);
  const money = (value: number) => formatAriary(value, locale);
  const memberName = (userId: string | undefined) =>
    !userId || userId === me ? t("expenses.household.you") : (household.members.find((member) => member.userId === userId)?.label ?? t("expenses.household.formerMember"));
  const worst = view.budget.find((line) => line.level === "over") ?? view.budget.find((line) => line.level === "warning");
  const scopeName = (scope: string) => (scope === "total" ? t("expenses.budget.overall") : categoryName(scope));

  if (editing)
    return (
      <ExpenseForm
        key={editing.id ?? "new"}
        records={[]}
        initial={editing}
        links={[]}
        from="household"
        scope="household"
        share={{ name: household.name, me, choose: canMove }}
        onDone={() => setEditing(null)}
      />
    );

  return (
    <div className={styles.panel}>
      <h2 className={styles.householdName}>{household.name}</h2>
      <div className={styles.stats}>
        <span>
          <small>{t("expenses.household.spent")}</small>
          <strong data-testid="household-total">{money(view.totals.total)}</strong>
        </span>
        <span>
          <small>{t("expenses.household.membersCount")}</small>
          <strong>{household.members.length}</strong>
        </span>
      </div>

      {worst && worst.level !== "ok" && (
        <p className={styles.banner} data-level={worst.level} role="status">
          <AlertTriangle size={18} />
          <span>
            {t(worst.level === "over" ? "expenses.budget.overBanner" : "expenses.budget.warningBanner", {
              scope: scopeName(worst.scope),
              percent: Math.round(worst.ratio * 100),
              amount: money(Math.abs(worst.cap - worst.spent)),
            })}
          </span>
        </p>
      )}

      {view.budget.length > 0 && (
        <section>
          <h3 className={styles.subTitle}>{t("expenses.household.budgetTitle")}</h3>
          <ul className={styles.bars}>
            {view.budget.map((line) => (
              <li key={line.scope}>
                <span className={styles.barLabel}>
                  <span>{scopeName(line.scope)}</span>
                  <small>
                    {money(line.spent)} / {money(line.cap)}
                  </small>
                </span>
                <span className={styles.track} data-level={line.level}>
                  <span style={{ width: `${Math.min(100, line.ratio * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.byMember.length > 0 && (
        <section>
          <h3 className={styles.subTitle}>{t("expenses.household.byMember")}</h3>
          <ul className={styles.bars}>
            {view.byMember.map((line) => (
              <li key={line.userId}>
                <span className={styles.barLabel}>
                  <span>{memberName(line.userId)}</span>
                  <small>
                    {money(line.amount)} · {Math.round((line.amount / view.totals.total) * 100)} %
                  </small>
                </span>
                <span className={styles.track}>
                  <span style={{ width: `${(line.amount / view.byMember[0].amount) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.totals.byCategory.length > 0 && (
        <section>
          <h3 className={styles.subTitle}>{t("expenses.month.byCategory")}</h3>
          <ul className={styles.bars}>
            {view.totals.byCategory.map((line) => (
              <li key={line.category}>
                <span className={styles.barLabel}>
                  <span>
                    <i className={styles.dot} style={{ background: categoryColor(line.category) }} />
                    {categoryName(line.category)}
                  </span>
                  <small>{money(line.amount)}</small>
                </span>
                <span className={styles.track} style={{ "--tone": categoryColor(line.category) } as React.CSSProperties}>
                  <span style={{ width: `${(line.amount / view.totals.byCategory[0].amount) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.row}>
        <Button icon={<Plus />} onClick={() => setEditing({ at: defaultDay(month) })}>
          {t("expenses.household.add")}
        </Button>
      </div>

      <section>
        <h3 className={styles.subTitle}>{t("expenses.household.list")}</h3>
        {view.items.length === 0 ? (
          <p className={styles.hint}>{t("expenses.household.empty")}</p>
        ) : (
          <ul className={styles.entries}>
            {view.items.map((expense) => {
              const mine = isMine(expense, me);
              const details = [formatDate(expense.at, locale), expense.note && categoryName(expense.category), expense.payment && t(`expenses.payments.${expense.payment}`), t("expenses.household.by", { name: memberName(expense.userId) })];
              const content = (
                <>
                  <i className={styles.dot} style={{ background: categoryColor(expense.category) }} />
                  <span className={styles.entryText}>
                    <strong>{expense.note || categoryName(expense.category)}</strong>
                    <small>{details.filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={styles.amount}>{money(expense.amountMga)}</span>
                </>
              );
              return (
                <li key={expense.id} className={styles.entry}>
                  {mine ? (
                    <button type="button" className={styles.entryMain} onClick={() => setEditing(expense)}>
                      {content}
                    </button>
                  ) : (
                    // The others' expenses: seen, never changed.
                    <span className={styles.entryMain}>{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A new expense is dated today in the current month, else on the 1st of the month shown. */
function defaultDay(month: string) {
  const now = Date.now();
  const [year, index] = month.split("-").map(Number);
  const start = new Date(year, index - 1, 1).getTime();
  const end = new Date(year, index, 1).getTime();
  return now >= start && now < end ? now : start;
}
