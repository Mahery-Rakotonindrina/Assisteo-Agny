import Head from "next/head";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, MapPin, Package, Pencil, RotateCcw, ScanLine, Search, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ParcelCosts } from "@/components/ParcelCosts";
import { ParcelEditSheet } from "@/components/ParcelEditSheet";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useParcels } from "@/hooks/useParcels";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate, formatDateTime } from "@/lib/format";
import { easeOut, rise, stagger } from "@/lib/motion";
import { compareParcels, matchesSearch, parcelStep, parcelSteps, parcelTone, trackingUrl } from "@/lib/parcels";
import { haptics } from "@/services/device";
import { parcelStore, parcelTotalMga, type Parcel } from "@/services/parcelStore";
import styles from "@/styles/Parcels.module.scss";

/**
 * "Mes colis": the parcels being followed. In progress first, problems then
 * along the journey (delivered last); then received, the last one first.
 */
export default function ParcelsPage() {
  const { t, locale } = useTranslation();
  const { parcels, isLoading } = useParcels();
  const { entries } = useHistory();
  const thumbnails = new Map(entries.map((entry) => [entry.id, entry.thumbnail]));
  // Received = in the user's hands, set by hand: the carrier's "delivered"
  // often means a forwarding warehouse abroad, not Madagascar.
  const isReceived = (parcel: Parcel) => Boolean(parcel.receivedAt);
  const totalSpent = parcels.reduce((total, parcel) => total + parcelTotalMga(parcel), 0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const clients = [...new Set(parcels.map((parcel) => parcel.client?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) =>
    a.localeCompare(b, locale),
  );

  // Everything known about a parcel can be searched, in the user's language.
  const searchTexts = (parcel: Parcel) => {
    const { info } = parcel;
    const total = parcelTotalMga(parcel);
    return [
      parcel.title,
      parcel.client,
      t(`parcel.statuses.${info.status}`),
      info.statusLabel,
      isReceived(parcel) ? t("parcels.receivedLabel") : t("parcels.ongoing"),
      parcel.receivedAt ? formatDate(parcel.receivedAt, locale) : null,
      info.carrier,
      info.trackingNumber,
      info.orderNumber,
      info.platform,
      info.seller,
      info.orderedAt,
      info.shippedAt,
      info.estimatedDelivery,
      info.destinationCity,
      info.total,
      info.lastEvent?.description,
      info.lastEvent?.location,
      info.lastEvent?.at,
      ...info.items.flatMap((item) => [item.name, item.variant, item.price]),
      ...parcel.timeline.flatMap((item) => [item.event?.description, item.event?.location, item.event?.at]),
      parcel.priceMga,
      ...(parcel.fees ?? []).flatMap((fee) => [fee.label, fee.amountMga]),
      total || null,
      total ? formatAriary(total, locale) : null,
    ];
  };
  const visible = parcels.filter((parcel) => matchesSearch(searchTexts(parcel), deferredQuery)).sort(compareParcels);
  const ongoing = visible.filter((parcel) => !isReceived(parcel));
  const received = visible.filter(isReceived);
  const allOngoing = parcels.filter((parcel) => !isReceived(parcel)).length;

  return (
    <>
      <Head>
        <title>{`${t("parcels.title")} · ${t("meta.title")}`}</title>
      </Head>
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("parcels.title")}</h1>
          {parcels.length > 0 && <p>{t("parcels.count", { ongoing: allOngoing, received: parcels.length - allOngoing })}</p>}
          {totalSpent > 0 && <p className={styles.totalAll}>{t("parcels.totalAll", { amount: formatAriary(totalSpent, locale) })}</p>}
        </motion.header>

        {!isLoading && parcels.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("parcels.emptyTitle")}
              body={t("parcels.emptyBody")}
              action={
                <Button href="/" icon={<ScanLine />}>
                  {t("parcels.emptyCta")}
                </Button>
              }
            />
          </motion.div>
        ) : (
          <>
            {parcels.length > 0 && (
              <motion.label variants={rise} className={styles.search}>
                <Search size={18} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("parcels.search")}
                  aria-label={t("parcels.search")}
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label={t("parcels.clearSearch")}>
                    <X size={16} />
                  </button>
                )}
              </motion.label>
            )}
            {deferredQuery && visible.length === 0 && <p className={styles.noMatch}>{t("parcels.noMatch")}</p>}
            {deferredQuery && visible.length > 0 && <p className={styles.matchCount}>{t("parcels.matchCount", { count: visible.length })}</p>}
            {ongoing.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2>{t("parcels.ongoing")}</h2>
                {ongoing.map((parcel) => (
                  <ParcelRow key={parcel.id} parcel={parcel} thumbnail={thumbnails.get(parcel.scanIds[0])} clients={clients} />
                ))}
              </motion.section>
            )}
            {received.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2>{t("parcels.received")}</h2>
                {received.map((parcel) => (
                  <ParcelRow key={parcel.id} parcel={parcel} thumbnail={thumbnails.get(parcel.scanIds[0])} clients={clients} received />
                ))}
              </motion.section>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

function ParcelRow({ parcel, thumbnail, clients, received = false }: { parcel: Parcel; thumbnail?: string; clients: string[]; received?: boolean }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const { info } = parcel;
  const step = parcelStep(info.status);
  const lastScan = parcel.scanIds[parcel.scanIds.length - 1];
  const total = parcelTotalMga(parcel);
  const statusText = received
    ? parcel.receivedAt
      ? t("parcels.receivedOn", { date: formatDate(parcel.receivedAt, locale) })
      : t("parcels.receivedLabel")
    : info.status === "delivered"
      ? t("parcels.deliveredWaiting")
      : t(`parcel.statuses.${info.status}`);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      haptics.tap();
      toast(t("parcel.copied"));
    } catch {
      toast(t("parcel.copyFailed"), "error");
    }
  };

  return (
    <article className={styles.card} data-tone={received ? "done" : info.status === "delivered" ? "ok" : parcelTone(info.status)}>
      <button type="button" className={styles.summary} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          {thumbnail ? <img src={thumbnail} alt="" /> : <Package size={20} />}
        </span>
        <span className={styles.text}>
          <strong>{parcel.title}</strong>
          {parcel.client && (
            <span className={styles.client}>
              <UserRound size={12} /> {t("parcels.forClient", { name: parcel.client })}
            </span>
          )}
          <span className={styles.status}>{statusText}</span>
          {info.lastEvent && <small>{[info.lastEvent.description, info.lastEvent.at].filter(Boolean).join(" · ")}</small>}
          {total > 0 && <span className={styles.cost}>{formatAriary(total, locale)}</span>}
        </span>
        <ChevronDown size={18} className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>

      <div className={styles.bar} aria-hidden>
        {parcelSteps.map((name, index) => (
          <span key={name} className={received || index <= step ? styles.barDone : undefined} />
        ))}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.more}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: easeOut }}
          >
            <div className={styles.moreInner}>
              {info.trackingNumber && (
                <div className={styles.tracking}>
                  <button type="button" onClick={() => void copy(info.trackingNumber!)}>
                    <span>
                      <small>{[info.carrier, t("parcel.trackingNumber")].filter(Boolean).join(" · ")}</small>
                      <strong>{info.trackingNumber}</strong>
                    </span>
                    <Copy size={16} />
                  </button>
                  <a href={trackingUrl(info.trackingNumber, locale)} target="_blank" rel="noopener noreferrer">
                    {t("parcel.trackOnline")} <ExternalLink size={14} />
                  </a>
                </div>
              )}

              <section className={styles.block}>
                <h3>{t("parcels.cost")}</h3>
                <ParcelCosts parcel={parcel} />
              </section>

              <ol className={styles.timeline} aria-label={t("parcels.timeline")}>
                {[...parcel.timeline].reverse().map((item) => (
                  <li key={`${item.scanId}-${item.at}`}>
                    <span className={styles.dot} />
                    <div>
                      <strong>{t(`parcel.statuses.${item.status}`)}</strong>
                      {item.event && (
                        <small>
                          <MapPin size={12} /> {[item.event.description, item.event.location, item.event.at].filter(Boolean).join(" · ")}
                        </small>
                      )}
                      {item.scanId ? (
                        <Link href={{ pathname: "/result", query: { id: item.scanId } }} className={styles.scanLink}>
                          {t("parcels.scannedOn", { date: formatDateTime(item.at, locale) })}
                        </Link>
                      ) : (
                        <span className={styles.manual}>{t("parcels.editedOn", { date: formatDateTime(item.at, locale) })}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              <div className={styles.actions}>
                <Button variant="secondary" size="md" icon={<Pencil />} onClick={() => setEditing(true)}>
                  {t("parcels.edit")}
                </Button>
                {lastScan && (
                  <Button href={`/result?id=${lastScan}`} variant="secondary" size="md">
                    {t("parcels.openScan")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  icon={received ? <RotateCcw /> : <Check />}
                  onClick={() => {
                    haptics.tap();
                    void parcelStore.markReceived(parcel, !received);
                  }}
                >
                  {received ? t("parcels.markOngoing") : t("parcels.markReceived")}
                </Button>
                <Button
                  variant={confirmRemove ? "danger" : "ghost"}
                  size="md"
                  icon={<Trash2 />}
                  onClick={() => {
                    if (!confirmRemove) {
                      setConfirmRemove(true);
                      return;
                    }
                    haptics.press();
                    void parcelStore.remove(parcel.id);
                    toast(t("parcels.removed"));
                  }}
                >
                  {confirmRemove ? t("parcels.confirmRemove") : t("parcels.remove")}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ParcelEditSheet parcel={parcel} open={editing} onClose={() => setEditing(false)} clients={clients} />
    </article>
  );
}
