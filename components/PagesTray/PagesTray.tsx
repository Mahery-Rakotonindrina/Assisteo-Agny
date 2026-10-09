import { AnimatePresence, motion } from "motion/react";
import { Camera, ChevronLeft, ChevronRight, Files, ImageUp, ScanText, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { MAX_PAGES } from "@/lib/ai/schema";
import { easeOut } from "@/lib/motion";
import type { PageCapture } from "@/hooks/useScan";
import type { PhotoSource } from "@/services/camera";
import styles from "./PagesTray.module.scss";

type PagesTrayProps = {
  pages: PageCapture[];
  adding: boolean;
  onAdd: (source: PhotoSource) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, offset: -1 | 1) => void;
  onAnalyze: () => void;
  onCancel: () => void;
};

/** The pages of a document, taken one by one (or picked together), before one analysis of them all. */
export function PagesTray({ pages, adding, onAdd, onRemove, onMove, onAnalyze, onCancel }: PagesTrayProps) {
  const { t } = useTranslation();
  const full = pages.length >= MAX_PAGES;

  return (
    <motion.section className={styles.tray} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
      <header className={styles.head}>
        <h2>
          <Files size={20} /> {t("pages.title")}
        </h2>
        <p>{t("pages.hint", { max: MAX_PAGES })}</p>
      </header>

      <ol className={styles.grid} aria-label={t("pages.title")}>
        <AnimatePresence initial={false}>
          {pages.map((page, index) => (
            <motion.li
              key={page.key}
              layout
              className={styles.page}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
              <img src={page.thumbnail.dataUrl} alt={t("pages.page", { number: index + 1 })} />
              <span className={styles.number}>{index + 1}</span>
              <button type="button" className={styles.remove} onClick={() => onRemove(index)} aria-label={t("pages.remove", { number: index + 1 })}>
                <X size={14} />
              </button>
              {pages.length > 1 && (
                <div className={styles.move}>
                  <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={t("pages.earlier", { number: index + 1 })}>
                    <ChevronLeft size={14} />
                  </button>
                  <button type="button" onClick={() => onMove(index, 1)} disabled={index === pages.length - 1} aria-label={t("pages.later", { number: index + 1 })}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </motion.li>
          ))}
          {adding && (
            <motion.li key="adding" className={`${styles.page} ${styles.placeholder}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className={styles.spinner} aria-label={t("scan.preparing")} />
            </motion.li>
          )}
        </AnimatePresence>
      </ol>

      <p className={styles.count}>{t("pages.count", { count: pages.length, max: MAX_PAGES })}</p>

      <div className={styles.add}>
        <Button variant="secondary" icon={<Camera />} onClick={() => onAdd("camera")} disabled={full || adding}>
          {pages.length === 0 ? t("pages.firstPhoto") : t("pages.addPhoto")}
        </Button>
        <Button variant="secondary" icon={<ImageUp />} onClick={() => onAdd("gallery")} disabled={full || adding}>
          {t("pages.addGallery")}
        </Button>
      </div>

      <div className={styles.actions}>
        <Button size="lg" icon={<ScanText />} onClick={onAnalyze} disabled={pages.length === 0 || adding} block>
          {pages.length > 1 ? t("pages.analyze", { count: pages.length }) : t("pages.analyzeOne")}
        </Button>
        <Button variant="ghost" onClick={onCancel} block>
          {t("scan.cancel")}
        </Button>
      </div>
    </motion.section>
  );
}
