import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Apple, ArrowRight, Box, Car, Check, CloudOff, FileText, Files, FlaskConical, ImageUp, Lightbulb, QrCode, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/Button";
import { CaptureOrb } from "@/components/CaptureOrb";
import { CodeList } from "@/components/CodeList";
import { DropZone } from "@/components/DropZone";
import { HistoryItem } from "@/components/HistoryItem";
import { NextReminder } from "@/components/NextReminder";
import { PagesTray } from "@/components/PagesTray";
import { PendingScans } from "@/components/PendingScans";
import { PlanBadge } from "@/components/PlanBadge";
import { PlanNotice } from "@/components/PlanWelcome";
import { ScanStage } from "@/components/ScanStage";
import { ScanWait } from "@/components/ScanWait";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toast";
import { PLANS_HREF, TrialOver, TrialPill } from "@/components/Trial";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useHistory } from "@/hooks/useHistory";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useScan } from "@/hooks/useScan";
import { useTranslation } from "@/hooks/useTranslation";
import { useTrial } from "@/hooks/useTrial";
import type { ScanMode } from "@/lib/ai/schema";
import { exampleIds, exampleImage } from "@/lib/examples";
import { easeOut, rise, stagger } from "@/lib/motion";
import { incomingShare } from "@/services/incomingShare";
import styles from "@/styles/Scan.module.scss";

const modeIcons = { auto: Sparkles, food: Apple, document: FileText, vehicle: Car, object: Box } as const;
/** A plan's scans are shown once this few are left in the month. */
const LOW_MONTH_SCANS = 10;
/** Errors the offers answer: no scans left, the AI busy, an own key without a plan. */
const planErrors = new Set(["trial_exhausted", "server_busy", "plan_limit", "plan_required"]);

function greetingKey() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

function isMode(value: unknown): value is ScanMode {
  return typeof value === "string" && value in modeIcons;
}

export default function ScanPage() {
  const { t, list } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = useState<ScanMode>("auto");
  // "Retake the photo" from an uncertain result comes back with ?mode=…, and
  // "Choose the type" with ?pick=1 (the mode picker is highlighted until used).
  const queryMode = router.isReady && isMode(router.query.mode) ? router.query.mode : null;
  const [appliedQueryMode, setAppliedQueryMode] = useState<ScanMode | null>(null);
  if (queryMode && queryMode !== appliedQueryMode) {
    setAppliedQueryMode(queryMode);
    setMode(queryMode);
  }
  const [picked, setPicked] = useState(false);
  const picking = router.isReady && router.query.pick === "1" && !picked;
  const { state, start, startWithFile, startWithSrc, retry, reset, analyzeAnyway, canRetry, pages } = useScan(mode);
  const { has } = usePlan();
  const multiPage = has("multiPage");
  const toast = useToast();
  const { entries, isLoading: historyLoading } = useHistory();
  const aiStatus = useAiStatus();
  const isDesktop = useIsDesktop();
  const trial = useTrial();
  const recent = entries.slice(0, isDesktop ? 4 : 3);
  const busy = state.phase === "preparing" || state.phase === "analyzing";
  const ModeIcon = modeIcons[mode];
  const now = useNow(60_000);
  const hasReminder = entries.some((entry) => entry.reminderAt && entry.reminderAt > now);

  // Photos shared from another app (Android): one is analysed right away;
  // several become the pages of one document (Premium), else the first one.
  const beginPages = pages.begin;
  useEffect(() => {
    const take = () => {
      if (state.phase !== "idle") return;
      const images = incomingShare.take();
      if (!images) return;
      if (images.length > 1 && multiPage) {
        beginPages(images);
        return;
      }
      if (images.length > 1) toast(t("share.onlyFirst"));
      void startWithSrc(images[0]);
    };
    take();
    return incomingShare.subscribe(take);
  }, [beginPages, multiPage, startWithSrc, state.phase, t, toast]);

  // Pasting an image anywhere on the screen starts an analysis.
  useEffect(() => {
    if (state.phase !== "idle" || trial.exhausted) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void startWithFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [startWithFile, state.phase, trial.exhausted]);

  return (
    <>
      <Head>
        <title>{t("meta.title")}</title>
        <meta name="description" content={t("meta.description")} />
      </Head>

      <AnimatePresence mode="wait" initial={false}>
        {state.phase === "idle" ? (
          <motion.div
            key="idle"
            className={`${styles.idle} ${hasReminder ? styles.idleWithReminder : ""}`}
            variants={stagger}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
          >
            <div className={styles.intro}>
              <motion.header variants={rise} className={styles.header}>
                <p className={styles.greeting} suppressHydrationWarning>
                  {t(`scan.greeting.${greetingKey()}`)}
                </p>
                <h1 className={styles.headline}>
                  {t("scan.headline")} <em>{t("scan.headlineAccent")}</em>
                </h1>
                <p className={styles.lead}>{t("scan.webIntro")}</p>
                {(trial.plan !== "free" ||
                  (trial.limited && !trial.exhausted && trial.remaining !== null && trial.limit !== null)) && (
                  <div className={styles.trial}>
                    {trial.plan !== "free" && (
                      <Link href="/settings?section=plan" aria-label={t("plans.section")}>
                        <PlanBadge plan={trial.plan} size="md" />
                      </Link>
                    )}
                    {trial.limited &&
                      !trial.exhausted &&
                      trial.remaining !== null &&
                      trial.limit !== null &&
                      (trial.kind === "trial" || trial.remaining <= LOW_MONTH_SCANS) && (
                        <TrialPill remaining={trial.remaining} limit={trial.limit} kind={trial.kind} />
                      )}
                  </div>
                )}
                <PlanNotice />
              </motion.header>

              {aiStatus.status === "demo" && (
                <motion.div variants={rise} className={styles.demoBanner} role="note">
                  <FlaskConical size={18} />
                  <div>
                    <strong>{t("scan.demoTitle")}</strong>
                    <p>{t("scan.demoBody")}</p>
                  </div>
                </motion.div>
              )}

              <motion.div variants={rise} className={`${styles.modes} ${picking ? styles.modesPick : ""}`}>
                <SegmentedControl
                  size="lg"
                  ariaLabel="Mode"
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    setPicked(true);
                  }}
                  options={(Object.keys(modeIcons) as ScanMode[]).map((value) => {
                    const Icon = modeIcons[value];
                    return { value, label: t(`scan.modes.${value}`), icon: <Icon /> };
                  })}
                />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={picking ? "pick" : mode}
                    className={`${styles.modeHint} ${picking ? styles.modeHintPick : ""}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22, ease: easeOut }}
                  >
                    {picking ? t("scan.pickHint") : t(`scan.modeHints.${mode}`)}
                  </motion.p>
                </AnimatePresence>
                {/* How to frame the photo for this mode, before taking it. */}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={`framing-${mode}`}
                    className={styles.framing}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: easeOut }}
                  >
                    <Lightbulb aria-hidden />
                    {t(`scan.framing.${mode}`)}
                  </motion.p>
                </AnimatePresence>
              </motion.div>

              <motion.ol variants={rise} className={styles.how} aria-label={t("scan.how")}>
                {(["how1", "how2", "how3"] as const).map((key, index) => (
                  <li key={key}>
                    <span>{index + 1}</span>
                    {t(`scan.${key}`)}
                  </li>
                ))}
              </motion.ol>
            </div>

            <motion.div variants={rise} className={styles.capture}>
              {trial.exhausted && trial.limit !== null ? (
                <TrialOver limit={trial.limit} kind={trial.kind} plan={trial.plan} canUseOwnKey={trial.canUseOwnKey} />
              ) : (
                <>
                  <div className={styles.orb}>
                    <CaptureOrb label={t("scan.capture")} onPress={() => void start("camera")} />
                    <p className={styles.captureLabel}>{t("scan.capture")}</p>
                    <Button variant="ghost" icon={<ImageUp />} onClick={() => void start("gallery")}>
                      {t("scan.gallery")}
                    </Button>
                  </div>
                  <div className={styles.drop}>
                    <DropZone onFile={(file) => void startWithFile(file)} onWebcam={() => void start("camera")} />
                  </div>
                  {/* Several pages in one analysis: Premium and up; the others see the offer. */}
                  <div className={styles.multi}>
                    {multiPage ? (
                      <Button variant="secondary" icon={<Files />} onClick={() => pages.begin()}>
                        {t("pages.start")}
                      </Button>
                    ) : (
                      <Button variant="ghost" icon={<Files />} href="/plans">
                        {t("pages.start")} <PlanBadge plan="premium" />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </motion.div>

            <PendingScans />

            {hasReminder && (
              <motion.div variants={rise} className={styles.reminderSlot}>
                <NextReminder entries={entries} />
              </motion.div>
            )}

            {!historyLoading && recent.length === 0 && (
              <motion.section variants={rise} className={styles.recent}>
                <div className={styles.sectionHead}>
                  <h2>{t("examples.title")}</h2>
                </div>
                <p className={styles.examplesHint}>{t("examples.hint")}</p>
                <div className={styles.examples}>
                  {exampleIds.map((id) => (
                    <Link key={id} href={{ pathname: "/result", query: { example: id } }} className={styles.example}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- static example photo, works in the static export */}
                      <img src={exampleImage(id)} alt="" loading="lazy" />
                      <span>{t(`examples.labels.${id}`)}</span>
                    </Link>
                  ))}
                </div>
              </motion.section>
            )}

            {recent.length > 0 && (
              <motion.section variants={rise} className={styles.recent}>
                <div className={styles.sectionHead}>
                  <h2>{t("scan.recent")}</h2>
                  <Link href="/history" className={styles.seeAll}>
                    {t("scan.seeAll")} <ArrowRight size={14} />
                  </Link>
                </div>
                <div className={styles.recentList}>
                  {recent.map((entry) => (
                    <HistoryItem key={entry.id} entry={entry} variant={isDesktop ? "tile" : "row"} />
                  ))}
                </div>
              </motion.section>
            )}
          </motion.div>
        ) : state.phase === "collecting" ? (
          <motion.div key="pages" className={styles.working} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
            <PagesTray
              pages={pages.list}
              adding={pages.adding}
              onAdd={(source) => void pages.add(source)}
              onRemove={pages.remove}
              onMove={pages.move}
              onAnalyze={() => void pages.analyze()}
              onCancel={reset}
            />
          </motion.div>
        ) : (
          <motion.div
            key="stage"
            className={styles.working}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {state.phase !== "error" || state.previewSrc ? (
              <ScanStage
                key={state.phase === "analyzing" ? state.startedAt : "static"}
                src={state.phase === "error" ? state.previewSrc! : state.previewSrc}
                steps={state.phase === "preparing" ? [t("scan.preparing")] : state.phase === "analyzing" ? list("scan.steps") : []}
                scanning={busy}
              />
            ) : null}

            {state.phase === "analyzing" && state.pageCount > 1 && (
              <p className={styles.pagesNote}>
                <Files size={15} /> {t("pages.analyzing", { count: state.pageCount })}
              </p>
            )}

            {state.phase === "analyzing" && (
              <ScanWait mode={mode} modeIcon={<ModeIcon />} startedAt={state.startedAt} />
            )}

            {state.phase === "codes" && (
              <motion.div className={styles.codes} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
                <h2>
                  <QrCode size={18} /> {t("codes.found", { count: state.codes.length })}
                </h2>
                <p>{t("codes.free")}</p>
                <CodeList codes={state.codes} />
              </motion.div>
            )}

            {state.phase === "queued" && (
              <motion.div className={styles.queued} role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
                <CloudOff size={22} />
                <h2>{t("queue.queuedTitle")}</h2>
                <p>{t("queue.queuedBody")}</p>
              </motion.div>
            )}

            {state.phase === "error" && (
              <motion.div
                className={styles.error}
                role="alert"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: easeOut }}
              >
                <h2>{t("errors.title")}</h2>
                <p>{t(`errors.${state.error}`)}</p>
              </motion.div>
            )}

            <div className={styles.actions}>
              {state.phase === "codes" ? (
                <>
                  <Button size="lg" icon={<Check />} onClick={reset}>
                    {t("codes.done")}
                  </Button>
                  <Button size="lg" variant="secondary" icon={<Sparkles />} onClick={analyzeAnyway}>
                    {t("codes.analyze")}
                  </Button>
                </>
              ) : state.phase === "queued" ? (
                <Button size="lg" icon={<Check />} onClick={reset}>
                  {t("queue.ok")}
                </Button>
              ) : state.phase === "error" && planErrors.has(state.error) ? (
                <>
                  <Button size="lg" href={PLANS_HREF} icon={<Sparkles />}>
                    {t("trial.seeOffers")}
                  </Button>
                  <Button size="lg" variant="secondary" onClick={reset}>
                    {t("scan.cancel")}
                  </Button>
                </>
              ) : state.phase === "error" ? (
                <>
                  {canRetry && (
                    <Button size="lg" icon={<RotateCcw />} onClick={retry}>
                      {t("scan.retry")}
                    </Button>
                  )}
                  <Button size="lg" variant="secondary" onClick={reset}>
                    {t("scan.newPhoto")}
                  </Button>
                </>
              ) : (
                <Button variant="secondary" icon={<X />} onClick={reset}>
                  {t("scan.cancel")}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
