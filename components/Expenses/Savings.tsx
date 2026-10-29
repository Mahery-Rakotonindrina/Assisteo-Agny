import { useState, type FormEvent } from "react";
import { Check, ChevronRight, HandCoins, Minus, Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { useTranslation } from "@/hooks/useTranslation";
import { barPercent, tontineFrequencies, type ExpenseRecord, type SavingsGoal, type Tontine, type TontineFrequency } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { dayString } from "@/lib/papers";
import { goalPerMonth, goalSaved, goalsOf, nextPaymentKey, removalEffect, roundDay, tontinesOf, tontineStatus } from "@/lib/savings";
import type { WalletBook } from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { requestNotificationPermission } from "@/services/notifications";
import { dayOf, parseAmount, today } from "./ExpenseForm";
import { ExpenseSheet } from "./ExpenseSheet";
import { startingWallet, WalletChips, type PocketChoice } from "./WalletChips";
import styles from "./Expenses.module.scss";

/** What a sheet shows: the lists, a form, or money moved in or out of a goal or a tontine. */
type Sheet =
  | { view: "list" }
  | { view: "goal"; goal?: SavingsGoal }
  | { view: "tontine"; tontine?: Tontine }
  | { view: "deposit"; record: SavingsGoal | Tontine; sign: 1 | -1 }
  | { view: "pot"; tontine: Tontine };

type Props = { records: ExpenseRecord[]; book: WalletBook; pockets: PocketChoice; canRemind: boolean; now: number };

/**
 * "Mis de côté": under the pockets, the money set aside (savings goals,
 * tontines). Neither spent nor earned: it only leaves a pocket, and comes
 * back to one. Opens "Épargne et tontines".
 */
export function Savings({ records, book, pockets, canRemind, now }: Props) {
  const { t, locale } = useTranslation();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const goals = goalsOf(records);
  const tontines = tontinesOf(records);
  const any = goals.length > 0 || tontines.length > 0;
  const toList = () => setSheet({ view: "list" });
  const titles = {
    list: t("expenses.savings.title"),
    goal: t("expenses.savings.goalTitle"),
    tontine: t("expenses.savings.tontineTitle"),
    deposit: sheet?.view === "deposit" ? (sheet.record.kind === "tontine" ? t("expenses.savings.payTitle") : t(sheet.sign > 0 ? "expenses.savings.putAside" : "expenses.savings.takeBack")) : "",
    pot: t("expenses.savings.potTitle"),
  };

  return (
    <>
      <button type="button" className={styles.pocketsLine} onClick={toList}>
        <PiggyBank size={18} aria-hidden />
        <span>
          {any ? (
            <>
              {t("expenses.savings.line")} <strong data-testid="savings-total">{formatAriary(book.saved, locale)}</strong>
            </>
          ) : (
            t("expenses.savings.empty")
          )}
        </span>
        <ChevronRight size={18} aria-hidden />
      </button>

      <ExpenseSheet open={sheet !== null} title={sheet ? titles[sheet.view] : ""} onClose={() => setSheet(null)}>
        {sheet?.view === "list" && <SavingsList goals={goals} tontines={tontines} now={now} saved={book.saved} onOpen={setSheet} />}
        {sheet?.view === "goal" && <GoalForm goal={sheet.goal} onDone={toList} />}
        {sheet?.view === "tontine" && <TontineForm tontine={sheet.tontine} canRemind={canRemind} onDone={toList} />}
        {sheet?.view === "deposit" && <DepositForm record={sheet.record} sign={sheet.sign} pockets={pockets} onDone={toList} />}
        {sheet?.view === "pot" && <PotForm tontine={sheet.tontine} pockets={pockets} onDone={toList} />}
      </ExpenseSheet>
    </>
  );
}

type ListProps = { goals: SavingsGoal[]; tontines: Tontine[]; now: number; saved: number; onOpen: (sheet: Sheet) => void };

function SavingsList({ goals, tontines, now, saved, onOpen }: ListProps) {
  const { t, locale } = useTranslation();
  const money = (value: number) => formatAriary(value, locale);

  return (
    <div className={styles.form}>
      <p className={styles.hint}>{t("expenses.savings.hint")}</p>
      <p className={styles.pocketsTotal}>
        {t("expenses.savings.line")} <strong>{money(saved)}</strong>
      </p>

      <section aria-labelledby="savings-goals" className={styles.savingsGroup}>
        <div className={styles.listHead}>
          <h3 id="savings-goals" className={styles.subTitle}>
            {t("expenses.savings.goals")}
          </h3>
          <Button variant="secondary" icon={<Plus />} onClick={() => onOpen({ view: "goal" })}>
            {t("expenses.savings.addGoal")}
          </Button>
        </div>
        {goals.length === 0 && <p className={styles.hint}>{t("expenses.savings.noGoal")}</p>}
        <ul className={styles.entries}>
          {goals.map((goal) => {
            const held = goalSaved(goal);
            const perMonth = goalPerMonth(goal, now);
            return (
              <li key={goal.id} className={styles.savingsItem} data-testid="savings-goal">
                <strong>{goal.name}</strong>
                <span data-testid="goal-progress">
                  {money(held)} / {money(goal.targetMga)}
                </span>
                <span className={styles.track} data-level={held >= goal.targetMga ? "ok" : undefined}>
                  <span style={{ width: `${barPercent(held / goal.targetMga)}%` }} />
                </span>
                {held >= goal.targetMga ? (
                  <small className={styles.hint}>{t("expenses.savings.reached")}</small>
                ) : (
                  perMonth !== null && <small className={styles.hint}>{t("expenses.savings.perMonth", { amount: money(perMonth) })}</small>
                )}
                <div className={styles.row}>
                  <Button icon={<Plus />} onClick={() => onOpen({ view: "deposit", record: goal, sign: 1 })}>
                    {t("expenses.savings.putAside")}
                  </Button>
                  {held > 0 && (
                    <Button variant="ghost" icon={<Minus />} onClick={() => onOpen({ view: "deposit", record: goal, sign: -1 })}>
                      {t("expenses.savings.takeBack")}
                    </Button>
                  )}
                  <Button variant="ghost" icon={<Pencil />} onClick={() => onOpen({ view: "goal", goal })}>
                    {t("expenses.savings.edit")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="savings-tontines" className={styles.savingsGroup}>
        <div className={styles.listHead}>
          <h3 id="savings-tontines" className={styles.subTitle}>
            {t("expenses.savings.tontines")}
          </h3>
          <Button variant="secondary" icon={<Plus />} onClick={() => onOpen({ view: "tontine" })}>
            {t("expenses.savings.addTontine")}
          </Button>
        </div>
        {tontines.length === 0 && <p className={styles.hint}>{t("expenses.savings.noTontine")}</p>}
        <ul className={styles.entries}>
          {tontines.map((tontine) => {
            const status = tontineStatus(tontine, now);
            return (
              <li key={tontine.id} className={styles.savingsItem} data-testid="tontine">
                <strong>{tontine.name}</strong>
                <span data-testid="tontine-status">
                  {[
                    t("expenses.savings.paid", { amount: money(status.paid) }),
                    tontine.received
                      ? t("expenses.savings.got", { amount: money(tontine.received.amountMga), date: formatDate(tontine.received.at, locale) })
                      : t("expenses.savings.willGet", { amount: money(status.pot), date: formatDate(status.turnAt, locale) }),
                  ].join(" · ")}
                </span>
                {/* One text, values included: the pot received, the payments still go on until every round is paid. */}
                <small className={styles.hint} data-tone={status.next?.late ? "bad" : undefined} data-testid="tontine-next">
                  {[
                    status.next
                      ? t(`expenses.savings.${nextPaymentKey(status)}`, { amount: money(tontine.amountMga), date: formatDate(status.next.at, locale) })
                      : t("expenses.savings.allPaid"),
                    t("expenses.savings.rounds", { done: status.rounds.done, total: status.rounds.total }),
                  ].join(" · ")}
                </small>
                <div className={styles.row}>
                  {status.next && (
                    <Button icon={<Check />} onClick={() => onOpen({ view: "deposit", record: tontine, sign: 1 })}>
                      {t("expenses.savings.pay")}
                    </Button>
                  )}
                  {tontine.received ? (
                    <Button variant="ghost" onClick={() => void expenseStore.setPotReceived(tontine.id, null)}>
                      {t("expenses.savings.undoPot")}
                    </Button>
                  ) : (
                    <Button variant="ghost" icon={<HandCoins />} onClick={() => onOpen({ view: "pot", tontine })}>
                      {t("expenses.savings.potReceived")}
                    </Button>
                  )}
                  <Button variant="ghost" icon={<Pencil />} onClick={() => onOpen({ view: "tontine", tontine })}>
                    {t("expenses.savings.edit")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** "Supprimer « Rentrée scolaire » ? Les 120 000 Ar mis de côté reviendront dans tes poches.": deleting undoes every move of its pockets. */
function useRemovalQuestion() {
  const { t, locale } = useTranslation();
  return (record: SavingsGoal | Tontine) => {
    const effect = removalEffect(record);
    return effect.kind === "held"
      ? t("expenses.savings.removeHeld", { name: record.name, amount: formatAriary(effect.amountMga, locale) })
      : t(effect.kind === "pot" ? "expenses.savings.removePot" : "expenses.savings.removeEmpty", { name: record.name });
  };
}

/** The form's buttons; deleting is asked first (`question`), then confirmed. */
function FormButtons({ valid, onCancel, onRemove, question }: { valid: boolean; onCancel: () => void; onRemove?: () => void; question?: string }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  return (
    <>
      {asking && (
        <p className={styles.hint} role="alert" data-testid="savings-remove-question">
          {question}
        </p>
      )}
      <div className={styles.row}>
        {asking ? (
          <>
            <Button variant="danger" icon={<Trash2 />} onClick={onRemove}>
              {t("expenses.savings.removeConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t("expenses.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" icon={<Check />} disabled={!valid}>
              {t("expenses.save")}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              {t("expenses.cancel")}
            </Button>
            {onRemove && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => setAsking(true)}>
                {t("expenses.savings.remove")}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** A savings goal: its name, what is aimed at, and by when (if wanted). */
function GoalForm({ goal, onDone }: { goal?: SavingsGoal; onDone: () => void }) {
  const { t } = useTranslation();
  const ask = useRemovalQuestion();
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.targetMga) : "");
  const [due, setDue] = useState(goal?.dueAt ? dayString(goal.dueAt) : "");
  const targetValue = parseAmount(target);
  const valid = name.trim() !== "" && targetValue !== undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || targetValue === undefined) return;
    haptics.success();
    await expenseStore.saveGoal({ id: goal?.id, name, targetMga: targetValue, dueAt: due ? dayOf(due) : undefined });
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.savings.goalTitle")}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.savings.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={t("expenses.savings.goalPlaceholder")} required autoFocus />
        </label>
        <label>
          <span>{t("expenses.savings.target")}</span>
          <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="numeric" required />
        </label>
        <label>
          <span>{t("expenses.savings.dueAt")}</span>
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
      </div>
      <FormButtons
        valid={valid}
        onCancel={onDone}
        question={goal && ask(goal)}
        onRemove={
          goal &&
          (() => {
            void expenseStore.remove(goal.id).then(onDone);
          })
        }
      />
    </form>
  );
}

/** A tontine: what each member pays, how often, how many they are, from when, and the user's turn. */
function TontineForm({ tontine, canRemind, onDone }: { tontine?: Tontine; canRemind: boolean; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const ask = useRemovalQuestion();
  const [name, setName] = useState(tontine?.name ?? "");
  const [amount, setAmount] = useState(tontine ? String(tontine.amountMga) : "");
  const [frequency, setFrequency] = useState<TontineFrequency>(tontine?.frequency ?? "monthly");
  const [members, setMembers] = useState(tontine ? String(tontine.members) : "");
  const [start, setStart] = useState(() => (tontine ? dayString(tontine.startAt) : today()));
  const [turn, setTurn] = useState(tontine ? String(tontine.myTurn) : "1");
  const [remind, setRemind] = useState(tontine?.remind ?? true);
  const amountValue = parseAmount(amount);
  const count = Math.round(Number(members));
  const myTurn = Math.round(Number(turn));
  const valid = name.trim() !== "" && amountValue !== undefined && count >= 2 && count <= 100 && myTurn >= 1 && myTurn <= count && start !== "";
  const startAt = dayOf(start);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || amountValue === undefined) return;
    haptics.success();
    if (remind && canRemind) await requestNotificationPermission().catch(() => undefined);
    await expenseStore.saveTontine({ id: tontine?.id, name, amountMga: amountValue, frequency, members: count, startAt, myTurn, remind });
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.savings.tontineTitle")}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.savings.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={t("expenses.savings.tontinePlaceholder")} required autoFocus />
        </label>
        <label>
          <span>{t("expenses.savings.amountEach")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" required />
        </label>
        <label>
          <span>{t("expenses.savings.frequency")}</span>
          <select value={frequency} onChange={(event) => setFrequency(event.target.value as TontineFrequency)}>
            {tontineFrequencies.map((item) => (
              <option key={item} value={item}>
                {t(`expenses.savings.frequencies.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("expenses.savings.members")}</span>
          <input value={members} onChange={(event) => setMembers(event.target.value)} inputMode="numeric" required />
        </label>
        <label>
          <span>{t("expenses.savings.startAt")}</span>
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} required />
        </label>
        <label>
          <span>{t("expenses.savings.myTurn")}</span>
          <input value={turn} onChange={(event) => setTurn(event.target.value)} inputMode="numeric" required />
        </label>
        {valid && amountValue !== undefined && (
          <p className={`${styles.wide} ${styles.hint}`}>
            {t("expenses.savings.turnHint", { amount: formatAriary(Math.round(amountValue) * count, locale), date: formatDate(roundDay({ startAt, frequency }, myTurn - 1), locale) })}
          </p>
        )}
        {canRemind && (
          <div className={`${styles.wide} ${styles.switchRow}`}>
            <span>
              <strong>{t("expenses.savings.remind")}</strong>
            </span>
            <Toggle checked={remind} onChange={setRemind} label={t("expenses.savings.remind")} />
          </div>
        )}
      </div>
      <FormButtons
        valid={valid}
        onCancel={onDone}
        question={tontine && ask(tontine)}
        onRemove={
          tontine &&
          (() => {
            void expenseStore.remove(tontine.id).then(onDone);
          })
        }
      />
    </form>
  );
}

/** Money put aside (or taken back) for a goal, or a tontine's payment: the amount and its pocket. */
function DepositForm({ record, sign, pockets, onDone }: { record: SavingsGoal | Tontine; sign: 1 | -1; pockets: PocketChoice; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const tontine = record.kind === "tontine";
  const [amount, setAmount] = useState(tontine ? String(record.amountMga) : "");
  const [wallet, setWallet] = useState(() => startingWallet(pockets, undefined));
  const value = parseAmount(amount);
  const held = record.kind === "savingsGoal" ? goalSaved(record) : 0;
  const tooMuch = sign < 0 && value !== undefined && Math.round(value) > held;
  const valid = value !== undefined && !tooMuch;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || value === undefined) return;
    haptics.success();
    const rounded = Math.round(value);
    await expenseStore.addDeposit(record.id, sign * rounded, wallet || undefined);
    const shown = formatAriary(rounded, locale);
    toast(t(tontine ? "expenses.savings.paidDone" : sign > 0 ? "expenses.savings.putAsideDone" : "expenses.savings.takenBack", { amount: shown }));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={record.name}>
      <p className={styles.hint}>{record.name}</p>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.savings.amount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className={styles.amountInput} required autoFocus />
        </label>
        {tooMuch && <p className={`${styles.wide} ${styles.hint}`}>{t("expenses.savings.tooMuch", { amount: formatAriary(held, locale) })}</p>}
        {pockets.wallets.length > 0 && (
          <div className={styles.wide}>
            <WalletChips label={t(sign > 0 ? "expenses.savings.fromPocket" : "expenses.savings.toPocket")} wallets={pockets.wallets} value={wallet} onChange={setWallet} />
          </div>
        )}
      </div>
      <FormButtons valid={valid} onCancel={onDone} />
    </form>
  );
}

/** The tontine's pot, received: how much, and into which pocket. */
function PotForm({ tontine, pockets, onDone }: { tontine: Tontine; pockets: PocketChoice; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(String(tontine.amountMga * tontine.members));
  const [wallet, setWallet] = useState(() => startingWallet(pockets, undefined));
  const value = parseAmount(amount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value === undefined) return;
    haptics.success();
    await expenseStore.setPotReceived(tontine.id, { amountMga: value, wallet: wallet || undefined });
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.savings.potTitle")}>
      <p className={styles.hint}>{tontine.name}</p>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.savings.amount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className={styles.amountInput} required autoFocus />
        </label>
        {pockets.wallets.length > 0 && (
          <div className={styles.wide}>
            <WalletChips label={t("expenses.savings.toPocket")} wallets={pockets.wallets} value={wallet} onChange={setWallet} />
          </div>
        )}
      </div>
      <FormButtons valid={value !== undefined} onCancel={onDone} />
    </form>
  );
}
