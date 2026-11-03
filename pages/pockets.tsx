import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { Eye, EyeOff, WalletCards } from "lucide-react";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import { AddForm, CorrectForm, EditForm, PocketDetail, PocketList, SetupForm, TransferForm, type TransferPreset } from "@/components/Pockets";
import styles from "@/components/Pockets/Pockets.module.scss";
import { Seo } from "@/components/Seo";
import { useExpenses } from "@/hooks/useExpenses";
import { useBalanceMask } from "@/hooks/useBalanceMask";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useWalletBook } from "@/hooks/useWalletBook";
import { rise, stagger } from "@/lib/motion";
import { activeWallets, pendingMoves } from "@/lib/wallets";

type Sheet = "transfer" | "add" | "correct" | "edit";

/** The pocket opened from the list on a phone: its back button then goes back in the history (Android's too). */
const OPENED_KEY = "pockets.opened";

/**
 * "Mes poches": where the money really is (cash, MVola, the bank…), a part of
 * "Mes dépenses" (same plan, same figures). On a phone, the list, then a
 * pocket at "?id=" (back returns to the list); on a computer, both side by
 * side. Pure display over the same records: an older app keeps its window.
 */
export default function PocketsPage() {
  const { t } = useTranslation();
  const { plan, has } = usePlan();
  // Null on the server and at hydration: nothing is shown until the plan is read.
  const known = plan !== null;

  return (
    <>
      <Seo title={`${t("expenses.pockets.title")} · ${t("meta.title")}`} noindex />
      {!known ? null : has("expenses") ? (
        <Pockets />
      ) : (
        <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
          <motion.header variants={rise} className={styles.header}>
            <h1>{t("expenses.pockets.title")}</h1>
            <p>{t("expenses.pockets.unavailable")}</p>
          </motion.header>
        </motion.div>
      )}
    </>
  );
}

function Pockets() {
  const { t } = useTranslation();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const now = useNow(60_000);
  const { records, isLoading } = useExpenses();
  // The same lines and loans as "Mes dépenses": the same balances.
  const sources = useExpenseSources();
  const { book, loans } = useWalletBook(records, sources, now);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [preset, setPreset] = useState<TransferPreset>({});
  const { wallets, byId, primary } = book.context;
  const active = activeWallets(wallets);
  const mask = useBalanceMask();
  const activeIds = active.map((wallet) => wallet.id);
  const eyeClosed = mask.allHidden(activeIds);
  const pending = wallets.length > 0 ? pendingMoves(book, now) : [];

  const askedId = typeof router.query.id === "string" ? router.query.id : null;
  // A pocket removed (here or on another device) leaves its sheet.
  const asked = askedId ? byId.get(askedId) : undefined;
  // A computer shows the first pocket until another is picked.
  const shown = asked ?? (isDesktop ? active[0] : undefined);

  const open = (id: string) => {
    if (isDesktop) {
      void router.replace({ pathname: router.pathname, query: { id } }, undefined, { shallow: true, scroll: false });
      return;
    }
    sessionStorage.setItem(OPENED_KEY, id);
    void router.push({ pathname: router.pathname, query: { id } }, undefined, { shallow: true });
  };
  // Back to the list: the way it came when opened from it, else in place (a link, a reload).
  const leave = () => {
    const fromList = sessionStorage.getItem(OPENED_KEY) === askedId;
    sessionStorage.removeItem(OPENED_KEY);
    if (fromList) router.back();
    else void router.replace({ pathname: router.pathname }, undefined, { shallow: true });
  };
  const transfer = (next: TransferPreset) => {
    setPreset(next);
    setSheet("transfer");
  };
  const close = () => setSheet(null);
  const titles: Record<Sheet, string> = {
    transfer: t("expenses.pockets.transfer"),
    add: t("expenses.pockets.add"),
    correct: t("expenses.pockets.correct"),
    edit: t("expenses.pockets.editTitle"),
  };

  const list = <PocketList book={book} pending={pending} selectedId={isDesktop ? shown?.id : undefined} onOpen={open} onTransfer={() => transfer({})} onAdd={() => setSheet("add")} />;
  const detail = shown && (
    <PocketDetail
      key={shown.id}
      book={book}
      records={records}
      loans={loans}
      wallet={shown}
      onBack={isDesktop ? undefined : leave}
      onTransfer={() => transfer({ from: shown.id })}
      onCorrect={() => setSheet("correct")}
      onEdit={() => setSheet("edit")}
      onRemoved={() => (isDesktop ? void router.replace({ pathname: router.pathname }, undefined, { shallow: true }) : leave())}
    />
  );
  const split = isDesktop && Boolean(detail);

  return (
    <motion.div className={styles.page} data-split={split || undefined} variants={stagger} initial="hidden" animate="show">
      <motion.header variants={rise} className={styles.header}>
        <h1>
          <WalletCards size={28} aria-hidden /> {t("expenses.pockets.title")}
        </h1>
        {wallets.length > 0 && (
          <button type="button" className={styles.eye} onClick={() => mask.flipAll(activeIds)} aria-label={t(eyeClosed ? "expenses.pockets.showBalances" : "expenses.pockets.hideBalances")} data-testid="pockets-eye">
            {eyeClosed ? <EyeOff size={22} aria-hidden /> : <Eye size={22} aria-hidden />}
          </button>
        )}
        <p>
          {t("expenses.pockets.subtitle")} <Link href="/expenses">{t("expenses.pockets.toExpenses")}</Link>
        </p>
      </motion.header>

      {isLoading ? null : wallets.length === 0 ? (
        // The first time: where the money is, right in the page.
        <motion.div variants={rise} className={styles.total}>
          <h2>{t("expenses.pockets.setupTitle")}</h2>
          <SetupForm onDone={() => undefined} />
        </motion.div>
      ) : split ? (
        <div className={styles.split}>
          <motion.div variants={rise}>{list}</motion.div>
          <motion.div variants={rise}>{detail}</motion.div>
        </div>
      ) : (
        <motion.div variants={rise}>{detail || list}</motion.div>
      )}

      <ExpenseSheet open={sheet !== null} title={sheet ? titles[sheet] : ""} onClose={close}>
        {sheet === "transfer" && <TransferForm wallets={active} primary={primary?.id} preset={preset} onDone={close} />}
        {sheet === "add" && <AddForm onDone={close} />}
        {sheet === "correct" && shown && <CorrectForm wallet={shown} balance={book.balances.get(shown.id) ?? 0} onDone={close} />}
        {sheet === "edit" && shown && <EditForm wallet={shown} onDone={close} />}
      </ExpenseSheet>
    </motion.div>
  );
}
