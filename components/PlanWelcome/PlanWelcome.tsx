import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanIcon } from "@/components/PlanBadge";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { spring } from "@/lib/motion";
import { planPerks } from "@/lib/planPerks";
import { soldPlans, type PlanLimits, type SoldPlanId } from "@/lib/plans";
import { haptics } from "@/services/device";
import { planMemoryKeys, rememberPlan, usePlanMemory } from "@/services/planMemory";
import styles from "./PlanWelcome.module.scss";

export const isSoldPlan = (id: string | null): id is SoldPlanId => (soldPlans as readonly string[]).includes(id ?? "");

type Piece = { x: number; drift: number; delay: number; duration: number; rotate: number; size: number; tone: number };

/** Confetti pieces, drawn once per welcome. */
const makePieces = (): Piece[] =>
  Array.from({ length: 44 }, () => ({
    x: Math.random() * 100,
    drift: (Math.random() - 0.5) * 24,
    delay: Math.random() * 0.7,
    duration: 2.4 + Math.random() * 1.8,
    rotate: (Math.random() - 0.5) * 900,
    size: 7 + Math.random() * 7,
    tone: Math.floor(Math.random() * 3),
  }));

const noSubscribe = () => () => {};

/**
 * "Bienvenue dans Premium": shown once when a plan starts on this device
 * (checked with the server), with what it unlocks. Also keeps the device's
 * memory of the last paid plan, for the "has ended" notice.
 */
export function PlanWelcome() {
  const { plan, id, fresh } = usePlan();
  const welcomed = usePlanMemory(planMemoryKeys.welcomed);
  const lastPaid = usePlanMemory(planMemoryKeys.lastPaid);
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const signedIn = Boolean(plan?.signedIn);

  useEffect(() => {
    if (!fresh || !signedIn) return;
    if (isSoldPlan(id) && lastPaid !== id) rememberPlan(planMemoryKeys.lastPaid, id);
    // Administrators aren't welcomed; back on free, a later plan is welcomed again.
    if (id === "unlimited" && welcomed !== id) rememberPlan(planMemoryKeys.welcomed, id);
    if (id === "free" && welcomed && welcomed !== "free") rememberPlan(planMemoryKeys.welcomed, "free");
  }, [fresh, signedIn, id, lastPaid, welcomed]);

  if (!mounted) return null;
  const show = fresh && signedIn && isSoldPlan(id) && welcomed !== id && plan !== null;
  return createPortal(
    <AnimatePresence>
      {show && isSoldPlan(id) && (
        <Welcome
          key={id}
          id={id}
          endsAt={plan.endsAt}
          limits={plan.limits}
          onClose={() => {
            haptics.success();
            rememberPlan(planMemoryKeys.welcomed, id);
          }}
        />
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Welcome({ id, endsAt, limits, onClose }: { id: SoldPlanId; endsAt: number | null; limits: PlanLimits; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [pieces] = useState(makePieces);
  const name = t(`plans.names.${id}`);

  return (
    <motion.div className={styles.backdrop} data-plan={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {!reduceMotion && (
        <div className={styles.confetti} aria-hidden>
          {pieces.map((piece, index) => (
            <motion.i
              key={index}
              data-tone={piece.tone}
              style={{ left: `${piece.x}%`, width: piece.size, height: piece.size * 0.45 }}
              initial={{ y: "-8vh", x: "0vw", rotate: 0, opacity: 1 }}
              animate={{ y: "108vh", x: `${piece.drift}vw`, rotate: piece.rotate, opacity: [1, 1, 0] }}
              transition={{ duration: piece.duration, delay: piece.delay, ease: "easeIn" }}
            />
          ))}
        </div>
      )}
      <motion.div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-welcome-title"
        initial={{ scale: 0.9, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={spring}
      >
        <span className={styles.icon}>
          <PlanIcon plan={id} size={34} />
        </span>
        <p className={styles.kicker}>{t("plans.welcome.kicker")}</p>
        <h2 id="plan-welcome-title">{t("plans.welcome.title", { plan: name })}</h2>
        <p className={styles.until}>{endsAt === null ? t("plans.noEnd") : t("plans.welcome.until", { date: formatDate(endsAt - 1, locale) })}</p>
        <ul className={styles.perks}>
          {planPerks(id, limits, t, locale).map((perk) => (
            <li key={perk}>
              <Check size={15} /> {perk}
            </li>
          ))}
        </ul>
        <Button block className={styles.cta} onClick={onClose}>
          {t("plans.welcome.cta")}
        </Button>
      </motion.div>
    </motion.div>
  );
}
