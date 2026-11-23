import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, BookOpen, CalendarDays, Car, FolderLock, HandCoins, HeartPulse, House, Receipt, RotateCcw, Sprout, Store, Wallet, WalletCards, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { Toggle } from "@/components/Toggle";
import { useSheetKeyboard } from "@/hooks/useSheetKeyboard";
import { useShortcutKeys } from "@/hooks/useShortcutKeys";
import { useTranslation } from "@/hooks/useTranslation";
import { arrangeShortcuts, isDefaultShortcuts, moveShortcut, normalizeShortcuts, setShortcutHidden, type HomeShortcutKey } from "@/lib/homeShortcuts";
import { spring } from "@/lib/motion";
import { useSettings } from "@/lib/settings/SettingsProvider";
import type { HistoryEntry } from "@/types/history";
import styles from "./Shortcuts.module.scss";

const noSubscribe = () => () => {};

/** What each shortcut is called in the list, and its icon. */
const meta: Record<HomeShortcutKey, { title: string; Icon: LucideIcon }> = {
  agenda: { title: "agenda.title", Icon: CalendarDays },
  food: { title: "food.title", Icon: BookOpen },
  papers: { title: "papers.title", Icon: FolderLock },
  bills: { title: "bills.title", Icon: Receipt },
  garage: { title: "garage.title", Icon: Car },
  inventory: { title: "inventory.title", Icon: House },
  plants: { title: "plants.title", Icon: Sprout },
  health: { title: "health.title", Icon: HeartPulse },
  shop: { title: "shop.title", Icon: Store },
  expenses: { title: "expenses.title", Icon: Wallet },
  pockets: { title: "expenses.pockets.title", Icon: WalletCards },
  loans: { title: "loans.title", Icon: HandCoins },
};

type Props = { open: boolean; onClose: () => void; entries: HistoryEntry[] };

/** The sheet where the home's shortcuts are shown, hidden and put in order (buttons first: they work with a keyboard and a screen reader). */
export function ShortcutsEditor({ open, onClose, entries }: Props) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(<AnimatePresence>{open && <Sheet onClose={onClose} entries={entries} />}</AnimatePresence>, document.body);
}

function Sheet({ onClose, entries }: Omit<Props, "open">) {
  const { t } = useTranslation();
  const id = useId();
  const backdrop = useSheetKeyboard();
  const { settings, update } = useSettings();
  const available = useShortcutKeys(entries);
  const pref = normalizeShortcuts(settings.homeShortcuts);
  const { all, visible } = arrangeShortcuts(available, pref);
  // Said aloud after a move, since the list changes under the user's finger.
  const [said, setSaid] = useState("");
  const [moved, setMoved] = useState<{ key: string; step: -1 | 1 } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The button just pressed follows its row, so a keyboard user can press it again.
  useEffect(() => {
    if (!moved) return;
    const wanted = document.querySelector<HTMLButtonElement>(`[data-move="${moved.key}:${moved.step}"]`);
    const other = document.querySelector<HTMLButtonElement>(`[data-move="${moved.key}:${-moved.step}"]`);
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [moved, settings.homeShortcuts]);

  const name = (key: string) => t(meta[key as HomeShortcutKey].title);
  const move = (key: string, step: -1 | 1) => {
    const next = moveShortcut(pref, available, key, step);
    update({ homeShortcuts: next });
    setMoved({ key, step });
    setSaid(t("shortcuts.moved", { name: name(key), position: arrangeShortcuts(available, next).all.indexOf(key) + 1, total: all.length }));
  };

  return (
    <motion.div ref={backdrop} className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetTop}>
          <h2 id={id}>{t("shortcuts.editTitle")}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("shortcuts.close")}>
            <X size={18} />
          </button>
        </div>
        <p className={styles.editHint}>{t("shortcuts.editHint")}</p>

        <ul className={styles.list}>
          {all.map((key, index) => {
            const { Icon } = meta[key as HomeShortcutKey];
            const shown = visible.includes(key);
            return (
              <li key={key} className={styles.item} data-hidden={!shown || undefined}>
                <Icon size={18} className={styles.itemIcon} aria-hidden />
                <span className={styles.itemName}>{name(key)}</span>
                <span className={styles.moves}>
                  <button type="button" data-move={`${key}:-1`} onClick={() => move(key, -1)} disabled={index === 0} aria-label={t("shortcuts.up", { name: name(key) })}>
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" data-move={`${key}:1`} onClick={() => move(key, 1)} disabled={index === all.length - 1} aria-label={t("shortcuts.down", { name: name(key) })}>
                    <ArrowDown size={16} />
                  </button>
                </span>
                <Toggle checked={shown} onChange={(on) => update({ homeShortcuts: setShortcutHidden(pref, key, !on) })} label={t("shortcuts.show", { name: name(key) })} />
              </li>
            );
          })}
        </ul>
        <p className="visually-hidden" role="status" aria-live="polite">
          {said}
        </p>
        {visible.length === 0 && <p className={styles.empty}>{t("shortcuts.allHidden")}</p>}

        <div className={styles.editActions}>
          <Button variant="secondary" icon={<RotateCcw />} onClick={() => update({ homeShortcuts: { hidden: [], order: [] } })} disabled={isDefaultShortcuts(pref)}>
            {t("shortcuts.reset")}
          </Button>
          <Button onClick={onClose}>{t("shortcuts.done")}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The same sheet, from Réglages → Apparence. */
export function ShortcutsSettings({ entries }: { entries: HistoryEntry[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-label={t("shortcuts.editAria")}>
        {t("shortcuts.edit")}
      </Button>
      <ShortcutsEditor open={open} onClose={() => setOpen(false)} entries={entries} />
    </>
  );
}
