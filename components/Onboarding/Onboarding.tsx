import { useRouter } from "next/router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { BellRing, Camera, Check, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut, spring } from "@/lib/motion";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { getPermission, requestPermission, type PermissionKind, type PermissionStatus } from "@/services/permissions";
import styles from "./Onboarding.module.scss";

type Step = "welcome" | PermissionKind | "done";

const permissionIcons: Record<PermissionKind, ReactNode> = {
  camera: <Camera size={40} strokeWidth={1.8} />,
  notifications: <BellRing size={40} strokeWidth={1.8} />,
};

const legalRoutes = new Set(["/privacy", "/terms"]);

/**
 * First-run walkthrough on phones: explains each device permission and asks
 * for it before the app ever needs it. Skips what is already granted or what
 * the platform doesn't let us ask for.
 */
export function Onboarding() {
  const { settings, ready, update } = useSettings();
  const isDesktop = useIsDesktop();
  const { pathname } = useRouter();
  // Legal pages are opened from the stores and links: never cover them.
  const active = ready && !settings.onboardingDone && !isDesktop && !legalRoutes.has(pathname);
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const kinds: PermissionKind[] = ["camera", "notifications"];
    Promise.all(kinds.map((kind) => getPermission(kind).catch(() => "unsupported" as const))).then((statuses) => {
      if (cancelled) return;
      const toAsk = kinds.filter((_, index) => statuses[index] === "prompt");
      // Nothing to ask (web on iOS, everything already granted…): don't show anything.
      if (toAsk.length === 0) update({ onboardingDone: true });
      else setSteps(["welcome", ...toAsk, "done"]);
    });
    return () => {
      cancelled = true;
    };
  }, [active, update]);

  if (!active || !steps) return null;
  return <Walkthrough steps={steps} onFinish={() => update({ onboardingDone: true })} />;
}

function Walkthrough({ steps, onFinish }: { steps: Step[]; onFinish: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Partial<Record<PermissionKind, PermissionStatus>>>({});
  const [asking, setAsking] = useState(false);
  const step = steps[index];
  const next = () => setIndex((current) => Math.min(current + 1, steps.length - 1));

  // Keep the page behind from scrolling while the walkthrough is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const ask = async (kind: PermissionKind) => {
    setAsking(true);
    haptics.tap();
    const status = await requestPermission(kind).catch(() => "denied" as const);
    setResults((current) => ({ ...current, [kind]: status }));
    setAsking(false);
    if (status === "granted") {
      haptics.success();
      setTimeout(next, 700);
    }
  };

  const skip = (kind: PermissionKind) => {
    setResults((current) => ({ ...current, [kind]: "prompt" }));
    next();
  };

  const permissionSteps = steps.filter((item): item is PermissionKind => item === "camera" || item === "notifications");

  return (
    <motion.div
      className={styles.overlay}
      role="dialog"
      aria-modal
      aria-labelledby="onboarding-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className={styles.aurora} aria-hidden />

      <div className={styles.progress} aria-hidden>
        {steps.map((item, i) => (
          <span key={item} className={i <= index ? styles.reached : undefined} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className={styles.step}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.35, ease: easeOut }}
        >
          {step === "welcome" && (
            <>
              <Illustration>
                <Logo size={88} markOnly />
              </Illustration>
              <h1 id="onboarding-title">{t("onboarding.welcomeTitle")}</h1>
              <p>{t("onboarding.welcomeBody")}</p>
              <div className={styles.actions}>
                <Button size="lg" block onClick={next}>
                  {t("onboarding.start")}
                </Button>
              </div>
            </>
          )}

          {(step === "camera" || step === "notifications") && (
            <PermissionStep
              kind={step}
              status={results[step]}
              asking={asking}
              onAllow={() => void ask(step)}
              onSkip={() => skip(step)}
              onContinue={next}
            />
          )}

          {step === "done" && (
            <>
              <Illustration>
                <Sparkles size={40} strokeWidth={1.8} />
              </Illustration>
              <h1 id="onboarding-title">{t("onboarding.doneTitle")}</h1>
              <ul className={styles.summary}>
                {permissionSteps.map((kind) => {
                  const granted = results[kind] === "granted";
                  return (
                    <li key={kind} className={granted ? styles.on : styles.off}>
                      <span>{granted ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}</span>
                      {t(`onboarding.${kind}Title`)}
                    </li>
                  );
                })}
              </ul>
              <p className={styles.small}>{t("onboarding.doneBody")}</p>
              <div className={styles.actions}>
                <Button size="lg" block onClick={onFinish}>
                  {t("onboarding.finish")}
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

type PermissionStepProps = {
  kind: PermissionKind;
  status?: PermissionStatus;
  asking: boolean;
  onAllow: () => void;
  onSkip: () => void;
  onContinue: () => void;
};

function PermissionStep({ kind, status, asking, onAllow, onSkip, onContinue }: PermissionStepProps) {
  const { t, list } = useTranslation();

  return (
    <>
      <Illustration pulse={kind === "camera"} wiggle={kind === "notifications"} badge={status === "granted"}>
        {permissionIcons[kind]}
      </Illustration>
      <h1 id="onboarding-title">{t(`onboarding.${kind}Title`)}</h1>
      <p>{t(`onboarding.${kind}Body`)}</p>
      <ul className={styles.reasons}>
        {list(`onboarding.${kind}Reasons`).map((reason) => (
          <li key={reason}>
            <Check size={16} />
            {reason}
          </li>
        ))}
      </ul>
      <p className={styles.privacy}>
        <ShieldCheck size={15} />
        {t(`onboarding.${kind}Privacy`)}
      </p>

      <div className={styles.actions}>
        {status === "denied" ? (
          <>
            <p className={styles.denied} role="status">
              {t("onboarding.denied")}
            </p>
            <Button size="lg" block onClick={onContinue}>
              {t("onboarding.continue")}
            </Button>
          </>
        ) : status === "granted" ? (
          <p className={styles.granted} role="status">
            <Check size={18} strokeWidth={3} /> {t("onboarding.granted")}
          </p>
        ) : (
          <>
            <Button size="lg" block onClick={onAllow} disabled={asking}>
              {t("onboarding.allow")}
            </Button>
            <Button size="lg" variant="ghost" block onClick={onSkip} disabled={asking}>
              {t("onboarding.later")}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

type IllustrationProps = {
  children: ReactNode;
  pulse?: boolean;
  wiggle?: boolean;
  badge?: boolean;
};

function Illustration({ children, pulse, wiggle, badge }: IllustrationProps) {
  return (
    <div className={styles.illustration} aria-hidden>
      {pulse && (
        <>
          <span className={styles.ring} />
          <span className={`${styles.ring} ${styles.ringDelayed}`} />
        </>
      )}
      <motion.div
        className={styles.disc}
        initial={{ scale: 0.6, rotate: -10 }}
        animate={wiggle ? { scale: 1, rotate: [0, -12, 10, -6, 4, 0] } : { scale: 1, rotate: 0 }}
        transition={wiggle ? { scale: spring, rotate: { duration: 1.2, delay: 0.3, repeat: Infinity, repeatDelay: 2.2 } } : spring}
      >
        {children}
      </motion.div>
      <AnimatePresence>
        {badge && (
          <motion.span className={styles.badge} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
            <Check size={18} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
