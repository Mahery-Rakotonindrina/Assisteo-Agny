import { ME, ownerOf, type HealthProfile } from "./healthProfiles";

// "Mes mesures" (Ma santé): blood pressure, blood sugar and weight, written by
// hand for oneself or a relative ("Pour qui ?"). Kept on the device
// (services/measureStore.ts) and synced with the account (table
// health_measures, migration 0024). Never an opinion on a value: no
// "normal", no advice, only the numbers, their change, and the doctor.
// Pure, so it can be tested.

export const measureKinds = ["pressure", "glucose", "weight"] as const;
export type MeasureKind = (typeof measureKinds)[number];

export const glucoseMoments = ["fasting", "afterMeal", "other"] as const;
export type GlucoseMoment = (typeof glucoseMoments)[number];

export type Measure = {
  id: string;
  kind: MeasureKind;
  /** When it was measured. */
  at: number;
  /** A relative's profile; none for "Moi". */
  profileId?: string;
  /** Blood pressure, mmHg; the pulse (beats a minute) is optional. */
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  /** Blood sugar, g/L, and when. */
  glucose?: number;
  moment?: GlucoseMoment;
  /** Weight, kg. */
  weight?: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
};

/** What the form gives (numbers as typed: "1,05", "64.5"). */
export type MeasureDraft = {
  kind: MeasureKind;
  at: number;
  profileId?: string;
  systolic?: string;
  diastolic?: string;
  pulse?: string;
  glucose?: string;
  moment?: GlucoseMoment;
  weight?: string;
  note?: string;
};

/** What the form accepts: wide on purpose (a typing slip, not a judgement). */
export const LIMITS = {
  systolic: [40, 300],
  diastolic: [20, 200],
  pulse: [20, 250],
  glucose: [0.1, 8],
  weight: [0.5, 400],
} as const;

export const NOTE_MAX = 200;

/** "1,05" or "1.05" to 1.05; null when it is not a number in its range. */
export function readNumber(value: string | undefined, [min, max]: readonly [number, number], decimals: number): number | null {
  const text = (value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

export type MeasureFields = Pick<Measure, "kind" | "at" | "profileId" | "systolic" | "diastolic" | "pulse" | "glucose" | "moment" | "weight" | "note">;

/** The form's values, checked; the fields wrong (to show) when they are not. */
export function cleanMeasure(draft: MeasureDraft): { fields: MeasureFields; wrong: [] } | { fields: null; wrong: string[] } {
  const base = {
    kind: draft.kind,
    at: draft.at,
    ...(draft.profileId && draft.profileId !== ME && { profileId: draft.profileId }),
    ...(draft.note?.trim() && { note: draft.note.trim().slice(0, NOTE_MAX) }),
  };
  if (!Number.isFinite(draft.at) || draft.at <= 0) return { fields: null, wrong: ["at"] };
  if (draft.kind === "pressure") {
    const systolic = readNumber(draft.systolic, LIMITS.systolic, 0);
    const diastolic = readNumber(draft.diastolic, LIMITS.diastolic, 0);
    const pulse = draft.pulse?.trim() ? readNumber(draft.pulse, LIMITS.pulse, 0) : undefined;
    const wrong = [systolic === null && "systolic", (diastolic === null || (systolic !== null && diastolic !== null && diastolic >= systolic)) && "diastolic", pulse === null && "pulse"].filter(
      (field): field is string => Boolean(field),
    );
    if (wrong.length || systolic === null || diastolic === null) return { fields: null, wrong };
    return { fields: { ...base, systolic, diastolic, ...(pulse && { pulse }) }, wrong: [] };
  }
  if (draft.kind === "glucose") {
    const glucose = readNumber(draft.glucose, LIMITS.glucose, 2);
    if (glucose === null) return { fields: null, wrong: ["glucose"] };
    return { fields: { ...base, glucose, moment: glucoseMoments.includes(draft.moment as GlucoseMoment) ? draft.moment : "other" }, wrong: [] };
  }
  const weight = readNumber(draft.weight, LIMITS.weight, 1);
  if (weight === null) return { fields: null, wrong: ["weight"] };
  return { fields: { ...base, weight }, wrong: [] };
}

/** A measure as stored, read back (another device, an older version): null when unusable. */
export function readMeasure(value: Measure): Measure | null {
  if (!value || !measureKinds.includes(value.kind) || !Number.isFinite(value.at)) return null;
  const ok =
    value.kind === "pressure" ? Number.isFinite(value.systolic) && Number.isFinite(value.diastolic) : value.kind === "glucose" ? Number.isFinite(value.glucose) : Number.isFinite(value.weight);
  return ok ? value : null;
}

export const periods = ["30d", "3m", "1y"] as const;
export type Period = (typeof periods)[number];

/** The start of a period ending now. */
export function periodStart(period: Period, now: number) {
  const date = new Date(now);
  if (period === "30d") date.setDate(date.getDate() - 30);
  else if (period === "3m") date.setMonth(date.getMonth() - 3);
  else date.setFullYear(date.getFullYear() - 1);
  return date.getTime();
}

/** One person's measures of a kind, oldest first ("Moi": also those of a relative removed). */
export function measuresOf(list: Measure[], kind: MeasureKind, person: string, profiles: HealthProfile[] | null | undefined, since = 0, until = Infinity) {
  return list
    .filter((item) => !item.deletedAt && item.kind === kind && item.at >= since && item.at <= until && ownerOf(item.profileId, profiles) === person)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** The numbers a measure draws: pressure two (systolic, diastolic), the others one. */
export function valuesOf(measure: Measure): number[] {
  if (measure.kind === "pressure") return [measure.systolic ?? 0, measure.diastolic ?? 0];
  return [measure.kind === "glucose" ? (measure.glucose ?? 0) : (measure.weight ?? 0)];
}

/**
 * The change over the period, without a word of judgement: the last value
 * minus the first one, per line drawn; null with fewer than two measures.
 */
export function change(series: Measure[]): number[] | null {
  if (series.length < 2) return null;
  const first = valuesOf(series[0]);
  const last = valuesOf(series[series.length - 1]);
  return last.map((value, index) => Math.round((value - first[index]) * 100) / 100);
}

/** The y range drawn: the values with a little room, never flat. */
export function yRange(series: Measure[]): [number, number] {
  const values = series.flatMap(valuesOf);
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, max === min ? Math.max(Math.abs(max) * 0.05, 1) : 0);
  min -= pad;
  max += pad;
  return [Math.max(0, min), max];
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One measure, in words: "128/82 mmHg · pouls 70", "1,05 g/L · à jeun", "64,5 kg". */
export function measureLine(measure: Measure, t: Translate, number: (value: number, decimals: number) => string) {
  if (measure.kind === "pressure") {
    const value = t("health.measures.pressureValue", { systolic: number(measure.systolic ?? 0, 0), diastolic: number(measure.diastolic ?? 0, 0) });
    return measure.pulse ? `${value} · ${t("health.measures.pulseValue", { pulse: number(measure.pulse, 0) })}` : value;
  }
  if (measure.kind === "glucose") return `${t("health.measures.glucoseValue", { value: number(measure.glucose ?? 0, 2) })} · ${t(`health.measures.moments.${measure.moment ?? "other"}`)}`;
  return t("health.measures.weightValue", { value: number(measure.weight ?? 0, 1) });
}

export type ShareOptions = { person: string; profiles: HealthProfile[] | null | undefined; since: number; until: number; name: string | null };
export type ShareFormat = { date: (at: number) => string; dateTime: (at: number) => string; number: (value: number, decimals: number) => string };

/**
 * The measures of a period for the doctor, the same in the message and the
 * PDF: a heading (and the person), the period, then each kind with its dated
 * values, oldest first, and the neutral line. Nothing but what was written.
 */
export function measureReport(list: Measure[], options: ShareOptions, t: Translate, format: ShareFormat) {
  const sections = measureKinds
    .map((kind) => ({ kind, series: measuresOf(list, kind, options.person, options.profiles, options.since, options.until) }))
    .filter(({ series }) => series.length > 0)
    .map(({ kind, series }) => ({
      title: t(`health.measures.kinds.${kind}`),
      lines: series.map((measure) => t("health.measures.share.line", { when: format.dateTime(measure.at), value: `${measureLine(measure, t, format.number)}${measure.note ? ` (${measure.note})` : ""}` })),
    }));
  return {
    title: options.name ? t("health.measures.share.headingOf", { name: options.name }) : t("health.measures.share.heading"),
    period: t("health.measures.share.period", { from: format.date(options.since), to: format.date(options.until) }),
    sections,
    doctor: t("health.measures.doctor"),
  };
}

/** The report as a message. */
export function measuresText(list: Measure[], options: ShareOptions, t: Translate, format: ShareFormat) {
  const report = measureReport(list, options, t, format);
  return [report.title, report.period, ...report.sections.flatMap((section) => ["", section.title, ...section.lines]), "", report.doctor].join("\n");
}
