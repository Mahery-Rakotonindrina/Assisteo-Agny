import { useState, type FormEvent } from "react";
import { AlarmClock, ArrowLeft, BellRing, CalendarPlus, Car, Check, Fuel, Gauge, Pencil, Plus, Receipt, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/Button";
import { CountedLink } from "@/components/Expenses/CountedLink";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { useVehicleReminderTexts } from "@/hooks/useVehicleReminderTexts";
import { formatAriary, formatDate, formatDateTime, formatDecimal, formatNumber } from "@/lib/format";
import {
  expenseKinds,
  fuelConsumption,
  kmPerDay,
  lastOilChange,
  latestReading,
  maintenanceKinds,
  spendingByPeriod,
  spendingKinds,
  vehicleReminders,
  type ExpenseKind,
  type MaintenanceEntry,
  type MaintenanceKind,
  type Vehicle,
  type VehicleReminder,
} from "@/lib/garage";
import { dayString, parseDay } from "@/lib/papers";
import { SNOOZE_CHOICES, snoozeAt, type SnoozeChoice } from "@/lib/reminderRepeat";
import { addToCalendar, type CalendarKind } from "@/services/calendarExport";
import { haptics } from "@/services/device";
import { vehicleStore } from "@/services/vehicleStore";
import { parseField, VehicleForm } from "./VehicleForm";
import styles from "./Garage.module.scss";

type Tab = "sheet" | "log" | "fuel" | "costs";

// Taken in event handlers (never during render).
const timestamp = () => Date.now();
const today = () => dayString(timestamp());
const dayOf = (value: string) => parseDay(value) ?? timestamp();

const snoozeLabels: Record<SnoozeChoice, string> = { hour: "reminders.snoozeHour", tomorrow: "reminders.snoozeTomorrow", week: "reminders.snoozeWeek" };

/**
 * One vehicle: its reminders, then its sheet, service log, fuel fills and
 * expenses. `readOnly` (plan below Premium): everything shown, nothing editable, no reminders.
 */
export function VehicleDetail({ vehicle, onBack, readOnly = false }: { vehicle: Vehicle; onBack: () => void; readOnly?: boolean }) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState<Tab>("sheet");
  const reading = latestReading(vehicle);
  const subtitle = [[vehicle.make, vehicle.model].filter(Boolean).join(" "), vehicle.year, vehicle.plate].filter(Boolean).join(" · ");

  return (
    <div className={styles.detail}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ArrowLeft size={16} /> {t("garage.title")}
      </button>
      <div className={styles.detailHead}>
        <span className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          {vehicle.thumbnail ? <img src={vehicle.thumbnail} alt="" /> : <Car size={24} />}
        </span>
        <span className={styles.text}>
          <h2>{vehicle.name}</h2>
          {subtitle && <small>{subtitle}</small>}
          {reading && <small>{t("garage.odometerValue", { km: formatNumber(reading.km, locale), date: formatDate(reading.at, locale) })}</small>}
        </span>
      </div>

      {!readOnly && <Reminders vehicle={vehicle} />}

      <SegmentedControl
        ariaLabel={vehicle.name}
        value={tab}
        onChange={(next) => setTab(next)}
        options={[
          { value: "sheet", label: t("garage.tabs.sheet"), icon: <Car /> },
          { value: "log", label: t("garage.tabs.log"), icon: <Wrench /> },
          { value: "fuel", label: t("garage.tabs.fuel"), icon: <Fuel /> },
          { value: "costs", label: t("garage.tabs.costs"), icon: <Receipt /> },
        ]}
      />

      {tab === "sheet" && <SheetPanel vehicle={vehicle} onRemoved={onBack} readOnly={readOnly} />}
      {tab === "log" && <LogPanel vehicle={vehicle} readOnly={readOnly} />}
      {tab === "fuel" && <FuelPanel vehicle={vehicle} readOnly={readOnly} />}
      {tab === "costs" && <CostsPanel vehicle={vehicle} readOnly={readOnly} />}
      {tab !== "sheet" && latestCost(vehicle) !== null && <CountedLink sourceKey={`garage:${vehicle.id}`} at={latestCost(vehicle)!} label={t("expenses.counted.garage")} />}
    </div>
  );
}

/** When the vehicle last cost something (a fill, a service, a cost), or null: its month is opened in "Mes dépenses". */
function latestCost(vehicle: Vehicle) {
  const dates = [
    ...(vehicle.fuel ?? []).filter((fill) => fill.amountMga).map((fill) => fill.at),
    ...(vehicle.maintenance ?? []).filter((entry) => entry.costMga).map((entry) => entry.at),
    ...(vehicle.expenses ?? []).filter((expense) => expense.amountMga).map((expense) => expense.at),
  ];
  return dates.length > 0 ? Math.max(...dates) : null;
}

// ---- Reminders ----------------------------------------------------------------

function Reminders({ vehicle }: { vehicle: Vehicle }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const texts = useVehicleReminderTexts();
  const now = useNow(60_000);
  const reminders = vehicleReminders(vehicle);
  const hasOil = lastOilChange(vehicle) !== null;

  const snooze = async (reminder: VehicleReminder, choice: SnoozeChoice) => {
    haptics.tap();
    const at = snoozeAt(choice, timestamp());
    await vehicleStore.snooze(vehicle.id, reminder.kind, at);
    toast(t("result.reminderSet", { date: formatDateTime(at, locale) }));
  };

  const calendar = async (reminder: VehicleReminder, kind: CalendarKind) => {
    haptics.tap();
    const text = texts(vehicle, reminder);
    const outcome = await addToCalendar(kind, { uid: `${vehicle.id}-${reminder.kind}@assisteo-agny`, title: text.title, details: text.body, start: reminder.at });
    if (outcome === "downloaded") toast(t("reminders.calendarDownloaded"));
  };

  return (
    <section className={styles.reminders} aria-label={t("garage.remindersTitle")}>
      {reminders.map((reminder) => {
        const due = reminder.at <= now;
        const text = texts(vehicle, reminder);
        return (
          <article key={reminder.kind} className={styles.reminder} data-due={due || undefined}>
            <p className={styles.reminderText}>
              {due ? <BellRing size={16} /> : <AlarmClock size={16} />}
              <span>
                <strong>{text.title}</strong>
                <small>{text.body}</small>
                {!due && <small>{t("garage.remindOn", { date: formatDateTime(reminder.at, locale) })}</small>}
              </span>
            </p>
            {due ? (
              <div className={styles.choices}>
                <span>{t("reminders.snoozeLater")}</span>
                {SNOOZE_CHOICES.map((choice) => (
                  <button key={choice} type="button" onClick={() => void snooze(reminder, choice)}>
                    {t(snoozeLabels[choice])}
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.choices}>
                <span>
                  <CalendarPlus size={14} aria-hidden /> {t("reminders.calendar")}
                </span>
                {(["google", "ics"] as const).map((kind) => (
                  <button key={kind} type="button" onClick={() => void calendar(reminder, kind)}>
                    {t(kind === "google" ? "reminders.calendarGoogle" : "reminders.calendarOther")}
                  </button>
                ))}
              </div>
            )}
          </article>
        );
      })}
      {!hasOil && <p className={styles.hint}>{t("garage.oilHint")}</p>}
      {reminders.length === 0 && <p className={styles.hint}>{t("garage.noReminders")}</p>}
    </section>
  );
}

// ---- Sheet ----------------------------------------------------------------------

type PanelProps = { vehicle: Vehicle; readOnly: boolean };

function SheetPanel({ vehicle, onRemoved, readOnly }: PanelProps & { onRemoved: () => void }) {
  const { t, locale } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [km, setKm] = useState("");
  const rate = kmPerDay(vehicle);

  if (editing) return <VehicleForm vehicle={vehicle} onDone={() => setEditing(false)} />;

  const saveReading = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseField(km);
    if (value === undefined) return;
    haptics.success();
    await vehicleStore.addReading(vehicle.id, value);
    setKm("");
  };

  const day = (value: string | undefined) => {
    const at = parseDay(value);
    return at === null ? "—" : formatDate(at, locale);
  };

  const rows: Array<[string, string | undefined]> = [
    [t("garage.fields.kind"), t(`garage.kinds.${vehicle.kind}`)],
    [t("garage.fields.make"), vehicle.make],
    [t("garage.fields.model"), [vehicle.model, vehicle.generation].filter(Boolean).join(" · ") || undefined],
    [t("garage.fields.year"), vehicle.year?.toString()],
    [t("garage.fields.plate"), vehicle.plate],
    [t("garage.fields.energy"), vehicle.energy && t(`garage.energies.${vehicle.energy}`)],
    [t("garage.fields.fiscalPower"), vehicle.fiscalPower ? `${vehicle.fiscalPower} CV` : undefined],
    [t("garage.fields.vin"), vehicle.vin],
    [t("garage.fields.insuranceUntil"), day(vehicle.insuranceUntil)],
    [t("garage.fields.inspectionUntil"), day(vehicle.inspectionUntil)],
    [
      t("garage.fields.oilInterval"),
      [vehicle.oilIntervalKm && `${formatNumber(vehicle.oilIntervalKm, locale)} km`, vehicle.oilIntervalMonths && t("garage.months", { count: vehicle.oilIntervalMonths })]
        .filter(Boolean)
        .join(" / ") || undefined,
    ],
    [t("garage.perDay"), rate ? `${formatDecimal(Math.round(rate * 10) / 10, locale)} km` : undefined],
  ];

  return (
    <div className={styles.panel}>
      {!readOnly && (
      <form className={styles.inline} onSubmit={(event) => void saveReading(event)}>
        <Gauge size={18} aria-hidden />
        <input value={km} onChange={(event) => setKm(event.target.value)} inputMode="numeric" placeholder={t("garage.fields.kmPlaceholder")} aria-label={t("garage.updateOdometer")} />
        <Button type="submit" variant="secondary" disabled={parseField(km) === undefined}>
          {t("garage.updateOdometer")}
        </Button>
      </form>
      )}
      <dl className={styles.sheet}>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {vehicle.advice && vehicle.advice.length > 0 && (
        <div>
          <h3 className={styles.subTitle}>{t("garage.advice")}</h3>
          <ul className={styles.advice}>
            {vehicle.advice.map((item) => (
              <li key={item.task}>
                <span>{item.task}</span>
                <small>{item.interval}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!readOnly && (
      <div className={styles.row}>
        <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
          {t("garage.edit")}
        </Button>
        {confirmRemove ? (
          <Button
            variant="danger"
            icon={<Trash2 />}
            onClick={() => {
              haptics.tap();
              void vehicleStore.remove(vehicle.id).then(onRemoved);
            }}
          >
            {t("garage.removeConfirm")}
          </Button>
        ) : (
          <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmRemove(true)}>
            {t("garage.remove")}
          </Button>
        )}
      </div>
      )}
    </div>
  );
}

// ---- Service log ----------------------------------------------------------------

function MaintenanceForm({ vehicle, entry, onDone }: { vehicle: Vehicle; entry?: MaintenanceEntry; onDone: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<MaintenanceKind>(entry?.kind ?? "oil");
  const [day, setDay] = useState(entry ? dayString(entry.at) : today);
  const [km, setKm] = useState(entry?.km?.toString() ?? "");
  const [cost, setCost] = useState(entry?.costMga?.toString() ?? "");
  const [garage, setGarage] = useState(entry?.garage ?? "");
  const [note, setNote] = useState(entry?.note ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    haptics.success();
    await vehicleStore.saveMaintenance(vehicle.id, { id: entry?.id, kind, at: dayOf(day), km: parseField(km), costMga: parseField(cost), garage, note });
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <div className={styles.fields}>
        <label>
          <span>{t("garage.log.kind")}</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as MaintenanceKind)}>
            {maintenanceKinds.map((value) => (
              <option key={value} value={value}>
                {t(`garage.log.kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("garage.date")}</span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
        </label>
        <label>
          <span>{t("garage.fields.km")}</span>
          <input value={km} onChange={(event) => setKm(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span>{t("garage.cost")}</span>
          <input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="numeric" placeholder="Ar" />
        </label>
        <label>
          <span>{t("garage.log.garage")}</span>
          <input value={garage} onChange={(event) => setGarage(event.target.value)} maxLength={80} />
        </label>
        <label className={styles.wide}>
          <span>{t("garage.log.note")}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />}>
          {t("garage.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function LogPanel({ vehicle, readOnly }: PanelProps) {
  const { t, locale } = useTranslation();
  const [editing, setEditing] = useState<string | "new" | null>(null);

  return (
    <div className={styles.panel}>
      {readOnly ? null : editing === "new" ? (
        <MaintenanceForm vehicle={vehicle} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="secondary" icon={<Plus />} onClick={() => setEditing("new")}>
          {t("garage.log.add")}
        </Button>
      )}
      {vehicle.maintenance.length === 0 && editing !== "new" && <p className={styles.hint}>{t("garage.log.empty")}</p>}
      <ul className={styles.entries}>
        {vehicle.maintenance.map((entry) =>
          editing === entry.id ? (
            <li key={entry.id}>
              <MaintenanceForm vehicle={vehicle} entry={entry} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={entry.id} className={styles.entry}>
              <span className={styles.text}>
                <strong>{t(`garage.log.kinds.${entry.kind}`)}</strong>
                <small>
                  {[formatDate(entry.at, locale), entry.km !== undefined && `${formatNumber(entry.km, locale)} km`, entry.garage].filter(Boolean).join(" · ")}
                </small>
                {entry.note && <small>{entry.note}</small>}
              </span>
              {entry.costMga !== undefined && <span className={styles.amount}>{formatAriary(entry.costMga, locale)}</span>}
              {!readOnly && (
              <>
              <button type="button" className={styles.iconButton} onClick={() => setEditing(entry.id)} aria-label={t("garage.edit")}>
                <Pencil size={15} />
              </button>
              <button type="button" className={styles.iconButton} onClick={() => void vehicleStore.removeMaintenance(vehicle.id, entry.id)} aria-label={t("garage.delete")}>
                <Trash2 size={15} />
              </button>
              </>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

// ---- Fuel ----------------------------------------------------------------------

function FuelPanel({ vehicle, readOnly }: PanelProps) {
  const { t, locale } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [day, setDay] = useState(today);
  const [km, setKm] = useState("");
  const [litres, setLitres] = useState("");
  const [amount, setAmount] = useState("");
  const [full, setFull] = useState(true);
  const consumption = fuelConsumption(vehicle.fuel);
  const per100 = (value: number | null) => (value === null ? "—" : `${formatDecimal(Math.round(value * 10) / 10, locale)} L`);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const kmValue = parseField(km);
    const litresValue = parseField(litres);
    if (kmValue === undefined || litresValue === undefined) return;
    haptics.success();
    await vehicleStore.saveFuel(vehicle.id, { at: dayOf(day), km: kmValue, litres: litresValue, amountMga: parseField(amount), full });
    setKm("");
    setLitres("");
    setAmount("");
    setAdding(false);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.stats}>
        <span>
          <small>{t("garage.fuel.last")}</small>
          <strong data-testid="fuel-last">{per100(consumption.last)}</strong>
        </span>
        <span>
          <small>{t("garage.fuel.average")}</small>
          <strong>{per100(consumption.average)}</strong>
        </span>
        <span>
          <small>{t("garage.fuel.costPerKm")}</small>
          <strong>{consumption.costPerKm === null ? "—" : formatAriary(consumption.costPerKm, locale)}</strong>
        </span>
      </div>
      {consumption.last === null && <p className={styles.hint}>{t("garage.fuel.hint")}</p>}

      {readOnly ? null : adding ? (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <div className={styles.fields}>
            <label>
              <span>{t("garage.date")}</span>
              <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
            </label>
            <label>
              <span>{t("garage.fields.km")}</span>
              <input value={km} onChange={(event) => setKm(event.target.value)} inputMode="numeric" required />
            </label>
            <label>
              <span>{t("garage.fuel.litres")}</span>
              <input value={litres} onChange={(event) => setLitres(event.target.value)} inputMode="decimal" required />
            </label>
            <label>
              <span>{t("garage.fuel.amount")}</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="Ar" />
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={full} onChange={(event) => setFull(event.target.checked)} />
              <span>{t("garage.fuel.full")}</span>
            </label>
          </div>
          <div className={styles.row}>
            <Button type="submit" icon={<Check />} disabled={parseField(km) === undefined || parseField(litres) === undefined}>
              {t("garage.save")}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>
          {t("garage.fuel.add")}
        </Button>
      )}

      <ul className={styles.entries}>
        {vehicle.fuel.map((fill) => (
          <li key={fill.id} className={styles.entry}>
            <span className={styles.text}>
              <strong>
                {formatDecimal(fill.litres, locale)} L{fill.full ? "" : ` · ${t("garage.fuel.partial")}`}
              </strong>
              <small>
                {formatDate(fill.at, locale)} · {formatNumber(fill.km, locale)} km
              </small>
            </span>
            {fill.amountMga !== undefined && <span className={styles.amount}>{formatAriary(fill.amountMga, locale)}</span>}
            {!readOnly && (
            <button type="button" className={styles.iconButton} onClick={() => void vehicleStore.removeFuel(vehicle.id, fill.id)} aria-label={t("garage.delete")}>
              <Trash2 size={15} />
            </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Expenses ------------------------------------------------------------------

function CostsPanel({ vehicle, readOnly }: PanelProps) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ExpenseKind>("insurance");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today);
  const spending = spendingByPeriod(vehicle, now);
  const peak = Math.max(1, ...spending.months.map((month) => month.total));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseField(amount);
    if (value === undefined) return;
    haptics.success();
    await vehicleStore.saveExpense(vehicle.id, { kind, label, amountMga: value, at: dayOf(day) });
    setLabel("");
    setAmount("");
    setAdding(false);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.stats}>
        {(["thisMonth", "lastMonth", "sixMonths"] as const).map((period) => (
          <span key={period}>
            <small>{t(`garage.costs.${period}`)}</small>
            <strong>{formatAriary(spending[period].total, locale)}</strong>
          </span>
        ))}
      </div>
      <div className={styles.chart} aria-label={t("garage.costs.months")}>
        {spending.months.map(({ month, total }) => (
          <span key={month} title={formatAriary(total, locale)}>
            <span className={styles.column}>
              <span style={{ height: `${(total / peak) * 100}%` }} />
            </span>
            <small>{new Date(month).toLocaleDateString(locale, { month: "short" })}</small>
          </span>
        ))}
      </div>
      <ul className={styles.kinds}>
        {spendingKinds
          .filter((value) => spending.sixMonths[value] > 0)
          .map((value) => (
            <li key={value}>
              {t(`garage.costs.kinds.${value}`)} <strong>{formatAriary(spending.sixMonths[value], locale)}</strong>
            </li>
          ))}
      </ul>

      {readOnly ? null : adding ? (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <div className={styles.fields}>
            <label>
              <span>{t("garage.costs.kind")}</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as ExpenseKind)}>
                {expenseKinds.map((value) => (
                  <option key={value} value={value}>
                    {t(`garage.costs.kinds.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("garage.date")}</span>
              <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
            </label>
            <label>
              <span>{t("garage.cost")}</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="Ar" required />
            </label>
            <label>
              <span>{t("garage.costs.label")}</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} />
            </label>
          </div>
          <div className={styles.row}>
            <Button type="submit" icon={<Check />} disabled={parseField(amount) === undefined}>
              {t("garage.save")}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>
          {t("garage.costs.add")}
        </Button>
      )}
      <p className={styles.hint}>{t("garage.costs.hint")}</p>

      <ul className={styles.entries}>
        {vehicle.expenses.map((expense) => (
          <li key={expense.id} className={styles.entry}>
            <span className={styles.text}>
              <strong>{expense.label || t(`garage.costs.kinds.${expense.kind}`)}</strong>
              <small>{formatDate(expense.at, locale)}</small>
            </span>
            <span className={styles.amount}>{formatAriary(expense.amountMga, locale)}</span>
            {!readOnly && (
            <button type="button" className={styles.iconButton} onClick={() => void vehicleStore.removeExpense(vehicle.id, expense.id)} aria-label={t("garage.delete")}>
              <Trash2 size={15} />
            </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
