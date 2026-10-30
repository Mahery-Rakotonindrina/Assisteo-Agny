import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, ArrowUpRight, Camera, Check, ChevronDown, FileImage, ScanText, X } from "lucide-react";
import { Button } from "@/components/Button";
import { WalletChips, type PocketChoice } from "@/components/Expenses/WalletChips";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, startOfDay, toDateInput } from "@/lib/format";
import { contactPerson, type PickedContact } from "@/lib/contactPick";
import { loanPurposes, spreadRepayment } from "@/lib/loanLedger";
import { loanScanDraft, otherParty, type LoanScanDraft } from "@/lib/loanScan";
import {
  loanMoney,
  dayFromInput,
  dueIn,
  knownPeople,
  knownPhone,
  loanRemaining,
  loanTotal,
  MAX_INSTALLMENTS,
  personKey,
  scheduleFrequency,
  splitSchedule,
  type Loan,
  type LoanDirection,
  type LoanInterest,
  type ScheduleFrequency,
} from "@/lib/loans";
import { parseNumber } from "@/lib/money";
import { spring } from "@/lib/motion";
import { CaptureCancelledError, capturePhoto, type PhotoSource } from "@/services/camera";
import { haptics } from "@/services/device";
import { personalBook, type LoanBook } from "@/services/loanBook";
import { loanStore } from "@/services/loanStore";
import { ApiError } from "@/types/api";
import { ContactPickButton } from "./ContactPick";
import { LoanProofs } from "./LoanProofs";
import styles from "./Loans.module.scss";
import { useAccountName } from "./useAccountName";

const noSubscribe = () => () => {};
// Read when the form is saved, never while rendering.
const timestamp = () => Date.now();

/** Known people offered as pills under "À qui ?". */
const PEOPLE_CHIPS = 5;

/** The day picked as a time: now when it is today, else midday that day. */
function pickedAt(day: string) {
  const now = Date.now();
  const at = dayFromInput(day);
  if (at === undefined || at >= startOfDay(now)) return now;
  return at + 12 * 60 * 60 * 1000;
}

/**
 * The on-screen keyboard's height, as `--keyboard` on the element: a phone
 * browser (Safari above all) keeps the page's height when the keyboard opens,
 * so the sheet is lifted above it and "Enregistrer" stays in sight.
 */
function useKeyboardInset(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!open || !viewport) return;
    const update = () => ref.current?.style.setProperty("--keyboard", `${Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))}px`);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);
  return ref;
}

/** A bottom sheet (a centred card on a computer), over the page. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const backdrop = useKeyboardInset(open);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div ref={backdrop} className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
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

/** "+ Nouveau": lent or borrowed first, in two big tiles, or a debt acknowledgment to scan. */
export function NewLoanSheet({ open, onClose, onPick, onScan }: { open: boolean; onClose: () => void; onPick: (direction: LoanDirection) => void; onScan?: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} title={t("loans.new.title")}>
      <div className={styles.tiles}>
        {(["lent", "borrowed"] as const).map((direction) => (
          <button key={direction} type="button" className={styles.tile} data-direction={direction} onClick={() => onPick(direction)}>
            {direction === "lent" ? <ArrowUpRight size={26} aria-hidden /> : <ArrowDownLeft size={26} aria-hidden />}
            <strong>{t(`loans.new.${direction}`)}</strong>
            <small>{t(`loans.new.${direction}Hint`)}</small>
          </button>
        ))}
      </div>
      {onScan && (
        <Button variant="secondary" block icon={<ScanText />} onClick={onScan}>
          {t("loans.scan.button")}
        </Button>
      )}
    </Sheet>
  );
}

/** A new loan: its way, and the person when written from their account; `scan`: starts with the scan of a debt acknowledgment. */
export type LoanDraft = { direction: LoanDirection; person?: string; phone?: string; scan?: boolean };

/** "J'ai prêté de l'argent" / "J'ai emprunté", "Rakoto me doit encore…" (`draft.person`), or a loan corrected (`loan`). */
export function LoanSheet({
  open,
  onClose,
  draft,
  loan,
  loans,
  pockets,
  onSaved,
  book = personalBook,
  household,
}: {
  open: boolean;
  onClose: () => void;
  draft: LoanDraft;
  loan?: Loan;
  loans: Loan[];
  /** The pockets of "Mes dépenses" (with both features): the money leaves one, or comes into it. */
  pockets?: PocketChoice;
  onSaved?: (loan: Loan) => void;
  /** Where the loan is (or, new, starts): the user's own, or the household's. */
  book?: LoanBook;
  /** A member of a household: "Prêt du foyer" on a new loan; `book` null: not available yet. */
  household?: { book: LoanBook | null };
}) {
  const { t } = useTranslation();
  // A scanned debt acknowledgment can turn "J'ai prêté" into "J'ai emprunté" (or back).
  const [side, setSide] = useState<LoanDirection | null>(null);
  const direction = loan?.direction ?? side ?? draft.direction;
  const title = loan
    ? t("loans.form.titleEdit")
    : draft.person && !side
      ? t(`loans.form.titleMore.${direction}`, { name: draft.person })
      : t(`loans.form.title.${direction}`);
  const close = () => {
    setSide(null);
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={title}>
      {open && (
        <LoanFields
          key={loan?.id ?? `${draft.direction}-${draft.person ?? ""}-${draft.scan ? "scan" : ""}`}
          direction={direction}
          onDirection={loan ? undefined : setSide}
          draft={draft}
          loan={loan}
          loans={loans}
          pockets={pockets}
          onClose={close}
          onSaved={onSaved}
          book={book}
          household={household}
        />
      )}
    </Sheet>
  );
}

type Scanned = { src: string; draft: LoanScanDraft };

type DueChoice = "none" | "week" | "month" | "pick";

function LoanFields({
  direction,
  onDirection,
  draft,
  loan,
  loans,
  pockets: allPockets,
  onClose,
  onSaved,
  book,
  household,
}: {
  direction: LoanDirection;
  onDirection?: (direction: LoanDirection) => void;
  draft: LoanDraft;
  loan?: Loan;
  loans: Loan[];
  pockets?: PocketChoice;
  onClose: () => void;
  onSaved?: (loan: Loan) => void;
  book: LoanBook;
  household?: { book: LoanBook | null };
}) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const accountName = useAccountName();
  const noteInput = useRef<HTMLInputElement>(null);
  // "Prêt du foyer": a new loan of the household (no pocket, no proof); a loan corrected stays where it is.
  const [shared, setShared] = useState(book.scope === "household");
  const target = loan ? book : household ? (shared && household.book ? household.book : personalBook) : book;
  const pockets = target.scope === "personal" ? allPockets : undefined;
  const [person, setPerson] = useState(loan?.person ?? draft.person ?? "");
  const [amount, setAmount] = useState(loan ? String(loan.amountMga) : "");
  const [day, setDay] = useState(toDateInput(loan?.at ?? now));
  const [due, setDue] = useState<DueChoice>(loan?.dueAt !== undefined ? "pick" : "none");
  const [dueDay, setDueDay] = useState(loan?.dueAt !== undefined ? toDateInput(loan.dueAt) : "");
  const [phone, setPhone] = useState(loan?.phone ?? draft.phone ?? "");
  const [note, setNote] = useState(loan?.note ?? "");
  // "Autre": the free text, whatever is written in it.
  const [otherPurpose, setOtherPurpose] = useState(false);
  // A loan corrected keeps its pocket (archived since included) until another is picked; one written before the pockets stays without one.
  const [wallet, setWallet] = useState(() => (loan ? (loan.wallet ?? "") : (pockets?.primary ?? pockets?.wallets[0]?.id ?? "")));
  const saved = loan?.schedule;
  const [split, setSplit] = useState(Boolean(saved?.length));
  const [times, setTimes] = useState(String(saved?.length ?? 3));
  const [frequency, setFrequency] = useState<ScheduleFrequency>(saved ? scheduleFrequency(saved) : "month");
  const [firstDay, setFirstDay] = useState(toDateInput(saved?.[0]?.dueAt ?? dueIn("month", now)));
  // Amounts changed by hand, by position; cleared once the parts are worked out again.
  const [parts, setParts] = useState<Record<number, string>>(() => Object.fromEntries((saved ?? []).map((item, index) => [index, String(item.amountMga)])));
  const [withInterest, setWithInterest] = useState(Boolean(loan?.interest));
  const [interestKind, setInterestKind] = useState<LoanInterest["kind"]>(loan?.interest?.kind ?? "fixed");
  const [interestValue, setInterestValue] = useState(loan?.interest ? String(loan.interest.value) : "");
  // "Plus d'options": open when a corrected loan already uses one of them.
  const [more, setMore] = useState(Boolean(loan && (loan.dueAt !== undefined || saved?.length || loan.interest || loan.phone)));
  const [error, setError] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  // "Scanner une reconnaissance de dette": the photo (the loan's first proof) and what was read.
  const [scanStep, setScanStep] = useState<"idle" | "choose" | "reading">(draft.scan && !loan ? "choose" : "idle");
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [askSide, setAskSide] = useState(false);
  const typedKey = personKey(person);
  const people = loan || draft.person ? [] : knownPeople(loans).filter((name) => personKey(name) !== typedKey && (!typedKey || personKey(name).includes(typedKey))).slice(0, PEOPLE_CHIPS);
  const today = toDateInput(now);
  const purposes = loanPurposes.filter((purpose) => purpose !== "other").map((purpose) => t(`loans.form.purposes.${purpose}`));
  const purposePicked = note.trim() !== "" && purposes.includes(note.trim());

  const typedAmount = parseNumber(amount);
  const typedInterest = withInterest ? parseNumber(interestValue) : null;
  const interest: LoanInterest | undefined = typedInterest !== null && typedInterest > 0 ? { kind: interestKind, value: typedInterest } : undefined;
  const total = typedAmount !== null && typedAmount > 0 ? loanTotal({ amountMga: Math.round(typedAmount), interest }) : 0;
  const count = Math.min(MAX_INSTALLMENTS, Math.max(2, Math.round(parseNumber(times) ?? 2)));
  const firstAt = dayFromInput(firstDay);
  const schedule =
    split && total > 0 && firstAt !== undefined
      ? splitSchedule(total, count, frequency, firstAt).map((item, index) => (parts[index] === undefined ? item : { ...item, amountMga: Math.round(parseNumber(parts[index]) ?? 0) }))
      : [];
  const scheduleSum = schedule.reduce((sum, item) => sum + item.amountMga, 0);
  /** Something the parts are worked out from changed: they are split equally again. */
  const resplit = () => {
    setParts({});
    setMismatch(false);
  };
  // What "Plus d'options" holds, said on its button while folded.
  const pocketName = pockets?.wallets.find((item) => item.id === wallet)?.name;
  const moreSummary = [pocketName, split ? t("loans.form.split") : due !== "none" ? t("loans.form.due") : null, withInterest ? t("loans.form.interest") : null, target.scope === "household" && !loan ? t("loans.household.option") : null]
    .filter(Boolean)
    .join(" · ");

  /** The form filled in from the reading; the person is the other party than the user. */
  const fill = (read: LoanScanDraft, side: LoanDirection | null) => {
    if (side) {
      onDirection?.(side);
      setPerson(otherParty(read, side));
    }
    if (read.amountMga !== null) setAmount(String(read.amountMga));
    if (read.day) setDay(read.day);
    if (read.interest) {
      setWithInterest(true);
      setInterestKind(read.interest.kind);
      setInterestValue(String(read.interest.value));
      setMore(true);
    }
    const installments = read.installments.flatMap((item) => {
      const at = dayFromInput(item.dueDay);
      return at === undefined ? [] : [{ id: item.dueDay, dueAt: at, amountMga: item.amountMga }];
    });
    if (installments.length >= 2) {
      setSplit(true);
      setTimes(String(installments.length));
      setFrequency(scheduleFrequency(installments));
      setFirstDay(toDateInput(installments[0].dueAt));
      setParts(Object.fromEntries(installments.map((item, index) => [index, String(item.amountMga)])));
      setMore(true);
    } else if (read.dueDay) {
      setSplit(false);
      setDue("pick");
      setDueDay(read.dueDay);
      setMore(true);
    }
    if (read.place && !note) setNote(t("loans.scan.placeNote", { place: read.place }));
    setError(false);
    setMismatch(false);
  };

  const scan = async (source: PhotoSource) => {
    if (scanStep === "reading") return;
    let src: string;
    try {
      src = await capturePhoto(source);
    } catch (captureError) {
      if (!(captureError instanceof CaptureCancelledError)) toast(t("loans.scan.errors.failed"), "error");
      return;
    }
    setScanStep("reading");
    try {
      const { readAcknowledgment } = await import("@/services/loanScan");
      const { reading } = await readAcknowledgment(src, locale);
      if (!reading.isAcknowledgment) {
        toast(t("loans.scan.notAck"), "error");
        setScanStep("choose");
        return;
      }
      const read = loanScanDraft(reading, accountName, today);
      haptics.success();
      setScanned({ src, draft: read });
      setAskSide(read.direction === null);
      fill(read, read.direction);
      setScanStep("idle");
    } catch (scanError) {
      const code = scanError instanceof ApiError ? scanError.code : "unknown";
      const key = code === "plan_limit" ? "limit" : code === "sign_in_required" ? "signIn" : code === "network" ? "offline" : code === "plan_required" ? "plan" : "failed";
      toast(t(`loans.scan.errors.${key}`), "error");
      setScanStep("choose");
    }
  };

  const chooseSide = (side: LoanDirection) => {
    haptics.tap();
    setAskSide(false);
    if (scanned) fill(scanned.draft, side);
  };

  const pickPerson = (name: string) => {
    haptics.tap();
    setPerson(name);
    setError(false);
    if (!phone) {
      const known = knownPhone(loans, name);
      if (known) setPhone(known);
    }
  };

  /** "Choisir dans mes contacts": a known person by that name is kept (the loan goes on their account), the contact's number shown. */
  const fromContact = (contact: PickedContact) => {
    const name = contact.name ? contactPerson(knownPeople(loans), contact.name) : person;
    setPerson(name);
    setError(false);
    const number = contact.phone ?? (phone ? undefined : knownPhone(loans, name));
    if (number) {
      setPhone(number);
      setMore(true);
    }
  };

  const dueAt = () => {
    if (due === "week") return dueIn("week", timestamp());
    if (due === "month") return dueIn("month", timestamp());
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
    if (split && (schedule.length < 2 || scheduleSum !== total || schedule.some((item) => item.amountMga <= 0))) {
      setMismatch(true);
      setMore(true);
      haptics.error();
      return;
    }
    setSaving(true);
    const fields = {
      direction,
      person,
      phone,
      amountMga: value,
      at: loan && toDateInput(loan.at) === day ? loan.at : pickedAt(day),
      dueAt: split ? undefined : dueAt(),
      schedule: split ? schedule : undefined,
      interest,
      note,
      // Without the pockets shown, the one it had stays.
      wallet: pockets ? wallet || undefined : loan?.wallet,
    };
    try {
      if (loan) {
        await target.edit(loan.id, fields);
        toast(t("loans.saved.edited"));
        onSaved?.(loan);
      } else {
        const created = await target.create(fields);
        if (created) {
          // The scanned acknowledgment is the loan's first proof.
          if (scanned && target.scope === "personal") await loanStore.addPhotoProof(created.id, scanned.src).catch(() => null);
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

  const scanBox = !loan && target.scope === "personal" && (scanStep !== "idle" || scanned) && (
    <div className={styles.scanBox} data-testid="loan-scan">
      {scanStep === "reading" ? (
        <p className={styles.hint} role="status">
          {t("loans.scan.reading")}
        </p>
      ) : scanStep === "choose" ? (
        <div className={styles.chips}>
          <Button type="button" variant="secondary" icon={<Camera />} onClick={() => void scan("camera")}>
            {t("loans.scan.camera")}
          </Button>
          <Button type="button" variant="secondary" icon={<FileImage />} onClick={() => void scan("gallery")}>
            {t("loans.scan.gallery")}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" icon={<ScanText />} onClick={() => setScanStep("choose")}>
          {t("loans.scan.again")}
        </Button>
      )}
      {scanned && scanStep === "idle" && <small className={styles.hint}>{t("loans.scan.filled")}</small>}
      {scanned && askSide && (
        <div className={styles.field}>
          <span>{t("loans.scan.whichSide")}</span>
          <div className={styles.chips}>
            <button type="button" className={styles.chip} onClick={() => chooseSide("lent")}>
              {t("loans.scan.sideLent", { name: scanned.draft.lender ?? t("loans.scan.lender") })}
            </button>
            <button type="button" className={styles.chip} onClick={() => chooseSide("borrowed")}>
              {t("loans.scan.sideBorrowed", { name: scanned.draft.borrower ?? t("loans.scan.borrower") })}
            </button>
          </div>
        </div>
      )}
      {scanned?.draft.amountsDiffer && (
        <p className={styles.error} role="alert" data-testid="loan-scan-mismatch">
          {t("loans.scan.amountsDiffer", {
            figures: loanMoney(scanned.draft.amountMga ?? 0, locale),
            words: scanned.draft.amountWords ?? loanMoney(scanned.draft.amountWordsValue ?? 0, locale),
          })}
        </p>
      )}
    </div>
  );

  return (
    <form className={styles.sheetForm} onSubmit={(event) => void save(event)}>
      {scanBox}

      {/* The essentials: who, how much, what for, when. */}
      <div className={styles.field}>
        <label htmlFor="loan-person">{t(`loans.form.person.${direction}`)}</label>
        <input
          id="loan-person"
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
          maxLength={60}
          autoFocus={!loan && !draft.person && !draft.scan}
          autoComplete="off"
          enterKeyHint="next"
        />
        <ContactPickButton onPick={fromContact} />
        {people.length > 0 && (
          <div className={styles.chips} data-testid="loan-people">
            {people.map((name) => (
              <button key={name} type="button" className={styles.chip} onClick={() => pickPerson(name)}>
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.field}>
        <label htmlFor="loan-amount">{t("loans.form.amount")}</label>
        <input
          id="loan-amount"
          className={styles.bigInput}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError(false);
            resplit();
          }}
          inputMode="numeric"
          placeholder="50 000"
          autoFocus={!loan && Boolean(draft.person)}
          enterKeyHint="done"
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="loan-note">{t("loans.form.purpose")}</label>
        <div className={styles.chips} role="group" aria-label={t("loans.form.purpose")}>
          {purposes.map((label) => (
            <button
              key={label}
              type="button"
              className={styles.chip}
              aria-pressed={note.trim() === label}
              data-on={note.trim() === label || undefined}
              onClick={() => {
                haptics.tap();
                setOtherPurpose(false);
                setNote(note.trim() === label ? "" : label);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            aria-pressed={otherPurpose}
            data-on={otherPurpose || undefined}
            onClick={() => {
              setOtherPurpose(true);
              if (purposePicked) setNote("");
              noteInput.current?.focus();
            }}
          >
            {t("loans.form.purposes.other")}
          </button>
        </div>
        <input
          id="loan-note"
          ref={noteInput}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setOtherPurpose(event.target.value.trim() !== "" && !purposes.includes(event.target.value.trim()));
          }}
          placeholder={t("loans.form.purposePlaceholder")}
          maxLength={200}
        />
      </div>
      <div className={styles.field}>
        <span>{t("loans.form.date")}</span>
        <div className={styles.chips}>
          <button type="button" className={styles.chip} data-on={day === today || undefined} onClick={() => setDay(today)}>
            {t("loans.form.today")}
          </button>
          <input type="date" value={day} max={today} onChange={(event) => setDay(event.target.value || today)} aria-label={t("loans.form.date")} />
        </div>
      </div>

      <button type="button" className={styles.moreButton} aria-expanded={more} onClick={() => setMore(!more)} data-testid="loan-more">
        <span>
          <strong>{t("loans.form.more")}</strong>
          {!more && <small>{moreSummary || t("loans.form.moreHint")}</small>}
        </span>
        <ChevronDown size={18} data-open={more || undefined} aria-hidden />
      </button>

      {more && (
        <div className={styles.moreOptions}>
          {!split && (
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
          )}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={split}
              onChange={(event) => {
                setSplit(event.target.checked);
                resplit();
              }}
            />
            {t("loans.form.split")}
          </label>
          {split && (
            <div className={styles.group}>
              <label className={styles.field}>
                <span>{t("loans.form.times")}</span>
                <input
                  value={times}
                  onChange={(event) => {
                    setTimes(event.target.value);
                    resplit();
                  }}
                  inputMode="numeric"
                  placeholder="3"
                />
              </label>
              <div className={styles.field}>
                <span>{t("loans.form.frequency")}</span>
                <div className={styles.chips}>
                  {(["week", "month"] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className={styles.chip}
                      data-on={frequency === choice || undefined}
                      onClick={() => {
                        setFrequency(choice);
                        resplit();
                      }}
                    >
                      {t(`loans.form.frequencies.${choice}`)}
                    </button>
                  ))}
                </div>
              </div>
              <label className={styles.field}>
                <span>{t("loans.form.firstDue")}</span>
                <input
                  type="date"
                  value={firstDay}
                  onChange={(event) => {
                    setFirstDay(event.target.value);
                    resplit();
                  }}
                />
              </label>
              {schedule.length > 0 && (
                <div className={styles.field}>
                  <span>{t("loans.form.installments")}</span>
                  <ul className={styles.installments}>
                    {schedule.map((item, index) => (
                      <li key={item.id}>
                        <span>{formatDate(item.dueAt, locale)}</span>
                        <input
                          value={parts[index] ?? String(item.amountMga)}
                          onChange={(event) => {
                            setParts({ ...parts, [index]: event.target.value });
                            setMismatch(false);
                          }}
                          inputMode="numeric"
                          aria-label={t("loans.form.installmentLabel", { date: formatDate(item.dueAt, locale) })}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {mismatch && (
                <p className={styles.error} role="alert">
                  {t("loans.form.scheduleMismatch", { sum: loanMoney(scheduleSum, locale), total: loanMoney(total, locale) })}
                </p>
              )}
            </div>
          )}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={withInterest}
              onChange={(event) => {
                setWithInterest(event.target.checked);
                resplit();
              }}
            />
            {t("loans.form.interest")}
          </label>
          {withInterest && (
            <div className={styles.group}>
              <div className={styles.chips}>
                {(["fixed", "percent"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={styles.chip}
                    data-on={interestKind === kind || undefined}
                    onClick={() => {
                      setInterestKind(kind);
                      resplit();
                    }}
                  >
                    {t(`loans.form.interestKinds.${kind}`)}
                  </button>
                ))}
              </div>
              <label className={styles.field}>
                <span>{interestKind === "fixed" ? t("loans.form.interestFixed") : t("loans.form.interestPercent")}</span>
                <input
                  value={interestValue}
                  onChange={(event) => {
                    setInterestValue(event.target.value);
                    resplit();
                  }}
                  inputMode="decimal"
                  placeholder={interestKind === "fixed" ? "10 000" : "10"}
                />
              </label>
              {total > 0 && (
                <p className={styles.left} data-testid="loan-form-total">
                  {t("loans.form.totalDue", { amount: loanMoney(total, locale) })}
                </p>
              )}
            </div>
          )}
          <label className={styles.field}>
            <span>{t("loans.form.phone")}</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" type="tel" placeholder="034 12 345 67" maxLength={24} autoComplete="tel" />
          </label>
          {pockets && <WalletChips label={t(`loans.form.wallet.${direction}`)} wallets={pockets.wallets} value={wallet} onChange={setWallet} />}
          {!loan && household && (
            <div className={styles.field}>
              <label className={styles.toggle}>
                <input type="checkbox" checked={shared} disabled={!household.book} onChange={(event) => setShared(event.target.checked)} data-testid="loan-household" />
                {t("loans.household.option")}
              </label>
              <small className={styles.hint}>{household.book ? t("loans.household.optionHint") : t("loans.household.soon")}</small>
            </div>
          )}
          {loan && book.scope === "personal" ? (
            <LoanProofs loan={loan} readOnly={false} />
          ) : (
            !loan &&
            target.scope === "personal" &&
            !scanned &&
            scanStep === "idle" && (
              <div className={styles.field}>
                <Button type="button" variant="ghost" icon={<ScanText />} onClick={() => setScanStep("choose")}>
                  {t("loans.scan.button")}
                </Button>
                <small className={styles.hint}>{t("loans.form.proofsLater")}</small>
              </div>
            )
          )}
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {t("loans.form.missing")}
        </p>
      )}
      <div className={styles.sheetActions}>
        <Button type="submit" block size="lg" icon={<Check />} disabled={saving}>
          {t("loans.form.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Rakoto m'a rendu…" / "J'ai rendu…": for one loan, or for a person (`loans`,
 * their open loans in the order of their list), prefilled with what is left
 * and capped to it. A person's repayment is spread over their loans (lib/loanLedger.ts).
 */
export function RepaySheet({ open, onClose, loans, pockets, book = personalBook }: { open: boolean; onClose: () => void; loans: Loan[] | null; pockets?: PocketChoice; book?: LoanBook }) {
  const { t } = useTranslation();
  const first = loans?.[0];
  return (
    <Sheet open={open && first !== undefined} onClose={onClose} title={first ? (first.person.trim() ? t(`loans.repay.titleNamed.${first.direction}`, { name: first.person.trim() }) : t(`loans.repay.title.${first.direction}`)) : ""}>
      {loans && first && <RepayFields key={loans.map((loan) => loan.id).join()} loans={loans} pockets={book.scope === "personal" ? pockets : undefined} book={book} onClose={onClose} />}
    </Sheet>
  );
}

function RepayFields({ loans, pockets, book, onClose }: { loans: Loan[]; pockets?: PocketChoice; book: LoanBook; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const left = loans.reduce((sum, loan) => sum + loanRemaining(loan), 0);
  const [amount, setAmount] = useState(String(left));
  const today = toDateInput(now);
  const [day, setDay] = useState(today);
  const first = loans[0];
  // The (first) loan's pocket, else the default one.
  const [wallet, setWallet] = useState(() => (pockets?.wallets.some((item) => item.id === first.wallet) ? first.wallet! : (pockets?.primary ?? pockets?.wallets[0]?.id ?? "")));
  const [saving, setSaving] = useState(false);
  const typed = parseNumber(amount);
  const parts = typed === null ? [] : spreadRepayment(loans, typed);
  const over = typed !== null && typed > left;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (parts.length === 0 || saving) return;
    setSaving(true);
    try {
      let kept = 0;
      const at = pickedAt(day);
      for (const part of parts) kept += (await book.addRepayment(part.loan.id, { amountMga: part.amountMga, at, wallet: (pockets && wallet) || undefined })) ?? 0;
      if (kept <= 0) return;
      haptics.success();
      const rest = left - kept;
      toast(rest > 0 ? t("loans.repay.saved", { amount: loanMoney(kept, locale), left: loanMoney(rest, locale) }) : t("loans.repay.savedAll"));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.sheetForm} onSubmit={(event) => void save(event)}>
      <p className={styles.hint}>{t("loans.repay.left", { amount: loanMoney(left, locale) })}</p>
      <label className={styles.field}>
        <span>{t("loans.repay.amount")}</span>
        <input className={styles.bigInput} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" autoFocus />
      </label>
      {over && <p className={styles.hint}>{t("loans.repay.capped", { amount: loanMoney(left, locale) })}</p>}
      {loans.length > 1 && parts.length > 1 && <p className={styles.hint}>{t("loans.repay.spread", { count: parts.length })}</p>}
      <div className={styles.field}>
        <span>{t("loans.form.date")}</span>
        <div className={styles.chips}>
          <button type="button" className={styles.chip} data-on={day === today || undefined} onClick={() => setDay(today)}>
            {t("loans.form.today")}
          </button>
          <input type="date" value={day} max={today} onChange={(event) => setDay(event.target.value || today)} aria-label={t("loans.form.date")} />
        </div>
      </div>
      {pockets && <WalletChips label={t(`loans.repay.wallet.${first.direction}`)} wallets={pockets.wallets} value={wallet} onChange={setWallet} />}
      <div className={styles.sheetActions}>
        <Button type="submit" block size="lg" icon={<Check />} disabled={parts.length === 0 || saving}>
          {t("loans.form.save")}
        </Button>
      </div>
    </form>
  );
}
