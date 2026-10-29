import { RotateCcw } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { toggleOwnFeature } from "@/lib/featureChanges";
import {
  normalizeDiff,
  normalizeQuotas,
  planFeatures,
  quotaKeys,
  subscriptionFeatureList,
  type FeatureDiff,
  type PlanFeature,
  type PlanLimits,
  type QuotaOverrides,
} from "@/lib/plans";
import styles from "./AdminSubscriptions.module.scss";

/**
 * The features and limits of one subscription, in the add / edit sheet: the
 * plan's are ticked and filled in; what differs is kept as its own (a
 * difference from the plan, so a later change of the plan still applies).
 */
export function OwnSettings({
  planList,
  limits,
  diff,
  quotas,
  deepWithoutLimit,
  onChange,
}: {
  /** The features of the plan chosen. */
  planList: readonly PlanFeature[];
  /** The limits of the plan chosen. */
  limits: PlanLimits;
  diff: FeatureDiff | null;
  quotas: QuotaOverrides | null;
  deepWithoutLimit: boolean;
  onChange: (diff: FeatureDiff | null, quotas: QuotaOverrides | null) => void;
}) {
  const { t } = useTranslation();
  const own = normalizeDiff(planList, diff);
  const ownQuotas = normalizeQuotas(limits, quotas);
  const ticked = subscriptionFeatureList(planList, own);
  const name = (feature: PlanFeature) => t(`admin.features.names.${feature}`);

  return (
    <div className={styles.own} data-own={own || ownQuotas ? "" : undefined}>
      <h3 className={styles.group}>{t("admin.subs.own.title")}</h3>
      <p className={styles.ownHint}>{t("admin.subs.own.hint")}</p>
      <div className={styles.ownFeatures} role="group" aria-label={t("admin.subs.own.title")}>
        {planFeatures.map((feature) => {
          const byHand = Boolean(own?.add.includes(feature) || own?.remove.includes(feature));
          return (
            <label key={feature} data-by-hand={byHand ? "" : undefined}>
              <input type="checkbox" checked={ticked.includes(feature)} onChange={(event) => onChange(toggleOwnFeature(planList, own, feature, event.target.checked), ownQuotas)} />
              <span>{name(feature)}</span>
              {byHand && <small>{t("admin.subs.own.byHand")}</small>}
            </label>
          );
        })}
      </div>

      <h3 className={styles.group}>{t("admin.subs.own.quotas")}</h3>
      <div className={styles.grid}>
        {quotaKeys.map((key) => (
          <label key={key} className={styles.field} data-by-hand={ownQuotas?.[key] !== undefined ? "" : undefined}>
            <span>{t(`admin.plans.fields.${key}`)}</span>
            <input
              inputMode="numeric"
              value={String(ownQuotas?.[key] ?? limits[key])}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                onChange(own, normalizeQuotas(limits, { ...ownQuotas, [key]: digits === "" ? limits[key] : Number(digits) }));
              }}
            />
          </label>
        ))}
      </div>
      <small className={styles.ownHint}>{t("admin.subs.own.quotasHint")}</small>
      {deepWithoutLimit && <p className={styles.error}>{t("admin.subs.own.deepNeedsLimit")}</p>}
      {(own || ownQuotas) && (
        <Button size="md" variant="ghost" icon={<RotateCcw />} onClick={() => onChange(null, null)}>
          {t("admin.subs.own.reset")}
        </Button>
      )}
    </div>
  );
}
