import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { PlanLock } from "@/components/PlanLock";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary } from "@/lib/format";
import { createId } from "@/services/historyStore";
import { parcelStore, parcelTotalMga, type Parcel, type ParcelFee } from "@/services/parcelStore";
import styles from "./ParcelCosts.module.scss";

type DraftFee = { id: string; label: string; amount: string };

/** Common fees for parcels shipped to Madagascar; "other" leaves the label to type. */
const presets = ["freight", "customs", "delivery", "commission", "other"] as const;

const digits = (value: string) => value.replace(/\D/g, "").slice(0, 12);
const toAmount = (value: string) => (value ? Number(value) : 0);
/** Digits shown with thousands separators while typing ("120 000"). */
const grouped = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");

/**
 * What a parcel really cost, in ariary: the item's price plus every fee
 * (freight, customs, delivery…). Saved as you type.
 */
export function ParcelCosts({ parcel }: { parcel: Parcel }) {
  const { t } = useTranslation();
  const { has } = usePlan();
  return has("parcelCosts") ? <Costs parcel={parcel} /> : <PlanLock text={t("parcels.costsLocked")} />;
}

function Costs({ parcel }: { parcel: Parcel }) {
  const { t, locale } = useTranslation();
  const [price, setPrice] = useState(parcel.priceMga ? String(parcel.priceMga) : "");
  const [fees, setFees] = useState<DraftFee[]>(() => (parcel.fees ?? []).map((fee) => ({ id: fee.id, label: fee.label, amount: fee.amountMga ? String(fee.amountMga) : "" })));
  const edited = useRef(false);
  const focusFee = useRef<string | null>(null);

  // Save a moment after the last keystroke (only once the user changed something).
  useEffect(() => {
    if (!edited.current) return;
    const timer = setTimeout(() => {
      const kept: ParcelFee[] = fees
        .filter((fee) => fee.label.trim() || toAmount(fee.amount) > 0)
        .map((fee) => ({ id: fee.id, label: fee.label.trim(), amountMga: toAmount(fee.amount) }));
      void parcelStore.setCosts(parcel.id, { priceMga: price ? toAmount(price) : undefined, fees: kept });
    }, 600);
    return () => clearTimeout(timer);
  }, [price, fees, parcel.id]);

  const change = (update: () => void) => {
    edited.current = true;
    update();
  };

  const addFee = (preset: (typeof presets)[number]) => {
    const id = createId();
    focusFee.current = id;
    change(() => setFees((current) => [...current, { id, label: preset === "other" ? "" : t(`parcels.fees.${preset}`), amount: "" }]));
  };

  const feesTotal = fees.reduce((total, fee) => total + toAmount(fee.amount), 0);
  const total = parcelTotalMga({ priceMga: toAmount(price), fees: fees.map((fee) => ({ id: fee.id, label: fee.label, amountMga: toAmount(fee.amount) })) });

  return (
    <div className={styles.costs}>
      <label className={styles.row}>
        <span className={styles.label}>
          {t("parcels.price")}
          {parcel.info.total && <small>{t("parcels.paidOnShop", { amount: parcel.info.total })}</small>}
        </span>
        <span className={styles.amount}>
          <input
            inputMode="numeric"
            value={grouped(price)}
            onChange={(event) => change(() => setPrice(digits(event.target.value)))}
            placeholder="0"
            aria-label={t("parcels.price")}
          />
          <span>Ar</span>
        </span>
      </label>

      {fees.map((fee) => (
        <div key={fee.id} className={styles.row}>
          <input
            className={styles.feeLabel}
            value={fee.label}
            onChange={(event) => change(() => setFees((current) => current.map((item) => (item.id === fee.id ? { ...item, label: event.target.value.slice(0, 40) } : item))))}
            placeholder={t("parcels.feeName")}
            aria-label={t("parcels.feeName")}
          />
          <span className={styles.amount}>
            <input
              inputMode="numeric"
              value={grouped(fee.amount)}
              ref={(element) => {
                if (element && focusFee.current === fee.id) {
                  focusFee.current = null;
                  element.focus();
                }
              }}
              onChange={(event) => change(() => setFees((current) => current.map((item) => (item.id === fee.id ? { ...item, amount: digits(event.target.value) } : item))))}
              placeholder="0"
              aria-label={t("parcels.feeAmount", { name: fee.label || t("parcels.feeName") })}
            />
            <span>Ar</span>
          </span>
          <button
            type="button"
            className={styles.remove}
            onClick={() => change(() => setFees((current) => current.filter((item) => item.id !== fee.id)))}
            aria-label={t("parcels.removeFee", { name: fee.label || t("parcels.feeName") })}
          >
            <X size={15} />
          </button>
        </div>
      ))}

      <div className={styles.presets}>
        {presets.map((preset) => (
          <button key={preset} type="button" onClick={() => addFee(preset)}>
            <Plus size={13} /> {t(`parcels.fees.${preset}`)}
          </button>
        ))}
      </div>

      <div className={styles.total}>
        <span>
          {t("parcels.totalSpent")}
          {feesTotal > 0 && price && (
            <small>
              {formatAriary(toAmount(price), locale)} + {formatAriary(feesTotal, locale)} {t("parcels.ofFees")}
            </small>
          )}
        </span>
        <strong>{formatAriary(total, locale)}</strong>
      </div>
    </div>
  );
}
