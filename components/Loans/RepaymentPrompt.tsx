import Link from "next/link";
import { useState } from "react";
import { Check, HandCoins, Undo2 } from "lucide-react";
import { Button } from "@/components/Button";
import expenseStyles from "@/components/Expenses/Expenses.module.scss";
import { useToast } from "@/components/Toast";
import { useLoans } from "@/hooks/useLoans";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { linkedRepayment, repaymentProposal, type RepaymentSource } from "@/lib/loanLink";
import { loanMoney, loanRemaining, personKey, type Loan } from "@/lib/loans";
import { haptics } from "@/services/device";
import { linkSameRepayment, recordRepayment, undoRepayment } from "@/services/loanLink";

/** The loans, read only with both "Prêts" and "Mes dépenses" (none otherwise). */
export function useLinkedLoans(): Loan[] {
  const { has } = usePlan();
  const { loans } = useLoans();
  return has("loans") && has("expenses") ? loans : [];
}

const personHref = (loan: Loan) => ({ pathname: "/loans", query: { ...(loan.direction === "borrowed" && { dir: "borrowed" }), person: personKey(loan.person) } });

/**
 * Under a "Vous avez reçu" from someone who owes money (or a payment to
 * someone owed), in the result and on its line of "Mes dépenses": "C'est un
 * remboursement de Rakoto ?". "Oui" writes the repayment (in the line's
 * pocket) and keeps the line out of the incomes; once done, "Annuler". With
 * both "Prêts" and "Mes dépenses" only.
 */
export function RepaymentPrompt({ source, wallet }: { source: RepaymentSource; wallet?: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const loans = useLinkedLoans();
  const [busy, setBusy] = useState(false);
  const money = (value: number) => loanMoney(value, locale);
  if (loans.length === 0) return null;

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    haptics.tap();
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const linked = linkedRepayment(loans, source.key);
  if (linked)
    return (
      <div className={expenseStyles.panel} data-testid="repayment-linked">
        <p className={expenseStyles.receiptStatus}>
          <HandCoins size={15} />
          <span>
            {t(`loans.link.counted.${linked.loan.direction}`, { name: linked.loan.person, amount: money(linked.repayment.amountMga) })} ·{" "}
            <Link href={personHref(linked.loan)}>{t("loans.link.open")}</Link>
          </span>
        </p>
        <div className={expenseStyles.row}>
          <Button variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => void run(() => undoRepayment(linked.loan.id, linked.repayment))}>
            {t("loans.link.undo")}
          </Button>
        </div>
      </div>
    );

  const proposal = repaymentProposal(loans, source);
  if (!proposal) return null;
  const { loan, same } = proposal;
  const yes = () =>
    run(async () => {
      const kept = await recordRepayment(proposal, source, wallet);
      if (kept === null) return;
      haptics.success();
      const left = loanRemaining(loan) - kept;
      toast(left > 0 ? t(`loans.link.saved.${loan.direction}`, { name: proposal.person, amount: money(left) }) : t("loans.repay.savedAll"));
    });

  return (
    <div className={expenseStyles.panel} data-testid="repayment-prompt">
      <p className={expenseStyles.receiptStatus}>
        <HandCoins size={15} />
        <span>
          {same
            ? t("loans.link.same", { name: proposal.person, amount: money(same.repayment.amountMga), date: formatDate(same.repayment.at, locale) })
            : t(`loans.link.ask.${loan.direction}`, { name: proposal.person })}
          {!same && <small>{` ${t("loans.link.left", { amount: money(loanRemaining(loan)) })}`}</small>}
        </span>
      </p>
      <div className={expenseStyles.row}>
        {same ? (
          <>
            <Button variant="secondary" icon={<Check />} disabled={busy} onClick={() => void run(() => linkSameRepayment(same, source))}>
              {t("loans.link.sameYes")}
            </Button>
            <Button variant="ghost" icon={<HandCoins />} disabled={busy} onClick={() => void yes()}>
              {t("loans.link.another")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" icon={<Check />} disabled={busy} onClick={() => void yes()}>
            {t("loans.link.yes")}
          </Button>
        )}
      </div>
    </div>
  );
}
