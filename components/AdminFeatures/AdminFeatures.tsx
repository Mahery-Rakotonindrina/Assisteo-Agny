import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ListChecks, Power, PowerOff, Save, X } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanIcon } from "@/components/PlanBadge";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { featureChanges, setPlanFeatures, tickAlso, untickAlso, type FeatureChange } from "@/lib/featureChanges";
import { rise } from "@/lib/motion";
import { deepWithoutLimit, featureNeeds, planFeatures, planIds, type FeatureMode, type FeatureSettings, type PlanFeature, type PlanId } from "@/lib/plans";
import type { AdminFeaturesResponse } from "@/pages/api/admin/features";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminFeatures.module.scss";

/** A tick or an untick that drags other features with it: asked before it applies. */
type Ask = { plan: PlanId; feature: PlanFeature; on: boolean; also: PlanFeature[] };

const settingsOf = ({ features, featureStatus }: FeatureSettings): FeatureSettings => ({ features, featureStatus });
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Admin → Offers, the features table: which plan includes which feature, each
 * feature on, in test (its testers and the admins) or switched off for
 * everyone. A save shows its changes and the subscribers concerned first.
 */
export function AdminFeatures({ token, plansVersion = 0 }: { token: string; plansVersion?: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [saved, setSaved] = useState<FeatureSettings | null>(null);
  const [draft, setDraft] = useState<FeatureSettings | null>(null);
  const [subscribers, setSubscribers] = useState<AdminFeaturesResponse["subscribers"]>(null);
  const [deepPerMonth, setDeepPerMonth] = useState<AdminFeaturesResponse["deepPerMonth"] | null>(null);
  // The testers as typed, one per line; read into the draft on the way.
  const [testerText, setTesterText] = useState<Partial<Record<PlanFeature, string>>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<PlanFeature | null>(null);
  const headers = { Authorization: `Bearer ${token}` };

  const received = (result: AdminFeaturesResponse) => {
    setSaved(settingsOf(result));
    setDraft(settingsOf(result));
    setSubscribers(result.subscribers);
    setDeepPerMonth(result.deepPerMonth);
    setTesterText(Object.fromEntries(planFeatures.map((feature) => [feature, result.featureStatus[feature].testers.join("\n")])));
    setReview(false);
    setAsk(null);
  };

  useEffect(() => {
    httpClient
      .get<AdminFeaturesResponse>("/api/admin/features", { headers: { Authorization: `Bearer ${token}` } })
      .then(received)
      .catch(() => undefined);
  }, [token]);

  // Limits saved above: only the deep analysis counts are reread, the draft stays.
  useEffect(() => {
    if (plansVersion === 0) return;
    httpClient
      .get<AdminFeaturesResponse>("/api/admin/features", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => setDeepPerMonth(result.deepPerMonth))
      .catch(() => undefined);
  }, [token, plansVersion]);

  if (!draft || !saved) return <div className={styles.card} aria-busy />;

  const name = (feature: PlanFeature) => t(`admin.features.names.${feature}`);
  const names = (features: readonly PlanFeature[]) => features.map(name).join(", ");
  const planName = (plan: PlanId) => t(`plans.names.${plan}`);

  const toggle = (plan: PlanId, feature: PlanFeature, on: boolean) => {
    setReview(false);
    const also = on ? tickAlso(draft, plan, feature) : untickAlso(draft, plan, feature);
    if (also.length > 0) setAsk({ plan, feature, on, also });
    else setDraft(setPlanFeatures(draft, plan, [feature], on));
  };

  const setMode = (feature: PlanFeature, mode: FeatureMode) => {
    setReview(false);
    setDraft({ ...draft, featureStatus: { ...draft.featureStatus, [feature]: { ...draft.featureStatus[feature], mode } } });
  };

  const setTesters = (feature: PlanFeature, text: string) => {
    setReview(false);
    setTesterText({ ...testerText, [feature]: text });
    const testers = [...new Set(text.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    setDraft({ ...draft, featureStatus: { ...draft.featureStatus, [feature]: { ...draft.featureStatus[feature], testers } } });
  };

  const put = async (settings: FeatureSettings) => {
    setBusy(true);
    try {
      received(await httpClient.put<AdminFeaturesResponse>("/api/admin/features", settings, { headers }));
      return true;
    } catch {
      toast(t("admin.error"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The emergency switch acts at once, on what is saved: the edits in progress stay a draft.
  const emergency = async (feature: PlanFeature, mode: FeatureMode) => {
    setArmed(null);
    const pending = draft;
    const next = { ...saved, featureStatus: { ...saved.featureStatus, [feature]: { ...saved.featureStatus[feature], mode } } };
    if (await put(next)) {
      toast(t(mode === "off" ? "admin.features.cutDone" : mode === "test" ? "admin.features.restoredTest" : "admin.features.restored", { name: name(feature) }));
      setDraft({ ...pending, featureStatus: { ...pending.featureStatus, [feature]: next.featureStatus[feature] } });
    }
  };

  const changes = featureChanges(saved, draft);
  // Deep analyses on a plan without a monthly count (0 = no limit): refused, Admin aside.
  const noDeepLimit = deepPerMonth
    ? deepWithoutLimit({ features: draft.features, offers: { lite: { deepPerMonth: deepPerMonth.lite }, premium: { deepPerMonth: deepPerMonth.premium }, pro: { deepPerMonth: deepPerMonth.pro } } as Parameters<typeof deepWithoutLimit>[0]["offers"] })
    : [];
  const badTester = planFeatures.flatMap((feature) => (draft.featureStatus[feature].mode === "test" ? draft.featureStatus[feature].testers : [])).find((email) => !looksLikeEmail(email));
  const blocked = Boolean(badTester) || noDeepLimit.length > 0;

  const concerned = (plan: PlanId) => {
    if (plan === "free") return t("admin.features.freeAccounts");
    return subscribers ? t("admin.features.subscribers", { count: subscribers[plan] }) : t("admin.features.subscribersUnknown");
  };
  const describe = (change: FeatureChange) => {
    if (change.kind === "plan") {
      const list = [...change.added.map((feature) => `+ ${name(feature)}`), ...change.removed.map((feature) => `− ${name(feature)}`)].join(" · ");
      return { title: planName(change.plan), list, who: concerned(change.plan) };
    }
    const to = t(`admin.features.modes.${change.to}`) + (change.to === "test" ? ` (${t("admin.features.testersCount", { count: change.testers })})` : "");
    return { title: name(change.feature), list: `${t(`admin.features.modes.${change.from}`)} → ${to}`, who: t("admin.features.everyone") };
  };

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card} aria-labelledby="admin-features-title">
      <div>
        <h2 className={styles.title} id="admin-features-title">
          <ListChecks size={18} /> {t("admin.features.title")}
        </h2>
        <p className={styles.subtitle}>{t("admin.features.subtitle")}</p>
      </div>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("admin.features.feature")}</th>
              {planIds.map((plan) => (
                <th key={plan} scope="col" data-plan={plan} className={styles.planHead}>
                  <PlanIcon plan={plan} size={15} />
                  <span>{planName(plan)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {planFeatures.map((feature) => {
              const status = draft.featureStatus[feature];
              const savedMode = saved.featureStatus[feature].mode;
              const needs = featureNeeds[feature] ?? [];
              return (
                <tr key={feature} data-feature={feature} data-mode={status.mode}>
                  <th scope="row" className={styles.feature}>
                    <strong>{name(feature)}</strong>
                    <small>{t(`admin.features.descriptions.${feature}`)}</small>
                    {needs.length > 0 && <small className={styles.needs}>{t("admin.features.needs", { list: names(needs) })}</small>}
                    {feature === "deepAnalysis" && noDeepLimit.length > 0 && (
                      <small className={styles.error} role="alert">
                        {t("admin.features.deepNeedsLimit", { list: noDeepLimit.map(planName).join(", ") })}
                      </small>
                    )}

                    <div className={styles.status}>
                      {savedMode === "off" ? (
                        <>
                          <span className={styles.off}>
                            <PowerOff size={13} /> {t("admin.features.modes.off")}
                          </span>
                          <Button size="md" variant="secondary" icon={<Power />} disabled={busy} onClick={() => void emergency(feature, "on")}>
                            {t("admin.features.restore")}
                          </Button>
                          {/* Back to its testers only, when it has some: it may have been in test before the cut. */}
                          {saved.featureStatus[feature].testers.length > 0 && (
                            <Button size="md" variant="secondary" disabled={busy} onClick={() => void emergency(feature, "test")}>
                              {t("admin.features.restoreTest")}
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <SegmentedControl
                            ariaLabel={`${t("admin.features.status")} · ${name(feature)}`}
                            value={status.mode === "test" ? "test" : "on"}
                            onChange={(mode: FeatureMode) => setMode(feature, mode)}
                            options={[
                              { value: "on", label: t("admin.features.modes.on") },
                              { value: "test", label: t("admin.features.modes.test") },
                            ]}
                          />
                          <Button
                            size="md"
                            variant={armed === feature ? "danger" : "ghost"}
                            icon={<PowerOff />}
                            disabled={busy}
                            onClick={() => (armed === feature ? void emergency(feature, "off") : setArmed(feature))}
                          >
                            {armed === feature ? t("admin.features.cutConfirm") : t("admin.features.cut")}
                          </Button>
                        </>
                      )}
                    </div>

                    {status.mode === "test" && savedMode !== "off" && (
                      <label className={styles.testers}>
                        <span>{t("admin.features.testers")}</span>
                        <textarea rows={3} value={testerText[feature] ?? ""} onChange={(event) => setTesters(feature, event.target.value.slice(0, 20_000))} placeholder="rado@example.com" />
                        <small>{t("admin.features.testersHint")}</small>
                      </label>
                    )}

                    {ask?.feature === feature && (
                      <div className={styles.ask} role="alert">
                        <p>
                          {ask.on
                            ? t("admin.features.tickAsk", { plan: planName(ask.plan), name: name(feature), list: names(ask.also) })
                            : t("admin.features.untickAsk", { plan: planName(ask.plan), name: name(feature), list: names(ask.also) })}
                        </p>
                        <div>
                          <Button
                            size="md"
                            onClick={() => {
                              setDraft(setPlanFeatures(draft, ask.plan, [feature, ...ask.also], ask.on));
                              setAsk(null);
                            }}
                          >
                            {t("admin.features.yes")}
                          </Button>
                          <Button size="md" variant="ghost" onClick={() => setAsk(null)}>
                            {t("admin.features.cancel")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </th>
                  {planIds.map((plan) => (
                    <td key={plan} data-plan={plan} className={styles.tick}>
                      <input
                        type="checkbox"
                        checked={draft.features[plan].includes(feature)}
                        onChange={(event) => toggle(plan, feature, event.target.checked)}
                        aria-label={`${name(feature)} · ${planName(plan)}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>{t("admin.features.apkHint")}</p>

      {badTester && <p className={styles.error}>{t("admin.features.invalidTesters", { email: badTester })}</p>}

      {review && changes.length > 0 ? (
        <div className={styles.summary} role="region" aria-label={t("admin.features.summary")}>
          <h3>{t("admin.features.summary")}</h3>
          <ul>
            {changes.map((change) => {
              const { title, list, who } = describe(change);
              return (
                <li key={change.kind === "plan" ? `plan-${change.plan}` : `status-${change.feature}`}>
                  <strong>{title}</strong> {list}
                  <small>{who}</small>
                </li>
              );
            })}
          </ul>
          <div className={styles.actions}>
            <Button icon={<Save />} disabled={busy || blocked} onClick={() => void put(draft).then((ok) => ok && toast(t("admin.saved")))}>
              {t("admin.features.confirm")}
            </Button>
            <Button variant="ghost" icon={<X />} disabled={busy} onClick={() => setReview(false)}>
              {t("admin.features.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button block icon={<Save />} disabled={changes.length === 0 || busy || blocked} onClick={() => setReview(true)}>
          {t("admin.features.review")}
        </Button>
      )}
    </motion.section>
  );
}
