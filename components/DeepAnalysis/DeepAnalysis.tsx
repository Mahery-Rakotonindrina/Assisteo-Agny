import { useRouter } from "next/router";
import { useState } from "react";
import { Loader2, Microscope } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { analysisService } from "@/services/analysisService";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { planStore } from "@/services/plan";
import { ApiError } from "@/types/api";
import type { HistoryEntry } from "@/types/history";
import styles from "./DeepAnalysis.module.scss";

/**
 * Premium: analyse the scan again with the more capable model, for the hard
 * cases. The new analysis replaces this one; the photo stays.
 */
export function DeepAnalysis({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { plan, has } = usePlan();
  const [running, setRunning] = useState(false);

  if (entry.meta.deep) {
    return (
      <p className={styles.done}>
        <Microscope size={14} /> {t("deep.done")}
      </p>
    );
  }

  // Older scans only keep their thumbnail: too small to look closer.
  const photo = entry.preview.startsWith("data:") && entry.preview !== entry.thumbnail ? entry.preview : null;
  const allowed = has("deepAnalysis");
  const left = allowed && plan && plan.limits.deepPerMonth > 0 ? Math.max(0, plan.limits.deepPerMonth - plan.usage.deep) : null;

  const run = async () => {
    if (!allowed) {
      haptics.tap();
      void router.push("/plans");
      return;
    }
    if (!photo || running) return;
    haptics.press();
    setRunning(true);
    try {
      const { analysis, meta } = await analysisService.analyze({
        image: photo.slice(photo.indexOf(",") + 1),
        mediaType: "image/jpeg",
        mode: entry.mode,
        locale,
        deep: true,
      });
      await historyStore.update(entry.id, { analysis, meta: { model: meta.model, demo: meta.demo, durationMs: meta.durationMs, deep: Boolean(meta.deep) } });
      planStore.setUsage({ ...(meta.quota && { scans: meta.quota.used }), ...(meta.deepQuota && { deep: meta.deepQuota.used }) });
      haptics.success();
      toast(t("deep.finished"));
    } catch (error) {
      haptics.error();
      const code = error instanceof ApiError ? error.code : "unknown";
      toast(
        code === "deep_limit"
          ? t("deep.limit")
          : code === "plan_limit"
            ? t("errors.plan_limit")
            : code === "plan_required"
              ? t("deep.premium")
              : code === "unavailable"
                ? t("deep.unavailable")
                : t("deep.failed"),
        "error",
      );
    } finally {
      setRunning(false);
    }
  };

  const hint = running
    ? t("deep.wait")
    : !allowed
      ? t("deep.hintLocked")
      : !photo
        ? t("deep.noPhoto")
        : left === 0
          ? t("deep.limit")
          : left !== null
            ? t("deep.hint", { left })
            : t("deep.hintUnlimited");

  return (
    <div className={styles.wrap}>
      <Button
        variant="secondary"
        size="md"
        icon={running ? <Loader2 className={styles.spin} /> : <Microscope />}
        onClick={() => void run()}
        disabled={running || (allowed && (!photo || left === 0))}
      >
        {running ? t("deep.running") : t("deep.button")}
        {!allowed && <PlanBadge plan="premium" className={styles.tag} />}
      </Button>
      <small>{hint}</small>
    </div>
  );
}
