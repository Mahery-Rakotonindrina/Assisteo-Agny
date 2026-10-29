import { useState } from "react";
import { ArrowLeft, CircleCheck, Copy, Download, FileText, MessageCircle, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { loanInterest, loanMoney, loanNextDue, loanPaid, loanRemaining, loanStatus, loanTotal, scheduleState, whatsappLink, type Loan, type PersonLoans } from "@/lib/loans";
import { copyText, haptics } from "@/services/device";
import { loanStore } from "@/services/loanStore";
import { LoanProofs } from "./LoanProofs";
import styles from "./Loans.module.scss";

type Props = {
  person: PersonLoans;
  now: number;
  readOnly: boolean;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (loan: Loan) => void;
  onRepay: (loan: Loan) => void;
  /** "Exporter": this person's loans. */
  onExport: () => void;
  /** "Reconnaissance de dette (PDF)" of one loan. */
  onAck: (loan: Loan) => void;
};

/** One person's loans in one direction: each with its repayments, and what can be done. */
export function PersonDetail({ person, now, readOnly, onBack, onAdd, onEdit, onRepay, onExport, onAck }: Props) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const direction = person.loans[0]?.direction ?? "lent";
  const money = (value: number) => loanMoney(value, locale);
  const nextDue = person.nextDue;
  const message =
    nextDue !== undefined
      ? t("loans.reminder.messageDue", { name: person.name, amount: money(person.remaining), date: formatDate(nextDue, locale) })
      : t("loans.reminder.message", { name: person.name, amount: money(person.remaining) });
  const whatsapp = whatsappLink(person.phone, message);
  const canRemind = !readOnly && direction === "lent" && person.remaining > 0;

  const copy = async () => {
    // copyText falls back on older WebViews (installed APKs).
    if (await copyText(message)) {
      haptics.success();
      toast(t("loans.detail.copied"));
    } else toast(t("loans.detail.copyFailed"), "error");
  };

  return (
    <section className={styles.detail} aria-label={person.name}>
      <div className={styles.detailTop}>
        <button type="button" className={styles.back} onClick={onBack} aria-label={t("loans.detail.back")}>
          <ArrowLeft size={18} />
        </button>
        <div className={styles.text}>
          <h2>{person.name}</h2>
          <small>
            {person.remaining > 0 ? t(`loans.detail.left.${direction}`, { amount: money(person.remaining) }) : t("loans.detail.settled")}
            {person.phone && ` · ${person.phone}`}
          </small>
        </div>
      </div>

      {(canRemind || !readOnly || person.loans.length > 0) && (
        <div className={styles.row}>
          {canRemind &&
            (whatsapp ? (
              <Button
                icon={<MessageCircle />}
                onClick={() => {
                  haptics.tap();
                  window.open(whatsapp, "_blank", "noopener,noreferrer");
                }}
              >
                {t("loans.detail.whatsapp")}
              </Button>
            ) : (
              <Button variant="secondary" icon={<Copy />} onClick={() => void copy()}>
                {t("loans.detail.copy")}
              </Button>
            ))}
          {!readOnly && (
            <Button variant="ghost" icon={<Plus />} onClick={onAdd}>
              {t(`loans.detail.another.${direction}`)}
            </Button>
          )}
          <Button variant="ghost" icon={<Download />} onClick={onExport}>
            {t("loans.detail.export")}
          </Button>
        </div>
      )}

      <ul className={styles.loans}>
        {person.loans.map((loan) => (
          <LoanCard key={loan.id} loan={loan} now={now} readOnly={readOnly} onEdit={() => onEdit(loan)} onRepay={() => onRepay(loan)} onAck={() => onAck(loan)} />
        ))}
      </ul>
    </section>
  );
}

function LoanCard({ loan, now, readOnly, onEdit, onRepay, onAck }: { loan: Loan; now: number; readOnly: boolean; onEdit: () => void; onRepay: () => void; onAck: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = loanStatus(loan, now);
  const left = loanRemaining(loan);
  const money = (value: number) => loanMoney(value, locale);
  const interest = loanInterest(loan);
  const next = loanNextDue(loan, now);
  const installments = scheduleState(loan, now);

  const markRepaid = async () => {
    haptics.tap();
    const kept = await loanStore.markRepaid(loan.id);
    if (kept !== null) {
      haptics.success();
      toast(t("loans.repay.savedAll"));
    }
  };

  return (
    <li className={styles.loan} data-status={status} data-testid="loan-card">
      <div className={styles.loanHead}>
        <strong>{money(loanTotal(loan))}</strong>
        {status === "late" && <span className={styles.lateBadge}>{t("loans.late")}</span>}
        {status === "repaid" && <span className={styles.repaidBadge}>{t("loans.detail.repaidBadge")}</span>}
      </div>
      <small>
        {t(`loans.detail.on.${loan.direction}`, { date: formatDate(loan.at, locale) })}
        {next?.scheduled
          ? ` · ${t("loans.nextDue", { amount: money(next.amountMga), date: formatDate(next.dueAt, locale) })}`
          : loan.dueAt !== undefined && ` · ${t("loans.dueOn", { date: formatDate(loan.dueAt, locale) })}`}
      </small>
      {interest > 0 && (
        <small data-testid="loan-interest">
          {[t(`loans.detail.principal.${loan.direction}`, { amount: money(loan.amountMga) }), t("loans.detail.interest", { amount: money(interest) }), t("loans.detail.total", { amount: money(loanTotal(loan)) })].join(" · ")}
        </small>
      )}
      {installments.length > 0 && (
        <ul className={styles.schedule} aria-label={t("loans.detail.schedule")} data-testid="loan-schedule">
          {installments.map((item) => (
            <li key={item.id}>
              <span>
                {t("loans.detail.installment", { amount: money(item.amountMga), date: formatDate(item.dueAt, locale) })}
                {item.status !== "paid" && item.paidMga > 0 && <small>{` · ${t("loans.detail.installmentLeft", { amount: money(item.leftMga) })}`}</small>}
              </span>
              <span className={styles.state} data-status={item.status}>
                {t(`loans.detail.installmentStatus.${item.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {loan.note && <p className={styles.note}>{loan.note}</p>}
      <LoanProofs loan={loan} readOnly={readOnly} />

      {loan.repayments.length > 0 && (
        <ul className={styles.repayments} aria-label={t("loans.detail.repayments")}>
          {loan.repayments.map((repayment) => (
            <li key={repayment.id}>
              <Undo2 size={14} />
              <span>{t("loans.detail.repaymentLine", { amount: money(repayment.amountMga), date: formatDate(repayment.at, locale) })}</span>
              {!readOnly && (
                <button type="button" className={styles.iconButton} onClick={() => void loanStore.removeRepayment(loan.id, repayment.id)} aria-label={t("loans.detail.removeRepayment")}>
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status !== "repaid" && loanPaid(loan) > 0 && (
        <p className={styles.left} data-testid="loan-left">
          {t("loans.detail.leftOne", { amount: money(left) })}
        </p>
      )}

      {!readOnly && (
        <div className={styles.row}>
          {status !== "repaid" && (
            <>
              <Button variant="secondary" icon={<Undo2 />} onClick={onRepay}>
                {t(`loans.repay.title.${loan.direction}`)}
              </Button>
              <Button variant="ghost" icon={<CircleCheck />} onClick={() => void markRepaid()}>
                {t("loans.detail.markRepaid")}
              </Button>
            </>
          )}
          <Button variant="ghost" icon={<FileText />} onClick={onAck}>
            {t("loans.detail.ack")}
          </Button>
          <Button variant="ghost" icon={<Pencil />} onClick={onEdit}>
            {t("loans.detail.edit")}
          </Button>
          {confirmRemove ? (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={() => {
                haptics.tap();
                void loanStore.remove(loan.id).then(() => toast(t("loans.detail.removed")));
              }}
            >
              {t("loans.detail.confirmRemove")}
            </Button>
          ) : (
            <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmRemove(true)}>
              {t("loans.detail.remove")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
