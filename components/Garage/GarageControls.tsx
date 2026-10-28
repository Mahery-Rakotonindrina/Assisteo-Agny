import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { Car, RefreshCw } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useVehicles } from "@/hooks/useVehicles";
import { matchVehicle } from "@/lib/garage";
import { haptics } from "@/services/device";
import { vehicleStore } from "@/services/vehicleStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./Garage.module.scss";

/**
 * Under a vehicle scan or a registration certificate: "Add to my garage", or
 * "Update <vehicle>" with what was read (Premium and up; otherwise the plan
 * that has it).
 */
export function GarageControls({ entry, bare = false }: { entry: HistoryEntry; bare?: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { has, planFor } = usePlan();
  const { vehicles } = useVehicles();
  const [busy, setBusy] = useState(false);

  if (!has("garage")) {
    return (
      <div className={styles.controls} data-bare={bare || undefined}>
        <PlanLock plan={planFor("garage")} text={t("garage.lockedScan", { plan: t(`plans.names.${planFor("garage") ?? "premium"}`) })} />
      </div>
    );
  }

  const linked = vehicles.find((vehicle) => vehicle.scanIds.includes(entry.id));
  const match = linked ?? matchVehicle(vehicles, entry.analysis);
  // A registration certificate can update any vehicle; the matching one first.
  const others = entry.analysis.document?.registration ? vehicles.filter((vehicle) => vehicle.id !== match?.id).slice(0, 3) : [];

  const run = async (action: () => Promise<string>) => {
    haptics.tap();
    setBusy(true);
    try {
      const id = await action();
      haptics.success();
      toast(t("garage.saved"));
      void router.push({ pathname: "/garage", query: { open: id } });
    } finally {
      setBusy(false);
    }
  };

  const add = () => run(async () => (await vehicleStore.addFromScan(entry, t("garage.defaultName"))).id);
  const update = (id: string) =>
    run(async () => {
      await vehicleStore.updateFromScan(id, entry);
      return id;
    });

  return (
    <div className={styles.controls} data-bare={bare || undefined}>
      {linked ? (
        <p className={styles.status}>
          <Car size={15} />
          <span>
            {t("garage.inGarage", { name: linked.name })} <Link href={{ pathname: "/garage", query: { open: linked.id } }}>{t("garage.open")}</Link>
          </span>
        </p>
      ) : (
        <div className={styles.row}>
          {match ? (
            <Button icon={<RefreshCw />} onClick={() => void update(match.id)} disabled={busy}>
              {t("garage.updateVehicle", { name: match.name })}
            </Button>
          ) : null}
          <Button variant={match ? "secondary" : "primary"} icon={<Car />} onClick={() => void add()} disabled={busy}>
            {t("garage.addFromScan")}
          </Button>
        </div>
      )}
      {!linked && others.length > 0 && (
        <div className={styles.row}>
          {others.map((vehicle) => (
            <Button key={vehicle.id} variant="ghost" icon={<RefreshCw />} onClick={() => void update(vehicle.id)} disabled={busy}>
              {t("garage.updateVehicle", { name: vehicle.name })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
