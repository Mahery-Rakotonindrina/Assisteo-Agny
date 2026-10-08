import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { BadgePercent, Save } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { rise } from "@/lib/motion";
import { soldPlans, type PlanOffer, type PlansConfig } from "@/lib/plans";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminPlans.module.scss";

const offerFields: Array<keyof PlanOffer> = ["priceMga", "scans", "questionsPerDay", "parcels", "deepPerMonth"];

/** Prices and limits of each plan, and how to pay: shown on the app's offers page. */
export function AdminPlans({ token }: { token: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [saved, setSaved] = useState<PlansConfig | null>(null);
  const [draft, setDraft] = useState<PlansConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    httpClient
      .get<PlansConfig>("/api/admin/plans", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        setSaved(result);
        setDraft(result);
      })
      .catch(() => undefined);
  }, [token]);

  if (!draft || !saved) return <div className={styles.card} aria-busy />;

  const number = (value: string) => Math.min(10_000_000, Number(value.replace(/\D/g, "")) || 0);
  const setOffer = (plan: (typeof soldPlans)[number], field: keyof PlanOffer, value: string) =>
    setDraft({ ...draft, offers: { ...draft.offers, [plan]: { ...draft.offers[plan], [field]: number(value) } } });
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await httpClient.put<PlansConfig>("/api/admin/plans", draft, { headers });
      setSaved(result);
      setDraft(result);
      toast(t("admin.saved"));
    } catch {
      toast(t("admin.error"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.form variants={rise} initial="hidden" animate="show" className={styles.card} onSubmit={(event) => void save(event)}>
      <div>
        <h2 className={styles.title}>
          <BadgePercent size={18} /> {t("admin.plans.title")}
        </h2>
        <p className={styles.subtitle}>{t("admin.plans.subtitle")}</p>
      </div>

      {soldPlans.map((plan) => (
        <fieldset key={plan} className={styles.plan} data-plan={plan}>
          <legend>
            <PlanBadge plan={plan} size="md" />
          </legend>
          <div className={styles.grid}>
            {offerFields
              // Lite has no deep analyses.
              .filter((field) => field !== "deepPerMonth" || plan !== "lite")
              .map((field) => (
              <label key={field} className={styles.field}>
                <span>{t(`admin.plans.fields.${field}`)}</span>
                <input inputMode="numeric" value={String(draft.offers[plan][field])} onChange={(event) => setOffer(plan, field, event.target.value)} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p className={styles.hint}>{t("admin.plans.zeroHint")}</p>

      <label className={styles.field}>
        <span>{t("admin.plans.freeParcels")}</span>
        <input inputMode="numeric" value={String(draft.freeParcels)} onChange={(event) => setDraft({ ...draft, freeParcels: number(event.target.value) })} />
        <small>{t("admin.plans.freeParcelsHint")}</small>
      </label>

      <label className={styles.field}>
        <span>{t("admin.plans.instructions")}</span>
        <textarea
          rows={5}
          value={draft.payment.instructions}
          onChange={(event) => setDraft({ ...draft, payment: { ...draft.payment, instructions: event.target.value.slice(0, 1500) } })}
          placeholder={t("admin.plans.instructionsPlaceholder")}
        />
      </label>
      <label className={styles.field}>
        <span>{t("admin.plans.contact")}</span>
        <input
          value={draft.payment.contact}
          onChange={(event) => setDraft({ ...draft, payment: { ...draft.payment, contact: event.target.value.slice(0, 200) } })}
          placeholder="034 00 000 00 · https://wa.me/261340000000"
        />
        <small>{t("admin.plans.contactHint")}</small>
      </label>

      <Button type="submit" block icon={<Save />} disabled={!dirty || saving}>
        {t("admin.save")}
      </Button>
    </motion.form>
  );
}
