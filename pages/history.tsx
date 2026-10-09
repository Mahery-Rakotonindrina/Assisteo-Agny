import Head from "next/head";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import { Folder, ScanLine, Search, Star } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { HistoryItem } from "@/components/HistoryItem";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { categories, type Category } from "@/lib/ai/schema";
import { exampleImage } from "@/lib/examples";
import { formatDay, startOfDay } from "@/lib/format";
import { folderList, inCollection, type Collection } from "@/lib/historyFilters";
import { easeOut, rise, spring, stagger } from "@/lib/motion";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { keepParcelThumbnails } from "@/services/parcelLinking";
import { cancelNotification } from "@/services/notifications";
import type { HistoryEntry } from "@/types/history";
import styles from "@/styles/History.module.scss";

type Filter = Category | "all";

// The "swipe left to delete" hint: shown on the first few visits, and never
// again once the user has deleted something by swiping. Decided once per
// app launch so it doesn't vanish while being read.
const SWIPE_HINT_KEY = "hint.history-swipe";
const SWIPE_HINT_VISITS = 3;
let swipeHintVisible: boolean | undefined;
const swipeHintListeners = new Set<() => void>();

function readSwipeHint() {
  if (swipeHintVisible === undefined) {
    let shown = SWIPE_HINT_VISITS;
    try {
      shown = Number(localStorage.getItem(SWIPE_HINT_KEY) ?? 0);
      if (shown < SWIPE_HINT_VISITS) localStorage.setItem(SWIPE_HINT_KEY, String(shown + 1));
    } catch {
      // Storage unavailable: don't show the hint.
    }
    swipeHintVisible = shown < SWIPE_HINT_VISITS;
  }
  return swipeHintVisible;
}

function dismissSwipeHint() {
  swipeHintVisible = false;
  try {
    localStorage.setItem(SWIPE_HINT_KEY, String(SWIPE_HINT_VISITS));
  } catch {
    // Nothing to remember.
  }
  swipeHintListeners.forEach((listener) => listener());
}

function subscribeSwipeHint(listener: () => void) {
  swipeHintListeners.add(listener);
  return () => {
    swipeHintListeners.delete(listener);
  };
}

export default function HistoryPage() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { entries, isLoading } = useHistory();
  const [filter, setFilter] = useState<Filter>("all");
  // Favourites or a folder, on top of the category.
  const [collection, setCollection] = useState<Collection>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const showSwipeHint = useSyncExternalStore(subscribeSwipeHint, readSwipeHint, () => false);
  const now = useNow();
  const isDesktop = useIsDesktop();

  const counts = useMemo(() => {
    const byCategory = new Map<Category, number>();
    entries.forEach((entry) => byCategory.set(entry.analysis.category, (byCategory.get(entry.analysis.category) ?? 0) + 1));
    return byCategory;
  }, [entries]);

  const groups = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const visible = entries.filter((entry) => {
      if (filter !== "all" && entry.analysis.category !== filter) return false;
      if (!inCollection(entry, collection)) return false;
      if (!needle) return true;
      const { title, summary, tags } = entry.analysis;
      return [title, summary, ...tags].some((text) => text.toLowerCase().includes(needle));
    });

    const today = startOfDay(now);
    const byDay = new Map<number, HistoryEntry[]>();
    visible.forEach((entry) => {
      const day = startOfDay(entry.createdAt);
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
    });

    return [...byDay.entries()].map(([day, items]) => ({
      day,
      label: day === today ? t("history.today") : day === today - 86_400_000 ? t("history.yesterday") : formatDay(day, locale),
      items,
    }));
  }, [collection, deferredQuery, entries, filter, locale, now, t]);

  const remove = async (entry: HistoryEntry) => {
    dismissSwipeHint();
    if (entry.reminderId) await cancelNotification(entry.reminderId);
    await keepParcelThumbnails([entry.id]).catch(() => undefined);
    await historyStore.remove(entry.id);
    toast(t("result.deleted"));
  };

  const filters: Filter[] = ["all", ...categories.filter((category) => counts.has(category))];
  const favorites = entries.filter((entry) => entry.favorite).length;
  const folders = folderList(entries);
  const collections: Array<{ value: Collection; label: string; count: number; icon: React.ReactNode }> = [
    ...(favorites > 0 ? [{ value: "favorites" as const, label: t("folders.favorites"), count: favorites, icon: <Star size={13} /> }] : []),
    ...folders.map((folder) => ({ value: `folder:${folder.name}` as Collection, label: folder.name, count: folder.count, icon: <Folder size={13} /> })),
  ];

  return (
    <>
      <Head>
        <title>{`${t("history.title")} · ${t("meta.title")}`}</title>
      </Head>

      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("history.title")}</h1>
          {entries.length > 0 && <p>{t("history.count", { count: entries.length })}</p>}
        </motion.header>

        {!isLoading && entries.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("history.emptyTitle")}
              body={t("history.emptyBody")}
              images={[exampleImage("food"), exampleImage("document"), exampleImage("object")]}
              action={
                <Button href="/" icon={<ScanLine />}>
                  {t("history.emptyCta")}
                </Button>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.div variants={rise} className={styles.tools}>
              <label className={styles.search}>
                <Search size={18} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("history.search")}
                  aria-label={t("history.search")}
                />
              </label>
              <div className={styles.filters} role="tablist">
                {filters.map((value) => {
                  const active = filter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                      style={value !== "all" ? ({ "--cat": `var(--cat-${value})` } as React.CSSProperties) : undefined}
                      onClick={() => {
                        haptics.tap();
                        setFilter(value);
                      }}
                    >
                      {active && <motion.span layoutId="history-filter" className={styles.chipPill} transition={spring} />}
                      <span className={styles.chipLabel}>
                        {value !== "all" && <span className={styles.dot} />}
                        {value === "all" ? t("history.all") : t(`categories.${value}`)}
                        <span className={styles.chipCount}>{value === "all" ? entries.length : counts.get(value)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {collections.length > 0 && (
                <div className={styles.collections} role="group" aria-label={t("folders.title")}>
                  {collections.map(({ value, label, count, icon }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={collection === value}
                      onClick={() => {
                        haptics.tap();
                        setCollection(collection === value ? "all" : value);
                      }}
                    >
                      {icon}
                      {label}
                      <span>{count}</span>
                    </button>
                  ))}
                </div>
              )}
              {showSwipeHint && <p className={styles.hint}>{t("history.swipeHint")}</p>}
            </motion.div>

            {groups.length === 0 && !isLoading ? (
              <p className={styles.noMatch}>{t("history.noMatch")}</p>
            ) : (
              <div className={styles.groups}>
                <AnimatePresence initial={false}>
                  {groups.map((group) => (
                    <motion.section
                      key={group.day}
                      layout
                      className={styles.group}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <h2 className={styles.day}>{group.label}</h2>
                      <div className={styles.items}>
                        <AnimatePresence initial={false}>
                          {group.items.map((entry, index) => (
                            <motion.div
                              key={entry.id}
                              layout
                              initial={{ opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: easeOut, delay: Math.min(index, 8) * 0.04 } }}
                              exit={
                                isDesktop
                                  ? { opacity: 0, scale: 0.9, transition: { duration: 0.2, ease: easeOut } }
                                  : { opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.25, ease: easeOut } }
                              }
                              className={styles.row}
                            >
                              <HistoryItem
                                entry={entry}
                                variant={isDesktop ? "tile" : "row"}
                                onDelete={(item) => void remove(item)}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.section>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}
