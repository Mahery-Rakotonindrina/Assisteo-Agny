import { useMemo, useRef, useState } from "react";
import { FileStack, Loader2, Scale, Upload } from "lucide-react";
import { Button } from "@/components/Button";
import { useLinkedLoans } from "@/components/Loans/RepaymentPrompt";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useTranslation } from "@/hooks/useTranslation";
import type { Statement } from "@/lib/ai/schema";
import { incomeKinds, type ExpenseRecord, type IncomeKind, type StatementTag } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { repaymentKeys, repaymentProposal } from "@/lib/loanLink";
import type { Loan } from "@/lib/loans";
import {
  balanceProposal,
  importDrafts,
  isAriaryStatement,
  isStatementKey,
  knownOperations,
  markDuplicates,
  otherWallet,
  statementLines,
  statementTag,
  statementTotals,
  suggestedWallet,
  type StatementLine,
} from "@/lib/statement";
import { activeWallets, type WalletBook } from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { loanStore } from "@/services/loanStore";
import { pickStatementFiles, readStatementFiles } from "@/services/statementImport";
import { ApiError } from "@/types/api";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";
import { WalletChips } from "./WalletChips";

type Props = { records: ExpenseRecord[]; book?: WalletBook };

type Read = { statement: Statement; lines: StatementLine[]; demo: boolean };
type Done = { added: number; already: number; wallet?: string };
type Step = { step: "pick"; error?: string } | { step: "reading" } | ({ step: "review" } & Read) | ({ step: "done" } & Done & Read);

/** "Importé · Relevé MVola du 1 oct. au 31 oct.": on a line imported from a statement. */
export function ImportedBadge({ record }: { record?: { sourceKey?: string; statement?: StatementTag } }) {
  const { t, locale } = useTranslation();
  if (!record || !isStatementKey(record.sourceKey)) return null;
  const tag = record.statement;
  const text = !tag
    ? t("expenses.statement.imported")
    : tag.from !== undefined && tag.to !== undefined
      ? t("expenses.statement.tag", { name: tag.name, from: formatDate(tag.from, locale), to: formatDate(tag.to, locale) })
      : t("expenses.statement.tagNoPeriod", { name: tag.name });
  return <span className={styles.badge}>{text}</span>;
}

/**
 * "Importer un relevé": screenshots of a Mobile Money history or a bank
 * statement's PDF, read by the AI, checked line by line, then imported as
 * ordinary expenses, incomes and moves between pockets. Nothing of the files
 * is kept. The same statement imported again adds nothing.
 */
export function StatementImport({ records, book }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        size="lg"
        variant="secondary"
        icon={<FileStack />}
        onClick={() => {
          setSession(session + 1);
          setOpen(true);
        }}
      >
        {t("expenses.statement.open")}
      </Button>
      <ExpenseSheet open={open} title={t("expenses.statement.title")} onClose={() => setOpen(false)}>
        {open && <StatementFlow key={session} records={records} book={book} onClose={() => setOpen(false)} />}
      </ExpenseSheet>
    </>
  );
}

function StatementFlow({ records, book, onClose }: Props & { onClose: () => void }) {
  const { t, locale } = useTranslation();
  const sources = useExpenseSources();
  // With "Prêts": a line counted as a repayment already is there already.
  const loans = useLinkedLoans();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Step>({ step: "pick" });

  const read = async (files: File[]) => {
    const pick = pickStatementFiles(files);
    if ("error" in pick) return setState({ step: "pick", error: t(`expenses.statement.errors.${pick.error}`) });
    setState({ step: "reading" });
    try {
      const response = await readStatementFiles(pick, locale);
      if (!isAriaryStatement(response.statement)) return setState({ step: "pick", error: t("expenses.statement.errors.currency") });
      const repaid = repaymentKeys(loans);
      const lines = markDuplicates(statementLines(response.statement, Date.now()), knownOperations(records, sources)).map((line) =>
        !line.duplicate && repaid.has(line.key) ? { ...line, duplicate: "imported" as const } : line,
      );
      const found: Read = { statement: response.statement, lines, demo: response.demo };
      if (lines.length === 0) return setState({ step: "pick", error: t("expenses.statement.errors.empty") });
      // Everything there already: nothing to check.
      setState(lines.every((line) => line.duplicate) ? { step: "done", ...found, added: 0, already: lines.length } : { step: "review", ...found });
    } catch (error) {
      setState({ step: "pick", error: errorText(error, t) });
    }
  };

  if (state.step === "reading")
    return (
      <p className={styles.statementStatus} role="status">
        <Loader2 className={styles.spin} size={18} aria-hidden />
        {t("expenses.statement.reading")}
      </p>
    );
  if (state.step === "review") return <Review {...state} records={records} book={book} loans={loans} onDone={(done) => setState({ ...state, ...done, step: "done" })} />;
  if (state.step === "done") return <Result {...state} book={book} onClose={onClose} />;

  return (
    <div className={styles.form}>
      <p className={styles.hint}>{t("expenses.statement.intro")}</p>
      <p className={styles.hint}>{t("expenses.statement.privacy")}</p>
      {state.error && (
        <p className={styles.statementError} role="alert">
          {state.error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        data-testid="statement-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void read(files);
        }}
      />
      <Button block icon={<Upload />} onClick={() => input.current?.click()}>
        {t("expenses.statement.choose")}
      </Button>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function errorText(error: unknown, t: Translate) {
  const code = error instanceof ApiError ? error.code : "unknown";
  const known = ["network", "plan_limit", "plan_required", "rate_limited", "sign_in_required", "invalid_request", "refused"];
  return t(`expenses.statement.errors.${known.includes(code) ? code : "failed"}`);
}

type ReviewProps = Read & { records: ExpenseRecord[]; book?: WalletBook; loans: Loan[]; onDone: (done: Done) => void };

/** One line per operation: checked, unless it is there already; its category, and the other pocket of a move. */
function Review({ statement, lines, demo, records, book, loans, onDone }: ReviewProps) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { categories } = useExpenseLabels(records);
  const wallets = useMemo(() => activeWallets(book?.context.wallets ?? []), [book]);
  const [wallet, setWallet] = useState(() => suggestedWallet(wallets, statement)?.id ?? book?.context.primary?.id ?? wallets[0]?.id ?? "");
  const [checked, setChecked] = useState(() => new Set(lines.filter((line) => !line.duplicate).map((line) => line.key)));
  const [categoryOf, setCategoryOf] = useState<Record<string, string>>({});
  const [incomeOf, setIncomeOf] = useState<Record<string, IncomeKind>>({});
  const [otherOf, setOtherOf] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  // "Remboursement de Rakoto" ("Prêts"): unchecked by default; checked, the line is a repayment, not an income or an expense.
  const [repayOf, setRepayOf] = useState<Set<string>>(() => new Set());
  const money = (value: number) => formatAriary(value, locale);
  const proposals = useMemo(
    () =>
      new Map(
        lines.flatMap((line) => {
          if (line.duplicate || line.direction === "own") return [];
          const proposal = repaymentProposal(loans, { key: line.key, at: line.at, amountMga: line.amountMga, label: line.counterparty, ...(line.direction === "in" && { flow: "income" as const }) });
          return proposal && !proposal.same ? [[line.key, proposal] as const] : [];
        }),
      ),
    [lines, loans],
  );

  const other = (line: StatementLine) => otherOf[line.key] ?? otherWallet(wallets, wallet, line);
  // A move between pockets needs the statement's pocket and another one.
  const movable = (line: StatementLine) => line.direction !== "own" || Boolean(wallet && other(line) && other(line) !== wallet);
  const chosen = lines.filter((line) => checked.has(line.key) && movable(line));
  const totals = statementTotals(chosen);
  const already = lines.filter((line) => line.duplicate).length;
  const tag = statementTag(statement, lines, t("expenses.statement.defaultName"));

  const toggle = (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  };

  const run = async () => {
    if (importing) return;
    setImporting(true);
    haptics.success();
    try {
      // Read again just before writing: a line imported meanwhile (or twice in a row) is never added again.
      const taken = new Set((await expenseStore.list()).flatMap((record) => ("sourceKey" in record && record.sourceKey ? [record.sourceKey] : [])));
      const fresh = chosen
        .filter((line) => !taken.has(line.key))
        .map((line) => ({ ...line, category: categoryOf[line.key] ?? line.category, income: incomeOf[line.key] ?? line.income }));
      const others = Object.fromEntries(fresh.map((line) => [line.key, other(line)]));
      const repaying = fresh.filter((line) => repayOf.has(line.key) && proposals.has(line.key));
      const options = { wallet: wallets.find((item) => item.id === wallet), tag, others, feesNote: t("expenses.statement.feesNote", { name: tag.name }) };
      const drafts = importDrafts(
        fresh.filter((line) => !repaying.includes(line)),
        options,
      );
      // A repayment: on its loan, in the statement's pocket; only its fees are an expense.
      for (const line of repaying) {
        const proposal = proposals.get(line.key)!;
        await loanStore.addRepayment(proposal.loan.id, { amountMga: proposal.amountMga, at: line.at, wallet: wallet || undefined, sourceKey: line.key });
        drafts.expenses.push(...importDrafts([line], options).expenses.filter((draft) => draft.sourceKey !== line.key));
      }
      for (const draft of drafts.expenses) await expenseStore.saveExpense(draft);
      for (const draft of drafts.incomes) await expenseStore.saveIncome(draft);
      for (const draft of drafts.transfers) await expenseStore.saveTransfer(draft);
      onDone({ added: fresh.length, already: lines.filter((line) => line.duplicate || taken.has(line.key)).length, wallet: wallet || undefined });
    } catch {
      toast(t("expenses.statement.errors.save"), "error");
      setImporting(false);
    }
  };

  const lineTitle = (line: StatementLine) => line.counterparty ?? t(`expenses.statement.kinds.${line.direction === "own" ? (line.ownKind ?? "transfer") : line.direction}`);

  return (
    <div className={styles.form}>
      <p className={styles.statementHead}>
        <strong>{tag.from !== undefined && tag.to !== undefined ? t("expenses.statement.heading", { name: tag.name, from: formatDate(tag.from, locale), to: formatDate(tag.to, locale) }) : tag.name}</strong>
        {demo && <small>{t("expenses.statement.demo")}</small>}
      </p>
      {wallets.length > 0 ? (
        <WalletChips label={t("expenses.statement.wallet")} wallets={wallets} value={wallet} onChange={setWallet} />
      ) : (
        <p className={styles.hint}>{t("expenses.statement.noWallet")}</p>
      )}
      <p className={styles.statementTotals} data-testid="statement-totals">
        {t("expenses.statement.totals", { count: totals.count, out: money(totals.out), in: money(totals.in) })}
        {already > 0 && <small>{t("expenses.statement.alreadyCount", { count: already })}</small>}
      </p>
      <ul className={styles.statementLines}>
        {lines.map((line) => {
          const canMove = movable(line);
          const on = checked.has(line.key) && canMove;
          return (
            <li key={line.key} className={styles.statementLine} data-off={!on || undefined} data-testid="statement-line">
              <label className={styles.statementCheck}>
                <input type="checkbox" checked={on} disabled={!canMove} onChange={() => toggle(line.key)} />
                <span className={styles.entryText}>
                  <strong>{lineTitle(line)}</strong>
                  <small>
                    {line.duplicate && (
                      <span className={styles.badge} data-tone="warning">
                        {t("expenses.statement.already")}
                      </span>
                    )}
                    {[formatDate(line.at, locale), line.feesMga > 0 && t("expenses.statement.fees", { amount: money(line.feesMga) })].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <span className={styles.amount} data-tone={line.side === "credit" ? "good" : undefined}>
                  {line.side === "credit" ? "+" : "−"}
                  {money(line.amountMga)}
                </span>
              </label>
              {on && line.direction === "out" && (
                <select
                  className={styles.statementSelect}
                  aria-label={t("expenses.form.category")}
                  value={categoryOf[line.key] ?? line.category}
                  onChange={(event) => setCategoryOf({ ...categoryOf, [line.key]: event.target.value })}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              )}
              {on && line.direction === "in" && (
                <select
                  className={styles.statementSelect}
                  aria-label={t("expenses.income.kind")}
                  value={incomeOf[line.key] ?? line.income}
                  onChange={(event) => setIncomeOf({ ...incomeOf, [line.key]: event.target.value as IncomeKind })}
                >
                  {incomeKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`expenses.incomes.${kind}`)}
                    </option>
                  ))}
                </select>
              )}
              {line.direction === "own" &&
                (canMove ? (
                  on && (
                    <select
                      className={styles.statementSelect}
                      aria-label={t(line.side === "debit" ? "expenses.statement.to" : "expenses.statement.from")}
                      value={other(line)}
                      onChange={(event) => setOtherOf({ ...otherOf, [line.key]: event.target.value })}
                    >
                      {wallets
                        .filter((item) => item.id !== wallet)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {t(line.side === "debit" ? "expenses.statement.toWallet" : "expenses.statement.fromWallet", { name: item.name })}
                          </option>
                        ))}
                    </select>
                  )
                ) : (
                  <small className={styles.hint}>{t("expenses.statement.ownNeedsWallets")}</small>
                ))}
              {on && proposals.has(line.key) && (
                <label className={styles.statementCheck} data-testid="statement-repayment">
                  <input
                    type="checkbox"
                    checked={repayOf.has(line.key)}
                    onChange={() => {
                      const next = new Set(repayOf);
                      if (next.has(line.key)) next.delete(line.key);
                      else next.add(line.key);
                      setRepayOf(next);
                    }}
                  />
                  <small>{t(`loans.link.statement.${proposals.get(line.key)!.loan.direction}`, { name: proposals.get(line.key)!.person })}</small>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <Button block onClick={() => void run()} disabled={importing || chosen.length === 0}>
        {t("expenses.statement.import", { count: chosen.length })}
      </Button>
    </div>
  );
}

/** What was done, and the pocket's balance put right when the statement says otherwise. */
function Result({ statement, lines, added, already, wallet, book, onClose }: Done & Read & { book?: WalletBook; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [corrected, setCorrected] = useState(false);
  const proposal = book && !corrected ? balanceProposal(book, wallet, statement, lines) : null;
  const name = wallet ? book?.context.byId.get(wallet)?.name : undefined;

  return (
    <div className={styles.form}>
      <p className={styles.statementStatus} role="status" data-testid="statement-result">
        {t("expenses.statement.result", { added, already })}
      </p>
      {proposal && wallet && name && (
        <div className={styles.tip}>
          <p>{t("expenses.statement.balance", { name, amount: formatAriary(proposal.actual, locale), held: formatAriary(proposal.held, locale) })}</p>
          <Button
            variant="secondary"
            icon={<Scale />}
            onClick={() => {
              void expenseStore.correctWallet(wallet, proposal.difference).then(() => {
                setCorrected(true);
                toast(t("expenses.statement.balanceDone", { name }));
              });
            }}
          >
            {t("expenses.statement.balanceYes", { name, amount: formatAriary(proposal.actual, locale) })}
          </Button>
        </div>
      )}
      <Button block variant={proposal ? "ghost" : "primary"} onClick={onClose}>
        {t("expenses.statement.close")}
      </Button>
    </div>
  );
}
