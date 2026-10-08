import { ChevronRight, UserRound } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate } from "@/lib/format";
import { clientSummaries, isValidRange, periods, type DayRange, type Period } from "@/lib/parcelReport";
import type { Parcel } from "@/services/parcelStore";
import styles from "./ParcelClients.module.scss";

type Props = {
  /** The parcels of the chosen period. */
  parcels: Parcel[];
  period: Period;
  onPeriod: (period: Period) => void;
  /** The chosen days ("custom" period), and today (the latest day allowed). */
  range: DayRange;
  onRange: (range: DayRange) => void;
  today: string;
  /** Shows that client's parcels (null: those without a client). */
  onPick: (client: string | null) => void;
  /** Extra actions under the totals (the export). */
  actions?: React.ReactNode;
};

/** Reseller view (Pro): what each client's parcels cost, over a period. */
/** A date input's day as a time (local midnight), to print it. */
const dayTime = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
};

export function ParcelClients({ parcels, period, onPeriod, range, onRange, today, onPick, actions }: Props) {
  const { t, locale } = useTranslation();
  const summaries = clientSummaries(parcels);
  const total = summaries.reduce((sum, client) => sum + client.totalMga, 0);
  const ongoing = summaries.reduce((sum, client) => sum + client.ongoing, 0);

  return (
    <div className={styles.wrap}>
      <div className={styles.periods} role="group" aria-label={t("parcels.clients.period")}>
        {periods.map((value) => (
          <button key={value} type="button" aria-pressed={period === value} onClick={() => onPeriod(value)}>
            {t(`parcels.clients.periods.${value}`)}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className={styles.range}>
          <label>
            <span>{t("parcels.clients.from")}</span>
            <input type="date" value={range.from} max={range.to || today} onChange={(event) => onRange({ ...range, from: event.target.value })} />
          </label>
          <label>
            <span>{t("parcels.clients.to")}</span>
            <input type="date" value={range.to} min={range.from} max={today} onChange={(event) => onRange({ ...range, to: event.target.value })} />
          </label>
          {!isValidRange(range) && <p className={styles.rangeError}>{t("parcels.clients.badRange")}</p>}
        </div>
      )}

      <div className={styles.total}>
        <span>
          {period === "custom" && isValidRange(range)
            ? t("parcels.clients.totalOf.custom", { from: formatDate(dayTime(range.from), locale), to: formatDate(dayTime(range.to), locale) })
            : t(`parcels.clients.totalOf.${period}`)}
        </span>
        <strong>{formatAriary(total, locale)}</strong>
        <small>{t("parcels.clients.count", { parcels: parcels.length, ongoing })}</small>
      </div>
      {actions}

      {summaries.length === 0 ? (
        <p className={styles.empty}>{t("parcels.clients.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {summaries.map((client) => (
            <li key={client.name ?? ""}>
              <button type="button" onClick={() => onPick(client.name)}>
                <span className={styles.avatar} data-none={client.name === null ? "" : undefined}>
                  {client.name ? client.name.charAt(0).toUpperCase() : <UserRound size={16} />}
                </span>
                <span className={styles.text}>
                  <strong>{client.name ?? t("parcels.clients.none")}</strong>
                  <small>{t("parcels.clients.count", { parcels: client.parcels, ongoing: client.ongoing })}</small>
                </span>
                <span className={styles.amount}>{formatAriary(client.totalMga, locale)}</span>
                <ChevronRight size={16} className={styles.chevron} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
