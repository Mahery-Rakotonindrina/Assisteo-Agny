import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plane, Plus, Save, Ship, Trash2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useSheetKeyboard } from "@/hooks/useSheetKeyboard";
import { useTranslation } from "@/hooks/useTranslation";
import type { ParcelStatus, ShippingMode } from "@/lib/ai/schema";
import { formatAriary, formatDate, formatDecimal } from "@/lib/format";
import { spring } from "@/lib/motion";
import { lotSummaries, type LotSummary, type ParcelLot } from "@/lib/parcelLots";
import { haptics } from "@/services/device";
import { createId } from "@/services/historyStore";
import { parcelStore, type Parcel } from "@/services/parcelStore";
import sheet from "@/components/ParcelEditSheet/ParcelEditSheet.module.scss";
import styles from "./ParcelLots.module.scss";

/** Statuses a whole shipment moves through; "received" marks its parcels received. */
const lotStatuses = ["shipped", "in_transit", "pickup_ready", "delivered", "received"] as const satisfies ReadonlyArray<ParcelStatus | "received">;
type LotStatus = (typeof lotStatuses)[number];

const noSubscribe = () => () => {};
/** A date input's day as a time (local midnight), to print it. */
const dayTime = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
};

/**
 * Reseller view (Pro): the shipments (a lot, a container) and their parcels,
 * with what they weigh, their freight, what the clients paid and still owe,
 * and one status for all of them.
 */
export function ParcelLots({ parcels }: { parcels: Parcel[] }) {
  const { t } = useTranslation();
  const lots = lotSummaries(parcels);
  // null: a new shipment; a summary: that one edited; undefined: closed.
  const [editing, setEditing] = useState<LotSummary<Parcel> | null | undefined>(undefined);

  return (
    <div className={styles.wrap}>
      <Button icon={<Plus />} onClick={() => setEditing(null)}>
        {t("parcelLots.new")}
      </Button>
      {lots.length === 0 ? (
        <p className={styles.empty}>{t("parcelLots.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {lots.map((summary) => (
            <LotCard key={summary.lot.id} summary={summary} onEdit={() => setEditing(summary)} />
          ))}
        </ul>
      )}
      <LotSheet open={editing !== undefined} summary={editing ?? null} parcels={parcels} onClose={() => setEditing(undefined)} />
    </div>
  );
}

function LotCard({ summary, onEdit }: { summary: LotSummary<Parcel>; onEdit: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { lot } = summary;
  const [status, setStatus] = useState<LotStatus>("in_transit");
  const [showParcels, setShowParcels] = useState(false);
  const ModeIcon = lot.mode === "air" ? Plane : Ship;

  const apply = async () => {
    haptics.tap();
    const label = status === "received" ? t("parcels.receivedLabel") : t(`parcel.statuses.${status}`);
    const count = await parcelStore.setLotStatus(lot.id, status, label);
    toast(count > 0 ? t("parcelLots.applied", { count }) : t("parcelLots.nothingToUpdate"));
  };

  return (
    <li className={styles.card} data-testid="parcel-lot">
      <div className={styles.head}>
        <span className={styles.icon} data-mode={lot.mode ?? "none"}>
          <ModeIcon size={18} />
        </span>
        <span className={styles.title}>
          <strong>{lot.name}</strong>
          <small>
            {[lot.mode && t(`parcel.shipping.${lot.mode}`), lot.departedAt ? t("parcelLots.departed", { date: formatDate(dayTime(lot.departedAt), locale) }) : t("parcelLots.noDate")]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
        <button type="button" className={styles.iconButton} onClick={onEdit} aria-label={t("parcelLots.editNamed", { name: lot.name })}>
          <Pencil size={17} />
        </button>
      </div>

      <dl className={styles.stats} data-testid="parcel-lot-totals">
        <div>
          <dt>{t("parcelLots.parcelsCount")}</dt>
          <dd>{t("parcelLots.count", { count: summary.parcels.length, ongoing: summary.ongoing })}</dd>
        </div>
        <div>
          <dt>{t("parcelLots.weightTotal")}</dt>
          <dd>{t("parcelLots.kg", { weight: formatDecimal(summary.weightKg, locale) })}</dd>
        </div>
        <div>
          <dt>{t("parcelLots.freightTotal")}</dt>
          <dd>{formatAriary(summary.freightMga, locale)}</dd>
        </div>
        <div>
          <dt>{t("parcelLots.paid")}</dt>
          <dd>{formatAriary(summary.paidMga, locale)}</dd>
        </div>
        <div>
          <dt>{t("parcelLots.due")}</dt>
          <dd data-tone={summary.dueMga > 0 ? "due" : "ok"}>{formatAriary(summary.dueMga, locale)}</dd>
        </div>
      </dl>

      <div className={styles.status}>
        <label>
          <span>{t("parcelLots.statusLabel")}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as LotStatus)}>
            {lotStatuses.map((value) => (
              <option key={value} value={value}>
                {value === "received" ? t("parcelLots.received") : t(`parcel.statuses.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" size="md" icon={<Check />} onClick={() => void apply()}>
          {t("parcelLots.apply")}
        </Button>
      </div>

      <button type="button" className={styles.toggle} aria-expanded={showParcels} onClick={() => setShowParcels(!showParcels)}>
        {showParcels ? t("parcelLots.hideParcels") : t("parcelLots.showParcels", { count: summary.parcels.length })}
      </button>
      {showParcels && (
        <ul className={styles.parcels}>
          {summary.parcels.map((parcel) => (
            <li key={parcel.id}>
              <Link href={{ pathname: "/parcels", query: { open: parcel.id } }}>
                <strong>{parcel.title}</strong>
                <small>
                  {[
                    parcel.client,
                    parcel.receivedAt ? t("parcels.receivedLabel") : t(`parcel.statuses.${parcel.info.status}`),
                    parcel.freight?.weightKg ? t("parcelLots.kg", { weight: formatDecimal(parcel.freight.weightKg, locale) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type SheetProps = {
  open: boolean;
  /** The shipment edited, or null for a new one. */
  summary: LotSummary<Parcel> | null;
  parcels: Parcel[];
  onClose: () => void;
};

function LotSheet({ open, summary, parcels, onClose }: SheetProps) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{open && <LotForm key={summary?.lot.id ?? "new"} summary={summary} parcels={parcels} onClose={onClose} />}</AnimatePresence>,
    document.body,
  );
}

function LotForm({ summary, parcels, onClose }: Omit<SheetProps, "open">) {
  const backdrop = useSheetKeyboard();
  const { t } = useTranslation();
  const toast = useToast();
  const lot = summary?.lot;
  const [name, setName] = useState(lot?.name ?? "");
  const [mode, setMode] = useState<ShippingMode | "">(lot?.mode ?? "");
  const [departedAt, setDepartedAt] = useState(lot?.departedAt ?? "");
  const members = new Set(summary?.parcels.map((parcel) => parcel.id) ?? []);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(members));
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Its parcels, then those still on their way (in another shipment or not).
  const choices = parcels.filter((parcel) => members.has(parcel.id) || !parcel.receivedAt);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    const next: ParcelLot = {
      id: lot?.id ?? createId(),
      name: name.trim().slice(0, 60),
      ...(mode && { mode }),
      ...(departedAt && { departedAt }),
    };
    await parcelStore.setLot([...picked], next);
    await parcelStore.setLot(
      [...members].filter((id) => !picked.has(id)),
      null,
    );
    haptics.success();
    toast(t("parcelLots.saved"));
    onClose();
  };

  const remove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    haptics.press();
    await parcelStore.setLot([...members], null);
    toast(t("parcelLots.removed"));
    onClose();
  };

  return (
    <motion.div ref={backdrop} className={sheet.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form
        className={sheet.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parcel-lot-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={sheet.top}>
          <h2 id="parcel-lot-title">{lot ? t("parcelLots.sheetEdit") : t("parcelLots.new")}</h2>
          <button type="button" className={sheet.close} onClick={onClose} aria-label={t("common.cancel")}>
            <X size={18} />
          </button>
        </div>

        <label className={sheet.field}>
          <span>{t("parcelLots.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value.slice(0, 60))} placeholder={t("parcelLots.namePlaceholder")} required />
        </label>
        <div className={sheet.grid}>
          <label className={sheet.field}>
            <span>{t("parcel.shipping.label")}</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ShippingMode | "")}>
              <option value="">{t("parcelLots.modeNone")}</option>
              <option value="sea">{t("parcel.shipping.sea")}</option>
              <option value="air">{t("parcel.shipping.air")}</option>
            </select>
          </label>
          <label className={sheet.field}>
            <span>{t("parcelLots.departedAt")}</span>
            <input type="date" value={departedAt} onChange={(event) => setDepartedAt(event.target.value)} />
          </label>
        </div>

        <h3 className={sheet.group}>{t("parcelLots.parcels")}</h3>
        {choices.length === 0 ? (
          <p className={styles.empty}>{t("parcelLots.noParcels")}</p>
        ) : (
          <ul className={styles.picker}>
            {choices.map((parcel) => (
              <li key={parcel.id}>
                <label>
                  <input type="checkbox" checked={picked.has(parcel.id)} onChange={() => toggle(parcel.id)} />
                  <span>
                    <strong>{parcel.title}</strong>
                    <small>
                      {[parcel.client, parcel.lot && parcel.lot.id !== lot?.id ? t("parcelLots.inOther", { name: parcel.lot.name }) : null].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className={sheet.actions}>
          <div className={styles.sheetActions}>
            {lot && (
              <Button variant={confirmRemove ? "danger" : "ghost"} icon={<Trash2 />} onClick={() => void remove()}>
                {confirmRemove ? t("parcelLots.confirmRemove") : t("parcelLots.remove")}
              </Button>
            )}
            <Button type="submit" block icon={<Save />} disabled={!name.trim() || picked.size === 0}>
              {t("parcelLots.save")}
            </Button>
          </div>
        </div>
      </motion.form>
    </motion.div>
  );
}
