import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useState } from "react";
import { ChevronRight, FileDown, FileSpreadsheet, House, Plus, ScanLine } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ItemDetail, ItemForm, WarrantyPill } from "@/components/Inventory";
import styles from "@/components/Inventory/Inventory.module.scss";
import { PlanLock } from "@/components/PlanLock";
import { Seo } from "@/components/Seo";
import { useToast } from "@/components/Toast";
import { useHomeItems } from "@/hooks/useHomeItems";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate } from "@/lib/format";
import { inventoryTotals, itemsByRoom, warrantyStatus } from "@/lib/inventory";
import { rise, stagger } from "@/lib/motion";
import { dayString } from "@/lib/papers";
import { shareFile } from "@/services/fileShare";

const timestamp = () => Date.now();

/**
 * "Ma maison": the things of the home with their purchase, warranty and
 * papers, room by room, and the export for an insurer (Premium and up). Below
 * Premium, the things already there stay visible, read only (their reminders
 * are paused).
 */
export default function InventoryPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { plan, has, planFor } = usePlan();
  // Until the plan is read (cache or server), neither the lock nor the read-only banner: a Premium user would see them flash.
  const known = plan !== null;
  const now = useNow(60_000);
  const { items, isLoading } = useHomeItems();
  const [exporting, setExporting] = useState(false);
  const openId = typeof router.query.open === "string" ? router.query.open : null;
  const creating = router.query.new === "1";
  const opened = items.find((item) => item.id === openId);
  const readOnly = !has("inventory");
  const canRemind = has("reminders");
  const planName = t(`plans.names.${planFor("inventory") ?? "premium"}`);

  const go = (query: Record<string, string>) => void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true, scroll: true });
  const open = (id: string | null) => go(id ? { open: id } : {});

  const totals = inventoryTotals(items);
  const rooms = itemsByRoom(items);

  const exportAs = async (kind: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(true);
    const at = timestamp();
    const heading = { title: t("inventory.export.title"), subtitle: t("inventory.export.exportedOn", { date: formatDate(at, locale) }) };
    try {
      const bytes =
        kind === "xlsx"
          ? await (await import("@/lib/inventoryExport")).inventoryWorkbook(items, t, heading, at)
          : await (await import("@/services/inventoryPdf")).inventoryPdf(items, t, locale, heading, at);
      const { inventoryFileName, XLSX_TYPE } = await import("@/lib/inventoryExport");
      const result = await shareFile(inventoryFileName(dayString(at), kind), bytes, kind === "xlsx" ? XLSX_TYPE : "application/pdf", t("inventory.title"));
      if (result === "downloaded") toast(t("inventory.export.downloaded"));
    } catch {
      toast(t("inventory.export.failed"), "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Seo title={`${t("inventory.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("inventory.title")}</h1>
          <p>{t("inventory.subtitle")}</p>
        </motion.header>

        {known && readOnly && items.length > 0 && (
          <motion.div variants={rise}>
            <PlanLock plan={planFor("inventory")} text={t("inventory.readOnly", { plan: planName })} />
          </motion.div>
        )}

        {!known || (readOnly && isLoading) ? null : readOnly && items.length === 0 ? (
          <motion.div variants={rise} className={styles.locked}>
            <PlanLock plan={planFor("inventory")} text={t("inventory.locked", { plan: planName })} />
            <ul>
              {(["list", "warranty", "papers", "export"] as const).map((key) => (
                <li key={key}>{t(`inventory.pitch.${key}`)}</li>
              ))}
            </ul>
          </motion.div>
        ) : opened ? (
          <motion.div variants={rise}>
            <ItemDetail key={opened.id} item={opened} readOnly={readOnly} canRemind={canRemind} onBack={() => open(null)} />
          </motion.div>
        ) : creating && !readOnly ? (
          <motion.div variants={rise}>
            <ItemForm canRemind={canRemind} onDone={(id) => open(id ?? null)} />
          </motion.div>
        ) : !isLoading && items.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("inventory.emptyTitle")}
              body={t("inventory.emptyBody")}
              action={
                <div className={styles.emptyActions}>
                  <Button href="/?mode=object" icon={<ScanLine />}>
                    {t("inventory.scanObject")}
                  </Button>
                  <Button variant="secondary" icon={<Plus />} onClick={() => go({ new: "1" })}>
                    {t("inventory.add")}
                  </Button>
                </div>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.div variants={rise} className={styles.stats} data-testid="inventory-totals">
              <span>
                <small>{t("inventory.export.count")}</small>
                <strong>{totals.count}</strong>
              </span>
              <span>
                <small>{t("inventory.export.total")}</small>
                <strong>{formatAriary(totals.totalMga, locale)}</strong>
              </span>
            </motion.div>

            {rooms.map((group) => (
              <motion.section key={group.room} variants={rise} className={styles.room}>
                <h2>
                  {t(`inventory.rooms.${group.room}`)} <span>{formatAriary(group.totalMga, locale)}</span>
                </h2>
                <ul className={styles.items}>
                  {group.items.map((item) => {
                    const status = warrantyStatus(item, now);
                    const subtitle = [item.category && t(`inventory.categories.${item.category}`), item.priceMga && formatAriary(item.priceMga, locale)].filter(Boolean).join(" · ");
                    return (
                      <li key={item.id}>
                        <button type="button" className={styles.item} onClick={() => open(item.id)}>
                          <span className={styles.thumb}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                            {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <House size={22} />}
                          </span>
                          <span className={styles.text}>
                            <strong>{item.name}</strong>
                            {subtitle && <small>{subtitle}</small>}
                          </span>
                          {status && <WarrantyPill status={status} />}
                          <ChevronRight size={18} className={styles.chevron} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </motion.section>
            ))}

            <motion.div variants={rise} className={styles.row}>
              {!readOnly && (
                <>
                  <Button variant="secondary" icon={<Plus />} onClick={() => go({ new: "1" })}>
                    {t("inventory.add")}
                  </Button>
                  <Button variant="ghost" href="/?mode=object" icon={<ScanLine />}>
                    {t("inventory.scanObject")}
                  </Button>
                </>
              )}
            </motion.div>
            <motion.div variants={rise} className={styles.section}>
              <h3>{t("inventory.export.heading")}</h3>
              <p className={styles.hint}>{t("inventory.export.hint")}</p>
              <div className={styles.row}>
                <Button variant="secondary" icon={<FileDown />} onClick={() => void exportAs("pdf")} disabled={exporting} data-testid="inventory-export-pdf">
                  {t("inventory.export.pdf")}
                </Button>
                <Button variant="ghost" icon={<FileSpreadsheet />} onClick={() => void exportAs("xlsx")} disabled={exporting} data-testid="inventory-export-xlsx">
                  {t("inventory.export.xlsx")}
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </motion.div>
    </>
  );
}
