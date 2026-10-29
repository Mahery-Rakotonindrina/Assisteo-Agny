import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { startOfDay, toDateInput } from "@/lib/format";
import { loanMoney, cappedRepayment, dayFromInput, dueIn, knownPhone, loanRemaining, type Loan, type LoanDirection } from "@/lib/loans";
import { parseNumber } from "@/lib/money";
import { spring } from "@/lib/motion";
import { haptics } from "@/services/device";
import { loanStore } from "@/services/loanStore";
import styles from "./Loans.module.scss";

const noSubscribe = () => () => {};

/** The day picked as a time: now when it is today, else midday that day. */
function pickedAt(day: string) {
  const now = Date.now();
  const at = dayFromInput(day);
  if (at === undefined || at >= startOfDay(now)) return now;
  return at + 12 * 60 * 60 * 1000;
}

/** A bottom sheet (a centred card on a computer), over the page. */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={spring}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.key === "Escape" && onClose()}
          >
            <div className={styles.sheetTop}>
              <h2>{title}</h2>
              <button type="button" className={styles.close} onClick={onClose} aria-label={t("loans.close")}>
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

type Draft = { direction: LoanDirection; person?: string; phone?: string };

/** "J'ai prêté de l'argent" / "J'ai emprunté", or a loan corrected (`loan`). */
export function LoanSheet({ open, onClose, draft, loan, loans, onSaved }: { open: boolean; onClose: () => void; draft: Draft; loan?: Loan; loans: Loan[]; onSaved?: (loan: Loan) => void }) {
  const { t } = useTranslation();
  const direction = loan?.direction ?? draft.direction;
  const title = loan ? t("loans.form.titleEdit") : t(`loans.form.title.${direction}`);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open && <LoanFields key={loan?.id ?? `${direction}-${draft.person ?? ""}`} direction={direction} draft={draft} loan={loan} loans={loans} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

type DueChoice = "none" | "week" | "month" | "pick";

function LoanFields({ direction, draft, loan, loans, onClose, onSaved }: { direction: LoanDirection; draft: Draft; loan?: Loan; loans: Loan[]; onClose: () => void; onSaved?: (loan: Loan) => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const [person, setPerson] = useState(loan?.person ?? draft.person ?? "");
  const [amount, setAmount] = useState(loan ? String(loan.amountMga) : "");
  const [day, setDay] = useState(toDateInput(loan?.at ?? now));
  const [due, setDue] = useState<DueChoice>(loan?.dueAt !== undefined ? "pick" : "none");
  const [dueDay, setDueDay] = useState(loan?.dueAt !== undefined ? toDateInput(loan.dueAt) : "");
  const [phone, setPhone] = useState(loan?.phone ?? draft.phone ?? "");
  const [note, setNote] = useState(loan?.note ?? "");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const names = [...new Set(loans.map((item) => item.person.trim()))];
  const today = toDateInput(now);

  const dueAt = () => {
    if (due === "week") return dueIn("week", Date.now());
    if (due === "month") return dueIn("month", Date.now());
    if (due === "pick") return dayFromInput(dueDay);
    return undefined;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseNumber(amount);
    if (!person.trim() || value === null || value <= 0) {
      setError(true);
      haptics.error();
      return;
    }
    setSaving(true);
    const fields = { direction, person, phone, amountMga: value, at: loan && toDateInput(loan.at) === day ? loan.at : pickedAt(day), dueAt: dueAt(), note };
    try {
      if (loan) {
        await loanStore.edit(loan.id, fields);
        toast(t("loans.saved.edited"));
        onSaved?.(loan);
      } else {
        const created = await loanStore.create(fields);
        if (created) {
          haptics.success();
          const params = { person: created.person, amount: loanMoney(created.amountMga, locale) };
          toast(t(`loans.saved.${direction}`, params));
          onSaved?.(created);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.sheetForm} onSubmit={(event) => void save(event)}>
      <label className={styles.field}>
        <span>{t(`loans.form.person.${direction}`)}</span>
        <input
          value={person}
          onChange={(event) => {
            setPerson(event.target.value);
            setError(false);
            // A known person: their last number is prefilled.
            if (!phone) {
              const known = knownPhone(loans, event.target.value);
              if (known) setPhone(known);
            }
          }}
          placeholder={t("loans.form.personPlaceholder")}
          list="loan-people"
          maxLength={60}
          autoFocus={!loan && !draft.person}
          autoComplete="off"
        />
        <datalist id="loan-people">
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label className={styles.field}>
        <span>{t("loans.form.amount")}</span>
        <input
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError(false);
          }}
          inputMode="numeric"
          placeholder="50 000"
          autoFocus={!loan && Boolean(draft.person)}
        />
      </label>
      <div className={styles.field}>
        <span>{t("loans.form.date")}</span>
        <div className={styles.chips}>
          <button type="button" className={styles.chip} data-on={day === today || undefined} onClick={() => setDay(today)}>
            {t("loans.form.today")}
          </button>
          <input type="date" value={day} max={today} onChange={(event) => setDay(event.target.value || today)} aria-label={t("loans.form.date")} />
        </div>
      </div>
      <div className={styles.field}>
        <span>{t("loans.form.due")}</span>
        <div className={styles.chips}>
          {(["none", "week", "month", "pick"] as const).map((choice) => (
            <button key={choice} type="button" className={styles.chip} data-on={due === choice || undefined} onClick={() => setDue(choice)}>
              {t(`loans.form.dueChoices.${choice}`)}
            </button>
          ))}
        </div>
        {due === "pick" && <input type="date" value={dueDay} onChange={(event) => setDueDay(event.target.value)} aria-label={t("loans.form.dueDay")} />}
      </div>
      <label className={styles.field}>
        <span>{t("loans.form.phone")}</span>
        <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" type="tel" placeholder="034 12 345 67" maxLength={24} />
      </label>
      <label className={styles.field}>
        <span>{t("loans.form.note")}</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("loans.form.notePlaceholder")} maxLength={200} />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {t("loans.form.missing")}
        </p>
      )}
      <div className={styles.sheetActions}>
        <Button type="submit" block icon={<Check />} disabled={saving}>
          {t("loans.form.save")}
        </Button>
      </div>
    </form>
  );
}

/** "Il m'a rendu…" / "J'ai rendu…": prefilled with what is left, capped to it. */
export function RepaySheet({ open, onClose, loan }: { open: boolean; onClose: () => void; loan: Loan | null }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open && loan !== null} onClose={onClose} title={loan ? t(`loans.repay.title.${loan.direction}`) : ""}>
      {loan && <RepayFields key={loan.id} loan={loan} onClose={onClose} />}
    </Sheet>
  );
}

function RepayFields({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const left = loanRemaining(loan);
  const [amount, setAmount] = useState(String(left));
  const today = toDateInput(now);
  const [day, setDay] = useState(today);
  const typed = parseNumber(amount);
  const capped = typed === null ? null : cappedRepayment(loan, typed);
  const over = typed !== null && typed > left;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (capped === null) return;
    const kept = await loanStore.addRepayment(loan.id, { amountMga: capped, at: pickedAt(day) });
    if (kept === null) return;
    haptics.success();
    const rest = left - kept;
    toast(rest > 0 ? t("loans.repay.saved", { amount: loanMoney(kept, locale), left: loanMoney(rest, locale) }) : t("loans.repay.savedAll"));
    onClose();
  };

  return (
    <form className={styles.sheetForm} onSubmit={(event) => void save(event)}>
      <p className={styles.hint}>{t("loans.repay.left", { amount: loanMoney(left, locale) })}</p>
      <label className={styles.field}>
        <span>{t("loans.form.amount")}</span>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" autoFocus />
      </label>
      {over && <p className={styles.hint}>{t("loans.repay.capped", { amount: loanMoney(left, locale) })}</p>}
      <div className={styles.field}>
        <span>{t("loans.form.date")}</span>
        <div className={styles.chips}>
          <button type="button" className={styles.chip} data-on={day === today || undefined} onClick={() => setDay(today)}>
            {t("loans.form.today")}
          </button>
          <input type="date" value={day} max={today} onChange={(event) => setDay(event.target.value || today)} aria-label={t("loans.form.date")} />
        </div>
      </div>
      <div className={styles.sheetActions}>
        <Button type="submit" block icon={<Check />} disabled={capped === null}>
          {t("loans.form.save")}
        </Button>
      </div>
    </form>
  );
}
