import { Copy, ExternalLink, MapPin, Package, Truck } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { parcelStep, parcelSteps, parcelTone, trackingUrl, type ParcelInfo } from "@/lib/parcels";
import { haptics } from "@/services/device";
import styles from "./Parcel.module.scss";

/** Status, journey and order details of a parcel read from a screenshot. */
export function ParcelCard({ parcel }: { parcel: ParcelInfo }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const step = parcelStep(parcel.status);
  const tone = parcelTone(parcel.status);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      haptics.tap();
      toast(t("parcel.copied"));
    } catch {
      toast(t("parcel.copyFailed"), "error");
    }
  };

  const details: Array<[string, string | null]> = [
    [t("parcel.carrier"), parcel.carrier],
    [t("parcel.platform"), parcel.platform],
    [t("parcel.seller"), parcel.seller],
    [t("parcel.orderedAt"), parcel.orderedAt],
    [t("parcel.shippedAt"), parcel.shippedAt],
    [t("parcel.estimatedDelivery"), parcel.estimatedDelivery],
    [t("parcel.destination"), parcel.destinationCity],
    [t("parcel.total"), parcel.total],
  ];

  return (
    <div className={styles.parcel}>
      <div className={styles.status} data-tone={tone}>
        <span className={styles.statusIcon}>
          <Truck />
        </span>
        <div>
          <strong>{t(`parcel.statuses.${parcel.status}`)}</strong>
          {parcel.statusLabel && parcel.statusLabel.toLowerCase() !== t(`parcel.statuses.${parcel.status}`).toLowerCase() && <small>{parcel.statusLabel}</small>}
        </div>
      </div>

      <ol className={styles.steps} data-tone={tone} aria-label={t("parcel.progress")}>
        {parcelSteps.map((name, index) => (
          <li
            key={name}
            className={index <= step ? styles.stepDone : undefined}
            aria-current={index === step ? "step" : undefined}
            title={t(`parcel.statuses.${name}`)}
          >
            <span />
          </li>
        ))}
      </ol>

      {parcel.lastEvent && (
        <div className={styles.event}>
          <MapPin size={16} />
          <div>
            <strong>{parcel.lastEvent.description}</strong>
            <small>{[parcel.lastEvent.location, parcel.lastEvent.at].filter(Boolean).join(" · ")}</small>
          </div>
        </div>
      )}

      {(parcel.trackingNumber || parcel.orderNumber) && (
        <div className={styles.numbers}>
          {parcel.trackingNumber && (
            <button type="button" className={styles.number} onClick={() => void copy(parcel.trackingNumber!)} aria-label={t("parcel.copyTracking")}>
              <span>
                <small>{t("parcel.trackingNumber")}</small>
                <strong>{parcel.trackingNumber}</strong>
              </span>
              <Copy size={16} />
            </button>
          )}
          {parcel.orderNumber && (
            <button type="button" className={styles.number} onClick={() => void copy(parcel.orderNumber!)} aria-label={t("parcel.copyOrder")}>
              <span>
                <small>{t("parcel.orderNumber")}</small>
                <strong>{parcel.orderNumber}</strong>
              </span>
              <Copy size={16} />
            </button>
          )}
          {parcel.trackingNumber && (
            <a className={styles.track} href={trackingUrl(parcel.trackingNumber, locale)} target="_blank" rel="noopener noreferrer">
              {t("parcel.trackOnline")} <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}

      {parcel.items.length > 0 && (
        <ul className={styles.items}>
          {parcel.items.map((item, index) => (
            <li key={`${item.name}-${index}`}>
              <span className={styles.itemIcon}>
                <Package size={16} />
              </span>
              <span className={styles.itemText}>
                <strong>{item.name}</strong>
                {item.variant && <small>{item.variant}</small>}
              </span>
              <span className={styles.itemQty}>
                {item.quantity > 1 && <>{item.quantity} × </>}
                {item.price}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className={styles.details}>
        {details
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
