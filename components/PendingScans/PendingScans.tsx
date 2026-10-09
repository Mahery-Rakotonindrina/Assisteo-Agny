import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { CloudOff, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { formatTime } from "@/lib/format";
import { rise } from "@/lib/motion";
import { haptics } from "@/services/device";
import { scanQueue, type QueuedScan } from "@/services/scanQueue";
import styles from "./PendingScans.module.scss";

/** The queued scans: waiting for the network, being sent, or refused (to retry or remove). */
export function usePendingScans() {
  const [items, setItems] = useState<QueuedScan[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void scanQueue
        .list()
        .then((list) => {
          if (alive) setItems(list);
        })
        .catch(() => undefined);
    load();
    const unsubscribe = scanQueue.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return items;
}

export function PendingScans() {
  const { t, locale } = useTranslation();
  const items = usePendingScans();
  if (items.length === 0) return null;

  const retry = async (item: QueuedScan) => {
    haptics.press();
    await scanQueue.update(item.id, { status: "waiting", error: undefined });
    scanQueue.wake();
  };
  const remove = async (item: QueuedScan) => {
    haptics.tap();
    await scanQueue.remove(item.id);
  };

  return (
    <motion.section variants={rise} className={styles.pending} aria-live="polite">
      <h2>
        <CloudOff size={16} /> {t("queue.title", { count: items.length })}
      </h2>
      <ul>
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li key={item.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
              <img src={item.first.thumbnail.dataUrl} alt="" />
              <div className={styles.text}>
                <strong>
                  {t(`scan.modes.${item.mode}`)}
                  {item.pages.length > 0 && ` · ${t("pages.short", { count: item.pages.length + 1 })}`}
                </strong>
                <small data-status={item.status}>
                  {item.status === "sending" ? (
                    <>
                      <LoaderCircle size={13} className={styles.spin} /> {t("queue.sending")}
                    </>
                  ) : item.status === "failed" ? (
                    <>
                      <TriangleAlert size={13} /> {t(`errors.${item.error ?? "unknown"}`)}
                    </>
                  ) : (
                    t("queue.waiting", { time: formatTime(item.createdAt, locale) })
                  )}
                </small>
              </div>
              {item.status === "failed" && (
                <button type="button" onClick={() => void retry(item)} aria-label={t("queue.retry")}>
                  <RotateCcw size={16} />
                </button>
              )}
              {item.status !== "sending" && (
                <button type="button" onClick={() => void remove(item)} aria-label={t("queue.remove")}>
                  <X size={16} />
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}
