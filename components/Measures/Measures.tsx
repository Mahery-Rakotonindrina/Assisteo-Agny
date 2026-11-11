import { useState, type FormEvent } from "react";
import { Activity, FileDown, Plus, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import formStyles from "@/components/EmergencyCard/EmergencyCard.module.scss";
import { WhoField } from "@/components/HealthProfiles/WhoField";
import { useToast } from "@/components/Toast";
import { useMeasures } from "@/hooks/useMeasures";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { appointmentTime } from "@/lib/appointments";
import { formatDate, formatDateTime, formatMeasure, toDateInput } from "@/lib/format";
import { ME, ownerName } from "@/lib/healthProfiles";
import {
  change,
  cleanMeasure,
  glucoseMoments,
  measureKinds,
  measureLine,
  measuresOf,
  periods,
  periodStart,
  type GlucoseMoment,
  type Measure,
  type MeasureDraft,
  type MeasureKind,
  type Period,
} from "@/lib/measures";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { exportMeasuresPdf, shareMeasures } from "@/services/healthShare";
import { measureStore } from "@/services/measureStore";
import { MeasureChart } from "./MeasureChart";
import styles from "./Measures.module.scss";

/** When the form opens (read in the handlers only). */
const clock = () => Date.now();

/** Decimals shown per kind: mmHg whole, g/L to the hundredth, kg to the tenth. */
const decimalsOf: Record<MeasureKind, number> = { pressure: 0, glucose: 2, weight: 1 };

type Sheet = null | { kind: MeasureKind; measure: Measure | null; at: number };

/**
 * "Mes mesures" in Ma santé: blood pressure, blood sugar and weight of the
 * person picked at the top ("Pour qui ?"), a curve per kind over 30 days, 3
 * months or a year, with the last value and how much it moved. Never a word
 * on whether a value is good: only "Montre ces valeurs à ton médecin". For
 * everyone; shared as a message or a PDF.
 */
export function Measures({ profileId = ME }: { profileId?: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const { settings } = useSettings();
  const { measures, isLoading } = useMeasures();
  const [period, setPeriod] = useState<Period>("30d");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sharing, setSharing] = useState(false);
  const profiles = settings.healthProfiles;
  const since = periodStart(period, now);
  const number = (value: number, decimals: number) => formatMeasure(value, decimals, locale);
  const all = measureKinds.map((kind) => ({ kind, every: measuresOf(measures, kind, profileId, profiles), series: measuresOf(measures, kind, profileId, profiles, since, now) }));
  const kept = all.filter(({ every }) => every.length > 0);
  const inPeriod = kept.some(({ series }) => series.length > 0);

  const open = (kind: MeasureKind, measure: Measure | null = null) => setSheet({ kind, measure, at: measure?.at ?? clock() });

  const share = async (as: "text" | "pdf") => {
    if (sharing) return;
    haptics.tap();
    setSharing(true);
    const options = { person: profileId, profiles, since, until: now, name: ownerName(profileId, profiles) };
    try {
      const outcome = as === "pdf" ? await exportMeasuresPdf(measures, options, t, locale) : await shareMeasures(measures, options, t, locale);
      if (outcome === "copied") toast(t("health.measures.share.copied"));
      else if (outcome === "downloaded") toast(t("pdf.downloaded"));
      else if (outcome === "unavailable") toast(t("health.measures.share.failed"), "error");
    } catch {
      toast(t("health.measures.share.failed"), "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className={styles.section} id="measures" data-testid="measures" aria-labelledby="measures-title">
      <h2 id="measures-title">{t("health.measures.title")}</h2>
      <Button variant="secondary" icon={<Plus />} onClick={() => open(kept[0]?.kind ?? "pressure")} data-testid="measure-add">
        {t("health.measures.add")}
      </Button>

      {!isLoading && kept.length === 0 && <p className={styles.empty}>{t("health.measures.empty")}</p>}

      {kept.length > 0 && (
        <>
          <div className={styles.periods} role="group" aria-label={t("health.measures.period")}>
            {periods.map((item) => (
              <button key={item} type="button" aria-pressed={period === item} onClick={() => setPeriod(item)} data-testid="measure-period" data-period={item}>
                {t(`health.measures.periods.${item}`)}
              </button>
            ))}
          </div>
          <ul className={styles.list}>
            {kept.map(({ kind, every, series }) => (
              <KindCard key={kind} kind={kind} every={every} series={series} since={since} until={now} number={number} onAdd={() => open(kind)} onOpen={(measure) => open(kind, measure)} />
            ))}
          </ul>
          {inPeriod && (
            <div className={styles.share}>
              <Button variant="secondary" icon={<Share2 />} onClick={() => void share("text")} disabled={sharing} data-testid="measure-share">
                {t("health.measures.share.button")}
              </Button>
              <Button variant="secondary" icon={<FileDown />} onClick={() => void share("pdf")} disabled={sharing} data-testid="measure-share-pdf">
                {t("health.measures.share.pdf")}
              </Button>
            </div>
          )}
        </>
      )}
      <p className={styles.doctor}>{t("health.measures.doctor")}</p>

      <ExpenseSheet open={sheet !== null} title={sheet?.measure ? t("health.measures.edit") : t("health.measures.add")} onClose={() => setSheet(null)}>
        {sheet && <MeasureForm key={sheet.measure?.id ?? "new"} sheet={sheet} owner={sheet.measure?.profileId ?? profileId} onDone={() => setSheet(null)} />}
      </ExpenseSheet>
    </section>
  );
}

function KindCard({
  kind,
  every,
  series,
  since,
  until,
  number,
  onAdd,
  onOpen,
}: {
  kind: MeasureKind;
  every: Measure[];
  series: Measure[];
  since: number;
  until: number;
  number: (value: number, decimals: number) => string;
  onAdd: () => void;
  onOpen: (measure: Measure) => void;
}) {
  const { t, locale } = useTranslation();
  const last = every[every.length - 1];
  const moved = change(series);
  const unit = t(`health.measures.units.${kind}`);
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${number(Math.abs(value), decimalsOf[kind])}`;
  const labels = kind === "pressure" ? [t("health.measures.systolic"), t("health.measures.diastolic")] : [];

  return (
    <li className={styles.card} data-testid="measure-kind" data-kind={kind}>
      <div className={styles.head}>
        <h3>
          <Activity size={16} aria-hidden /> {t(`health.measures.kinds.${kind}`)}
        </h3>
        <Button variant="ghost" icon={<Plus />} onClick={onAdd} aria-label={t("health.measures.addKind", { kind: t(`health.measures.kinds.${kind}`) })} data-testid="measure-add-kind">
          {t("health.measures.addShort")}
        </Button>
      </div>
      <p className={styles.last} data-testid="measure-last">
        <strong>{measureLine(last, t, number)}</strong>
        <span>{t("health.measures.lastOn", { when: formatDateTime(last.at, locale) })}</span>
      </p>
      {moved && (
        <p className={styles.change} data-testid="measure-change">
          {kind === "pressure"
            ? t("health.measures.changePressure", { systolic: signed(moved[0]), diastolic: signed(moved[1]), unit, date: formatDate(series[0].at, locale) })
            : t("health.measures.change", { value: signed(moved[0]), unit, date: formatDate(series[0].at, locale) })}
        </p>
      )}
      {series.length > 0 ? (
        <MeasureChart series={series} since={since} until={until} labels={labels} number={number} decimals={decimalsOf[kind]} />
      ) : (
        <p className={styles.none}>{t("health.measures.noneInPeriod")}</p>
      )}
      {series.length > 0 && (
        <details className={styles.values}>
          <summary>{t("health.measures.values", { count: series.length })}</summary>
          <ul>
            {[...series].reverse().map((measure) => (
              <li key={measure.id}>
                <button type="button" onClick={() => onOpen(measure)} data-testid="measure-value">
                  <span>{formatDateTime(measure.at, locale)}</span>
                  <strong>{measureLine(measure, t, number)}</strong>
                  {measure.note && <small>{measure.note}</small>}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

const hourOf = (at: number) => `${String(new Date(at).getHours()).padStart(2, "0")}:${String(new Date(at).getMinutes()).padStart(2, "0")}`;
const asText = (value: number | undefined, decimals: number, locale: string) => (value === undefined ? "" : decimals === 0 ? String(value) : String(value).replace(".", locale === "fr" ? "," : "."));

function MeasureForm({ sheet, owner, onDone }: { sheet: NonNullable<Sheet>; owner: string; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { measure } = sheet;
  const [kind, setKind] = useState<MeasureKind>(sheet.kind);
  const [day, setDay] = useState(toDateInput(sheet.at));
  const [hour, setHour] = useState(hourOf(sheet.at));
  const [forWho, setForWho] = useState(owner);
  const [systolic, setSystolic] = useState(asText(measure?.systolic, 0, locale));
  const [diastolic, setDiastolic] = useState(asText(measure?.diastolic, 0, locale));
  const [pulse, setPulse] = useState(asText(measure?.pulse, 0, locale));
  const [glucose, setGlucose] = useState(asText(measure?.glucose, 2, locale));
  const [moment, setMoment] = useState<GlucoseMoment>(measure?.moment ?? "fasting");
  const [weight, setWeight] = useState(asText(measure?.weight, 1, locale));
  const [note, setNote] = useState(measure?.note ?? "");
  const [wrong, setWrong] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const at = appointmentTime(day, hour) ?? Number.NaN;
    const draft: MeasureDraft = { kind, at, profileId: forWho, systolic, diastolic, pulse, glucose, moment, weight, note };
    const result = cleanMeasure(draft);
    if (!result.fields) {
      setWrong(result.wrong);
      return;
    }
    haptics.success();
    if (measure) await measureStore.edit(measure.id, result.fields);
    else await measureStore.add(result.fields);
    toast(t(measure ? "health.measures.updated" : "health.measures.added"));
    onDone();
  };

  const remove = async () => {
    if (!measure) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    haptics.press();
    await measureStore.remove(measure.id);
    toast(t("health.measures.removed"));
    onDone();
  };

  const invalid = (field: string) => wrong.includes(field) || undefined;

  return (
    <form className={`${sheetStyles.form} ${formStyles.form}`} onSubmit={(event) => void submit(event)} noValidate data-testid="measure-form">
      {!measure && (
        <div className={styles.kinds} role="group" aria-label={t("health.measures.kind")}>
          {measureKinds.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={kind === item}
              onClick={() => {
                setKind(item);
                setWrong([]);
              }}
              data-testid="measure-kind-pick"
              data-kind={item}
            >
              {t(`health.measures.kinds.${item}`)}
            </button>
          ))}
        </div>
      )}
      <WhoField value={forWho} onChange={setForWho} />
      {kind === "pressure" && (
        <>
          <div className={styles.pair}>
            <label>
              {t("health.measures.systolicField")}
              <input inputMode="numeric" value={systolic} onChange={(event) => setSystolic(event.target.value)} aria-invalid={invalid("systolic")} data-testid="measure-systolic" />
            </label>
            <label>
              {t("health.measures.diastolicField")}
              <input inputMode="numeric" value={diastolic} onChange={(event) => setDiastolic(event.target.value)} aria-invalid={invalid("diastolic")} data-testid="measure-diastolic" />
            </label>
          </div>
          <label>
            {t("health.measures.pulseField")}
            <input inputMode="numeric" value={pulse} onChange={(event) => setPulse(event.target.value)} aria-invalid={invalid("pulse")} data-testid="measure-pulse" />
          </label>
        </>
      )}
      {kind === "glucose" && (
        <>
          <label>
            {t("health.measures.glucoseField")}
            <input inputMode="decimal" value={glucose} placeholder="1,05" onChange={(event) => setGlucose(event.target.value)} aria-invalid={invalid("glucose")} data-testid="measure-glucose" />
          </label>
          <label>
            {t("health.measures.moment")}
            <select value={moment} onChange={(event) => setMoment(event.target.value as GlucoseMoment)} data-testid="measure-moment">
              {glucoseMoments.map((item) => (
                <option key={item} value={item}>
                  {t(`health.measures.moments.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {kind === "weight" && (
        <label>
          {t("health.measures.weightField")}
          <input inputMode="decimal" value={weight} placeholder="64,5" onChange={(event) => setWeight(event.target.value)} aria-invalid={invalid("weight")} data-testid="measure-weight" />
        </label>
      )}
      {wrong.length > 0 && (
        <p className={styles.error} role="alert">
          {t(wrong.includes("at") ? "health.measures.whenMissing" : `health.measures.wrong.${kind}`)}
        </p>
      )}
      <div className={styles.pair}>
        <label>
          {t("health.measures.day")}
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} aria-invalid={invalid("at")} data-testid="measure-day" />
        </label>
        <label>
          {t("health.measures.hour")}
          <input type="time" value={hour} onChange={(event) => setHour(event.target.value)} aria-invalid={invalid("at")} data-testid="measure-hour" />
        </label>
      </div>
      <label>
        {t("health.measures.note")}
        <input value={note} maxLength={200} placeholder={t("health.measures.noteHint")} onChange={(event) => setNote(event.target.value)} data-testid="measure-note" />
      </label>
      {measure && (
        <Button variant={confirm ? "danger" : "ghost"} icon={<Trash2 />} onClick={() => void remove()} data-testid="measure-remove">
          {t(confirm ? "health.measures.removeConfirm" : "health.measures.remove")}
        </Button>
      )}
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="measure-save">
          {t("health.measures.save")}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t("health.measures.cancel")}
        </Button>
      </div>
    </form>
  );
}
