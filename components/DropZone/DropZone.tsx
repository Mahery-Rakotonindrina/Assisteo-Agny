import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type DragEvent } from "react";
import { Camera, ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { spring } from "@/lib/motion";
import styles from "./DropZone.module.scss";

type DropZoneProps = {
  onFile: (file: File) => void;
  onWebcam: () => void;
};

/** Desktop capture surface: drag & drop, file picker and webcam. */
export function DropZone({ onFile, onWebcam }: DropZoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // Counts nested dragenter/dragleave pairs so child elements don't flicker the state.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <motion.div
      className={`${styles.zone} ${dragging ? styles.dragging : ""}`}
      animate={{ scale: dragging ? 1.02 : 1 }}
      transition={spring}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <span className={styles.glow} aria-hidden />

      <motion.span
        className={styles.icon}
        animate={dragging ? { y: -6, rotate: -6 } : { y: [0, -6, 0], rotate: 0 }}
        transition={dragging ? spring : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      >
        {dragging ? <Upload size={34} /> : <ImagePlus size={34} />}
      </motion.span>

      <AnimatePresence mode="wait" initial={false}>
        <motion.h2
          key={dragging ? "active" : "idle"}
          className={styles.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {dragging ? t("scan.dropActive") : t("scan.drop")}
        </motion.h2>
      </AnimatePresence>
      <p className={styles.hint}>{t("scan.dropHint")}</p>

      <div className={styles.actions}>
        <Button icon={<ImagePlus />} onClick={() => inputRef.current?.click()}>
          {t("scan.chooseFile")}
        </Button>
        <Button variant="secondary" icon={<Camera />} onClick={onWebcam}>
          {t("scan.webcam")}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </motion.div>
  );
}
