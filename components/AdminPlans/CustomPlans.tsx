import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { useTranslation } from "@/hooks/useTranslation";
import { planIdProblem, planSlug } from "@/lib/customPlans";
import { formatAriary } from "@/lib/format";
import { rise } from "@/lib/motion";
import { monthsFree } from "@/lib/offers";
import { customPlanColors, customPlanSlots, featureDependents, featureNeeds, planFeatures, type CustomPlan, type PlanFeature, type PlanOffer, type PlansConfig } from "@/lib/plans";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";
import styles from "./AdminPlans.module.scss";

const offerFields: Array<keyof PlanOffer> = ["priceMga", "yearPriceMga", "scans", "questionsPerDay", "parcels", "deepPerMonth"];

type Draft = Omit<CustomPlan, "createdAt"> & { createdAt?: number };

const blank = (): Draft => ({
  id: "",
  name: { fr: "", en: "" },
  color: customPlanColors[0],
  after: "lite",
  features: [],
  onSale: true,
  priceMga: 0,
  yearPriceMga: 0,
  scans: 0,
  questionsPerDay: 0,
  parcels: 0,
  deepPerMonth: 0,
});

/**
 * The plans created from the Admin (Admin → Offers): each between two
 * built-in ones, with its name, colour, price, limits and features. Sold
 * like the others: the subscription is recorded by hand after the payment.
 */
export function CustomPlans({ token, config, onSaved }: { token: string; config: PlansConfig; onSaved: (config: PlansConfig) => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  // null: closed; a draft with createdAt: editing that plan.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [idTyped, setIdTyped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const editing = draft?.createdAt !== undefined;
  const plans = config.customPlans;

  const open = (next: Draft, typed: boolean) => {
    setDraft(next);
    setIdTyped(typed);
    setConfirming(false);
  };

  const failed = (error: unknown) =>
    toast(error instanceof ApiError && error.code === "refused" ? t("admin.plans.created.inUse") : t("admin.error"), "error");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const { createdAt, ...body } = draft;
      void createdAt;
      const result = editing
        ? await httpClient.put<PlansConfig>("/api/admin/custom-plans", body, { headers })
        : await httpClient.post<PlansConfig>("/api/admin/custom-plans", { ...body, onSale: undefined }, { headers });
      onSaved(result);
      setDraft(null);
      toast(t("admin.plans.created.saved"));
    } catch (error) {
      failed(error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      onSaved(await httpClient.delete<PlansConfig>(`/api/admin/custom-plans?id=${encodeURIComponent(id)}`, { headers }));
      setDraft(null);
      toast(t("admin.plans.created.deleted"));
    } catch (error) {
      failed(error);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card} aria-labelledby="custom-plans-title">
      <div>
        <h2 className={styles.title} id="custom-plans-title">
          <Sparkles size={18} /> {t("admin.plans.created.title")}
        </h2>
        <p className={styles.subtitle}>{t("admin.plans.created.subtitle")}</p>
      </div>

      {plans.length === 0 && !draft && <p className={styles.hint}>{t("admin.plans.created.empty")}</p>}
      {plans.length > 0 && (
        <ul className={styles.createdList}>
          {plans.map((plan) => (
            <li key={plan.id} data-plan={plan.id} data-plan-color={plan.color} data-off-sale={plan.onSale ? undefined : ""}>
              <PlanBadge plan={plan.id} custom={plan} size="md" />
              <span>
                <strong>{t(`admin.plans.created.after.${plan.after}`)}</strong>
                <small>
                  {formatAriary(plan.priceMga, locale)} · {plan.onSale ? t("admin.plans.created.onSale") : t("admin.plans.created.offSale")}
                </small>
              </span>
              <Button size="icon" variant="secondary" aria-label={t("admin.plans.created.editTitle")} onClick={() => open({ ...plan }, true)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!draft && (
        <Button icon={<Plus />} variant="secondary" block onClick={() => open(blank(), false)} data-testid="custom-plan-create">
          {t("admin.plans.created.create")}
        </Button>
      )}

      {draft && (
        <PlanForm
          draft={draft}
          editing={editing}
          idTyped={idTyped}
          taken={plans.filter((plan) => plan.id !== draft.id || !editing).map((plan) => plan.id)}
          saving={saving}
          confirming={confirming}
          onChange={setDraft}
          onIdTyped={() => setIdTyped(true)}
          onSubmit={(event) => void save(event)}
          onCancel={() => setDraft(null)}
          onDelete={() => (confirming ? void remove(draft.id) : setConfirming(true))}
        />
      )}
    </motion.section>
  );
}

function PlanForm({
  draft,
  editing,
  idTyped,
  taken,
  saving,
  confirming,
  onChange,
  onIdTyped,
  onSubmit,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  editing: boolean;
  idTyped: boolean;
  taken: string[];
  saving: boolean;
  confirming: boolean;
  onChange: (draft: Draft) => void;
  onIdTyped: () => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const number = (value: string) => Math.min(10_000_000, Number(value.replace(/\D/g, "")) || 0);
  const idProblem = editing ? null : planIdProblem(draft.id, taken);
  const deepWithoutLimit = draft.features.includes("deepAnalysis") && draft.deepPerMonth === 0;
  const valid = draft.name.fr.trim() !== "" && draft.name.en.trim() !== "" && idProblem === null && !deepWithoutLimit;

  const setNameFr = (fr: string) => {
    const name = { ...draft.name, fr: fr.slice(0, 24) };
    // The id follows the French name until the admin types one (never once created).
    onChange({ ...draft, name, ...(!editing && !idTyped && { id: planSlug(name.fr) }) });
  };
  // A feature's needs come with it; unticking a need unticks what depends on it.
  const toggle = (feature: PlanFeature, on: boolean) => {
    const next = new Set(draft.features);
    if (on) [feature, ...(featureNeeds[feature] ?? [])].forEach((item) => next.add(item));
    else [feature, ...featureDependents(feature)].forEach((item) => next.delete(item));
    onChange({ ...draft, features: planFeatures.filter((item) => next.has(item)) });
  };

  return (
    <form className={[styles.plan, styles.createdForm].join(" ")} data-plan={draft.id || "custom"} data-plan-color={draft.color} onSubmit={onSubmit} aria-label={editing ? t("admin.plans.created.editTitle") : t("admin.plans.created.newTitle")}>
      <div className={styles.formTitle}>
        <h3>{editing ? t("admin.plans.created.editTitle") : t("admin.plans.created.newTitle")}</h3>
        <button type="button" className={styles.close} onClick={onCancel} aria-label={t("common.cancel")}>
          <X size={16} />
        </button>
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>{t("admin.plans.created.nameFr")}</span>
          <input value={draft.name.fr} onChange={(event) => setNameFr(event.target.value)} placeholder="Famille" data-testid="custom-plan-name-fr" />
        </label>
        <label className={styles.field}>
          <span>{t("admin.plans.created.nameEn")}</span>
          <input value={draft.name.en} onChange={(event) => onChange({ ...draft, name: { ...draft.name, en: event.target.value.slice(0, 24) } })} placeholder="Family" data-testid="custom-plan-name-en" />
        </label>
      </div>

      <label className={styles.field}>
        <span>{t("admin.plans.created.id")}</span>
        <input
          value={draft.id}
          disabled={editing}
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => {
            onIdTyped();
            onChange({ ...draft, id: event.target.value.toLowerCase().slice(0, 24) });
          }}
          data-testid="custom-plan-id"
        />
        <small className={idProblem && draft.id ? styles.error : undefined}>
          {idProblem && draft.id ? t(`admin.plans.created.idProblems.${idProblem}`) : t("admin.plans.created.idHint")}
        </small>
      </label>

      <div className={styles.field} role="radiogroup" aria-label={t("admin.plans.created.color")}>
        <span>{t("admin.plans.created.color")}</span>
        <div className={styles.swatches}>
          {customPlanColors.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={draft.color === color}
              aria-label={t(`admin.plans.created.colors.${color}`)}
              data-plan="custom"
              data-plan-color={color}
              className={styles.swatch}
              onClick={() => onChange({ ...draft, color })}
            />
          ))}
        </div>
      </div>

      <label className={styles.field}>
        <span>{t("admin.plans.created.rank")}</span>
        <select value={draft.after} onChange={(event) => onChange({ ...draft, after: event.target.value as Draft["after"] })} data-testid="custom-plan-after">
          {customPlanSlots.map((slot) => (
            <option key={slot} value={slot}>
              {t(`admin.plans.created.after.${slot}`)}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.grid}>
        {offerFields.map((field) => (
          <label key={field} className={styles.field}>
            <span>{t(`admin.plans.fields.${field}`)}</span>
            <input inputMode="numeric" value={String(draft[field])} onChange={(event) => onChange({ ...draft, [field]: number(event.target.value) })} data-testid={`custom-plan-${field}`} />
            {field === "yearPriceMga" && <small>{t("admin.plans.monthsFree", { count: monthsFree(draft) })}</small>}
            {field === "deepPerMonth" && deepWithoutLimit && <small className={styles.error}>{t("admin.plans.deepNeedsLimit")}</small>}
          </label>
        ))}
      </div>
      <p className={styles.hint}>{t("admin.plans.zeroHint")}</p>

      <fieldset className={styles.features}>
        <legend>{t("admin.plans.created.features")}</legend>
        {planFeatures.map((feature) => (
          <label key={feature}>
            <input type="checkbox" checked={draft.features.includes(feature)} onChange={(event) => toggle(feature, event.target.checked)} />
            {t(`admin.features.names.${feature}`)}
          </label>
        ))}
      </fieldset>

      {editing && (
        <div className={styles.saleRow}>
          <Toggle checked={draft.onSale} onChange={(onSale) => onChange({ ...draft, onSale })} label={t("admin.plans.created.onSale")} />
          <small>{t("admin.plans.created.onSaleHint")}</small>
        </div>
      )}

      <Button type="submit" block icon={<Save />} disabled={!valid || saving} data-testid="custom-plan-save">
        {t("admin.plans.created.save")}
      </Button>
      {editing && (
        <Button type="button" variant="secondary" block icon={<Trash2 />} disabled={saving} onClick={onDelete}>
          {confirming ? t("admin.plans.created.deleteConfirm") : t("admin.plans.created.delete")}
        </Button>
      )}
    </form>
  );
}
