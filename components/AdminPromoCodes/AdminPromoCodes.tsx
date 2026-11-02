import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Power, PowerOff, ShieldAlert, TicketPercent, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanIcon } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, formatNumber } from "@/lib/format";
import { rise } from "@/lib/motion";
import { CODE_PATTERN, normalizeCode, type PromoCode, type PromoWithUses } from "@/lib/offers";
import { adminPlanName, localName } from "@/lib/customPlans";
import { soldPlans } from "@/lib/plans";
import type { AdminPromoCodesResponse } from "@/pages/api/admin/promo-codes";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminPromoCodes.module.scss";

type Draft = { code: string; kind: PromoCode["kind"]; plan: PromoCode["plan"]; days: string; percent: string; maxUses: string; expires: string };

const emptyDraft: Draft = { code: "", kind: "access", plan: "premium", days: "30", percent: "20", maxUses: "0", expires: "" };
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

/** The end of the chosen day (local), as the code's expiry. */
const endOfDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date + 1).getTime();
};

/** Promo codes typed in "I have a code" on the offers page: an offered access or a discount. */
export function AdminPromoCodes({ token }: { token: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<AdminPromoCodesResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    httpClient
      .get<AdminPromoCodesResponse>("/api/admin/promo-codes", { headers: { Authorization: `Bearer ${token}` } })
      .then(setData)
      .catch(() => undefined);
  }, [token, version]);

  if (!data) return <div className={styles.card} aria-busy />;

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast(done);
      setVersion((value) => value + 1);
      return true;
    } catch {
      toast(t("admin.error"), "error");
      return false;
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const code = draft ? normalizeCode(draft.code) : "";
  const valid =
    draft !== null &&
    CODE_PATTERN.test(code) &&
    (draft.kind === "access" ? Number(draft.days) >= 1 && Number(draft.days) <= 366 : Number(draft.percent) >= 1 && Number(draft.percent) <= 100);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !valid) return;
    setSaving(true);
    const body = {
      code,
      kind: draft.kind,
      ...(draft.kind === "access" ? { plan: draft.plan, days: Number(draft.days) } : { percent: Number(draft.percent) }),
      maxUses: Number(draft.maxUses) || 0,
      expiresAt: draft.expires ? endOfDay(draft.expires) : null,
    };
    if (await run(() => httpClient.post("/api/admin/promo-codes", body, { headers }), t("admin.promo.created"))) setDraft(null);
    setSaving(false);
  };

  const describe = (promo: PromoWithUses) =>
    [
      promo.kind === "access"
        ? t("admin.promo.accessLine", { plan: adminPlanName(promo.plan, t, locale, data.customPlans ?? []), days: promo.days })
        : t("admin.promo.discountLine", { percent: promo.percent }),
      promo.maxUses > 0
        ? t("admin.promo.usesOf", { count: formatNumber(promo.uses, locale), max: formatNumber(promo.maxUses, locale) })
        : t("admin.promo.uses", { count: formatNumber(promo.uses, locale) }),
      promo.expiresAt !== null && t("admin.promo.expires", { date: formatDate(promo.expiresAt - 1, locale) }),
      !promo.active && t("admin.promo.off"),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card}>
      <div>
        <h2 className={styles.title}>
          <TicketPercent size={18} /> {t("admin.promo.title")}
        </h2>
        <p className={styles.subtitle}>{t("admin.promo.subtitle")}</p>
      </div>
      {!data.durable && (
        <p className={styles.warning}>
          <ShieldAlert size={16} /> {t("admin.promo.notDurable")}
        </p>
      )}

      {data.codes.length === 0 ? (
        <p className={styles.empty}>{t("admin.promo.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {data.codes.map((promo) => (
            <li key={promo.code} data-off={promo.active ? undefined : ""}>
              {promo.kind === "access" && <PlanIcon plan={promo.plan} size={16} />}
              <div>
                <strong>{promo.code}</strong>
                <small>{describe(promo)}</small>
              </div>
              <span className={styles.actions}>
                <button
                  type="button"
                  aria-label={promo.active ? t("admin.promo.disable") : t("admin.promo.enable")}
                  title={promo.active ? t("admin.promo.disable") : t("admin.promo.enable")}
                  onClick={() =>
                    void run(
                      () => httpClient.patch("/api/admin/promo-codes", { code: promo.code, active: !promo.active }, { headers }),
                      promo.active ? t("admin.promo.disabled") : t("admin.promo.enabled"),
                    )
                  }
                >
                  {promo.active ? <PowerOff size={15} /> : <Power size={15} />}
                </button>
                <button
                  type="button"
                  data-armed={armed === promo.code ? "" : undefined}
                  aria-label={armed === promo.code ? t("admin.promo.confirmDelete") : t("admin.promo.delete")}
                  title={armed === promo.code ? t("admin.promo.confirmDelete") : t("admin.promo.delete")}
                  onClick={() =>
                    armed === promo.code
                      ? void run(() => httpClient.delete(`/api/admin/promo-codes?code=${encodeURIComponent(promo.code)}`, { headers }), t("admin.promo.deleted"))
                      : setArmed(promo.code)
                  }
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <form className={styles.form} onSubmit={(event) => void create(event)}>
          <label className={styles.field}>
            <span>{t("admin.promo.code")}</span>
            <input
              className={styles.code}
              value={draft.code}
              onChange={(event) => set("code", event.target.value.slice(0, 24))}
              placeholder="NOEL2026"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <small>{t("admin.promo.codeHint")}</small>
          </label>

          <div className={styles.field} role="group" aria-label={t("admin.promo.kind")}>
            <span>{t("admin.promo.kind")}</span>
            <div className={styles.chips}>
              {(["access", "discount"] as const).map((kind) => (
                <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => set("kind", kind)}>
                  {t(`admin.promo.kinds.${kind}`)}
                </button>
              ))}
            </div>
          </div>

          {draft.kind === "access" ? (
            <>
              <div className={styles.field} role="group" aria-label={t("admin.subs.plan")}>
                <span>{t("admin.subs.plan")}</span>
                <div className={styles.chips}>
                  {soldPlans.map((plan) => (
                    <button key={plan} type="button" data-plan={plan} aria-pressed={draft.plan === plan} onClick={() => set("plan", plan)}>
                      <PlanIcon plan={plan} size={14} /> {t(`plans.names.${plan}`)}
                    </button>
                  ))}
                  {(data.customPlans ?? [])
                    .filter((plan) => plan.onSale)
                    .map((plan) => (
                      <button key={plan.id} type="button" data-plan={plan.id} data-plan-color={plan.color} aria-pressed={draft.plan === plan.id} onClick={() => set("plan", plan.id)}>
                        <PlanIcon plan={plan.id} size={14} /> {localName(plan.name, locale)}
                      </button>
                    ))}
                </div>
              </div>
              <label className={styles.field}>
                <span>{t("admin.promo.days")}</span>
                <input inputMode="numeric" value={draft.days} onChange={(event) => set("days", digits(event.target.value))} />
              </label>
            </>
          ) : (
            <label className={styles.field}>
              <span>{t("admin.promo.percent")}</span>
              <input inputMode="numeric" value={draft.percent} onChange={(event) => set("percent", digits(event.target.value))} />
              <small>{t("admin.promo.percentHint")}</small>
            </label>
          )}

          <div className={styles.grid}>
            <label className={styles.field}>
              <span>{t("admin.promo.maxUses")}</span>
              <input inputMode="numeric" value={draft.maxUses} onChange={(event) => set("maxUses", digits(event.target.value))} />
              <small>{t("admin.promo.maxUsesHint")}</small>
            </label>
            <label className={styles.field}>
              <span>{t("admin.promo.expiresAt")}</span>
              <input type="date" value={draft.expires} onChange={(event) => set("expires", event.target.value)} />
              <small>{t("admin.promo.expiresHint")}</small>
            </label>
          </div>

          <Button type="submit" block icon={<Plus />} disabled={!valid || saving}>
            {t("admin.promo.create")}
          </Button>
          <Button variant="ghost" block onClick={() => setDraft(null)}>
            {t("common.cancel")}
          </Button>
        </form>
      ) : (
        <Button variant="secondary" block icon={<Plus />} onClick={() => setDraft(emptyDraft)}>
          {t("admin.promo.new")}
        </Button>
      )}
    </motion.section>
  );
}
