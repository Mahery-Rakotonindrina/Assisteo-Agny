import { ChevronRight, UserRound } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary } from "@/lib/format";
import { clientSummaries, periods, type Period } from "@/lib/parcelReport";
import type { Parcel } from "@/services/parcelStore";
import styles from "./ParcelClients.module.scss";

type Props = {
  /** The parcels of the chosen period. */
  parcels: Parcel[];
  period: Period;
  onPeriod: (period: Period) => void;
  /** Shows that client's parcels (null: those without a client). */
  onPick: (client: string | null) => void;
  /** Extra actions under the totals (the export). */
  actions?: React.ReactNode;
};

/** Reseller view (Pro): what each client's parcels cost, over a period. */
export function ParcelClients({ parcels, period, onPeriod, onPick, actions }: Props) {
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

      <div className={styles.total}>
        <span>{t(`parcels.clients.totalOf.${period}`)}</span>
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
