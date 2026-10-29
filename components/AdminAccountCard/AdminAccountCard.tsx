import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Gift, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import shared from "@/components/AdminSubscriptions/AdminSubscriptions.module.scss";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, formatNumber, toDateInput } from "@/lib/format";
import { spring } from "@/lib/motion";
import { planFeatures, type FeatureLine, type PlanFeature } from "@/lib/plans";
import type { AdminAccountCard as Card } from "@/pages/api/admin/account";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";
import styles from "./AdminAccountCard.module.scss";

const DAY_MS = 24 * 3600 * 1000;
const timestamp = () => Date.now();
const offerDurations = ["week", "month", "date"] as const;
type OfferDuration = (typeof offerDurations)[number];

/** The last day included of an exclusive end. */
const lastDay = (end: number) => end - 1;
const midnight = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};

/** The end of an offer made now (exclusive); null when the date is missing or past. */
function offerEnd(duration: OfferDuration, day: string, now: number): number | null {
  if (duration === "week") return now + 7 * DAY_MS;
  if (duration === "month") return now + 30 * DAY_MS;
  if (!day) return null;
  const end = midnight(day).getTime() + DAY_MS;
  return end > now ? end : null;
}

const noSubscribe = () => () => {};

/**
 * Admin → an account's card (a subscriber or not): what it may use, each
 * feature with why; its limits; the features offered to it for a while, with
 * "Offer a feature" and "Stop now". `email` null: closed.
 */
export function AdminAccountCard({ token, email, onClose }: { token: string; email: string | null; onClose: () => void }) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(<AnimatePresence>{email && <CardSheet key={email} token={token} email={email} onClose={onClose} />}</AnimatePresence>, document.body);
}

function CardSheet({ token, email, onClose }: { token: string; email: string; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow();
  const [card, setCard] = useState<Card | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [feature, setFeature] = useState<PlanFeature>("garage");
  const [duration, setDuration] = useState<OfferDuration>("week");
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<Card>(`/api/admin/account?email=${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (!cancelled) setCard(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [email, token, version]);

  const name = (value: PlanFeature) => t(`admin.features.names.${value}`);
  const planName = card ? t(`plans.names.${card.plan}`) : "";
  const end = offerEnd(duration, day, now);
  // Deep analyses without a monthly count would have no limit: the server refuses it too.
  const deepBlocked = feature === "deepAnalysis" && card !== null && card.plan !== "unlimited" && card.quotas.find((quota) => quota.key === "deepPerMonth")?.value === 0;

  const failure = (error: unknown) => toast(error instanceof ApiError && error.code === "migration_needed" ? t("admin.migrationNeeded") : t("admin.error"), "error");

  const give = async () => {
    // Taken again at the click: the render's clock may be a minute old.
    const at = offerEnd(duration, day, timestamp());
    if (!at || deepBlocked) return;
    setBusy(true);
    try {
      await httpClient.post("/api/admin/account", { email, feature, endsAt: new Date(at).toISOString(), note: note.trim() || null }, { headers });
      toast(t("admin.card.given"));
      setNote("");
      setVersion((value) => value + 1);
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string) => {
    setBusy(true);
    try {
      await httpClient.patch("/api/admin/account", { action: "stop", id }, { headers });
      toast(t("admin.card.stopped"));
      setVersion((value) => value + 1);
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };

  const origin = (line: FeatureLine) => {
    switch (line.kind) {
      case "plan":
        return t("admin.card.origins.plan", { plan: planName });
      case "added":
        return t("admin.card.origins.added");
      case "removed":
        return t("admin.card.origins.removed");
      case "grant":
        return t("admin.card.origins.grant", { date: formatDate(lastDay(Date.parse(line.endsAt)), locale) });
      case "test":
        return line.on ? t("admin.card.origins.test") : t("admin.card.origins.testOut");
      case "off":
        return t("admin.card.origins.off");
      case "missing":
        return t("admin.card.origins.missing", { list: line.needs.map(name).join(", ") });
      case "notInPlan":
        return t("admin.card.origins.notInPlan", { plan: planName });
    }
  };

  return (
    <motion.div className={shared.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className={shared.sheet}
        data-plan={card?.plan === "free" ? undefined : card?.plan}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-card-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={shared.top}>
          <h2 id="account-card-title" className={styles.email}>
            {email}
          </h2>
          <button type="button" className={shared.close} onClick={onClose} aria-label={t("common.cancel")}>
            <X size={18} />
          </button>
        </div>

        {failed && <p className={shared.error}>{t("admin.error")}</p>}
        {!card && !failed && <div className={styles.loading} aria-busy />}

        {card && (
          <>
            <div className={styles.plan}>
              <PlanBadge plan={card.plan} />
              <span>
                {card.plan === "free"
                  ? t("admin.card.freePlan")
                  : card.endsAt === null
                    ? t("admin.subs.noEnd")
                    : t("admin.subs.until", { date: formatDate(lastDay(card.endsAt), locale) })}
              </span>
            </div>
            {(!card.ready.own || !card.ready.grants) && <p className={shared.adminWarning}>{t("admin.card.needsMigration")}</p>}

            <h3 className={shared.group}>{t("admin.card.features")}</h3>
            <ul className={styles.lines} aria-label={t("admin.card.features")}>
              {card.features.map((line) => (
                <li key={line.feature} data-on={line.on ? "" : undefined} data-kind={line.kind} data-feature={line.feature}>
                  {line.on ? <Check size={15} aria-hidden /> : <Minus size={15} aria-hidden />}
                  <strong>{name(line.feature)}</strong>
                  <small>{origin(line)}</small>
                </li>
              ))}
            </ul>

            <h3 className={shared.group}>{t("admin.card.quotas")}</h3>
            <ul className={styles.lines} aria-label={t("admin.card.quotas")}>
              {card.quotas.map((quota) => (
                <li key={quota.key} data-on="" data-kind={quota.own ? "added" : "plan"}>
                  <strong>{t(`admin.plans.fields.${quota.key}`)}</strong>
                  <span className={styles.value}>{quota.value === 0 ? t("admin.card.unlimited") : formatNumber(quota.value, locale)}</span>
                  <small>{quota.own ? t("admin.card.quotaOwn") : t("admin.card.quotaPlan", { plan: planName })}</small>
                </li>
              ))}
            </ul>

            <h3 className={shared.group}>{t("admin.card.offer")}</h3>
            <label className={shared.field}>
              <span>{t("admin.card.feature")}</span>
              <select value={feature} onChange={(event) => setFeature(event.target.value as PlanFeature)}>
                {planFeatures.map((value) => (
                  <option key={value} value={value}>
                    {name(value)}
                  </option>
                ))}
              </select>
            </label>
            <div className={shared.field} role="group" aria-label={t("admin.card.duration")}>
              <span>{t("admin.card.duration")}</span>
              <div className={shared.chips}>
                {offerDurations.map((value) => (
                  <button key={value} type="button" aria-pressed={duration === value} onClick={() => setDuration(value)}>
                    {t(`admin.card.durations.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            {duration === "date" && (
              <label className={shared.field}>
                <span>{t("admin.card.lastDay")}</span>
                <input type="date" value={day} min={toDateInput(now)} onChange={(event) => setDay(event.target.value)} />
              </label>
            )}
            {end && <p className={shared.period}>{t("admin.card.origins.grant", { date: formatDate(lastDay(end), locale) })}</p>}
            <label className={shared.field}>
              <span>{t("admin.card.note")}</span>
              <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} placeholder={t("admin.card.notePlaceholder")} />
            </label>
            {deepBlocked && <p className={shared.error}>{t("admin.card.deepNeedsLimit")}</p>}
            <Button icon={<Gift />} block disabled={busy || !end || deepBlocked || !card.ready.grants} onClick={() => void give()}>
              {t("admin.card.give")}
            </Button>

            <h3 className={shared.group}>{t("admin.card.offers")}</h3>
            {card.grants.length === 0 && <p className={styles.none}>{t("admin.card.none")}</p>}
            <ol className={shared.history}>
              {card.grants.map((grant) => {
                const ends = Date.parse(grant.endsAt);
                // useNow ticks once a minute: a grant just given starts a little after it.
                const running = Date.parse(grant.startsAt) <= now + 60_000 && ends > now;
                return (
                  <li key={grant.id} data-running={running ? "" : undefined}>
                    <div>
                      <strong>{name(grant.feature)}</strong>
                      <small>
                        {[
                          running ? t("admin.card.running", { date: formatDate(lastDay(ends), locale) }) : t("admin.card.ended", { date: formatDate(lastDay(ends), locale) }),
                          t("admin.card.givenOn", { date: formatDate(Date.parse(grant.createdAt), locale) }),
                        ].join(" · ")}
                      </small>
                      {grant.note && <small className={shared.note}>{grant.note}</small>}
                    </div>
                    {running && (
                      <Button size="md" variant="ghost" icon={<Square />} disabled={busy} onClick={() => void stop(grant.id)}>
                        {t("admin.card.stop")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
