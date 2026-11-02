import { useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronDown, ChevronRight, ListOrdered, Plus, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/Button";
import ex from "@/components/Expenses/Expenses.module.scss";
import { WalletChips, walletIcons } from "@/components/Expenses/WalletChips";
import { useTranslation } from "@/hooks/useTranslation";
import { arrivalKey, type Wallet } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { activeWallets, movedOrder, walletColors, type PocketMove, type WalletBook } from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import styles from "./Pockets.module.scss";

type Props = {
  book: WalletBook;
  pending: PocketMove[];
  /** The pocket shown next to the list (a computer). */
  selectedId?: string;
  onOpen: (id: string) => void;
  onTransfer: () => void;
  onAdd: () => void;
};

/**
 * "Mes poches": all the money in big, the moves to finish, a card per
 * pocket (a tap opens it), one more, "Virement", "Réordonner" (↑ ↓ on each
 * card), how it works and the archived ones.
 */
export function PocketList({ book, pending, selectedId, onOpen, onTransfer, onAdd }: Props) {
  const { t, locale } = useTranslation();
  const [reordering, setReordering] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const money = (value: number) => formatAriary(value, locale);
  const { wallets, primary, byId } = book.context;
  const active = activeWallets(wallets);
  const archived = wallets.filter((wallet) => wallet.archived);

  const reorder = async (ids: string[] | null) => {
    if (!ids) return;
    haptics.tap();
    await expenseStore.setWalletOrder(ids);
  };

  const card = (wallet: Wallet) => {
    const balance = book.balances.get(wallet.id) ?? 0;
    const Icon = walletIcons[wallet.type] ?? WalletIcon;
    const body = (
      <>
        <span className={styles.icon} style={{ "--tone": walletColors[wallet.type] } as React.CSSProperties} aria-hidden>
          <Icon size={20} />
        </span>
        {/* The name, then the balance under it: every card the same height, whatever the amount or the text size. */}
        <span className={styles.text}>
          <span className={styles.nameRow}>
            <strong>{wallet.name}</strong>
            {wallet.id === primary?.id && <span className={ex.badge}>{t("expenses.pockets.default")}</span>}
          </span>
          <strong className={styles.balance} data-testid="wallet-balance" data-wallet={wallet.name} data-tone={balance < 0 ? "bad" : undefined}>
            {money(balance)}
          </strong>
        </span>
      </>
    );
    if (reordering && !wallet.archived) {
      const up = movedOrder(wallets, wallet.id, -1);
      const down = movedOrder(wallets, wallet.id, 1);
      return (
        <li key={wallet.id} className={styles.card} data-reorder data-testid="pocket-card">
          {body}
          <span className={styles.arrows}>
            <button type="button" className={styles.arrow} disabled={!up} onClick={() => void reorder(up)} aria-label={t("expenses.pockets.moveUpNamed", { name: wallet.name })}>
              <ArrowUp size={20} aria-hidden />
            </button>
            <button type="button" className={styles.arrow} disabled={!down} onClick={() => void reorder(down)} aria-label={t("expenses.pockets.moveDownNamed", { name: wallet.name })}>
              <ArrowDown size={20} aria-hidden />
            </button>
          </span>
        </li>
      );
    }
    return (
      <li key={wallet.id}>
        <button type="button" className={styles.card} data-current={wallet.id === selectedId || undefined} data-archived={wallet.archived || undefined} onClick={() => onOpen(wallet.id)} data-testid="pocket-card">
          {body}
          <ChevronRight size={18} className={styles.chevron} aria-hidden />
        </button>
      </li>
    );
  };

  return (
    <div className={styles.column}>
      <section className={styles.total} aria-label={t("expenses.pockets.allMoney")}>
        <small>{t("expenses.pockets.allMoney")}</small>
        <strong data-testid="pockets-all" data-tone={book.total < 0 ? "bad" : undefined}>
          {money(book.total)}
        </strong>
        {/* Nothing looks lost: what was set aside left the pockets. */}
        {book.saved > 0 && (
          <p className={ex.hint} data-testid="pockets-saved">
            {t("expenses.savings.inPockets", { amount: money(book.saved) })}
          </p>
        )}
      </section>

      {pending.length > 0 && (
        <section aria-labelledby="pockets-pending" className={ex.pending}>
          <h2 id="pockets-pending" className={ex.subTitle}>
            {t("expenses.pockets.pendingTitle")}
          </h2>
          <p className={ex.hint}>{t("expenses.pockets.pendingHint")}</p>
          {pending.map((move) => (
            <div key={move.key} className={ex.pendingMove}>
              <strong>
                {t("expenses.pockets.pendingMove", { amount: money(move.amountMga), date: formatDate(move.at, locale) })}
                {move.label && ` · ${move.label}`}
              </strong>
              {!move.from && <WalletChips label={t("expenses.pockets.fromWhich")} wallets={active} value="" onChange={(id) => void expenseStore.setWalletPick(move.key, id)} />}
              {move.from && <small className={ex.hint}>{t("expenses.pockets.fromName", { name: byId.get(move.from)?.name ?? "" })}</small>}
              {!move.to && (
                <WalletChips
                  label={t("expenses.pockets.toWhich")}
                  wallets={active.filter((wallet) => wallet.id !== move.from)}
                  value=""
                  onChange={(id) => void expenseStore.setWalletPick(arrivalKey(move.key), id)}
                />
              )}
            </div>
          ))}
        </section>
      )}

      <ul className={styles.cards} aria-label={t("expenses.pockets.title")}>
        {active.map(card)}
        {!reordering && (
          <li>
            <button type="button" className={`${styles.card} ${styles.addCard}`} onClick={onAdd}>
              <Plus size={20} aria-hidden />
              <span className={styles.text}>
                <strong>{t("expenses.pockets.add")}</strong>
              </span>
            </button>
          </li>
        )}
      </ul>

      <div className={styles.listActions}>
        {reordering ? (
          <Button icon={<Check />} onClick={() => setReordering(false)}>
            {t("expenses.pockets.reorderDone")}
          </Button>
        ) : (
          <>
            {active.length > 1 && (
              <Button icon={<ArrowLeftRight />} onClick={onTransfer}>
                {t("expenses.pockets.transferShort")}
              </Button>
            )}
            {active.length > 1 && (
              <Button variant="secondary" icon={<ListOrdered />} onClick={() => setReordering(true)}>
                {t("expenses.pockets.reorder")}
              </Button>
            )}
          </>
        )}
      </div>
      {reordering && <p className={ex.hint}>{t("expenses.pockets.orderHint")}</p>}

      <div className={styles.how}>
        <button type="button" className={ex.linkButton} aria-expanded={showHow} onClick={() => setShowHow(!showHow)}>
          {t("expenses.pockets.howTitle")}
        </button>
        {showHow && (
          <ul data-testid="pockets-how">
            <li>{t("expenses.pockets.how1")}</li>
            <li>{t("expenses.pockets.how2")}</li>
            <li>{t("expenses.pockets.how3")}</li>
          </ul>
        )}
      </div>

      {archived.length > 0 && (
        <div>
          <button type="button" className={styles.fold} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            <span>{t("expenses.pockets.archived", { count: archived.length })}</span>
            <ChevronDown size={18} data-open={showArchived || undefined} aria-hidden />
          </button>
          {showArchived && <ul className={styles.cards}>{archived.map(card)}</ul>}
        </div>
      )}
    </div>
  );
}
