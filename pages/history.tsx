import Head from "next/head";
import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
import { CalendarDays, CheckCheck, FileDown, Folder, ScanLine, Search, Star, X } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { HistoryItem } from "@/components/HistoryItem";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { categories, type Category } from "@/lib/ai/schema";
import { exampleImage } from "@/lib/examples";
import { formatDay, startOfDay } from "@/lib/format";
import { datePresets, dateRange, folderList, inCollection, inRange, type Collection, type DatePreset } from "@/lib/historyFilters";
import { easeOut, rise, spring, stagger } from "@/lib/motion";
import { planFor } from "@/lib/plans";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { exportHistoryPdf } from "@/services/historyPdf";
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
  // A period: the last days, this month, or dates picked by the user.
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Selection mode: tick scans, then export them as one PDF (Lite and up).
  const { has } = usePlan();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
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
    const range = dateRange(datePreset, now, from, to);
    const visible = entries.filter((entry) => {
      if (filter !== "all" && entry.analysis.category !== filter) return false;
      if (!inCollection(entry, collection)) return false;
      if (!inRange(entry.createdAt, range)) return false;
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
  }, [collection, datePreset, deferredQuery, entries, filter, from, locale, now, t, to]);

  const remove = async (entry: HistoryEntry) => {
    dismissSwipeHint();
    if (entry.reminderId) await cancelNotification(entry.reminderId);
    await keepParcelThumbnails([entry.id]).catch(() => undefined);
    await historyStore.remove(entry.id);
    toast(t("result.deleted"));
  };

  const visibleEntries = groups.flatMap((group) => group.items);
  const toggle = (entry: HistoryEntry) => {
    haptics.tap();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const exportSelected = async () => {
    haptics.press();
    setExporting(true);
    try {
      const outcome = await exportHistoryPdf(
        entries.filter((entry) => selected.has(entry.id)),
        t,
        locale,
      );
      if (outcome === "downloaded") toast(t("pdf.downloaded"));
      if (outcome !== "cancelled") stopSelecting();
    } catch {
      toast(t("pdf.failed"), "error");
    } finally {
      setExporting(false);
    }
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
          <div className={styles.headerRow}>
            <h1>{t("history.title")}</h1>
            {entries.length > 0 &&
              !selecting &&
              (has("pdfExport") ? (
                <Button variant="secondary" size="md" icon={<FileDown />} onClick={() => setSelecting(true)}>
                  {t("historyPdf.export")}
                </Button>
              ) : (
                <Button variant="secondary" size="md" icon={<FileDown />} href="/plans">
                  {t("historyPdf.export")} <PlanBadge plan={planFor("pdfExport")} />
                </Button>
              ))}
          </div>
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
              <div className={styles.dates} role="group" aria-label={t("history.dates.label")}>
                <CalendarDays size={15} aria-hidden />
                {datePresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={datePreset === preset}
                    onClick={() => {
                      haptics.tap();
                      setDatePreset(preset);
                    }}
                  >
                    {t(`history.dates.${preset}`)}
                  </button>
                ))}
              </div>
              {datePreset === "custom" && (
                <div className={styles.dateFields}>
                  <label>
                    <span>{t("history.dates.from")}</span>
                    <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
                  </label>
                  <label>
                    <span>{t("history.dates.to")}</span>
                    <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
                  </label>
                </div>
              )}
              {showSwipeHint && <p className={styles.hint}>{t("history.swipeHint")}</p>}
            </motion.div>

            {selecting && (
              <div className={styles.selectBar} role="toolbar" aria-label={t("historyPdf.export")}>
                <span>{t("historyPdf.selected", { count: selected.size })}</span>
                <button
                  type="button"
                  className={styles.selectAll}
                  onClick={() => setSelected(selected.size === visibleEntries.length ? new Set() : new Set(visibleEntries.map((entry) => entry.id)))}
                >
                  <CheckCheck size={15} />
                  {selected.size === visibleEntries.length && visibleEntries.length > 0 ? t("historyPdf.none") : t("historyPdf.all")}
                </button>
                <Button size="md" icon={<FileDown />} onClick={() => void exportSelected()} disabled={selected.size === 0 || exporting}>
                  {exporting ? t("pdf.making") : t("historyPdf.makePdf")}
                </Button>
                <button type="button" className={styles.selectClose} onClick={stopSelecting} aria-label={t("common.cancel")}>
                  <X size={18} />
                </button>
              </div>
            )}

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
                                onDelete={selecting ? undefined : (item) => void remove(item)}
                                onToggle={selecting ? toggle : undefined}
                                selected={selected.has(entry.id)}
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
