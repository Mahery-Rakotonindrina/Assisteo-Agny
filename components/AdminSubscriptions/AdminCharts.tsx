import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatCompact, formatMonth, toDateInput } from "@/lib/format";
import { paidPlans, type PaidPlanId, type Subscription } from "@/lib/plans";
import styles from "./AdminCharts.module.scss";

type Props = {
  rows: Subscription[];
  /** Subscribers with each plan running now. */
  counts: Array<{ plan: PaidPlanId; count: number }>;
  now: number;
};

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MONTHS = 6;

const monthOf = (time: number) => toDateInput(time).slice(0, 7);

/** Admin charts in the plans' colours: who has which plan, and the money of the last months. */
export function AdminCharts({ rows, counts, now }: Props) {
  const { t, locale } = useTranslation();

  // The ring: one arc per plan, in proportion.
  const active = counts.filter(({ count }) => count > 0);
  const total = active.reduce((sum, { count }) => sum + count, 0);
  const share = (count: number) => (count / total) * CIRCUMFERENCE;
  const arcs = active.map(({ plan, count }, index) => ({
    plan,
    length: share(count),
    // Each arc starts where the ones before it end.
    offset: active.slice(0, index).reduce((sum, item) => sum + share(item.count), 0),
  }));

  // The bars: what was recorded each month, stacked by plan.
  const months = Array.from({ length: MONTHS }, (_, index) => {
    const date = new Date(now);
    return new Date(date.getFullYear(), date.getMonth() - (MONTHS - 1 - index), 15).getTime();
  });
  const byMonth = months.map((time) => {
    const month = monthOf(time);
    const parts = paidPlans
      .map((plan) => ({
        plan,
        amount: rows.filter((row) => row.plan === plan && monthOf(Date.parse(row.createdAt)) === month).reduce((sum, row) => sum + (row.amountMga ?? 0), 0),
      }))
      .filter(({ amount }) => amount > 0);
    return { time, parts, total: parts.reduce((sum, { amount }) => sum + amount, 0) };
  });
  const highest = Math.max(1, ...byMonth.map(({ total: monthTotal }) => monthTotal));

  return (
    <div className={styles.charts}>
      <figure className={styles.box}>
        <figcaption>{t("admin.subs.charts.split")}</figcaption>
        <div className={styles.ringRow}>
          <svg viewBox="0 0 120 120" className={styles.ring} role="img" aria-label={t("admin.subs.charts.split")}>
            <circle cx="60" cy="60" r={RADIUS} className={styles.track} />
            {arcs.map(({ plan, length, offset: start }) => (
              <circle
                key={plan}
                data-plan={plan}
                cx="60"
                cy="60"
                r={RADIUS}
                className={styles.arc}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-start}
                transform="rotate(-90 60 60)"
              />
            ))}
            <text x="60" y="60" className={styles.ringTotal}>
              {total}
            </text>
            <text x="60" y="78" className={styles.ringLabel}>
              {t("admin.subs.active")}
            </text>
          </svg>
          <ul className={styles.legend}>
            {active.map(({ plan, count }) => (
              <li key={plan} data-plan={plan}>
                <i />
                <span>{t(`plans.names.${plan}`)}</span>
                <strong>{count}</strong>
                <small>{Math.round((count / total) * 100)} %</small>
              </li>
            ))}
            {active.length === 0 && <li className={styles.none}>{t("admin.subs.empty")}</li>}
          </ul>
        </div>
      </figure>

      <figure className={styles.box}>
        <figcaption>{t("admin.subs.charts.monthly")}</figcaption>
        {byMonth.every(({ total: monthTotal }) => monthTotal === 0) ? (
          <p className={styles.none}>{t("admin.subs.charts.noPayments")}</p>
        ) : (
          <div className={styles.bars}>
            {byMonth.map(({ time, parts, total: monthTotal }) => (
              <div key={time} className={styles.column} title={formatAriary(monthTotal, locale)}>
                <span className={styles.amount}>{monthTotal ? formatCompact(monthTotal, locale) : ""}</span>
                <div className={styles.track2}>
                  <div className={styles.bar} style={{ height: `${(monthTotal / highest) * 100}%` }}>
                    {parts.map(({ plan, amount }) => (
                      <span key={plan} data-plan={plan} style={{ flexGrow: amount }} />
                    ))}
                  </div>
                </div>
                <small>{formatMonth(time, locale)}</small>
              </div>
            ))}
          </div>
        )}
      </figure>
    </div>
  );
}
