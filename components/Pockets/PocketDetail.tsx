import Link from "next/link";
import { useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, ArrowLeftRight, ChevronRight, Ellipsis, Eye, EyeOff, Pencil, Scale, Star, Trash2, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/Button";
import ex from "@/components/Expenses/Expenses.module.scss";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import { walletIcons, useWalletTypeName } from "@/components/Expenses/WalletChips";
import { useToast } from "@/components/Toast";
import { useBalanceMask } from "@/hooks/useBalanceMask";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { monthStart, type ExpenseRecord, type Wallet } from "@/lib/expenses";
import { BALANCE_MASK } from "@/lib/balanceMask";
import { formatAriary, formatDate, formatMonthYear } from "@/lib/format";
import type { Loan } from "@/lib/loans";
import { activeWallets, correctionId, movementTarget, pocketStatement, walletColors, walletInUse, type Movement, type StatementLine, type WalletBook } from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { Masked } from "./Masked";
import styles from "./Pockets.module.scss";

type Props = {
  book: WalletBook;
  records: ExpenseRecord[];
  /** Every loan, the feature on or not: a pocket a loan names is never removed. */
  loans: Loan[];
  wallet: Wallet;
  /** A phone: back to the list. */
  onBack?: () => void;
  onTransfer: () => void;
  onCorrect: () => void;
  onEdit: () => void;
  /** The pocket is gone: back to the list. */
  onRemoved: () => void;
};

/**
 * A pocket's sheet: what it holds in big, "Virement" and "Corriger le
 * solde", the rest in "Plus", then its statement (the latest first, by
 * month, the balance after each line). A line opens its page; back returns
 * here.
 */
export function PocketDetail({ book, records, loans, wallet, onBack, onTransfer, onCorrect, onEdit, onRemoved }: Props) {
  const { t, locale } = useTranslation();
  const typeName = useWalletTypeName();
  const { categoryName } = useExpenseLabels(records);
  const [more, setMore] = useState(false);
  // A correction's line, opened in its window.
  const [correction, setCorrection] = useState<StatementLine | null>(null);
  const money = (value: number) => formatAriary(value, locale);
  const mask = useBalanceMask();
  const balanceHidden = mask.hidden(wallet.id);
  const signed = (value: number) => `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;
  const { wallets, primary } = book.context;
  const balance = book.balances.get(wallet.id) ?? 0;
  const months = pocketStatement(book, wallet.id);
  const Icon = walletIcons[wallet.type] ?? WalletIcon;
  const canMove = !wallet.archived && activeWallets(wallets).length > 1;

  const describe = (movement: Movement) => {
    if (movement.type === "correction") return t("expenses.pockets.correction");
    if (movement.loan) return t(`expenses.pockets.loan.${movement.loan.type}`, { name: movement.label ?? "" });
    if (movement.type === "saved" || movement.type === "unsaved" || movement.type === "pot") return [t(`expenses.savings.movement.${movement.type}`), movement.label].filter(Boolean).join(" · ");
    if (movement.type === "move_in" || movement.type === "move_out") return [t("expenses.pockets.move"), movement.label].filter(Boolean).join(" · ");
    if (movement.origin === "fees") return t("expenses.feesLabel");
    if (movement.type === "income") return movement.label || t("expenses.pockets.income");
    return movement.label || categoryName(movement.category ?? "other");
  };

  const line = (item: StatementLine) => {
    const target = movementTarget(item);
    const corrected = correctionId(item);
    const content = (
      <>
        <span className={styles.lineText}>
          <span>{describe(item)}</span>
          <small>
            {formatDate(item.at, locale)}
            {item.pending && ` · ${t("expenses.pockets.toChoose")}`}
          </small>
        </span>
        <span className={ex.statementAmount}>
          <strong data-tone={item.amountMga < 0 ? "out" : "in"}>{signed(item.amountMga)}</strong>
          <small data-testid="pocket-line-balance">
            <Masked hidden={balanceHidden} masked={t("expenses.pockets.balanceAfter", { amount: BALANCE_MASK })}>
              {t("expenses.pockets.balanceAfter", { amount: money(item.balanceMga) })}
            </Masked>
          </small>
        </span>
      </>
    );
    return (
      <li key={`${item.key}:${item.type}`} data-testid="pocket-line">
        {target ? (
          <Link href={target} className={styles.line} data-testid={item.loan ? "pocket-loan" : "pocket-open"}>
            {content}
            <ChevronRight size={16} className={styles.chevron} aria-hidden />
          </Link>
        ) : corrected ? (
          <button type="button" className={styles.line} onClick={() => setCorrection(item)} data-testid="pocket-correction">
            {content}
            <ChevronRight size={16} className={styles.chevron} aria-hidden />
          </button>
        ) : (
          <div className={styles.line}>{content}</div>
        )}
      </li>
    );
  };

  return (
    <div className={styles.column} data-testid="pocket-detail">
      {onBack && (
        <button type="button" className={`${ex.linkButton} ${styles.back}`} onClick={onBack}>
          <ArrowLeft size={18} aria-hidden /> {t("expenses.pockets.back")}
        </button>
      )}

      <section className={styles.head}>
        <div className={styles.headTop}>
          <span className={styles.icon} data-size="lg" style={{ "--tone": walletColors[wallet.type] } as React.CSSProperties} aria-hidden>
            <Icon size={24} />
          </span>
          <span className={styles.text}>
            <h2 data-testid="pocket-name">{wallet.name}</h2>
            <small>
              {typeName(wallet.type)}
              {wallet.archived && ` · ${t("expenses.pockets.archivedOne")}`}
            </small>
            {wallet.id === primary?.id && <span className={ex.badge}>{t("expenses.pockets.default")}</span>}
          </span>
        </div>
        <small>{t("expenses.pockets.balanceNow")}</small>
        <strong className={styles.bigBalance} data-testid="pocket-balance" data-tone={balance < 0 ? "bad" : undefined}>
          <Masked hidden={balanceHidden}>{money(balance)}</Masked>
        </strong>
      </section>

      <div className={styles.listActions}>
        {canMove && (
          <Button icon={<ArrowLeftRight />} onClick={onTransfer}>
            {t("expenses.pockets.transferShort")}
          </Button>
        )}
        {!wallet.archived && (
          <Button variant="secondary" icon={<Scale />} onClick={onCorrect}>
            {t("expenses.pockets.correct")}
          </Button>
        )}
        <Button variant="ghost" icon={<Ellipsis />} onClick={() => setMore(true)} aria-label={t("expenses.pockets.moreActions")} data-testid="pocket-more">
          {t("expenses.pockets.moreShort")}
        </Button>
      </div>

      <section aria-label={t("expenses.pockets.statement")} className={ex.statement}>
        <h3 className={ex.subTitle}>{t("expenses.pockets.statement")}</h3>
        {months.length === 0 && <p className={ex.hint}>{t("expenses.pockets.noMovement")}</p>}
        {months.map(({ month, lines }) => (
          <div key={month}>
            <h4 className={ex.statementMonth}>{formatMonthYear(monthStart(month), locale)}</h4>
            <ul className={styles.lines}>{lines.map(line)}</ul>
          </div>
        ))}
        <p className={ex.hint} data-testid="pocket-start">
          {t("expenses.pockets.startLine")} :{" "}
          <Masked hidden={balanceHidden} masked={t("expenses.pockets.since", { amount: BALANCE_MASK, date: formatDate(wallet.startAt, locale) })}>
            {t("expenses.pockets.since", { amount: money(wallet.startMga), date: formatDate(wallet.startAt, locale) })}
          </Masked>
        </p>
      </section>

      <ExpenseSheet open={correction !== null} title={t("expenses.pockets.correction")} onClose={() => setCorrection(null)}>
        {correction && <CorrectionView line={correction} walletName={wallet.name} onDone={() => setCorrection(null)} />}
      </ExpenseSheet>

      <ExpenseSheet open={more} title={wallet.name} onClose={() => setMore(false)}>
        {more && (
          <MoreActions
            wallet={wallet}
            isPrimary={wallet.id === primary?.id}
            used={walletInUse(records, loans, book, wallet.id)}
            balanceHidden={balanceHidden}
            onToggleBalance={() => mask.flipOne(wallet.id, wallets.map((item) => item.id))}
            onEdit={() => {
              setMore(false);
              onEdit();
            }}
            onDone={() => setMore(false)}
            onRemoved={() => {
              setMore(false);
              onRemoved();
            }}
          />
        )}
      </ExpenseSheet>
    </div>
  );
}

/** A correction: what it changed, when, and on which pocket; removed (asked first), the balance goes back to what it was. */
function CorrectionView({ line, walletName, onDone }: { line: StatementLine; walletName: string; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const id = correctionId(line);
  const amount = `${line.amountMga > 0 ? "+" : "−"}${formatAriary(Math.abs(line.amountMga), locale)}`;

  const remove = async () => {
    if (!id) return;
    haptics.success();
    await expenseStore.remove(id);
    toast(t("expenses.pockets.correctionRemoved"));
    onDone();
  };

  return (
    <div className={ex.form} data-testid="correction-view">
      <p className={styles.correctionAmount}>
        <strong data-tone={line.amountMga < 0 ? "out" : "in"}>{amount}</strong>
        <small>
          {walletName} · {formatDate(line.at, locale)}
        </small>
      </p>
      <p className={ex.hint}>{t("expenses.pockets.correctionWhat")}</p>
      {asking ? (
        <>
          <p>{t("expenses.pockets.correctionAsk")}</p>
          <div className={ex.row}>
            <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
              {t("expenses.pockets.removeConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t("expenses.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <div className={ex.row}>
          <Button variant="ghost" icon={<Trash2 />} onClick={() => setAsking(true)}>
            {t("expenses.pockets.correctionRemove")}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            {t("expenses.close")}
          </Button>
        </div>
      )}
    </div>
  );
}

type MoreProps = { wallet: Wallet; isPrimary: boolean; used: boolean; balanceHidden: boolean; onToggleBalance: () => void; onEdit: () => void; onDone: () => void; onRemoved: () => void };

/** "Plus": big lines to edit the pocket, make it the default one, archive it or remove it (only when nothing uses it). */
function MoreActions({ wallet, isPrimary, used, balanceHidden, onToggleBalance, onEdit, onDone, onRemoved }: MoreProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [asking, setAsking] = useState(false);

  const archive = async () => {
    haptics.tap();
    await expenseStore.setWalletArchived(wallet.id, !wallet.archived);
    onDone();
  };

  const remove = async () => {
    haptics.success();
    await expenseStore.remove(wallet.id);
    toast(t("expenses.pockets.removed"));
    onRemoved();
  };

  if (asking)
    return (
      <div className={ex.form}>
        <p>{t("expenses.pockets.removeAsk", { name: wallet.name })}</p>
        <div className={ex.row}>
          <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
            {t("expenses.pockets.removeConfirm")}
          </Button>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            {t("expenses.cancel")}
          </Button>
        </div>
      </div>
    );

  return (
    <div className={ex.form}>
      <ul className={styles.menu}>
        <li>
          <button type="button" onClick={onEdit}>
            <Pencil size={20} aria-hidden />
            <span>
              <strong>{t("expenses.pockets.edit")}</strong>
              <small>{t("expenses.pockets.editHint")}</small>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            data-testid="pocket-toggle-balance"
            onClick={() => {
              haptics.tap();
              onToggleBalance();
              onDone();
            }}
          >
            {balanceHidden ? <Eye size={20} aria-hidden /> : <EyeOff size={20} aria-hidden />}
            <span>
              <strong>{t(balanceHidden ? "expenses.pockets.showBalance" : "expenses.pockets.hideBalance")}</strong>
            </span>
          </button>
        </li>
        {!wallet.archived && !isPrimary && (
          <li>
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                void expenseStore.setPrimaryWallet(wallet.id).then(onDone);
              }}
            >
              <Star size={20} aria-hidden />
              <span>
                <strong>{t("expenses.pockets.makeDefault")}</strong>
                <small>{t("expenses.pockets.makeDefaultHint")}</small>
              </span>
            </button>
          </li>
        )}
        <li>
          <button type="button" onClick={() => void archive()}>
            {wallet.archived ? <ArchiveRestore size={20} aria-hidden /> : <Archive size={20} aria-hidden />}
            <span>
              <strong>{t(wallet.archived ? "expenses.pockets.unarchive" : "expenses.pockets.archive")}</strong>
              {!wallet.archived && <small>{t("expenses.pockets.archiveHint")}</small>}
            </span>
          </button>
        </li>
        {used ? (
          <li>
            <p className={ex.hint} data-testid="pocket-in-use">
              {t("expenses.pockets.inUse")}
            </p>
          </li>
        ) : (
          <li>
            <button type="button" data-tone="danger" onClick={() => setAsking(true)}>
              <Trash2 size={20} aria-hidden />
              <span>
                <strong>{t("expenses.pockets.remove")}</strong>
              </span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
