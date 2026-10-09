import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Check, Folder, FolderPlus, Star, X } from "lucide-react";
import { useHistory } from "@/hooks/useHistory";
import { useTranslation } from "@/hooks/useTranslation";
import { cleanFolder, folderList } from "@/lib/historyFilters";
import { easeOut } from "@/lib/motion";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./FolderPicker.module.scss";

/** Under a result's title: star it, and put it in a folder (an existing one or a new one). */
export function FolderPicker({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const { entries } = useHistory();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const folders = folderList(entries);

  const setFolder = (folder: string | undefined) => {
    haptics.tap();
    void historyStore.update(entry.id, { folder });
    setOpen(false);
    setName("");
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    const folder = cleanFolder(name);
    if (folder) setFolder(folder);
  };

  return (
    <div className={styles.picker}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.chip}
          aria-pressed={Boolean(entry.favorite)}
          onClick={() => {
            haptics.tap();
            void historyStore.update(entry.id, { favorite: !entry.favorite });
          }}
        >
          <Star size={14} fill={entry.favorite ? "currentColor" : "none"} />
          {entry.favorite ? t("folders.favorite") : t("folders.addFavorite")}
        </button>
        <button type="button" className={styles.chip} aria-expanded={open} data-active={entry.folder ? "" : undefined} onClick={() => setOpen(!open)}>
          <Folder size={14} />
          {entry.folder ?? t("folders.addToFolder")}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.panel}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: easeOut }}
          >
            <div className={styles.panelInner}>
              {folders.length > 0 && (
                <div className={styles.folders}>
                  {folders.map((folder) => (
                    <button key={folder.name} type="button" aria-pressed={entry.folder === folder.name} onClick={() => setFolder(folder.name)}>
                      {entry.folder === folder.name ? <Check size={13} /> : <Folder size={13} />}
                      {folder.name}
                    </button>
                  ))}
                </div>
              )}
              <form className={styles.create} onSubmit={create}>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("folders.newPlaceholder")} aria-label={t("folders.new")} maxLength={40} />
                <button type="submit" disabled={!cleanFolder(name)} aria-label={t("folders.new")}>
                  <FolderPlus size={17} />
                </button>
              </form>
              {entry.folder && (
                <button type="button" className={styles.remove} onClick={() => setFolder(undefined)}>
                  <X size={13} /> {t("folders.remove")}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
