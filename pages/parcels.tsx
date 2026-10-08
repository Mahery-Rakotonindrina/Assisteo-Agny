import Head from "next/head";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, MapPin, Package, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ParcelCosts } from "@/components/ParcelCosts";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useParcels } from "@/hooks/useParcels";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDateTime } from "@/lib/format";
import { easeOut, rise, stagger } from "@/lib/motion";
import { parcelStep, parcelSteps, parcelTone, trackingUrl } from "@/lib/parcels";
import { haptics } from "@/services/device";
import { parcelStore, parcelTotalMga, type Parcel } from "@/services/parcelStore";
import styles from "@/styles/Parcels.module.scss";

/** "Mes colis": the parcels being followed, in progress first, then received. */
export default function ParcelsPage() {
  const { t, locale } = useTranslation();
  const { parcels, isLoading } = useParcels();
  const { entries } = useHistory();
  const thumbnails = new Map(entries.map((entry) => [entry.id, entry.thumbnail]));
  // Received = in the user's hands, set by hand: the carrier's "delivered"
  // often means a forwarding warehouse abroad, not Madagascar.
  const isReceived = (parcel: Parcel) => Boolean(parcel.receivedAt);
  const totalSpent = parcels.reduce((total, parcel) => total + parcelTotalMga(parcel), 0);
  const ongoing = parcels.filter((parcel) => !isReceived(parcel));
  const received = parcels.filter(isReceived);

  return (
    <>
      <Head>
        <title>{`${t("parcels.title")} · ${t("meta.title")}`}</title>
      </Head>
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("parcels.title")}</h1>
          {parcels.length > 0 && <p>{t("parcels.count", { ongoing: ongoing.length, received: received.length })}</p>}
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
            {ongoing.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2>{t("parcels.ongoing")}</h2>
                {ongoing.map((parcel) => (
                  <ParcelRow key={parcel.id} parcel={parcel} thumbnail={thumbnails.get(parcel.scanIds[0])} />
                ))}
              </motion.section>
            )}
            {received.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2>{t("parcels.received")}</h2>
                {received.map((parcel) => (
                  <ParcelRow key={parcel.id} parcel={parcel} thumbnail={thumbnails.get(parcel.scanIds[0])} received />
                ))}
              </motion.section>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

function ParcelRow({ parcel, thumbnail, received = false }: { parcel: Parcel; thumbnail?: string; received?: boolean }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { info } = parcel;
  const step = parcelStep(info.status);
  const lastScan = parcel.scanIds[parcel.scanIds.length - 1];
  const total = parcelTotalMga(parcel);
  const statusText = received
    ? t("parcels.receivedLabel")
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
                      <Link href={{ pathname: "/result", query: { id: item.scanId } }} className={styles.scanLink}>
                        {t("parcels.scannedOn", { date: formatDateTime(item.at, locale) })}
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>

              <div className={styles.actions}>
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
    </article>
  );
}
