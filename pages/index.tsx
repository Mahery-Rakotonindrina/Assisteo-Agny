import Head from "next/head";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Apple, ArrowRight, Box, Car, FileText, FlaskConical, ImageUp, KeyRound, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/Button";
import { CaptureOrb } from "@/components/CaptureOrb";
import { DropZone } from "@/components/DropZone";
import { HistoryItem } from "@/components/HistoryItem";
import { ScanStage } from "@/components/ScanStage";
import { SegmentedControl } from "@/components/SegmentedControl";
import { AI_SETTINGS_HREF, TrialOver, TrialPill } from "@/components/Trial";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useHistory } from "@/hooks/useHistory";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useScan } from "@/hooks/useScan";
import { useTranslation } from "@/hooks/useTranslation";
import { useTrial } from "@/hooks/useTrial";
import type { ScanMode } from "@/lib/ai/schema";
import { easeOut, rise, stagger } from "@/lib/motion";
import styles from "@/styles/Scan.module.scss";

const modeIcons = { auto: Sparkles, food: Apple, document: FileText, vehicle: Car, object: Box } as const;

function greetingKey() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

export default function ScanPage() {
  const { t, list } = useTranslation();
  const [mode, setMode] = useState<ScanMode>("auto");
  const { state, start, startWithFile, retry, reset, canRetry } = useScan(mode);
  const { entries } = useHistory();
  const aiStatus = useAiStatus();
  const isDesktop = useIsDesktop();
  const trial = useTrial();
  const recent = entries.slice(0, isDesktop ? 4 : 3);
  const busy = state.phase === "preparing" || state.phase === "analyzing";

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
            className={styles.idle}
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
                {trial.limited && !trial.exhausted && trial.remaining !== null && trial.limit !== null && (
                  <div className={styles.trial}>
                    <TrialPill remaining={trial.remaining} limit={trial.limit} />
                  </div>
                )}
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

              <motion.div variants={rise} className={styles.modes}>
                <SegmentedControl
                  size="lg"
                  ariaLabel="Mode"
                  value={mode}
                  onChange={setMode}
                  options={(Object.keys(modeIcons) as ScanMode[]).map((value) => {
                    const Icon = modeIcons[value];
                    return { value, label: t(`scan.modes.${value}`), icon: <Icon /> };
                  })}
                />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={mode}
                    className={styles.modeHint}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22, ease: easeOut }}
                  >
                    {t(`scan.modeHints.${mode}`)}
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
                <TrialOver limit={trial.limit} />
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
                </>
              )}
            </motion.div>

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
                steps={state.phase === "preparing" ? [t("scan.preparing")] : list("scan.steps")}
                scanning={busy}
              />
            ) : null}

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
              {state.phase === "error" && (state.error === "trial_exhausted" || state.error === "server_busy") ? (
                <>
                  <Button size="lg" href={AI_SETTINGS_HREF} icon={<KeyRound />}>
                    {t("trial.addKey")}
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
