import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, Save, X } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { toDateInput } from "@/lib/format";
import { parcelStatuses, type ParcelStatus } from "@/lib/ai/schema";
import { spring } from "@/lib/motion";
import type { ParcelInfo } from "@/lib/parcels";
import { haptics } from "@/services/device";
import { parcelStore, type Parcel } from "@/services/parcelStore";
import styles from "./ParcelEditSheet.module.scss";

type Props = {
  parcel: Parcel;
  open: boolean;
  onClose: () => void;
  /** Names already used, suggested while typing the client. */
  clients: string[];
};

type DraftItem = { name: string; variant: string; quantity: string; price: string };

const noSubscribe = () => () => {};
const orNull = (value: string) => (value.trim() ? value.trim() : null);
/** "YYYY-MM-DD HH:mm" ⇄ the value of a datetime-local input. */
const toInput = (at: string | null | undefined) => (at ? at.replace(" ", "T").slice(0, 16) : "");
const fromInput = (value: string) => (value ? value.replace("T", " ") : null);
const todayInput = () => toDateInput(Date.now());
/** The pick-up day as a time: now when it is today, else midday that day. */
const pickedUpAt = (day: string) => {
  const now = Date.now();
  if (day >= toDateInput(now)) return now;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12).getTime();
};

/** Lets the user correct or complete everything about a parcel. */
export function ParcelEditSheet({ parcel, open, onClose, clients }: Props) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>{open && <Form key={parcel.id} parcel={parcel} onClose={onClose} clients={clients} />}</AnimatePresence>,
    document.body,
  );
}

function Form({ parcel, onClose, clients }: Omit<Props, "open">) {
  const { t } = useTranslation();
  const reseller = usePlan().has("reseller");
  const { info } = parcel;
  const [title, setTitle] = useState(parcel.title);
  const [client, setClient] = useState(parcel.client ?? "");
  const [status, setStatus] = useState<ParcelStatus>(info.status);
  const initialReceivedDay = parcel.receivedAt ? toDateInput(parcel.receivedAt) : "";
  const [receivedDay, setReceivedDay] = useState(initialReceivedDay);
  const [today] = useState(todayInput);
  const [fields, setFields] = useState({
    carrier: info.carrier ?? "",
    trackingNumber: info.trackingNumber ?? "",
    orderNumber: info.orderNumber ?? "",
    platform: info.platform ?? "",
    seller: info.seller ?? "",
    orderedAt: info.orderedAt ?? "",
    shippedAt: info.shippedAt ?? "",
    estimatedDelivery: info.estimatedDelivery ?? "",
    destinationCity: info.destinationCity ?? "",
    total: info.total ?? "",
    eventDescription: info.lastEvent?.description ?? "",
    eventLocation: info.lastEvent?.location ?? "",
    eventAt: toInput(info.lastEvent?.at),
  });
  const [items, setItems] = useState<DraftItem[]>(() =>
    info.items.map((item) => ({ name: item.name, variant: item.variant ?? "", quantity: String(item.quantity), price: item.price ?? "" })),
  );
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof fields) => (value: string) => setFields((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    const next: ParcelInfo = {
      ...info,
      status,
      // The label follows a status changed by hand; otherwise keep the shop's wording.
      statusLabel: status === info.status ? info.statusLabel : t(`parcel.statuses.${status}`),
      carrier: orNull(fields.carrier),
      trackingNumber: orNull(fields.trackingNumber),
      orderNumber: orNull(fields.orderNumber),
      platform: orNull(fields.platform),
      seller: orNull(fields.seller),
      orderedAt: orNull(fields.orderedAt),
      shippedAt: orNull(fields.shippedAt),
      estimatedDelivery: orNull(fields.estimatedDelivery),
      destinationCity: orNull(fields.destinationCity),
      total: orNull(fields.total),
      lastEvent: fields.eventDescription.trim()
        ? { description: fields.eventDescription.trim(), location: orNull(fields.eventLocation), at: fromInput(fields.eventAt) }
        : null,
      items: items
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim(), variant: orNull(item.variant), quantity: Math.max(1, Number(item.quantity) || 1), price: orNull(item.price) })),
    };
    // An untouched day keeps the exact time it was marked received.
    const receivedAt = receivedDay === initialReceivedDay ? undefined : receivedDay ? pickedUpAt(receivedDay) : null;
    await parcelStore.edit(parcel.id, { title, client, info: next, receivedAt });
    haptics.success();
    setSaving(false);
    onClose();
  };

  return (
    <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parcel-edit-title"
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
        <div className={styles.top}>
          <h2 id="parcel-edit-title">{t("parcels.editTitle")}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("common.cancel")}>
            <X size={18} />
          </button>
        </div>

        <Field label={t("parcels.fields.title")}>
          <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 120))} required />
        </Field>
        <Field label={t("parcels.fields.client")} hint={
            reseller ? (
              t("parcels.fields.clientHint")
            ) : (
              <>
                <PlanBadge plan="pro" /> {t("parcels.fields.clientLocked")}
              </>
            )
          }
        >
          <input disabled={!reseller} value={client} onChange={(event) => setClient(event.target.value.slice(0, 60))} list="parcel-clients" placeholder={t("parcels.fields.clientPlaceholder")} />
          <datalist id="parcel-clients">
            {clients.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label={t("parcels.fields.status")}>
          <select value={status} onChange={(event) => setStatus(event.target.value as ParcelStatus)}>
            {parcelStatuses.map((value) => (
              <option key={value} value={value}>
                {t(`parcel.statuses.${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("parcels.fields.receivedAt")} hint={t("parcels.fields.receivedHint")}>
          <input type="date" value={receivedDay} max={today} onChange={(event) => setReceivedDay(event.target.value)} />
        </Field>

        <h3 className={styles.group}>{t("parcels.fields.shipping")}</h3>
        <div className={styles.grid}>
          <Field label={t("parcel.carrier")}>
            <input value={fields.carrier} onChange={(event) => set("carrier")(event.target.value)} />
          </Field>
          <Field label={t("parcel.trackingNumber")}>
            <input value={fields.trackingNumber} onChange={(event) => set("trackingNumber")(event.target.value)} className={styles.mono} />
          </Field>
          <Field label={t("parcel.orderNumber")}>
            <input value={fields.orderNumber} onChange={(event) => set("orderNumber")(event.target.value)} className={styles.mono} />
          </Field>
          <Field label={t("parcel.destination")}>
            <input value={fields.destinationCity} onChange={(event) => set("destinationCity")(event.target.value)} />
          </Field>
          <Field label={t("parcel.shippedAt")}>
            <input type="date" value={fields.shippedAt} onChange={(event) => set("shippedAt")(event.target.value)} />
          </Field>
          <Field label={t("parcel.estimatedDelivery")}>
            <input type="date" value={fields.estimatedDelivery} onChange={(event) => set("estimatedDelivery")(event.target.value)} />
          </Field>
        </div>

        <h3 className={styles.group}>{t("parcels.fields.lastEvent")}</h3>
        <Field label={t("parcels.fields.eventDescription")}>
          <input value={fields.eventDescription} onChange={(event) => set("eventDescription")(event.target.value)} />
        </Field>
        <div className={styles.grid}>
          <Field label={t("parcels.fields.eventLocation")}>
            <input value={fields.eventLocation} onChange={(event) => set("eventLocation")(event.target.value)} />
          </Field>
          <Field label={t("parcels.fields.eventAt")}>
            <input type="datetime-local" value={fields.eventAt} onChange={(event) => set("eventAt")(event.target.value)} />
          </Field>
        </div>

        <h3 className={styles.group}>{t("parcels.fields.order")}</h3>
        <div className={styles.grid}>
          <Field label={t("parcel.platform")}>
            <input value={fields.platform} onChange={(event) => set("platform")(event.target.value)} />
          </Field>
          <Field label={t("parcel.seller")}>
            <input value={fields.seller} onChange={(event) => set("seller")(event.target.value)} />
          </Field>
          <Field label={t("parcel.orderedAt")}>
            <input type="date" value={fields.orderedAt} onChange={(event) => set("orderedAt")(event.target.value)} />
          </Field>
          <Field label={t("parcel.total")}>
            <input value={fields.total} onChange={(event) => set("total")(event.target.value)} placeholder="¥221.45" />
          </Field>
        </div>

        <h3 className={styles.group}>{t("parcels.fields.items")}</h3>
        {items.map((item, index) => (
          <div key={index} className={styles.item}>
            <input
              value={item.name}
              onChange={(event) => setItems((current) => current.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))}
              placeholder={t("parcels.fields.itemName")}
              aria-label={t("parcels.fields.itemName")}
            />
            <input
              value={item.variant}
              onChange={(event) => setItems((current) => current.map((row, i) => (i === index ? { ...row, variant: event.target.value } : row)))}
              placeholder={t("parcels.fields.itemVariant")}
              aria-label={t("parcels.fields.itemVariant")}
            />
            <div className={styles.itemRow}>
              <input
                inputMode="numeric"
                value={item.quantity}
                onChange={(event) => setItems((current) => current.map((row, i) => (i === index ? { ...row, quantity: event.target.value.replace(/\D/g, "").slice(0, 3) } : row)))}
                aria-label={t("parcels.fields.itemQuantity")}
                className={styles.qty}
              />
              <input
                value={item.price}
                onChange={(event) => setItems((current) => current.map((row, i) => (i === index ? { ...row, price: event.target.value } : row)))}
                placeholder={t("parcels.fields.itemPrice")}
                aria-label={t("parcels.fields.itemPrice")}
              />
              <button type="button" className={styles.close} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label={t("parcels.fields.removeItem")}>
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
        <button type="button" className={styles.addItem} onClick={() => setItems((current) => [...current, { name: "", variant: "", quantity: "1", price: "" }])}>
          <Plus size={14} /> {t("parcels.fields.addItem")}
        </button>

        <div className={styles.actions}>
          <Button type="submit" block icon={<Save />} disabled={saving || !title.trim()}>
            {t("parcels.save")}
          </Button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
