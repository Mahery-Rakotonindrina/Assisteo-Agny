import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Cpu, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import type { Locale } from "@/i18n.config";
import { costsByKind, planWorstCaseUsd, priceFor, rowCostUsd, type AiPrice } from "@/lib/aiCost";
import { formatAriary, formatDecimal, formatNumber } from "@/lib/format";
import { rise } from "@/lib/motion";
import { soldPlans, type PlansConfig } from "@/lib/plans";
import type { AdminAiCostResponse } from "@/pages/api/admin/ai-cost";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminAiCost.module.scss";

type DraftPrice = { match: string; inputUsd: string; outputUsd: string };

const toDraft = (prices: AiPrice[]): DraftPrice[] => prices.map((price) => ({ match: price.match, inputUsd: String(price.inputUsd), outputUsd: String(price.outputUsd) }));
const toNumber = (value: string) => Number(value.replace(",", ".")) || 0;

/** Ariary, with a decimal for the small amounts a single AI call costs. */
function money(usd: number, usdToMga: number | null, locale: Locale) {
  if (usdToMga === null) return `$${usd.toFixed(usd < 0.01 ? 5 : 2)}`;
  const ariary = usd * usdToMga;
  return ariary < 10 ? `${formatDecimal(ariary, locale)} Ar` : formatAriary(ariary, locale);
}

/** What the server's AI key cost lately, and what each plan would cost used to the full. */
export function AdminAiCost({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<AdminAiCostResponse | null>(null);
  const [plans, setPlans] = useState<PlansConfig | null>(null);
  const [draft, setDraft] = useState<DraftPrice[] | null>(null);
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const auth = { Authorization: `Bearer ${token}` };
    httpClient
      .get<AdminAiCostResponse>("/api/admin/ai-cost", { headers: auth })
      .then((result) => {
        setData(result);
        setDraft(toDraft(result.prices));
      })
      .catch(() => undefined);
    httpClient
      .get<PlansConfig>("/api/admin/plans", { headers: auth })
      .then(setPlans)
      .catch(() => undefined);
  }, [token]);

  if (!data || !draft) return <div className={styles.card} aria-busy />;

  // Costs follow the prices being edited, before saving.
  const prices: AiPrice[] = draft.filter((price) => price.match.trim()).map((price) => ({ match: price.match.trim(), inputUsd: toNumber(price.inputUsd), outputUsd: toNumber(price.outputUsd) }));
  const kinds = costsByKind(data.rows, prices);
  const calls = kinds.reduce((sum, kind) => sum + kind.calls, 0);
  const dirty = JSON.stringify(prices) !== JSON.stringify(data.prices);

  const save = async () => {
    setSaving(true);
    try {
      const result = await httpClient.put<AdminAiCostResponse>("/api/admin/ai-cost", { prices }, { headers });
      setData(result);
      setDraft(toDraft(result.prices));
      toast(t("admin.saved"));
    } catch {
      toast(t("admin.error"), "error");
    } finally {
      setSaving(false);
    }
  };

  const setPrice = (index: number, patch: Partial<DraftPrice>) => setDraft(draft.map((price, i) => (i === index ? { ...price, ...patch } : price)));

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card}>
      <div>
        <h2 className={styles.title}>
          <Cpu size={18} /> {t("admin.ai.title", { days: data.days })}
        </h2>
        <p className={styles.subtitle}>{t("admin.ai.subtitle")}</p>
      </div>

      {calls === 0 ? (
        <p className={styles.empty}>{t("admin.ai.empty")}</p>
      ) : (
        <div className={styles.kinds}>
          {kinds.map((kind) => (
            <div key={kind.kind} className={styles.kind}>
              <span>{t(`admin.ai.kinds.${kind.kind}`)}</span>
              <strong>{kind.calls ? money(kind.usdPerCall, data.usdToMga, locale) : "—"}</strong>
              <small>{kind.calls ? t("admin.ai.perCall", { calls: formatNumber(kind.calls, locale), total: money(kind.usd, data.usdToMga, locale) }) : t("admin.ai.noCalls")}</small>
              {kind.unpriced.length > 0 && <small className={styles.warn}>{t("admin.ai.unpriced", { models: kind.unpriced.join(", ") })}</small>}
            </div>
          ))}
        </div>
      )}

      {plans && calls > 0 && (
        <div className={styles.plans}>
          <h3>{t("admin.ai.plansTitle")}</h3>
          {kinds.some((kind) => kind.calls === 0) && (
            <p className={styles.subtitle}>
              {t("admin.ai.partial", {
                kinds: kinds
                  .filter((kind) => kind.calls === 0)
                  .map((kind) => t(`admin.ai.kinds.${kind.kind}`).toLowerCase())
                  .join(", "),
              })}
            </p>
          )}
          {soldPlans.map((plan) => {
            const offer = plans.offers[plan];
            const worst = planWorstCaseUsd(offer, kinds);
            const worstMga = data.usdToMga ? worst * data.usdToMga : null;
            const margin = worstMga === null ? null : offer.priceMga - worstMga;
            return (
              <div key={plan} className={styles.plan} data-plan={plan}>
                <PlanBadge plan={plan} />
                <span className={styles.planText}>
                  {t("admin.ai.planLine", { price: formatAriary(offer.priceMga, locale), cost: money(worst, data.usdToMga, locale) })}
                  {offer.scans === 0 && ` ${t("admin.ai.unlimitedScans")}`}
                </span>
                {margin !== null && (
                  <strong data-tone={margin >= 0 ? "ok" : "loss"}>
                    {t("admin.ai.margin", {
                      amount: formatAriary(margin, locale),
                      percent: offer.priceMga ? Math.round((margin / offer.priceMga) * 100) : 0,
                    })}
                  </strong>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data.rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("admin.ai.model")}</th>
                <th>{t("admin.ai.calls")}</th>
                <th>{t("admin.ai.tokens")}</th>
                <th>{t("admin.ai.costPerCall")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const price = priceFor(row.model, prices);
                return (
                  <tr key={`${row.kind}-${row.model}`}>
                    <td>
                      <span className={styles.model}>{row.model}</span>
                      <small>{t(`admin.ai.kinds.${row.kind}`)}</small>
                    </td>
                    <td>{formatNumber(row.calls, locale)}</td>
                    <td>
                      {formatNumber(row.inputTokens / Math.max(1, row.calls), locale)} / {formatNumber(row.outputTokens / Math.max(1, row.calls), locale)}
                    </td>
                    <td>{price ? money(rowCostUsd(row, price) / Math.max(1, row.calls), data.usdToMga, locale) : <span className={styles.warn}>{t("admin.ai.noPrice")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.prices}>
        <h3>{t("admin.ai.pricesTitle")}</h3>
        <p className={styles.subtitle}>{t("admin.ai.pricesHint")}</p>
        <div className={styles.priceHead} aria-hidden>
          <span>{t("admin.ai.match")}</span>
          <span>{t("admin.ai.input")}</span>
          <span>{t("admin.ai.output")}</span>
          <span />
        </div>
        {draft.map((price, index) => (
          <div key={index} className={styles.priceRow}>
            <input value={price.match} onChange={(event) => setPrice(index, { match: event.target.value.slice(0, 60) })} aria-label={t("admin.ai.match")} placeholder="flash-lite" />
            <input inputMode="decimal" value={price.inputUsd} onChange={(event) => setPrice(index, { inputUsd: event.target.value.replace(/[^\d.,]/g, "") })} aria-label={t("admin.ai.input")} />
            <input inputMode="decimal" value={price.outputUsd} onChange={(event) => setPrice(index, { outputUsd: event.target.value.replace(/[^\d.,]/g, "") })} aria-label={t("admin.ai.output")} />
            <button type="button" onClick={() => setDraft(draft.filter((_, i) => i !== index))} aria-label={t("admin.ai.removePrice")}>
              <X size={15} />
            </button>
          </div>
        ))}
        <button type="button" className={styles.addPrice} onClick={() => setDraft([...draft, { match: "", inputUsd: "", outputUsd: "" }])}>
          <Plus size={14} /> {t("admin.ai.addPrice")}
        </button>
        <p className={styles.rate}>{data.usdToMga ? t("admin.ai.rate", { rate: formatNumber(data.usdToMga, locale) }) : t("admin.ai.noRate")}</p>
        <Button block icon={<Save />} disabled={!dirty || saving} onClick={() => void save()}>
          {t("admin.save")}
        </Button>
      </div>
    </motion.section>
  );
}
