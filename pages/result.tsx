import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bell,
  BellRing,
  CalendarDays,
  Camera,
  Car,
  ClipboardList,
  CookingPot,
  FileText,
  Files,
  Hash,
  HeartPulse,
  ListChecks,
  ListPlus,
  Lock,
  Maximize2,
  MessageCircle,
  Package,
  PackageCheck,
  PackagePlus,
  Plus,
  QrCode,
  RefreshCw,
  ScanText,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Utensils,
} from "lucide-react";
import { Button } from "@/components/Button";
import { DeepAnalysis } from "@/components/DeepAnalysis";
import { CategoryBadge } from "@/components/CategoryBadge";
import { CodeList } from "@/components/CodeList";
import { DocumentText } from "@/components/DocumentText";
import { PhotoViewer } from "@/components/PhotoViewer";
import { ReminderSheet } from "@/components/ReminderSheet";
import { ScanChat } from "@/components/ScanChat";
import {
  AnswerFeedback,
  ConfidenceBadge,
  DietCard,
  MealLogger,
  PaperControls,
  RecipeShopping,
  confidenceLevel,
  NutritionCard,
  ParcelCard,
  RecipeCard,
  ResultTabs,
  Section,
  SuggestionList,
  VehicleCard,
  type ResultTab,
} from "@/components/Result";
import { useToast } from "@/components/Toast";
import { useHistory, useHistoryEntry } from "@/hooks/useHistory";
import { useLists } from "@/hooks/useLists";
import { useParcels } from "@/hooks/useParcels";
import { usePlan } from "@/hooks/usePlan";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNow } from "@/hooks/useNow";
import { useReminderTexts } from "@/hooks/useReminderTexts";
import { useTranslation } from "@/hooks/useTranslation";
import { exampleEntry, isExampleId } from "@/lib/examples";
import { dietAlerts, hasDietAlert } from "@/lib/food";
import { sameParcel } from "@/lib/parcels";
import { formatDateTime, formatDay } from "@/lib/format";
import { easeOut, pop, rise, spring, stagger } from "@/lib/motion";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics, shareText } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { listStore } from "@/services/listStore";
import { keepParcelThumbnails } from "@/services/parcelLinking";
import { hasNewStatus, parcelStore } from "@/services/parcelStore";
import { cancelNotification } from "@/services/notifications";
import { foodJournal } from "@/services/foodJournal";
import { cancelReminder, expiryDate, INSURANCE_NOTICE_DAYS, insuranceReminderAt, scheduleReminder } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import styles from "@/styles/Result.module.scss";

type TabId = "overview" | "list" | "parcel" | "nutrition" | "recipe" | "vehicle" | "document" | "text" | "chat";

/** Photos of these kinds rarely hold text worth reading in full. */
const withoutText = new Set(["food", "vehicle", "plant"]);
type Action = "reminder" | "question" | "parcel" | "list" | "meal";

/** Gap between the header and the tabs (the .content flex gap). */
const CONTENT_GAP = 16;

export default function ResultPage() {
  const router = useRouter();
  const id = router.isReady && typeof router.query.id === "string" ? router.query.id : undefined;
  const entry = useHistoryEntry(id);
  const { t, locale } = useTranslation();
  // Example scans (from the home screen) open read-only, never from the history.
  const example = router.isReady && isExampleId(router.query.example) ? router.query.example : null;

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else void router.replace("/");
  };

  if (example) return <ResultView entry={exampleEntry(example, locale)} onBack={goBack} example />;

  if (entry === null) {
    return (
      <div className={styles.missing}>
        <h1>{t("result.notFound")}</h1>
        <p>{t("result.notFoundHint")}</p>
        <Button href="/" icon={<Plus />}>
          {t("result.newScan")}
        </Button>
      </div>
    );
  }

  if (!entry) return <div className={styles.skeleton} aria-busy />;

  return <ResultView entry={entry} onBack={goBack} />;
}

function ResultView({ entry, onBack, example = false }: { entry: HistoryEntry; onBack: () => void; example?: boolean }) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(15_000);
  const { analysis, meta } = entry;
  const reminderActive = Boolean(entry.reminderAt && entry.reminderAt > now);
  // Insurance documents get a mandatory notice 5 days before expiry: not editable.
  const forcedAt = insuranceReminderAt(analysis, now);
  const isDesktop = useIsDesktop();
  const reminderTexts = useReminderTexts();
  const level = confidenceLevel(analysis.confidence);
  const tabsId = useId();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  // A parcel opens on its tracking details.
  const [tab, setTab] = useState<TabId>(analysis.parcel ? "parcel" : analysis.list ? "list" : "overview");
  const [composerFocused, setComposerFocused] = useState(false);
  const [barSolid, setBarSolid] = useState(false);
  const [barTitled, setBarTitled] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  // The full-screen photo is part of the URL (?photo=1, ?photo=2 for the
  // second page…), so the phone's back button closes it instead of leaving.
  const photos = [entry.preview, ...(entry.pages ?? [])];
  const photoNumber = Number(router.query.photo);
  const photoOpen = Number.isInteger(photoNumber) && photoNumber >= 1;
  const openedPhotoHere = useRef(false);
  const openPhoto = (index = 0) => {
    haptics.tap();
    openedPhotoHere.current = true;
    void router.push({ pathname: router.pathname, query: { ...router.query, photo: String(index + 1) } }, undefined, { shallow: true, scroll: false });
  };
  const closePhoto = () => {
    if (openedPhotoHere.current) {
      openedPhotoHere.current = false;
      router.back();
      return;
    }
    const query = { ...router.query };
    delete query.photo;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true, scroll: false });
  };
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Mobile top bar: see-through over the photo, solid once the photo has
  // scrolled away (so its buttons never sit on text), and showing the title
  // once the page title has passed under it.
  useEffect(() => {
    const hero = heroRef.current;
    const title = titleRef.current;
    if (!hero || !title || isDesktop) return;
    const barHeight = barRef.current?.offsetHeight ?? 64;
    const above = (item: IntersectionObserverEntry) => !item.isIntersecting && item.boundingClientRect.top < barHeight;
    // The photo counts as gone a little before it fully leaves: its bottom fades into the page.
    const heroObserver = new IntersectionObserver(([item]) => setBarSolid(above(item)), {
      rootMargin: `-${barHeight + 48}px 0px 0px 0px`,
    });
    const titleObserver = new IntersectionObserver(([item]) => setBarTitled(above(item)), { rootMargin: `-${barHeight}px 0px 0px 0px` });
    heroObserver.observe(hero);
    titleObserver.observe(title);
    return () => {
      heroObserver.disconnect();
      titleObserver.disconnect();
    };
  }, [isDesktop]);

  // A tap on delete asks for a second tap; the question goes away on its own.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const tabs = [
    { id: "overview", label: t("result.tabs.overview"), icon: <Sparkles /> },
    analysis.list && { id: "list", label: t("result.tabs.list"), icon: <ListChecks /> },
    analysis.parcel && { id: "parcel", label: t("result.tabs.parcel"), icon: <Package /> },
    (analysis.nutrition || analysis.diet) && { id: "nutrition", label: t("result.tabs.nutrition"), icon: <Utensils /> },
    analysis.recipe && { id: "recipe", label: t("result.tabs.recipe"), icon: <CookingPot /> },
    analysis.vehicle && { id: "vehicle", label: t("result.tabs.vehicle"), icon: <Car /> },
    analysis.document && { id: "document", label: t("result.tabs.document"), icon: <FileText /> },
    // The full text, to copy or translate.
    !example && !withoutText.has(analysis.category) && { id: "text", label: t("result.tabs.text"), icon: <ScanText /> },
    // Examples aren't real scans: nothing to ask the AI about.
    !example && { id: "chat", label: t("result.tabs.chat"), icon: <MessageCircle />, dot: (entry.chat?.length ?? 0) > 0 },
  ].filter(Boolean) as ResultTab[];

  const changeTab = (next: TabId) => {
    setTab(next);
    // Once the tabs are stuck at the top, show the new panel from its start.
    const header = headerRef.current;
    if (!header) return;
    const offset = isDesktop ? 16 : (barRef.current?.offsetHeight ?? 64);
    const top = header.getBoundingClientRect().bottom + window.scrollY + CONTENT_GAP - offset;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "instant" });
  };

  const openQuestion = () => {
    haptics.tap();
    changeTab("chat");
    // After the panel has mounted.
    setTimeout(() => document.getElementById(`chat-${entry.id}`)?.focus({ preventScroll: false }), 320);
  };

  // What people most likely want next: a reminder for documents, vehicles and
  // plants that need care; otherwise asking about what they just scanned.
  // Parcels: the followed list ("Mes colis") and earlier scans of the same parcel.
  const { parcels } = useParcels();
  const { entries } = useHistory();
  const trackedParcel = analysis.parcel ? parcels.find((parcel) => sameParcel(parcel.info, analysis.parcel)) : undefined;
  const parcelHasNews = trackedParcel ? hasNewStatus(trackedParcel, analysis.parcel) : false;
  const earlierScans = analysis.parcel
    ? entries.filter((other) => other.id !== entry.id && other.createdAt < entry.createdAt && sameParcel(other.analysis.parcel, analysis.parcel))
    : [];

  const parcelLimit = usePlan().plan?.limits.parcels ?? 0;
  // "Mes listes": the list read on this scan, kept once.
  const { lists } = useLists();
  const savedList = lists.find((list) => list.scanId === entry.id);
  const addList = async () => {
    haptics.success();
    await listStore.addFromScan(entry);
    toast(t("lists.added"));
  };

  const addParcel = async () => {
    // Parcels followed at once (not received yet), per plan; 0 = no limit.
    if (parcelLimit > 0 && parcels.filter((parcel) => !parcel.receivedAt).length >= parcelLimit) {
      haptics.error();
      toast(t("parcel.limitReached", { count: parcelLimit }), "error");
      void router.push("/plans");
      return;
    }
    haptics.success();
    await parcelStore.add(entry);
    toast(t("parcel.added"));
  };
  const updateParcel = async () => {
    if (!trackedParcel) return;
    haptics.success();
    await parcelStore.applyScan(trackedParcel, entry);
    toast(t("parcel.updated", { status: t(`parcel.statuses.${analysis.parcel!.status}`) }));
  };

  // Food: the allergies and diets of the user, and the meals already logged today.
  const { settings } = useSettings();
  const alerts = dietAlerts(analysis.diet, settings);
  const eatenToday = (entry.meals ?? []).some((log) => new Date(log.at).toDateString() === new Date(now).toDateString());
  const logMeal = async () => {
    haptics.success();
    await foodJournal.add(entry.id);
    toast(t("food.loggedShort"));
  };

  const reminderFirst =
    forcedAt !== null ||
    reminderActive ||
    analysis.category === "document" ||
    analysis.category === "vehicle" ||
    (analysis.category === "plant" && analysis.reminder !== null);
  const actions = (
    example
      ? []
      : ((analysis.parcel
          ? ["parcel", "question"]
          : analysis.list
            ? ["list", "question"]
            : analysis.nutrition && analysis.category === "food"
              ? ["meal", "question"]
              : reminderFirst
                ? ["reminder", "question"]
                : ["question", "reminder"]) as Action[])
  ).filter(
    // The question tab has its own composer.
    (action) => !(action === "question" && tab === "chat"),
  );

  const share = async () => {
    haptics.tap();
    const lines = [
      analysis.summary,
      "",
      ...analysis.facts.map((fact) => `• ${fact.label}: ${fact.value}`),
      "",
      ...analysis.suggestions.map((suggestion) => `→ ${suggestion.title}: ${suggestion.detail}`),
      ...(analysis.recipe
        ? [
            "",
            `🍳 ${analysis.recipe.name}`,
            ...analysis.recipe.ingredients.map((ingredient) => `- ${ingredient.quantity} ${ingredient.name}`),
            "",
            ...analysis.recipe.steps.map((step, index) => `${index + 1}. ${step}`),
          ]
        : []),
    ];
    const outcome = await shareText(analysis.title, lines.join("\n"));
    if (outcome === "copied") toast(t("result.copied"));
  };

  const openReminder = () => {
    haptics.tap();
    // A fresh key resets the sheet to the current reminder each time it opens.
    setSheetKey((key) => key + 1);
    setSheetOpen(true);
  };

  const scheduleAt = async (at: number, texts = reminderTexts.other(entry)) => {
    if (!(await scheduleReminder(entry, at, texts))) {
      haptics.error();
      toast(t("result.reminderDenied"), "error");
      return false;
    }
    haptics.success();
    toast(t("result.reminderSet", { date: formatDateTime(at, locale) }));
    return true;
  };

  const removeReminder = async () => {
    await cancelReminder(entry);
    toast(t("result.reminderCancelled"));
    setSheetOpen(false);
  };

  const remove = async () => {
    haptics.press();
    if (entry.reminderId) await cancelNotification(entry.reminderId);
    await keepParcelThumbnails([entry.id]).catch(() => undefined);
    await historyStore.remove(entry.id);
    toast(t("result.deleted"));
    void router.replace("/history");
  };

  return (
    <>
      <Head>
        <title>{`${analysis.title} · ${t("meta.title")}`}</title>
      </Head>

      <div ref={barRef} className={[styles.topBar, barSolid && styles.topBarSolid, barTitled && styles.topBarTitled].filter(Boolean).join(" ")}>
        <Button variant="secondary" size="icon" className={styles.glassButton} onClick={onBack} aria-label={t("nav.back")}>
          <ArrowLeft />
        </Button>
        <span className={styles.barTitle} aria-hidden={!barTitled}>
          {analysis.title}
        </span>
        {!example && (
          <div className={styles.barActions}>
            <Button variant="secondary" size="icon" className={styles.glassButton} onClick={() => void share()} aria-label={t("result.share")}>
              <Share2 />
            </Button>
            {confirmDelete ? (
              <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
                {t("result.deleteConfirm")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="icon"
                className={styles.glassButton}
                onClick={() => {
                  haptics.tap();
                  setConfirmDelete(true);
                }}
                aria-label={t("result.delete")}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>

      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <div className={styles.media}>
          <motion.div
            ref={heroRef}
            className={styles.hero}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <button type="button" className={styles.heroOpen} onClick={() => openPhoto()} aria-label={t("result.openPhoto")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
              <img src={entry.preview} alt={analysis.title} />
            </button>
            <span className={styles.heroZoom} aria-hidden>
              <Maximize2 size={16} />
            </span>
            {(meta.pageCount ?? 1) > 1 && (
              <span className={styles.heroPages}>
                <Files size={14} /> {t("pages.short", { count: meta.pageCount ?? 1 })}
              </span>
            )}
            <motion.div className={styles.heroBadge} variants={pop}>
              <CategoryBadge category={analysis.category} variant="glass" />
            </motion.div>
          </motion.div>

          {isDesktop && example && (
            <motion.div variants={rise} className={styles.panel}>
              <Button href="/" icon={<Camera />} block>
                {t("examples.cta")}
              </Button>
            </motion.div>
          )}
          {isDesktop && !example && (
            <motion.div variants={rise} className={styles.panel}>
              {actions.map((action, index) => renderAction(action, index === 0 ? "primary" : "panel"))}
              <Button variant="secondary" icon={<Share2 />} onClick={() => void share()} block>
                {t("result.share")}
              </Button>
              <div className={styles.panelRow}>
                <Button href="/" variant="secondary" icon={<Plus />} block>
                  {t("result.newScan")}
                </Button>
                <Button variant="danger" size="icon" onClick={() => void remove()} aria-label={t("result.delete")}>
                  <Trash2 />
                </Button>
              </div>
            </motion.div>
          )}
        </div>

        <div className={styles.content}>
          <motion.header ref={headerRef} variants={rise} className={styles.header}>
            <h1 ref={titleRef}>{analysis.title}</h1>
            {example ? (
              <p className={styles.exampleNote}>{t("examples.note")}</p>
            ) : (
              <p className={styles.meta}>
                {formatDateTime(entry.createdAt, locale)}
                {!meta.demo && <> · {t("result.analyzedIn", { seconds: (meta.durationMs / 1000).toFixed(1) })}</>}
              </p>
            )}
            <ConfidenceBadge value={analysis.confidence} label={t(`result.confidenceLevels.${level}`)} />
            {!example && !meta.demo && <DeepAnalysis entry={entry} />}
            {level === "low" && (
              <div className={styles.uncertain} role="note">
                <TriangleAlert size={18} />
                <div>
                  <strong>{t("result.uncertainTitle")}</strong>
                  <p>{t("result.uncertainBody")}</p>
                  <div className={styles.uncertainActions}>
                    <Button variant="secondary" icon={<Camera />} href={`/?mode=${entry.mode}`}>
                      {t("result.retake")}
                    </Button>
                    <Button variant="ghost" icon={<SlidersHorizontal />} href="/?pick=1">
                      {t("result.pickType")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {hasDietAlert(alerts) && (
              <div className={styles.uncertain} role="alert">
                <TriangleAlert size={18} />
                <div>
                  <strong>{t("food.alertTitle")}</strong>
                  <p>
                    {[
                      alerts.allergens.length > 0 && t("food.alertAllergens", { list: alerts.allergens.map((value) => t(`food.allergens.${value}`)).join(", ") }),
                      alerts.against.length > 0 && t("food.alertDiets", { list: alerts.against.map((value) => t(`food.diets.${value}`)).join(", ") }),
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                </div>
              </div>
            )}
            {meta.demo && <p className={styles.demoNote}>{t("result.demoNote")}</p>}
          </motion.header>

          <div className={styles.tabsSticky}>
            <ResultTabs tabs={tabs} value={tab} onChange={(next) => changeTab(next as TabId)} idPrefix={tabsId} label={t("result.tabs.label")} />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              id={`${tabsId}-panel`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-tab-${tab}`}
              className={styles.panelContent}
              variants={stagger}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, transition: { duration: 0.12, ease: easeOut } }}
            >
              {renderPanel()}
            </motion.div>
          </AnimatePresence>

          {!isDesktop && !example && (
            <motion.div variants={rise} className={styles.footer}>
              <Button href="/" variant="secondary" icon={<Plus />} block>
                {t("result.newScan")}
              </Button>
            </motion.div>
          )}
        </div>
      </motion.div>

      {!isDesktop && example && (
        <motion.div className={styles.actionBar} initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring, delay: 0.2 }}>
          <Button href="/" icon={<Camera />} className={styles.grow}>
            {t("examples.cta")}
          </Button>
        </motion.div>
      )}

      <AnimatePresence>
        {!isDesktop && !composerFocused && actions.length > 0 && (
          <motion.div
            className={styles.actionBar}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ ...spring, delay: 0.2 }}
          >
            {actions.map((action, index) => renderAction(action, index === 0 ? "primary" : "secondary"))}
          </motion.div>
        )}
      </AnimatePresence>

      <PhotoViewer src={photos[photoNumber - 1] ?? entry.preview} alt={analysis.title} open={photoOpen} onClose={closePhoto} />

      <ReminderSheet
        key={sheetKey}
        open={sheetOpen}
        current={reminderActive ? entry.reminderAt : undefined}
        suggestedHours={analysis.reminder?.delayHours}
        onSchedule={async (at) => {
          if (await scheduleAt(at)) setSheetOpen(false);
        }}
        onCancelReminder={removeReminder}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );

  function renderPanel(): ReactNode {
    switch (tab) {
      case "list":
        return analysis.list && renderList(analysis.list);
      case "parcel":
        return analysis.parcel && renderParcel(analysis.parcel);
      case "nutrition":
        return (
          <>
            {analysis.nutrition && (
              <Section title={t("result.nutrition")} icon={<Utensils />}>
                <NutritionCard nutrition={analysis.nutrition} />
              </Section>
            )}
            {analysis.nutrition && !example && (
              <Section title={t("food.journalSection")} icon={<BookOpen />}>
                <MealLogger entry={entry} />
              </Section>
            )}
            {analysis.diet && (
              <Section title={t("food.dietSection")} icon={<HeartPulse />}>
                <DietCard diet={analysis.diet} />
              </Section>
            )}
          </>
        );
      case "recipe":
        return (
          analysis.recipe && (
            <Section title={t("result.recipe")} icon={<CookingPot />}>
              <RecipeCard recipe={analysis.recipe} />
              {!example && (
                <div className={styles.afterCard}>
                  <RecipeShopping entry={entry} />
                </div>
              )}
            </Section>
          )
        );
      case "vehicle":
        return (
          analysis.vehicle && (
            <Section title={t("result.vehicle")} icon={<Car />}>
              <VehicleCard vehicle={analysis.vehicle} />
            </Section>
          )
        );
      case "document":
        return analysis.document && renderDocument(analysis.document);
      case "text":
        return (
          <Section title={t("text.title")} icon={<ScanText />}>
            <DocumentText entry={entry} />
          </Section>
        );
      case "chat":
        return (
          <div
            // Hide the action bar while typing: it would sit on the keyboard.
            onFocus={() => setComposerFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerFocused(false);
            }}
          >
            <Section title={t("chat.title")} icon={<MessageCircle />}>
              <ScanChat entry={entry} />
            </Section>
          </div>
        );
      default:
        return (
          <>
            <Section title={t("result.summary")} icon={<Sparkles />}>
              <p className={styles.summary}>{analysis.summary}</p>
            </Section>

            {(meta.pageCount ?? 1) > 1 && (
              <Section title={t("pages.sectionTitle", { count: meta.pageCount ?? 1 })} icon={<Files />}>
                <div className={styles.pageStrip}>
                  {photos.map((src, index) => (
                    <button key={index} type="button" onClick={() => openPhoto(index)} aria-label={t("pages.page", { number: index + 1 })}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                      <img src={src} alt="" />
                      <span>{index + 1}</span>
                    </button>
                  ))}
                </div>
                {photos.length < (meta.pageCount ?? 1) && <p className={styles.pagesElsewhere}>{t("pages.elsewhere")}</p>}
              </Section>
            )}

            {meta.codes && meta.codes.length > 0 && (
              <Section title={t("codes.section", { count: meta.codes.length })} icon={<QrCode />}>
                <CodeList codes={meta.codes} />
              </Section>
            )}

            {analysis.facts.length > 0 && (
              <Section title={t("result.facts")} icon={<ClipboardList />}>
                <dl className={styles.facts}>
                  {analysis.facts.map((fact) => (
                    <div key={fact.label} className={styles.fact}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            {analysis.suggestions.length > 0 && (
              <Section title={t("result.suggestions")} icon={<Sparkles />}>
                <SuggestionList suggestions={analysis.suggestions} />
              </Section>
            )}

            {!example && <AnswerFeedback entry={entry} />}

            {analysis.tags.length > 0 && (
              <motion.div variants={rise} className={styles.tags} aria-label={t("result.tags")}>
                {analysis.tags.map((tag, index) => (
                  <motion.span
                    key={tag}
                    className={styles.tag}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...spring, delay: 0.2 + index * 0.05 }}
                  >
                    <Hash size={12} />
                    {tag}
                  </motion.span>
                ))}
              </motion.div>
            )}
          </>
        );
    }
  }

  function renderList(list: NonNullable<HistoryEntry["analysis"]["list"]>) {
    return (
      <Section title={`${t(`lists.kinds.${list.kind}`)} · ${t("lists.count", { count: list.items.length })}`} icon={<ListChecks />}>
        <ul className={styles.readList}>
          {list.items.map((item, index) => (
            <li key={`${index}-${item.text}`} data-done={item.done ? "" : undefined}>
              <span className={styles.readBox} aria-hidden />
              <span>{item.text}</span>
              {item.quantity && <small>{item.quantity}</small>}
            </li>
          ))}
        </ul>
        {savedList && (
          <p className={styles.readListNote}>
            <ListChecks size={14} /> {t("lists.inList")}{" "}
            <Link href={{ pathname: "/lists", query: { open: savedList.id } }}>{t("lists.open")}</Link>
          </p>
        )}
      </Section>
    );
  }

  function renderDocument(document: NonNullable<HistoryEntry["analysis"]["document"]>) {
    return (
      <Section title={`${t("result.document")} · ${document.type}`} icon={<FileText />}>
        <div className={styles.doc}>
          {document.keyPoints.length > 0 && (
            <ul className={styles.bullets}>
              {document.keyPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
          {document.dates.length > 0 && (
            <div className={styles.dates}>
              {document.dates.map((date) => (
                <span key={`${date.label}-${date.date}`} className={styles.date}>
                  <CalendarDays size={15} />
                  <span>
                    <small>{date.label}</small>
                    {date.date}
                  </span>
                </span>
              ))}
            </div>
          )}
          {forcedAt !== null && (
            <p className={styles.insurance}>
              <Lock size={15} />
              <span>
                {t("reminders.insuranceNotice", {
                  days: INSURANCE_NOTICE_DAYS,
                  expiry: formatDay(expiryDate(analysis)!, locale),
                  date: formatDateTime(entry.reminderAt && reminderActive ? entry.reminderAt : forcedAt, locale),
                })}
              </span>
            </p>
          )}
          {document.actionItems.length > 0 && (
            <div>
              <h3 className={styles.subTitle}>
                <ListChecks size={14} /> {t("result.actionItems")}
              </h3>
              <ul className={styles.checklist}>
                {document.actionItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {!example && <PaperControls entry={entry} />}
      </Section>
    );
  }

  /**
   * "primary": the main button (grows). "secondary": compact button next to it
   * in the mobile bar. "panel": full-width secondary button on desktop.
   */
  function renderParcel(parcel: NonNullable<HistoryEntry["analysis"]["parcel"]>) {
    const firstEarlier = earlierScans[earlierScans.length - 1];
    return (
      <>
        {!example && (trackedParcel || firstEarlier) && (
          <motion.div variants={rise} className={styles.parcelNote} data-news={parcelHasNews || undefined}>
            <PackageCheck size={18} />
            <div>
              {trackedParcel && parcelHasNews ? (
                <p>
                  {t("parcel.newStatus", {
                    from: t(`parcel.statuses.${trackedParcel.info.status}`),
                    to: t(`parcel.statuses.${parcel.status}`),
                  })}
                </p>
              ) : trackedParcel ? (
                <p>{t("parcel.inList", { status: t(`parcel.statuses.${trackedParcel.info.status}`) })}</p>
              ) : null}
              {firstEarlier && (
                <p className={styles.parcelEarlier}>
                  {t("parcel.earlierUpdated", { date: formatDateTime(firstEarlier.createdAt, locale) })}{" "}
                  <Link href={{ pathname: "/result", query: { id: firstEarlier.id } }}>{t("parcel.openEarlier")}</Link>
                </p>
              )}
            </div>
          </motion.div>
        )}
        <Section title={t("result.parcel")} icon={<Package />}>
          <ParcelCard parcel={parcel} />
        </Section>
      </>
    );
  }

  function renderAction(action: Action, slot: "primary" | "secondary" | "panel") {
    const className = slot === "primary" ? (isDesktop ? styles.panelButton : styles.grow) : slot === "panel" ? styles.panelButton : styles.compact;
    if (action === "parcel") {
      const variant = slot === "primary" ? "primary" : "secondary";
      if (!trackedParcel) {
        return (
          <Button key="parcel" variant={variant} icon={<PackagePlus />} onClick={() => void addParcel()} className={className}>
            {slot === "secondary" ? t("parcel.addShort") : t("parcel.add")}
          </Button>
        );
      }
      if (parcelHasNews) {
        return (
          <Button key="parcel" variant={variant} icon={<RefreshCw />} onClick={() => void updateParcel()} className={className}>
            {slot === "secondary" ? t("parcel.updateShort") : t("parcel.update")}
          </Button>
        );
      }
      return (
        <Button key="parcel" variant="secondary" icon={<PackageCheck />} href="/parcels" className={className}>
          {slot === "secondary" ? t("parcel.viewShort") : t("parcel.view")}
        </Button>
      );
    }
    if (action === "list") {
      return savedList ? (
        <Button key="list" variant="secondary" icon={<ListChecks />} href={`/lists?open=${savedList.id}`} className={className}>
          {slot === "secondary" ? t("lists.viewShort") : t("lists.view")}
        </Button>
      ) : (
        <Button key="list" variant={slot === "primary" ? "primary" : "secondary"} icon={<ListPlus />} onClick={() => void addList()} className={className}>
          {slot === "secondary" ? t("lists.addShort") : t("lists.add")}
        </Button>
      );
    }
    if (action === "meal") {
      return eatenToday ? (
        <Button key="meal" variant="secondary" icon={<BookOpen />} href="/food" className={className}>
          {slot === "secondary" ? t("food.journalShort") : t("food.inJournal")}
        </Button>
      ) : (
        <Button key="meal" variant={slot === "primary" ? "primary" : "secondary"} icon={<Utensils />} onClick={() => void logMeal()} className={className}>
          {slot === "secondary" ? t("food.ateShort") : t("food.ate")}
        </Button>
      );
    }
    if (action === "question") {
      return (
        <Button key="question" variant={slot === "primary" ? "primary" : "secondary"} icon={<MessageCircle />} onClick={openQuestion} className={className}>
          {slot === "secondary" ? t("result.askShort") : t("result.ask")}
        </Button>
      );
    }
    return renderReminder(className, slot);
  }

  function renderReminder(className: string, slot: "primary" | "secondary" | "panel") {
    const compact = slot === "secondary";
    if (forcedAt !== null) {
      // Scheduled automatically; the button only acts if notifications are off.
      return (
        <Button
          key="reminder"
          variant={reminderActive || slot !== "primary" ? "secondary" : "primary"}
          icon={reminderActive ? <Lock /> : <Bell />}
          onClick={
            reminderActive
              ? () => toast(t("reminders.forcedLabel", { date: formatDateTime(entry.reminderAt!, locale) }))
              : () => void scheduleAt(forcedAt, reminderTexts.insurance(entry))
          }
          className={`${className} ${reminderActive ? styles.reminderOn : ""}`}
          aria-label={reminderActive ? t("reminders.forcedLabel", { date: formatDateTime(entry.reminderAt!, locale) }) : undefined}
        >
          {compact ? t("result.remindShort") : reminderActive ? formatDateTime(entry.reminderAt!, locale) : t("reminders.enableInsurance")}
        </Button>
      );
    }
    const label = compact
      ? t("result.remindShort")
      : reminderActive
        ? formatDateTime(entry.reminderAt!, locale)
        : analysis.category === "vehicle"
          ? t("result.remindMaintenance")
          : t("result.remind");
    return (
      <Button
        key="reminder"
        variant={reminderActive || slot !== "primary" ? "secondary" : "primary"}
        icon={reminderActive ? <BellRing /> : <Bell />}
        onClick={openReminder}
        className={`${className} ${reminderActive ? styles.reminderOn : ""}`}
      >
        {label}
      </Button>
    );
  }
}
