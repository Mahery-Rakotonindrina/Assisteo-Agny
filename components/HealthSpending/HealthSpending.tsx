import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowRightLeft, ChevronLeft, ChevronRight, FlaskConical, Hospital, Pill, Plus, Stethoscope, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import formStyles from "@/components/EmergencyCard/EmergencyCard.module.scss";
import { WhoField } from "@/components/HealthProfiles/WhoField";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useExpenses } from "@/hooks/useExpenses";
import { useBudgetSources, useExpenseSources } from "@/hooks/useExpenseSources";
import { useHealthSpending } from "@/hooks/useHealthSpending";
import { useHistory } from "@/hooks/useHistory";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { monthExpenses, monthKey, monthStart, shiftMonth } from "@/lib/expenses";
import { formatAriary, formatDate, formatMonthYear, toDateInput } from "@/lib/format";
import { ME, liveProfiles } from "@/lib/healthProfiles";
import {
  canGoForward,
  cleanHealthSpend,
  expenseLines,
  HEALTH_CATEGORY,
  healthMonth,
  healthSpendKinds,
  mergeLines,
  previousTotal,
  spendLine,
  totalsByPerson,
  type HealthLine,
  type HealthSpend,
  type HealthSpendKind,
} from "@/lib/healthSpending";
import { parseDay } from "@/lib/papers";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { healthSpendStore } from "@/services/healthSpendStore";
import styles from "./HealthSpending.module.scss";

/** When the form opens (read in the handlers only). */
const clock = () => Date.now();

const kindIcons: Record<HealthSpendKind, typeof Pill> = { pharmacy: Pill, consultation: Stethoscope, tests: FlaskConical, hospital: Hospital, other: Wallet };

type Sheet = null | { spend: HealthSpend | null; at: number };

/**
 * "Dépenses de santé" in Ma santé: what the person picked at the top ("Pour
 * qui ?") spent this month on the pharmacy, the doctor, tests or the
 * hospital, the month before to compare, and the lines. For everyone. With
 * "Mes dépenses", it reads that screen's category "health" and adds real
 * expenses to it; without, it keeps a list of its own (still shown once the
 * plan has "Mes dépenses": nothing is lost, nothing counted twice).
 */
export function HealthSpending({ profileId = ME }: { profileId?: string }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const { plan, has, planFor } = usePlan();
  const linked = has("expenses");
  const { settings, update } = useSettings();
  const profiles = settings.healthProfiles;
  const { spends, isLoading } = useHealthSpending();
  const { records } = useExpenses();
  const allSources = useExpenseSources();
  const sources = useBudgetSources(records, allSources);
  const { entries } = useHistory();
  const [sheet, setSheet] = useState<Sheet>(null);
  // The month shown (‹ ›, like "Mes dépenses"): this one by default, never one to come.
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked && picked < monthKey(now) ? picked : monthKey(now);

  // Every line of this month and the one before, whichever home it has.
  const lines = useMemo(() => {
    // Without "Mes dépenses", only what was typed there (kept from a former plan): its computed lines are its own.
    const read = linked ? sources : [];
    const owners = new Map(entries.map((entry) => [entry.id, entry.profileId]));
    const fromExpenses = [month, shiftMonth(month, -1)].flatMap((key) => expenseLines(monthExpenses(records, read, key), (scanId) => owners.get(scanId)));
    return mergeLines(spends.map(spendLine), fromExpenses);
  }, [linked, sources, entries, records, month, spends]);

  const current = healthMonth(lines, month, profileId, profiles);
  const before = previousTotal(lines, month, profileId, profiles);
  const people = liveProfiles(profiles).length > 0 ? totalsByPerson(lines, month, profiles) : [];
  const nameOf = (person: string) => (person === ME ? t("health.profiles.me") : (liveProfiles(profiles).find((item) => item.id === person)?.name ?? ""));

  return (
    <section className={styles.section} id="spending" data-testid="health-spending" aria-labelledby="spending-title">
      <h2 id="spending-title">{t("health.spending.title")}</h2>

      {linked && spends.length > 0 && <MoveBanner count={spends.length} />}

      <div className={styles.monthPicker}>
        <button type="button" onClick={() => setPicked(shiftMonth(month, -1))} aria-label={t("health.spending.previousMonth")} data-testid="health-spending-prev">
          <ChevronLeft size={20} aria-hidden />
        </button>
        <strong aria-live="polite" data-testid="health-spending-month">
          {formatMonthYear(monthStart(month), locale)}
        </strong>
        <button
          type="button"
          onClick={() => setPicked(shiftMonth(month, 1))}
          disabled={!canGoForward(month, now)}
          aria-label={t("health.spending.nextMonth")}
          data-testid="health-spending-next"
        >
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      <div className={styles.summary} data-testid="health-spending-summary">
        <span>{t("health.spending.month", { month: formatMonthYear(monthStart(month), locale) })}</span>
        <strong data-testid="health-spending-total">{formatAriary(current.total, locale)}</strong>
        <small data-testid="health-spending-before">{t("health.spending.before", { amount: formatAriary(before, locale) })}</small>
        {current.byKind.length > 0 && (
          <ul className={styles.kindsTotal} aria-label={t("health.spending.byKind")}>
            {current.byKind.map(({ kind, total }) => (
              <li key={kind}>
                <span>{t(`health.spending.kinds.${kind}`)}</span>
                <strong>{formatAriary(total, locale)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="secondary" icon={<Plus />} onClick={() => setSheet({ spend: null, at: clock() })} data-testid="health-spending-add">
        {t("health.spending.add")}
      </Button>
      {linked ? (
        <p className={styles.hint}>{t("health.spending.linked")}</p>
      ) : (
        plan !== null && (
          <p className={styles.hint}>
            <span>{t("health.spending.unlinked")}</span> <PlanBadge plan={planFor("expenses")} />
          </p>
        )
      )}

      {!isLoading && current.lines.length === 0 && <p className={styles.empty}>{t("health.spending.empty")}</p>}
      {current.lines.length > 0 && (
        <ul className={styles.list} aria-label={t("health.spending.list")}>
          {current.lines.map((line) => (
            <LineRow key={line.key} line={line} onOpen={() => setSheet({ spend: spends.find((spend) => spend.id === line.id) ?? null, at: line.at })} />
          ))}
        </ul>
      )}

      {people.length > 0 && (
        <div className={styles.people} data-testid="health-spending-people">
          <h3>{t("health.spending.family")}</h3>
          <ul>
            {people.map(({ person, total }) => (
              <li key={person}>
                <button type="button" aria-pressed={person === profileId} onClick={() => update({ healthPerson: person })} data-testid="health-spending-person">
                  <span>{nameOf(person)}</span>
                  <strong>{formatAriary(total, locale)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExpenseSheet open={sheet !== null} title={sheet?.spend ? t("health.spending.edit") : t("health.spending.add")} onClose={() => setSheet(null)}>
        {sheet && <SpendForm key={sheet.spend?.id ?? "new"} sheet={sheet} owner={sheet.spend?.profileId ?? profileId} linked={linked} onDone={() => setSheet(null)} />}
      </ExpenseSheet>
    </section>
  );
}

/**
 * The plan has "Mes dépenses" and Ma santé still keeps expenses of its own:
 * "count them in Mes dépenses", once confirmed. Safe if tapped twice.
 */
function MoveBanner({ count }: { count: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);

  const move = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    if (working) return;
    setWorking(true);
    haptics.success();
    try {
      const moved = await healthSpendStore.moveToExpenses();
      toast(t(moved === 1 ? "health.spending.movedOne" : "health.spending.moved", { count: moved }));
    } catch {
      toast(t("health.spending.moveFailed"), "error");
    } finally {
      setWorking(false);
      setConfirm(false);
    }
  };

  return (
    <div className={styles.move} data-testid="health-spending-move">
      <p>{t(count === 1 ? "health.spending.moveTextOne" : "health.spending.moveText", { count })}</p>
      <Button variant={confirm ? "primary" : "secondary"} size="md" icon={<ArrowRightLeft />} onClick={() => void move()} disabled={working} data-testid="health-spending-move-button">
        {t(confirm ? "health.spending.moveConfirm" : "health.spending.move")}
      </Button>
    </div>
  );
}

/** One expense: its kind, day and note, the amount; it opens where it can be changed. */
function LineRow({ line, onOpen }: { line: HealthLine; onOpen: () => void }) {
  const { t, locale } = useTranslation();
  const Icon = kindIcons[line.kind];
  const body = (
    <>
      <span className={styles.icon} aria-hidden>
        <Icon size={17} />
      </span>
      <span className={styles.text}>
        {/* The amount goes under the kind when the line is too narrow (320 px, very large text). */}
        <span className={styles.top}>
          <strong>{t(`health.spending.kinds.${line.kind}`)}</strong>
          <strong className={styles.amount} data-testid="health-spending-amount-line">
            {formatAriary(line.amountMga, locale)}
          </strong>
        </span>
        <small>
          {formatDate(line.at, locale)}
          {line.note && <> · {line.note}</>}
        </small>
        {line.from !== "own" && <em>{t("health.spending.inExpenses")}</em>}
      </span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden />
    </>
  );
  // Typed in "Mes dépenses", or read there from a receipt: changed there, with all its fields.
  const href = line.from === "expense" && line.id ? `/expenses?open=${encodeURIComponent(line.id)}` : line.from === "computed" ? (line.href ?? "/expenses") : null;
  return (
    <li data-testid="health-spending-line" data-from={line.from}>
      {href ? (
        <Link href={href} className={styles.row}>
          {body}
        </Link>
      ) : (
        <button type="button" className={styles.row} onClick={onOpen}>
          {body}
        </button>
      )}
    </li>
  );
}

function SpendForm({ sheet, owner, linked, onDone }: { sheet: NonNullable<Sheet>; owner: string; linked: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { spend } = sheet;
  const [amount, setAmount] = useState(spend ? String(spend.amountMga) : "");
  const [kind, setKind] = useState<HealthSpendKind>(spend?.kind ?? "pharmacy");
  const [day, setDay] = useState(toDateInput(sheet.at));
  const [forWho, setForWho] = useState(owner);
  const [note, setNote] = useState(spend?.note ?? "");
  const [wrong, setWrong] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = cleanHealthSpend({ at: parseDay(day) ?? Number.NaN, amount, kind, profileId: forWho, note, scanId: spend?.scanId });
    if (!result.fields) {
      setWrong(result.wrong);
      return;
    }
    haptics.success();
    const { fields } = result;
    if (spend) await healthSpendStore.edit(spend.id, fields);
    // With "Mes dépenses": a real expense of its category "health", counted in the budget.
    else if (linked)
      await expenseStore.saveExpense({
        at: fields.at,
        amountMga: fields.amountMga,
        category: HEALTH_CATEGORY,
        note: fields.note,
        health: { kind: fields.kind, ...(fields.profileId && { profileId: fields.profileId }) },
      });
    else await healthSpendStore.add(fields);
    toast(t(spend ? "health.spending.updated" : linked ? "health.spending.addedExpenses" : "health.spending.added"));
    onDone();
  };

  const remove = async () => {
    if (!spend) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    haptics.press();
    await healthSpendStore.remove(spend.id);
    toast(t("health.spending.removed"));
    onDone();
  };

  const invalid = (field: string) => wrong.includes(field) || undefined;

  return (
    <form className={`${sheetStyles.form} ${formStyles.form}`} onSubmit={(event) => void submit(event)} noValidate data-testid="health-spending-form">
      <label>
        {t("health.spending.amount")}
        <input inputMode="numeric" value={amount} placeholder="12 500" onChange={(event) => setAmount(event.target.value)} aria-invalid={invalid("amount")} data-testid="health-spending-amount" />
      </label>
      <div className={styles.kinds} role="group" aria-label={t("health.spending.kind")}>
        {healthSpendKinds.map((item) => (
          <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)} data-testid="health-spending-kind" data-kind={item}>
            {t(`health.spending.kinds.${item}`)}
          </button>
        ))}
      </div>
      <WhoField value={forWho} onChange={setForWho} />
      <label>
        {t("health.spending.day")}
        <input type="date" value={day} onChange={(event) => setDay(event.target.value)} aria-invalid={invalid("at")} data-testid="health-spending-day" />
      </label>
      <label>
        {t("health.spending.note")}
        <input value={note} maxLength={200} placeholder={t("health.spending.noteHint")} onChange={(event) => setNote(event.target.value)} data-testid="health-spending-note" />
      </label>
      {wrong.length > 0 && (
        <div className={styles.error} role="alert">
          {wrong.includes("amount") && <p>{t("health.spending.wrongAmount")}</p>}
          {wrong.includes("at") && <p>{t("health.spending.wrongDay")}</p>}
        </div>
      )}
      {spend && (
        <Button variant={confirm ? "danger" : "ghost"} icon={<Trash2 />} onClick={() => void remove()} data-testid="health-spending-remove">
          {t(confirm ? "health.spending.removeConfirm" : "health.spending.remove")}
        </Button>
      )}
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="health-spending-save">
          {t("health.spending.save")}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t("health.spending.cancel")}
        </Button>
      </div>
    </form>
  );
}
