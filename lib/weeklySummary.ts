// "Ta semaine": every Sunday in the late afternoon, a summary of the week on
// this device: what was spent, the parcels that arrived, the reminders of the
// week to come. Computed on the device, never sent anywhere. Pure, so it can
// be tested; scheduled by services/weeklySummary.ts, shown on the home screen
// on Sundays (components/WeekCard).

/** Sunday, at 17:00 local time. */
export const SUMMARY_DAY = 0;
export const SUMMARY_HOUR = 17;

export type WeekSummary = {
  /** Spent over the week, in ariary; null when the account has no "Mes dépenses". */
  spentMga: number | null;
  /** Parcels that arrived (received by hand, or delivered) during the week. */
  arrived: number;
  /** Reminders falling in the 7 days after the summary. */
  upcoming: number;
};

const DAY = 24 * 60 * 60_000;

/** The Sunday summary time that comes next: today's while it hasn't passed, else the following Sunday's. */
export function nextSummaryAt(now: number): number {
  const today = new Date(now);
  const daysAhead = (SUMMARY_DAY - today.getDay() + 7) % 7;
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead, SUMMARY_HOUR, 0).getTime();
  return at > now ? at : new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead + 7, SUMMARY_HOUR, 0).getTime();
}

/** Monday 00:00 of the week the moment `at` belongs to (weeks run Monday to Sunday). */
export function weekStart(at: number): number {
  const date = new Date(at);
  const sinceMonday = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday).getTime();
}

/** Is it Sunday, the day the home card shows? */
export const isSummaryDay = (now: number) => new Date(now).getDay() === SUMMARY_DAY;

type Spending = { at: number; amountMga: number; excluded?: boolean };
type ParcelLike = { receivedAt?: number; updatedAt: number; info: { status: string } };

/**
 * The summary of the week that ends at `at` (the Sunday time): Monday 00:00 up to `at`.
 * `spending` is null without "Mes dépenses"; `reminders` are the times of the reminders set.
 */
export function weekSummary({ at, spending, parcels, reminders }: { at: number; spending: Spending[] | null; parcels: ParcelLike[]; reminders: number[] }): WeekSummary {
  const from = weekStart(at);
  const inWeek = (time: number) => time >= from && time <= at;
  const arrivedAt = (parcel: ParcelLike) => parcel.receivedAt ?? (parcel.info.status === "delivered" ? parcel.updatedAt : null);
  return {
    spentMga: spending ? spending.filter((item) => !item.excluded && inWeek(item.at)).reduce((sum, item) => sum + item.amountMga, 0) : null,
    arrived: parcels.filter((parcel) => {
      const time = arrivedAt(parcel);
      return time !== null && inWeek(time);
    }).length,
    upcoming: reminders.filter((time) => time > at && time <= at + 7 * DAY).length,
  };
}

/** Nothing to tell: no notification, no card. */
export const summaryIsEmpty = (summary: WeekSummary) => !summary.spentMga && summary.arrived === 0 && summary.upcoming === 0;
