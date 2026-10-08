import { useEffect, useRef, useState } from "react";
import { ArrowDown, ExternalLink, Plus, X } from "lucide-react";
import { PlanLock } from "@/components/PlanLock";
import { usePlan } from "@/hooks/usePlan";
import { planFor } from "@/lib/plans";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDecimal } from "@/lib/format";
import { currencySymbols, parseForeignAmount, type ForeignAmount } from "@/lib/money";
import { createId } from "@/services/historyStore";
import { marketRate, ownRate, rememberOwnRate } from "@/services/fx";
import { parcelDueMga, parcelProfitMga, parcelStore, parcelTotalMga, type Parcel, type ParcelFee } from "@/services/parcelStore";
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
  return has("parcelCosts") ? (
    <Costs parcel={parcel} reseller={has("reseller")} />
  ) : (
    <PlanLock plan={planFor("parcelCosts")} text={t("parcels.costsLocked")} />
  );
}

function Costs({ parcel, reseller }: { parcel: Parcel; reseller: boolean }) {
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

  // A price paid in yuan, dollars or euros on the shop: convert it.
  const foreign = parseForeignAmount(parcel.info.total);
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
      {foreign && <Convert foreign={foreign} onApply={(amount) => change(() => setPrice(String(amount)))} />}

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

      {reseller ? <Sale parcel={parcel} total={total} /> : <PlanLock plan="pro" text={t("parcels.sale.locked")} />}
    </div>
  );
}

/** "¥221,45 × 664 Ar = 147 029 Ar": today's rate, or the user's own (their forwarder's). */
function Convert({ foreign, onApply }: { foreign: ForeignAmount; onApply: (amountMga: number) => void }) {
  const { t, locale } = useTranslation();
  const [market, setMarket] = useState<number | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [saved] = useState(() => ownRate(foreign.currency));
  const symbol = currencySymbols[foreign.currency];

  useEffect(() => {
    let cancelled = false;
    void marketRate(foreign.currency).then((result) => {
      if (!cancelled && result) setMarket(result.rate);
    });
    return () => {
      cancelled = true;
    };
  }, [foreign.currency]);

  const fallback = saved ?? (market ? Math.round(market * 100) / 100 : null);
  const rate = typed !== null ? Number(typed.replace(",", ".")) || 0 : (fallback ?? 0);
  const result = Math.round(foreign.amount * rate);

  return (
    <div className={styles.convert}>
      <div className={styles.convertLine}>
        <span>
          {symbol}
          {formatDecimal(foreign.amount, locale)} ×
        </span>
        <span className={styles.rate}>
          <input
            inputMode="decimal"
            value={typed ?? (fallback ? String(fallback).replace(".", ",") : "")}
            onChange={(event) => setTyped(event.target.value.replace(/[^\d.,]/g, "").slice(0, 10))}
            placeholder="0"
            aria-label={t("parcels.fx.rate", { symbol })}
          />
          Ar
        </span>
        <span>=</span>
        <strong>{rate > 0 ? formatAriary(result, locale) : "…"}</strong>
      </div>
      <div className={styles.convertFoot}>
        <small>
          {market ? t("parcels.fx.market", { symbol, rate: formatDecimal(market, locale) }) : t("parcels.fx.noMarket")}
          {" · "}
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">
            ExchangeRate-API <ExternalLink size={11} />
          </a>
        </small>
        <button
          type="button"
          disabled={!(rate > 0)}
          onClick={() => {
            // A rate typed by hand (the forwarder's) is kept for the next parcels.
            if (typed !== null) rememberOwnRate(foreign.currency, rate);
            onApply(result);
          }}
        >
          <ArrowDown size={14} /> {t("parcels.fx.use")}
        </button>
      </div>
    </div>
  );
}

/** Resellers (Pro): what the client is charged and has paid, what is left and the profit. */
function Sale({ parcel, total }: { parcel: Parcel; total: number }) {
  const { t, locale } = useTranslation();
  const [sale, setSale] = useState(parcel.salePriceMga ? String(parcel.salePriceMga) : "");
  const [paid, setPaid] = useState(parcel.paidMga ? String(parcel.paidMga) : "");
  const edited = useRef(false);

  useEffect(() => {
    if (!edited.current) return;
    const timer = setTimeout(() => {
      void parcelStore.setSale(parcel.id, { salePriceMga: sale ? toAmount(sale) : undefined, paidMga: paid ? toAmount(paid) : undefined });
    }, 600);
    return () => clearTimeout(timer);
  }, [sale, paid, parcel.id]);

  const draft = { salePriceMga: toAmount(sale) || undefined, paidMga: toAmount(paid) || undefined, priceMga: total, fees: [] };
  const due = parcelDueMga(draft);
  const profit = parcelProfitMga(draft);
  const field = (label: string, value: string, set: (value: string) => void) => (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.amount}>
        <input
          inputMode="numeric"
          value={grouped(value)}
          onChange={(event) => {
            edited.current = true;
            set(digits(event.target.value));
          }}
          placeholder="0"
          aria-label={label}
        />
        <span>Ar</span>
      </span>
    </label>
  );

  return (
    <div className={styles.sale}>
      <h4>{t("parcels.sale.title")}</h4>
      {field(t("parcels.sale.price"), sale, setSale)}
      {field(t("parcels.sale.paid"), paid, setPaid)}
      {sale && (
        <div className={styles.saleSummary}>
          <span data-tone={due > 0 ? "due" : "ok"}>{due > 0 ? t("parcels.sale.due", { amount: formatAriary(due, locale) }) : t("parcels.sale.allPaid")}</span>
          {profit !== null && (
            <span data-tone={profit >= 0 ? "ok" : "loss"}>
              {profit >= 0 ? t("parcels.sale.profit", { amount: formatAriary(profit, locale) }) : t("parcels.sale.loss", { amount: formatAriary(-profit, locale) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
