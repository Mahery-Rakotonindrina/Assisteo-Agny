import { useEffect, useRef, useState } from "react";
import { ArrowDown, ExternalLink, Plus, Scale, X } from "lucide-react";
import { CountedLink } from "@/components/Expenses/CountedLink";
import { PlanLock } from "@/components/PlanLock";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useParcels } from "@/hooks/useParcels";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { isForResale, saleKey, soldOn } from "@/lib/expenses";
import type { AnyPlanId } from "@/lib/plans";
import { formatAriary, formatDecimal } from "@/lib/format";
import { currencySymbols, parseForeignAmount, type ForeignAmount } from "@/lib/money";
import { freightMga, freightMode, isFreightFee, knownForwarders, parseWeight, rememberedRate, withFreightFee, type ParcelFreight } from "@/lib/parcelLots";
import { shippingModeOf } from "@/lib/parcels";
import type { ShippingMode } from "@/lib/ai/schema";
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
  const { t, locale } = useTranslation();
  const { has, planFor, name: planName } = usePlan();
  if (has("parcelCosts")) return <Costs parcel={parcel} reseller={has("reseller")} resellerFrom={planFor("reseller")} />;
  // Lost with the plan: the costs already typed stay, shown read-only.
  const kept = parcelTotalMga(parcel);
  return (
    <PlanLock
      plan={planFor("parcelCosts")}
      text={
        kept > 0
          ? t("parcels.costsReadOnly", { amount: formatAriary(kept, locale) })
          : t("parcels.costsLocked", { plan: planName(planFor("parcelCosts") ?? "lite") })
      }
    />
  );
}

function Costs({ parcel, reseller, resellerFrom }: { parcel: Parcel; reseller: boolean; resellerFrom: AnyPlanId | null }) {
  const { t, locale } = useTranslation();
  const { name: planName } = usePlan();
  const [price, setPrice] = useState(parcel.priceMga ? String(parcel.priceMga) : "");
  // The freight by the kilo has its own fields (resellers), not a fee line.
  const [fees, setFees] = useState<DraftFee[]>(() =>
    (parcel.fees ?? []).filter((fee) => !isFreightFee(fee)).map((fee) => ({ id: fee.id, label: fee.label, amount: fee.amountMga ? String(fee.amountMga) : "" })),
  );
  const [freight, setFreight] = useState<DraftFreight>(() => ({
    forwarder: parcel.freight?.forwarder ?? "",
    weight: parcel.freight?.weightKg ? String(parcel.freight.weightKg).replace(".", locale === "fr" ? "," : ".") : "",
    rate: parcel.freight?.rateMga ? String(parcel.freight.rateMga) : "",
  }));
  const edited = useRef(false);
  const focusFee = useRef<string | null>(null);

  // A change not saved yet: saved at once when the parcel is closed.
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => () => pending.current?.(), []);

  // Save a moment after the last keystroke (only once the user changed something).
  useEffect(() => {
    if (!edited.current) return;
    const save = () => {
      pending.current = null;
      const kept: ParcelFee[] = fees
        .filter((fee) => fee.label.trim() || toAmount(fee.amount) > 0)
        .map((fee) => ({ id: fee.id, label: fee.label.trim(), amountMga: toAmount(fee.amount) }));
      if (!reseller) {
        // Without the reseller tools, the freight by the kilo already counted stays as it is.
        void parcelStore.setCosts(parcel.id, { priceMga: price ? toAmount(price) : undefined, fees: kept });
        return;
      }
      const next = draftFreight(freight, freightMode(parcel, shippingModeOf(parcel).mode));
      void parcelStore.setCosts(parcel.id, {
        priceMga: price ? toAmount(price) : undefined,
        fees: withFreightFee(kept, next, next ? t("parcelLots.freightFee", { weight: formatDecimal(next.weightKg, locale), rate: formatAriary(next.rateMga, locale) }) : ""),
        freight: next,
      });
    };
    pending.current = save;
    const timer = setTimeout(save, 600);
    return () => clearTimeout(timer);
    // t and locale only word the freight fee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price, fees, freight, reseller, parcel.id]);

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
  // The freight counted: typed here (resellers), else the one already saved.
  const keptFreight = (parcel.fees ?? []).find(isFreightFee);
  const freightAmount = reseller ? freightMga(draftFreight(freight)) : (keptFreight?.amountMga ?? 0);
  const feesTotal = fees.reduce((total, fee) => total + toAmount(fee.amount), 0) + freightAmount;
  const total = parcelTotalMga({ priceMga: toAmount(price), fees: fees.map((fee) => ({ id: fee.id, label: fee.label, amountMga: toAmount(fee.amount) })) }) + freightAmount;

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

      {reseller ? (
        <FreightFields parcel={parcel} value={freight} onChange={(next) => change(() => setFreight(next))} />
      ) : (
        keptFreight && (
          <div className={styles.row}>
            <span className={styles.label}>{keptFreight.label}</span>
            <strong>{formatAriary(keptFreight.amountMga, locale)}</strong>
          </div>
        )
      )}

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
      {parcelTotalMga(parcel) > 0 && <CountedLink sourceKey={`parcel:${parcel.id}`} at={parcel.createdAt} resaleAt={reseller && isForResale(parcel) ? soldOn(parcel) : undefined} />}

      {reseller ? <Sale parcel={parcel} total={total} /> : <PlanLock plan={resellerFrom} text={t("parcelLots.locked", { plan: planName(resellerFrom ?? "pro") })} />}
    </div>
  );
}

type DraftFreight = { forwarder: string; weight: string; rate: string };

/** The typed freight, or null when it counts nothing. */
function draftFreight(draft: DraftFreight, mode?: ShippingMode): ParcelFreight | null {
  const weightKg = parseWeight(draft.weight);
  const rateMga = toAmount(draft.rate);
  if (!(weightKg > 0) && !(rateMga > 0) && !draft.forwarder.trim()) return null;
  // The mode the rate is kept for (a forwarder's sea and air rates differ).
  return { ...(draft.forwarder.trim() && { forwarder: draft.forwarder.trim() }), weightKg, rateMga, ...(mode && { mode }) };
}

/**
 * Resellers (Pro): freight by the kilo, "2,5 kg × 12 000 Ar = 30 000 Ar".
 * The forwarder's rate is typed once per mode (sea, air): picking that
 * forwarder again for a parcel sent the same way brings it back.
 */
function FreightFields({ parcel, value, onChange }: { parcel: Parcel; value: DraftFreight; onChange: (value: DraftFreight) => void }) {
  const { t, locale } = useTranslation();
  const { parcels } = useParcels();
  const others = parcels.filter((other) => other.id !== parcel.id);
  const forwarders = knownForwarders(others);
  // Its shipment's mode first, then its own.
  const mode = freightMode(parcel, shippingModeOf(parcel).mode);
  const amount = freightMga(draftFreight(value));
  const listId = `forwarders-${parcel.id}`;

  return (
    <div className={styles.freight} data-testid="parcel-freight">
      <h4>
        <Scale size={15} /> {t("parcelLots.freightTitle")}
      </h4>
      {mode && <p className={styles.freightMode}>{t("parcelLots.rateMode", { mode: t(`parcel.shipping.${mode}`) })}</p>}
      <label className={styles.freightField}>
        <span>{t("parcelLots.forwarder")}</span>
        <input
          value={value.forwarder}
          list={listId}
          placeholder={t("parcelLots.forwarderPlaceholder")}
          onChange={(event) => {
            const forwarder = event.target.value.slice(0, 40);
            // A known forwarder brings back its rate, unless one is typed already.
            const rate = rememberedRate(others, forwarder, mode);
            onChange({ ...value, forwarder, rate: rate && !value.rate ? String(rate) : value.rate });
          }}
        />
        <datalist id={listId}>
          {forwarders.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <div className={styles.freightLine}>
        <label className={styles.amount}>
          <input
            inputMode="decimal"
            value={value.weight}
            onChange={(event) => onChange({ ...value, weight: event.target.value.replace(/[^0-9.,]/g, "").slice(0, 8) })}
            placeholder="0"
            aria-label={t("parcelLots.weight")}
          />
          <span>kg</span>
        </label>
        <span aria-hidden>×</span>
        <label className={styles.amount}>
          <input
            inputMode="numeric"
            value={grouped(value.rate)}
            onChange={(event) => onChange({ ...value, rate: digits(event.target.value) })}
            placeholder="0"
            aria-label={t("parcelLots.rate")}
          />
          <span>{t("parcelLots.perKg")}</span>
        </label>
      </div>
      <p className={styles.freightResult} data-testid="parcel-freight-amount">
        {amount > 0 ? t("parcelLots.freightAmount", { amount: formatAriary(amount, locale) }) : t("parcelLots.freightHint")}
      </p>
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
      {/* Kept apart from the home budget when the user asks for it (Mes dépenses → Mon activité). */}
      <SegmentedControl
        ariaLabel={t("parcels.sale.forLabel")}
        value={isForResale(parcel) ? "resale" : "me"}
        onChange={(value) => void parcelStore.setForResale(parcel.id, value === "resale")}
        options={[
          { value: "me", label: t("parcels.sale.forMe") },
          { value: "resale", label: t("parcels.sale.forResale") },
        ]}
      />
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
      {/* The whole sale price counts in the incomes, the month it was sold. */}
      {parcel.salePriceMga ? <CountedLink sourceKey={saleKey(parcel.id)} at={soldOn(parcel)} flow="income" resaleAt={isForResale(parcel) ? soldOn(parcel) : undefined} /> : null}
    </div>
  );
}
