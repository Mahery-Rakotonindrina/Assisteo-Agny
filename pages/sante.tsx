import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { BellOff, BellRing, Check, ChevronRight, Clock, FileDown, FileText, Pill, ScanLine, Share2 } from "lucide-react";
import { Appointments } from "@/components/Appointments";
import { Button } from "@/components/Button";
import { EmergencyCard } from "@/components/EmergencyCard";
import { EmptyState } from "@/components/EmptyState";
import { HealthProfiles } from "@/components/HealthProfiles";
import { Measures } from "@/components/Measures";
import { MedicineDisclaimer } from "@/components/Medicine";
import { PlanBadge } from "@/components/PlanBadge";
import { PlanLock } from "@/components/PlanLock";
import { Seo } from "@/components/Seo";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { healthOverview, type Treatment } from "@/lib/health";
import { ownerOf, personFromLink } from "@/lib/healthProfiles";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { todayDoses, weekAdherence } from "@/lib/medication";
import { rise, stagger } from "@/lib/motion";
import { haptics } from "@/services/device";
import { exportTreatmentsPdf, shareTreatments } from "@/services/healthShare";
import { historyStore } from "@/services/historyStore";
import { markDoseTaken } from "@/services/medicationReminders";
import type { HistoryEntry } from "@/types/history";
import styles from "@/styles/Health.module.scss";

/** Where a prescription is scanned: the scan screen, in document mode. */
const SCAN_HREF = "/?mode=document";

/**
 * "Ma santé": the treatments in progress with their next dose, and the
 * prescriptions and medicine boxes scanned. Everything comes from the
 * history (the scans and their dose plans), but the emergency card and the
 * appointments, kept in the settings. The lists and the card are for
 * everyone; reminders (doses, appointments) from Lite, like on a scan.
 */
export default function HealthPage() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const { entries, isLoading } = useHistory();
  const now = useNow(60_000);
  const { plan, has, planFor, name: planName } = usePlan();
  const reminders = has("reminders");
  const { settings, ready, update } = useSettings();
  // "Pour qui ?": the screen shows one person at a time ("Moi" has all that has no profile).
  // The person last picked is kept on this device; removed since, "Moi".
  const person = ownerOf(settings.healthPerson, settings.healthProfiles);
  const pick = (profileId: string) => update({ healthPerson: profileId });
  const theirs = entries.filter((entry) => ownerOf(entry.profileId, settings.healthProfiles) === person);
  const { treatments, scans } = healthOverview(theirs, now);
  const empty = !isLoading && scans.length === 0;
  const router = useRouter();
  const show = router.query.show;

  // A link or a notification ("?pour=", "?appt=", "?scan="): the screen opens on
  // that person, once the settings and the scans are read; unknown, ignored.
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!router.isReady || !ready || isLoading) return;
    const key = JSON.stringify([router.query.pour, router.query.appt, router.query.scan]);
    if (linked.current === key) return;
    linked.current = key;
    const target = personFromLink(router.query, { profiles: settings.healthProfiles, appointments: settings.appointments, entries });
    if (target !== null && target !== settings.healthPerson) update({ healthPerson: target });
  }, [router.isReady, router.query, ready, isLoading, settings.healthProfiles, settings.appointments, settings.healthPerson, entries, update]);

  // An appointment's notification: its section in sight.
  useEffect(() => {
    if (show === "appointments") document.getElementById("appointments")?.scrollIntoView({ block: "start" });
  }, [show]);

  // "Partager mes traitements": as a message, or as a PDF, with the medical warning.
  const share = async (as: "text" | "pdf") => {
    if (sharing) return;
    haptics.tap();
    setSharing(true);
    try {
      const outcome = as === "pdf" ? await exportTreatmentsPdf(treatments, t, locale) : await shareTreatments(treatments, t, locale);
      if (outcome === "copied") toast(t("health.share.copied"));
      else if (outcome === "downloaded") toast(t("pdf.downloaded"));
      else if (outcome === "unavailable") toast(t("health.share.failed"), "error");
    } catch {
      toast(t("health.share.failed"), "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <Seo title={`${t("health.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("health.title")}</h1>
          <p>{t("health.lead")}</p>
        </motion.header>

        <motion.div variants={rise}>
          <HealthProfiles selected={person} onSelect={pick} entries={entries} />
        </motion.div>

        <motion.div variants={rise}>
          <MedicineDisclaimer />
        </motion.div>

        <motion.div variants={rise}>
          <EmergencyCard key={person} profileId={person} />
        </motion.div>

        <motion.div variants={rise}>
          <Appointments profileId={person} />
        </motion.div>

        <motion.div variants={rise}>
          <Measures profileId={person} />
        </motion.div>

        {empty ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("health.emptyTitle")}
              body={t("health.emptyBody")}
              action={
                <Button href={SCAN_HREF} icon={<ScanLine />}>
                  {t("health.scan")}
                </Button>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.div variants={rise}>
              <Button href={SCAN_HREF} variant="secondary" icon={<ScanLine />}>
                {t("health.scan")}
              </Button>
            </motion.div>

            {treatments.length > 0 && (
              <motion.section variants={rise} className={styles.section} data-testid="health-treatments">
                <h2>{t("health.ongoing")}</h2>
                <div className={styles.shareRow}>
                  <Button variant="secondary" size="md" icon={<Share2 />} onClick={() => void share("text")} disabled={sharing} data-testid="health-share">
                    {t("health.share.button")}
                  </Button>
                  <Button variant="secondary" size="md" icon={<FileDown />} onClick={() => void share("pdf")} disabled={sharing} data-testid="health-share-pdf">
                    {t("health.share.pdf")}
                  </Button>
                </div>
                {/* The plan no longer has the reminders: they are paused, the treatment still shows. */}
                {plan !== null && !reminders && <PlanLock plan={planFor("reminders")} text={t("medicine.locked", { plan: planName(planFor("reminders") ?? "lite") })} />}
                <ul className={styles.list}>
                  {treatments.map((treatment) => (
                    <TreatmentCard key={treatment.entry.id} treatment={treatment} />
                  ))}
                </ul>
              </motion.section>
            )}

            {scans.length > 0 && (
              <motion.section variants={rise} className={styles.section} data-testid="health-prescriptions">
                <h2>{t("health.prescriptions")}</h2>
                <ul className={styles.list}>
                  {scans.map((entry) => (
                    <PrescriptionRow key={entry.id} entry={entry} active={treatments.some((treatment) => treatment.entry.id === entry.id)} reminders={reminders} />
                  ))}
                </ul>
              </motion.section>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

/** A treatment in progress: its medicines and times, until when, the next dose, and how to stop it. */
function TreatmentCard({ treatment }: { treatment: Treatment<HistoryEntry> }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const { entry, end, daysLeft, next } = treatment;
  const plan = entry.medication!;
  const now = useNow(60_000);
  const week = weekAdherence(plan, now);
  const today = todayDoses(plan, now);

  // "J'ai pris": the moment ticked on the scan's plan (synced, like the plan).
  const take = async (at: number) => {
    haptics.success();
    await markDoseTaken(entry.id, at);
    toast(t("health.takenDone"));
  };

  const stop = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    haptics.press();
    await historyStore.update(entry.id, { medication: undefined });
    toast(t("medicine.stopped"));
  };

  return (
    <li className={styles.card} data-testid="health-treatment">
      <h3>{entry.analysis.title}</h3>
      <ul className={styles.courses}>
        {plan.courses.map((course, index) => (
          <li key={`${index}-${course.name}`}>
            <Pill size={15} aria-hidden />
            <span>
              <strong>{course.name}</strong>
              {course.dose && <small>{course.dose}</small>}
              <small>{t("medicine.courseLine", { times: course.times.join(", "), count: course.days })}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.until}>
        <BellRing size={15} aria-hidden /> {t("health.until", { date: formatDate(end, locale), count: daysLeft })}
      </p>
      {week.due > 0 && (
        <p className={styles.until} data-testid="health-week">
          <Check size={15} aria-hidden /> {t("health.week", { taken: week.taken, due: week.due })}
        </p>
      )}
      {today.length > 0 && (
        <ul className={styles.today} aria-label={t("health.today")}>
          {today.map((dose) => (
            <li key={dose.at} data-state={dose.state} data-testid="health-dose">
              <span>
                <strong>{formatTime(dose.at, locale)}</strong>
                <small>
                  {dose.state === "taken" ? t("health.doseTaken") : dose.state === "missed" ? t("health.doseMissed") : dose.medicines.map((medicine) => medicine.name).join(" · ")}
                </small>
              </span>
              {dose.state !== "taken" && dose.canTake && (
                <Button variant="secondary" size="md" icon={<Check />} onClick={() => void take(dose.at)} data-testid="health-take">
                  {t("health.taken")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {next && (
        <p className={styles.next} data-testid="health-next">
          <Clock size={15} aria-hidden />
          <span>
            {t("health.next", { when: formatDateTime(next.at, locale) })}
            <small>{next.medicines.map((medicine) => medicine.name).join(" · ")}</small>
          </span>
        </p>
      )}
      <div className={styles.actions}>
        <Button href={`/result?id=${entry.id}`} variant="secondary" size="md" icon={<FileText />}>
          {t("health.open")}
        </Button>
        <Button variant={confirm ? "danger" : "ghost"} size="md" icon={<BellOff />} onClick={() => void stop()} data-testid="health-stop">
          {confirm ? t("medicine.confirmStop") : t("medicine.stop")}
        </Button>
      </div>
    </li>
  );
}

/** A prescription or box scanned: when, which medicines; opens the scan, or its dose reminders when it has none. */
function PrescriptionRow({ entry, active, reminders }: { entry: HistoryEntry; active: boolean; reminders: boolean }) {
  const { t, locale } = useTranslation();
  const { planFor } = usePlan();
  const names = (entry.analysis.medicine?.items ?? []).map((item) => item.name).filter((name) => name.trim());

  return (
    <li className={styles.row} data-testid="health-prescription">
      <Link href={`/result?id=${entry.id}`} className={styles.open}>
        <span className={styles.icon} aria-hidden>
          <FileText size={18} />
        </span>
        <span className={styles.text}>
          <strong>{entry.analysis.title}</strong>
          <small>
            {formatDate(entry.createdAt, locale)}
            {names.length > 0 && <> · {names.join(", ")}</>}
          </small>
          {active && <em>{t("health.remindersOn")}</em>}
        </span>
        <ChevronRight size={18} className={styles.chevron} aria-hidden />
      </Link>
      {!active && entry.analysis.medicine && (
        // The scan opens on its medicines, where the reminders are created (Lite and up).
        <Button href={`/result?id=${entry.id}`} variant="secondary" size="md" icon={<BellRing />}>
          {t("health.createReminders")}
          {!reminders && <PlanBadge plan={planFor("reminders")} />}
        </Button>
      )}
    </li>
  );
}
