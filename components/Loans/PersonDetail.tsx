import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CalendarClock, ChevronRight, CircleCheck, Copy, Download, FileText, MessageCircle, Paperclip, Pencil, Percent, Plus, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import type { Locale } from "@/i18n.config";
import { formatDate, formatMonthYear } from "@/lib/format";
import { ledgerMonths, personBadge, personLedger, type LedgerLine, type PersonBadge } from "@/lib/loanLedger";
import type { PickedContact } from "@/lib/contactPick";
import { hasProofs } from "@/lib/loanProof";
import { loanInterest, loanMoney, loanNextDue, loanPaid, loanRemaining, loanStatus, loanTotal, scheduleState, whatsappLink, type Loan, type PersonLoans, type Repayment } from "@/lib/loans";
import { copyText, haptics } from "@/services/device";
import { personalBook, type LoanBook } from "@/services/loanBook";
import { loanSharing } from "@/services/loanSharing";
import { ContactPickButton } from "./ContactPick";
import { LoanProofs } from "./LoanProofs";
import { Sheet } from "./LoanSheet";
import styles from "./Loans.module.scss";
import { ShareLink } from "./ShareLink";

type Props = {
  person: PersonLoans;
  /** The same person the other way ("Tu lui dois aussi…"), when something is left there. */
  other?: PersonLoans;
  now: number;
  readOnly: boolean;
  /** Read only because "Prêts" left the plan: a live link can still be stopped. */
  planEnded?: boolean;
  onBack: () => void;
  /** "Rakoto me doit encore…": a new loan to this same person. */
  onAdd: () => void;
  onEdit: (loan: Loan) => void;
  /** "Rakoto m'a rendu…": these loans (one, or all the open ones of the person). */
  onRepay: (loans: Loan[]) => void;
  /** "Exporter le compte": this person's loans. */
  onExport: () => void;
  /** "Reconnaissance de dette (PDF)" of one loan. */
  onAck: (loan: Loan) => void;
  onOther?: () => void;
  /** Opened from the "Le relancer ?" notification: "Relancer" stands out. */
  nudge?: boolean;
  /** Where the loans are written: the user's own (default) or the household's. */
  book?: LoanBook;
  /** The household's loans: who wrote each one, and each repayment. */
  authorOf?: (row: Loan | Repayment) => string | undefined;
  /** A pocket's name, for the repayments. */
  pocketName?: (id: string) => string | undefined;
};

const shortDay = (time: number, locale: Locale) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" }).format(time);

/** The pill of a person: late, next due day, up to date, repaid. */
export function BadgePill({ badge }: { badge: PersonBadge }) {
  const { t, locale } = useTranslation();
  const text =
    badge.kind === "late"
      ? badge.days === 1
        ? t("loans.badge.lateOne")
        : t("loans.badge.late", { count: badge.days })
      : badge.kind === "due"
        ? t("loans.badge.due", { date: shortDay(badge.at, locale) })
        : t(`loans.badge.${badge.kind}`);
  return (
    <span className={styles.badge} data-kind={badge.kind} data-testid="loan-badge">
      {text}
    </span>
  );
}

/**
 * "Compte avec Rakoto": what is left with one person in one way, what can be
 * done in one tap (add another sum, a repayment, a reminder), then every line
 * like a bank statement, with what is left after each one.
 */
export function PersonDetail({ person, other, now, readOnly, planEnded, onBack, onAdd, onEdit, onRepay, onExport, onAck, onOther, nudge, book = personalBook, authorOf, pocketName }: Props) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const direction = person.loans[0]?.direction ?? "lent";
  const money = (value: number) => loanMoney(value, locale);
  const badge = personBadge(person, now);
  const nextDue = person.nextDue;
  const message =
    nextDue !== undefined
      ? t("loans.reminder.messageDue", { name: person.name, amount: money(person.remaining), date: formatDate(nextDue, locale) })
      : t("loans.reminder.message", { name: person.name, amount: money(person.remaining) });
  const whatsapp = whatsappLink(person.phone, message);
  const canRemind = !readOnly && direction === "lent" && person.remaining > 0;
  const personal = book.scope === "personal";
  const open = person.loans.filter((loan) => loanRemaining(loan) > 0);
  const lines = personLedger(person.loans);
  const months = ledgerMonths(lines);
  const [opened, setOpened] = useState<string | null>(null);
  const [choosingAck, setChoosingAck] = useState(false);
  const openedLoan = opened ? person.loans.find((loan) => loan.id === opened) : undefined;
  // The last loan of the person removed: their link stops too.
  const removed = (loan: Loan) => {
    setOpened(null);
    if (personal && loan.direction === "lent" && person.loans.every((item) => item.id === loan.id)) void loanSharing.stop(person.key).catch(() => undefined);
  };
  /** An action of a loan's detail: the detail closes, the action's sheet opens. */
  const then = (action: () => void) => () => {
    setOpened(null);
    action();
  };

  const remind = async () => {
    haptics.tap();
    if (whatsapp) {
      window.open(whatsapp, "_blank", "noopener,noreferrer");
      return;
    }
    // copyText falls back on older WebViews (installed APKs).
    if (await copyText(message)) {
      haptics.success();
      toast(t("loans.detail.copied"));
    } else toast(t("loans.detail.copyFailed"), "error");
  };

  /** "Ajouter son numéro depuis mes contacts": the number goes on their loans (those this user may change), as if typed there. */
  const addPhone = async (contact: PickedContact) => {
    if (!contact.phone) {
      toast(t("loans.contacts.noNumber"), "error");
      return;
    }
    const phone = contact.phone;
    try {
      await Promise.all(person.loans.filter((loan) => book.canEdit(loan)).map((loan) => book.edit(loan.id, { ...loan, phone })));
      haptics.success();
      toast(t("loans.contacts.added", { name: person.name }));
    } catch {
      toast(t("loans.contacts.failed"), "error");
    }
  };

  return (
    <section className={styles.detail} aria-label={t("loans.detail.title", { name: person.name })}>
      <div className={styles.detailTop}>
        <button type="button" className={styles.back} onClick={onBack} aria-label={t("loans.detail.back")}>
          <ArrowLeft size={18} />
        </button>
        <div className={styles.text}>
          <h2>{t("loans.detail.title", { name: person.name })}</h2>
          {person.phone && <small>{person.phone}</small>}
        </div>
      </div>

      <div className={styles.balance} data-direction={direction} data-testid="loan-balance">
        <p>{person.remaining > 0 ? t(`loans.detail.owes.${direction}`, { name: person.name, amount: money(person.remaining) }) : t("loans.detail.settled")}</p>
        <div className={styles.balanceMeta}>
          <BadgePill badge={badge} />
          {person.next && badge.kind !== "repaid" && <small>{t("loans.nextDue", { amount: money(person.next.amountMga), date: formatDate(person.next.dueAt, locale) })}</small>}
          {person.lateAmount > 0 && <small className={styles.lateText}>{t("loans.summary.late", { amount: money(person.lateAmount) })}</small>}
        </div>
      </div>

      {nudge && canRemind && (
        <p className={styles.nudge} data-testid="loan-nudge">
          {t("loans.detail.nudge", { name: person.name })}
        </p>
      )}

      {!readOnly && (
        <div className={styles.actions}>
          <Button size="lg" icon={<Plus />} onClick={onAdd}>
            {t(`loans.detail.another.${direction}`, { name: person.name })}
          </Button>
          {open.length > 0 && (
            <Button size="lg" variant="secondary" icon={<Undo2 />} onClick={() => onRepay(open)}>
              {t(`loans.repay.titleNamed.${direction}`, { name: person.name })}
            </Button>
          )}
          {canRemind && (
            <Button size="lg" variant={nudge ? "primary" : "secondary"} icon={whatsapp ? <MessageCircle /> : <Copy />} onClick={() => void remind()} data-testid="loan-remind">
              {whatsapp ? t("loans.detail.remind") : t("loans.detail.remindCopy")}
            </Button>
          )}
          {!person.phone && person.loans.some((loan) => book.canEdit(loan)) && <ContactPickButton variant="ghost" label={t("loans.contacts.addNumber")} onPick={(contact) => void addPhone(contact)} testId="loan-contact-phone" />}
        </div>
      )}

      {other && onOther && (
        <button type="button" className={styles.otherWay} onClick={onOther} data-testid="loan-other-way">
          <span>{t(`loans.detail.alsoOwes.${other.loans[0]?.direction ?? "borrowed"}`, { name: person.name, amount: money(other.remaining) })}</span>
          <ChevronRight size={16} aria-hidden />
        </button>
      )}

      <div className={styles.ledger} data-testid="loan-ledger">
        <h3>{t("loans.ledger.title")}</h3>
        <div className={styles.ledgerHead} aria-hidden>
          <span>{t("loans.ledger.what")}</span>
          <span>{t("loans.ledger.amount")}</span>
          <span>{t("loans.ledger.left")}</span>
        </div>
        {months.map((group) => (
          <section key={group.month} className={styles.ledgerMonth} aria-label={formatMonthYear(group.month, locale)}>
            <h4>{formatMonthYear(group.month, locale)}</h4>
            <ul>
              {group.lines.map((line) => (
                <li key={line.id}>
                  <LedgerRow line={line} now={now} authorOf={authorOf} pocketName={pocketName} onOpen={() => setOpened(line.loan.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className={styles.tools}>
        <Button variant="secondary" icon={<Download />} onClick={onExport}>
          {t("loans.detail.export")}
        </Button>
        {person.loans.length > 0 && (
          <Button variant="secondary" icon={<FileText />} onClick={() => (person.loans.length === 1 ? onAck(person.loans[0]) : setChoosingAck(true))}>
            {t("loans.detail.ackShort")}
          </Button>
        )}
      </div>
      {personal && direction === "lent" && person.loans.length > 0 && (!readOnly || planEnded) && <ShareLink key={person.key} person={person} readOnly={readOnly} />}

      <Sheet open={openedLoan !== undefined} onClose={() => setOpened(null)} title={openedLoan ? t(`loans.line.title.${openedLoan.direction}`, { date: formatDate(openedLoan.at, locale) }) : ""}>
        {openedLoan && (
          <LoanCard
            loan={openedLoan}
            now={now}
            readOnly={readOnly}
            book={book}
            author={authorOf?.(openedLoan)}
            authorOf={authorOf}
            onEdit={then(() => onEdit(openedLoan))}
            onRepay={then(() => onRepay([openedLoan]))}
            onAck={then(() => onAck(openedLoan))}
            onRemoved={() => removed(openedLoan)}
          />
        )}
      </Sheet>
      <Sheet open={choosingAck} onClose={() => setChoosingAck(false)} title={t("loans.ack.title")}>
        <p className={styles.hint}>{t("loans.ack.choose")}</p>
        <ul className={styles.choiceList}>
          {person.loans.map((loan) => (
            <li key={loan.id}>
              <button
                type="button"
                className={styles.choiceRow}
                onClick={() => {
                  setChoosingAck(false);
                  onAck(loan);
                }}
              >
                <span>
                  <strong>{loan.note || t(`loans.line.loan.${loan.direction}`)}</strong>
                  <small>{formatDate(loan.at, locale)}</small>
                </span>
                <strong>{money(loanTotal(loan))}</strong>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  );
}

/** One line of the statement: a sum owed (with its icons), its interest, or a repayment; then what is left. */
function LedgerRow({ line, now, authorOf, pocketName, onOpen }: { line: LedgerLine; now: number; authorOf?: Props["authorOf"]; pocketName?: Props["pocketName"]; onOpen: () => void }) {
  const { t, locale } = useTranslation();
  const money = (value: number) => loanMoney(value, locale);
  const { loan } = line;
  const sign = line.kind === "repayment" ? "−" : "+";
  let label: string;
  const details: string[] = [];
  if (line.kind === "loan") {
    label = loan.note?.trim() || t(`loans.line.loan.${loan.direction}`);
    const next = loanNextDue(loan, now);
    if (loanStatus(loan, now) === "repaid") details.push(t("loans.detail.repaidBadge"));
    else if (next) details.push(t("loans.dueOn", { date: formatDate(next.dueAt, locale) }));
    const author = authorOf?.(loan);
    if (author) details.push(t("loans.household.by", { name: author }));
  } else if (line.kind === "interest") {
    label = t("loans.line.interest");
    details.push(t(`loans.line.interestOf.${loan.direction}`, { date: formatDate(loan.at, locale) }));
  } else {
    label = t(`loans.line.repayment.${loan.direction}`, { name: loan.person.trim() });
    const pocket = line.repayment?.wallet ? pocketName?.(line.repayment.wallet) : undefined;
    if (pocket) details.push(pocket);
    const author = line.repayment ? authorOf?.(line.repayment) : undefined;
    if (author) details.push(t("loans.household.by", { name: author }));
  }
  return (
    <button type="button" className={styles.ledgerRow} data-kind={line.kind} onClick={onOpen} data-testid="ledger-line">
      <span className={styles.ledgerDay}>{shortDay(line.at, locale)}</span>
      <span className={styles.ledgerWhat}>
        <strong>
          {label}
          {line.kind === "loan" && (
            <span className={styles.ledgerIcons}>
              {hasProofs(loan) && <Paperclip size={13} aria-label={t("loans.proofs.has")} />}
              {(loan.schedule?.length ?? 0) > 0 && <CalendarClock size={13} aria-label={t("loans.detail.schedule")} />}
              {loanInterest(loan) > 0 && <Percent size={13} aria-label={t("loans.line.interest")} />}
            </span>
          )}
        </strong>
        {details.length > 0 && <small>{details.join(" · ")}</small>}
      </span>
      <span className={styles.ledgerAmount}>
        {sign}
        {money(line.amountMga)}
      </span>
      <span className={styles.ledgerLeft} data-testid="ledger-left">
        <small>{t("loans.ledger.left")} </small>
        {money(line.balanceMga)}
      </span>
    </button>
  );
}

type CardProps = { loan: Loan; now: number; readOnly: boolean; book: LoanBook; author?: string; authorOf?: Props["authorOf"]; onEdit: () => void; onRepay: () => void; onAck: () => void; onRemoved: () => void };

/** One loan in full (its sheet, from the statement): schedule, interest, proofs, repayments, what can be done. */
function LoanCard({ loan, now, readOnly, book, author, authorOf, onEdit, onRepay, onAck, onRemoved }: CardProps) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = loanStatus(loan, now);
  const left = loanRemaining(loan);
  const money = (value: number) => loanMoney(value, locale);
  const interest = loanInterest(loan);
  const next = loanNextDue(loan, now);
  const installments = scheduleState(loan, now);
  // The household's: anyone writes a repayment, only the author corrects or removes the loan.
  const canEdit = !readOnly && book.canEdit(loan);

  const markRepaid = async () => {
    haptics.tap();
    const kept = await book.markRepaid(loan.id);
    if (kept !== null) {
      haptics.success();
      toast(t("loans.repay.savedAll"));
    }
  };

  return (
    <div className={styles.loan} data-status={status} data-testid="loan-card">
      <div className={styles.loanHead}>
        <strong>{money(loanTotal(loan))}</strong>
        {status === "late" && <span className={styles.lateBadge}>{t("loans.late")}</span>}
        {status === "repaid" && <span className={styles.repaidBadge}>{t("loans.detail.repaidBadge")}</span>}
      </div>
      {loan.note && <p className={styles.note}>{loan.note}</p>}
      <small>
        {t(`loans.detail.on.${loan.direction}`, { date: formatDate(loan.at, locale) })}
        {next?.scheduled
          ? ` · ${t("loans.nextDue", { amount: money(next.amountMga), date: formatDate(next.dueAt, locale) })}`
          : loan.dueAt !== undefined && ` · ${t("loans.dueOn", { date: formatDate(loan.dueAt, locale) })}`}
      </small>
      {author && <small data-testid="loan-author">{t("loans.household.by", { name: author })}</small>}
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
      {book.scope === "personal" && <LoanProofs loan={loan} readOnly={readOnly} />}

      {loan.repayments.length > 0 && (
        <ul className={styles.repayments} aria-label={t("loans.detail.repayments")}>
          {loan.repayments.map((repayment) => (
            <li key={repayment.id}>
              <Undo2 size={14} />
              <span>
                {t("loans.detail.repaymentLine", { amount: money(repayment.amountMga), date: formatDate(repayment.at, locale) })}
                {authorOf?.(repayment) && ` · ${t("loans.household.by", { name: authorOf(repayment)! })}`}
                {repayment.scanId && (
                  <>
                    {" · "}
                    <Link href={{ pathname: "/result", query: { id: repayment.scanId } }}>{t("loans.detail.receipt")}</Link>
                  </>
                )}
              </span>
              {!readOnly && book.canRemoveRepayment(repayment) && (
                <button type="button" className={styles.iconButton} onClick={() => void book.removeRepayment(loan, repayment)} aria-label={t("loans.detail.removeRepayment")}>
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
                {t(`loans.repay.titleNamed.${loan.direction}`, { name: loan.person.trim() })}
              </Button>
              <Button variant="ghost" icon={<CircleCheck />} onClick={() => void markRepaid()}>
                {t("loans.detail.markRepaid")}
              </Button>
            </>
          )}
          <Button variant="ghost" icon={<FileText />} onClick={onAck}>
            {t("loans.detail.ack")}
          </Button>
          {canEdit && (
            <Button variant="ghost" icon={<Pencil />} onClick={onEdit}>
              {t("loans.detail.edit")}
            </Button>
          )}
          {!canEdit ? null : confirmRemove ? (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={() => {
                haptics.tap();
                void book.remove(loan.id).then(() => {
                  onRemoved();
                  toast(t("loans.detail.removed"));
                });
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
    </div>
  );
}
