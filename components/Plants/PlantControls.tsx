import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { Sprout } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { usePlants } from "@/hooks/usePlants";
import { useTranslation } from "@/hooks/useTranslation";
import { haptics } from "@/services/device";
import { requestNotificationPermission } from "@/services/notifications";
import { plantStore } from "@/services/plantStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./Plants.module.scss";

/** Under a plant scan: "Add to my plants", or the plant it already is (Lite and up; otherwise the plan that has it). */
export function PlantControls({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { has, planFor } = usePlan();
  const { plants } = usePlants();
  const [busy, setBusy] = useState(false);

  if (!has("plants")) {
    return <PlanLock plan={planFor("plants")} text={t("plants.lockedScan", { plan: t(`plans.names.${planFor("plants") ?? "lite"}`) })} />;
  }

  const linked = plants.find((plant) => plant.scanIds.includes(entry.id));
  if (linked) {
    return (
      <p className={styles.status}>
        <Sprout size={15} />
        <span>
          {t("plants.inPlants", { name: linked.name })} <Link href={{ pathname: "/plants", query: { open: linked.id } }}>{t("plants.open")}</Link>
        </span>
      </p>
    );
  }

  const add = async () => {
    haptics.tap();
    setBusy(true);
    try {
      const plant = await plantStore.addFromScan(entry, t("plants.defaultName"));
      // The morning reminder needs the notifications: asked here, where the user expects it.
      await requestNotificationPermission().catch(() => undefined);
      haptics.success();
      toast(t("plants.saved"));
      void router.push({ pathname: "/plants", query: { open: plant.id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.controls}>
      <small className={styles.hint}>{t("plants.addHint")}</small>
      <div className={styles.row}>
        <Button icon={<Sprout />} onClick={() => void add()} disabled={busy}>
          {t("plants.addFromScan")}
        </Button>
      </div>
    </div>
  );
}
