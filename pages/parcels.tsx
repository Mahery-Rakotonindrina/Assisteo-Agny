import Head from "next/head";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, FileSpreadsheet, MapPin, Package, Pencil, RotateCcw, ScanLine, Search, Trash2, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ParcelClients } from "@/components/ParcelClients";
import { ParcelCosts } from "@/components/ParcelCosts";
import { ParcelEditSheet } from "@/components/ParcelEditSheet";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useNow } from "@/hooks/useNow";
import { useParcels } from "@/hooks/useParcels";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate, formatDateTime, formatMonthYear, toDateInput } from "@/lib/format";
import { easeOut, rise, stagger } from "@/lib/motion";
import { exportFileName, parcelsWorkbook, XLSX_TYPE } from "@/lib/parcelExport";
import { inPeriod, isForClient, isValidRange, parcelDate, type DayRange, type Period } from "@/lib/parcelReport";
import { compareParcels, matchesSearch, parcelStep, parcelSteps, parcelTone, trackingUrl } from "@/lib/parcels";
import { haptics } from "@/services/device";
import { shareFile } from "@/services/fileShare";
import { keepParcelThumbnails } from "@/services/parcelLinking";
import { parcelDueMga, parcelStore, parcelTotalMga, type Parcel } from "@/services/parcelStore";
import styles from "@/styles/Parcels.module.scss";

/**
 * "Mes colis": the parcels being followed. In progress first, problems then
 * along the journey (delivered last); then received, the last one first.
 */
/** From the 1st of this month to today, as date input values. */
const thisMonthSoFar = (): DayRange => {
  const today = toDateInput(Date.now());
  return { from: `${today.slice(0, 7)}-01`, to: today };
};

export default function ParcelsPage() {
  const { t, locale } = useTranslation();
  const { parcels, isLoading } = useParcels();
  const { entries, isLoading: historyLoading } = useHistory();
  // Parcels followed before they kept their own photo: copy it from their scans.
  useEffect(() => {
    void keepParcelThumbnails().catch(() => undefined);
  }, []);
  // A scan deleted from the history can no longer be opened from its parcel.
  const scanIds = new Set(entries.map((entry) => entry.id));
  const hasScan = (id: string) => historyLoading || scanIds.has(id);
  const thumbnails = new Map(entries.map((entry) => [entry.id, entry.thumbnail]));
  // Received = in the user's hands, set by hand: the carrier's "delivered"
  // often means a forwarding warehouse abroad, not Madagascar.
  const isReceived = (parcel: Parcel) => Boolean(parcel.receivedAt);
  const totalSpent = parcels.reduce((total, parcel) => total + parcelTotalMga(parcel), 0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  // Pro: the parcels by client, over a period, and one client's parcels.
  const reseller = usePlan().has("reseller");
  const now = useNow(60_000);
  const [view, setView] = useState<"parcels" | "clients">("parcels");
  const [period, setPeriod] = useState<Period>("month");
  // Chosen days: this month so far, to start with.
  const [range, setRange] = useState<DayRange>(thisMonthSoFar);
  const [exporting, setExporting] = useState(false);
  const [clientFilter, setClientFilter] = useState<{ name: string | null } | null>(null);
  const showClients = reseller && view === "clients";
  const toast = useToast();
  const periodParcels = parcels.filter((parcel) => inPeriod(parcel, period, now, range));

  // The period's parcels as an Excel workbook, client by client, oldest first.
  const exportParcels = async () => {
    if (exporting) return;
    haptics.tap();
    setExporting(true);
    const sorted = [...periodParcels].sort(
      (a, b) =>
        Number(!a.client?.trim()) - Number(!b.client?.trim()) ||
        (a.client ?? "").localeCompare(b.client ?? "", locale) ||
        parcelDate(a) - parcelDate(b),
    );
    const month = (offset: number) => {
      const date = new Date(now);
      return toDateInput(new Date(date.getFullYear(), date.getMonth() - offset, 1).getTime()).slice(0, 7);
    };
    const day = (value: string) => {
      const [year, monthIndex, date] = value.split("-").map(Number);
      return new Date(year, monthIndex - 1, date).getTime();
    };
    const monthStart = (offset: number) => {
      const date = new Date(now);
      return new Date(date.getFullYear(), date.getMonth() - offset, 1).getTime();
    };
    const { suffix, label } =
      period === "custom"
        ? { suffix: `${range.from}_au_${range.to}`, label: t("parcels.export.range", { from: formatDate(day(range.from), locale), to: formatDate(day(range.to), locale) }) }
        : period === "all"
          ? { suffix: `tout-${toDateInput(now)}`, label: t("parcels.export.allParcels") }
          : { suffix: month(period === "month" ? 0 : 1), label: formatMonthYear(monthStart(period === "month" ? 0 : 1), locale) };
    try {
      const bytes = await parcelsWorkbook(sorted, t, locale, {
        title: `${t("parcels.export.title")} · ${label}`,
        subtitle: t("parcels.export.exportedOn", { date: formatDate(now, locale) }),
      });
      const result = await shareFile(exportFileName(suffix), bytes, XLSX_TYPE, t("parcels.export.title"));
      if (result === "downloaded") toast(t("parcels.export.downloaded"));
    } catch {
      toast(t("parcels.export.failed"), "error");
    } finally {
      setExporting(false);
    }
  };
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
      parcel.salePriceMga,
      parcel.paidMga,
      total || null,
      total ? formatAriary(total, locale) : null,
    ];
  };
  const visible = parcels
    .filter((parcel) => matchesSearch(searchTexts(parcel), deferredQuery) && (!clientFilter || isForClient(parcel, clientFilter.name)))
    .sort(compareParcels);
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
            {reseller && parcels.length > 0 && (
              <motion.div variants={rise}>
                <SegmentedControl
                  ariaLabel={t("parcels.clients.view")}
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "parcels", label: t("parcels.clients.parcelsTab"), icon: <Package size={16} /> },
                    { value: "clients", label: t("parcels.clients.clientsTab"), icon: <Users size={16} /> },
                  ]}
                />
              </motion.div>
            )}
            {showClients && (
              <motion.div variants={rise}>
                <ParcelClients
                  parcels={periodParcels}
                  period={period}
                  onPeriod={setPeriod}
                  range={range}
                  onRange={setRange}
                  today={toDateInput(now)}
                  actions={
                    periodParcels.length > 0 &&
                    (period !== "custom" || isValidRange(range)) && (
                      <Button variant="secondary" icon={<FileSpreadsheet />} onClick={() => void exportParcels()} disabled={exporting}>
                        {exporting ? t("parcels.export.working") : t("parcels.export.button")}
                      </Button>
                    )
                  }
                  onPick={(name) => {
                    setClientFilter({ name });
                    setQuery("");
                    setView("parcels");
                  }}
                />
              </motion.div>
            )}
            {!showClients && clientFilter && (
              <motion.button variants={rise} type="button" className={styles.clientFilter} onClick={() => setClientFilter(null)}>
                <UserRound size={14} /> {clientFilter.name ? t("parcels.forClient", { name: clientFilter.name }) : t("parcels.clients.none")}
                <X size={14} aria-label={t("parcels.clearSearch")} />
              </motion.button>
            )}
            {!showClients && parcels.length > 0 && (
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
            {!showClients && (deferredQuery || clientFilter) && visible.length === 0 && <p className={styles.noMatch}>{t("parcels.noMatch")}</p>}
            {!showClients && deferredQuery && visible.length > 0 && <p className={styles.matchCount}>{t("parcels.matchCount", { count: visible.length })}</p>}
            {!showClients && ongoing.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2>{t("parcels.ongoing")}</h2>
                {ongoing.map((parcel) => (
                  <ParcelRow
                    key={parcel.id}
                    parcel={parcel}
                    thumbnail={parcel.thumbnail ?? thumbnails.get(parcel.scanIds[0])}
                    clients={clients}
                    hasScan={hasScan}
                    reseller={reseller}
                  />
                ))}
              </motion.section>
            )}
            {!showClients && received.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2>{t("parcels.received")}</h2>
                {received.map((parcel) => (
                  <ParcelRow
                    key={parcel.id}
                    parcel={parcel}
                    thumbnail={parcel.thumbnail ?? thumbnails.get(parcel.scanIds[0])}
                    clients={clients}
                    hasScan={hasScan}
                    reseller={reseller}
                    received
                  />
                ))}
              </motion.section>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

type ParcelRowProps = {
  parcel: Parcel;
  thumbnail?: string;
  clients: string[];
  /** Whether a scan still exists in the history (to open it). */
  hasScan: (id: string) => boolean;
  received?: boolean;
  /** Pro: show what the client still owes. */
  reseller: boolean;
};

function ParcelRow({ parcel, thumbnail, clients, hasScan, reseller, received = false }: ParcelRowProps) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const { info } = parcel;
  const step = parcelStep(info.status);
  // The latest scan still in the history; deleted ones can't be opened.
  const lastScan = [...parcel.scanIds].reverse().find(hasScan);
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
          {reseller && parcelDueMga(parcel) > 0 && <span className={styles.due}>{t("parcels.sale.dueShort", { amount: formatAriary(parcelDueMga(parcel), locale) })}</span>}
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
                      {item.scanId && hasScan(item.scanId) ? (
                        <Link href={{ pathname: "/result", query: { id: item.scanId } }} className={styles.scanLink}>
                          {t("parcels.scannedOn", { date: formatDateTime(item.at, locale) })}
                        </Link>
                      ) : item.scanId ? (
                        <span className={styles.manual}>{t("parcels.scannedOn", { date: formatDateTime(item.at, locale) })}</span>
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
