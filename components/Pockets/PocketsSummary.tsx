import Link from "next/link";
import { ChevronRight, Wallet as WalletIcon } from "lucide-react";
import ex from "@/components/Expenses/Expenses.module.scss";
import { useBalanceMask } from "@/hooks/useBalanceMask";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary } from "@/lib/format";
import { activeWallets, pendingMoves, pocketPreview, type WalletBook } from "@/lib/wallets";
import { Masked } from "./Masked";
import styles from "./Pockets.module.scss";

/**
 * "Dans tes poches", under "Il te reste": the total, then one line per
 * pocket (the first 4, "+ N autres" after), a link to "Mes poches". The
 * first time, the question that leads there.
 */
export function PocketsSummary({ book, now }: { book: WalletBook; now: number }) {
  const { t, locale } = useTranslation();
  const money = (value: number) => formatAriary(value, locale);
  const mask = useBalanceMask();
  const { wallets } = book.context;
  if (wallets.length === 0)
    return (
      <Link href="/pockets" className={ex.pocketsLine} data-testid="pockets-link">
        <WalletIcon size={18} aria-hidden />
        <span>{t("expenses.pockets.ask")}</span>
        <ChevronRight size={18} aria-hidden />
      </Link>
    );

  const { shown, more } = pocketPreview(activeWallets(wallets));
  const pending = pendingMoves(book, now);
  return (
    <Link href="/pockets" className={`${ex.pocketsLine} ${styles.summary}`} data-testid="pockets-link">
      <WalletIcon size={18} aria-hidden />
      <span className={styles.summaryText}>
        <span>
          {t("expenses.pockets.inPockets")} <strong data-testid="pockets-total">
            <Masked hidden={mask.totalHidden(activeWallets(wallets).map((item) => item.id))}>{money(book.total)}</Masked>
          </strong>
        </span>
        <span className={styles.summaryRows}>
          {shown.map((wallet) => {
            const balance = book.balances.get(wallet.id) ?? 0;
            return (
              <span key={wallet.id} className={styles.summaryRow} data-testid="pockets-row">
                <span>{wallet.name}</span> <strong data-tone={balance < 0 ? "bad" : undefined}><Masked hidden={mask.hidden(wallet.id)}>{money(balance)}</Masked>
                </strong>
              </span>
            );
          })}
          {more > 0 && <small data-testid="pockets-more">{t(more === 1 ? "expenses.pockets.moreOne" : "expenses.pockets.more", { count: more })}</small>}
        </span>
        {pending.length > 0 && (
          <span className={ex.badge} data-tone="warning">
            {t("expenses.pockets.pendingCount", { count: pending.length })}
          </span>
        )}
        <small className={styles.summaryOpen}>{t("expenses.pockets.open")}</small>
      </span>
      <ChevronRight size={18} aria-hidden />
    </Link>
  );
}
