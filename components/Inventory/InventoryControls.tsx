import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { House, Link2 } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { useHomeItems } from "@/hooks/useHomeItems";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { canAddToHome, isHomePaper, MAX_PAPERS } from "@/lib/inventory";
import { haptics } from "@/services/device";
import { homeItemStore } from "@/services/homeItemStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./Inventory.module.scss";

/** Whether a scan gets the "Ma maison" controls: an object, or an invoice, a receipt or a warranty card. */
export const hasInventoryControls = (entry: HistoryEntry) => canAddToHome(entry.analysis) || isHomePaper(entry.analysis);

/**
 * Under an object scan: "Ajouter à ma maison", prefilled by the analysis.
 * Under an invoice, a till receipt or a warranty card: "Lier à un objet de ma
 * maison" (the purchase it tells fills in what the thing doesn't have yet).
 * Premium and up; otherwise the plan that has it.
 */
export function InventoryControls({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { has, planFor } = usePlan();
  const { items } = useHomeItems();
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState("");
  const isObject = canAddToHome(entry.analysis);

  if (!has("inventory")) {
    return (
      <div className={styles.controls}>
        <PlanLock plan={planFor("inventory")} text={t(isObject ? "inventory.lockedScan" : "inventory.lockedPaper", { plan: t(`plans.names.${planFor("inventory") ?? "premium"}`) })} />
      </div>
    );
  }

  const openItem = (id: string) => void router.push({ pathname: "/inventory", query: { open: id } });

  if (isObject) {
    const made = items.find((item) => item.fromScanId === entry.id);
    if (made) {
      return (
        <div className={styles.controls}>
          <p className={styles.status}>
            <House size={15} />
            <span>
              {t("inventory.inHome", { name: made.name })} <Link href={{ pathname: "/inventory", query: { open: made.id } }}>{t("inventory.open")}</Link>
            </span>
          </p>
        </div>
      );
    }
    const add = async () => {
      haptics.tap();
      setBusy(true);
      try {
        const item = await homeItemStore.addFromScan(entry, t("inventory.defaultName"));
        haptics.success();
        toast(t("inventory.saved"));
        openItem(item.id);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className={styles.controls}>
        <div className={styles.row}>
          <Button icon={<House />} onClick={() => void add()} disabled={busy} data-testid="inventory-add-from-scan">
            {t("inventory.addFromScan")}
          </Button>
        </div>
      </div>
    );
  }

  const linked = items.filter((item) => item.scanIds.includes(entry.id));
  const free = items.filter((item) => !item.scanIds.includes(entry.id) && item.scanIds.length < MAX_PAPERS);
  const target = free.find((item) => item.id === chosen) ?? free[0];

  const link = async () => {
    if (!target) return;
    haptics.tap();
    setBusy(true);
    try {
      const done = await homeItemStore.linkPaper(target.id, entry);
      if (done) {
        haptics.success();
        toast(t("inventory.papers.linkedTo", { name: target.name }));
      } else toast(t("inventory.papers.full", { max: MAX_PAPERS }), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.controls}>
      {linked.map((item) => (
        <p key={item.id} className={styles.status}>
          <Link2 size={15} />
          <span>
            {t("inventory.papers.linkedWith", { name: item.name })} <Link href={{ pathname: "/inventory", query: { open: item.id } }}>{t("inventory.open")}</Link>
          </span>
        </p>
      ))}
      {items.length === 0 ? (
        <>
          <p className={styles.hint}>{t("inventory.papers.noItems")}</p>
          <div className={styles.row}>
            <Button variant="secondary" href="/inventory?new=1" icon={<House />}>
              {t("inventory.add")}
            </Button>
          </div>
        </>
      ) : (
        free.length > 0 && (
          <div className={styles.row}>
            {free.length > 1 && (
              <select value={target?.id ?? ""} onChange={(event) => setChosen(event.target.value)} aria-label={t("inventory.papers.choose")}>
                {free.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant={linked.length ? "secondary" : "primary"} icon={<Link2 />} onClick={() => void link()} disabled={busy || !target} data-testid="inventory-link-paper">
              {free.length === 1 ? t("inventory.papers.linkTo", { name: free[0].name }) : t("inventory.papers.linkToItem")}
            </Button>
          </div>
        )
      )}
    </div>
  );
}
