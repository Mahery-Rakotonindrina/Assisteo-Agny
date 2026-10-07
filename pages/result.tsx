import Head from "next/head";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellRing,
  CalendarDays,
  Car,
  ClipboardList,
  CookingPot,
  FileText,
  Hash,
  ListChecks,
  Lock,
  MessageCircle,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  Utensils,
} from "lucide-react";
import { Button } from "@/components/Button";
import { CategoryBadge } from "@/components/CategoryBadge";
import { ReminderSheet } from "@/components/ReminderSheet";
import { ScanChat } from "@/components/ScanChat";
import { ConfidenceMeter, NutritionCard, RecipeCard, Section, SuggestionList, VehicleCard } from "@/components/Result";
import { useToast } from "@/components/Toast";
import { useHistoryEntry } from "@/hooks/useHistory";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useNow } from "@/hooks/useNow";
import { useReminderTexts } from "@/hooks/useReminderTexts";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDateTime, formatDay } from "@/lib/format";
import { pop, rise, spring, stagger } from "@/lib/motion";
import { haptics, shareText } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { cancelNotification } from "@/services/notifications";
import { cancelReminder, expiryDate, INSURANCE_NOTICE_DAYS, insuranceReminderAt, scheduleReminder } from "@/services/reminders";
import type { HistoryEntry } from "@/types/history";
import styles from "@/styles/Result.module.scss";

export default function ResultPage() {
  const router = useRouter();
  const id = router.isReady && typeof router.query.id === "string" ? router.query.id : undefined;
  const entry = useHistoryEntry(id);
  const { t } = useTranslation();

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else void router.replace("/");
  };

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

function ResultView({ entry, onBack }: { entry: HistoryEntry; onBack: () => void }) {
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const hasReminder = true;

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
    await historyStore.remove(entry.id);
    toast(t("result.deleted"));
    void router.replace("/history");
  };

  return (
    <>
      <Head>
        <title>{`${analysis.title} · ${t("meta.title")}`}</title>
      </Head>

      <div className={styles.topBar}>
        <Button variant="secondary" size="icon" className={styles.glassButton} onClick={onBack} aria-label={t("nav.back")}>
          <ArrowLeft />
        </Button>
        {meta.demo && <span className={styles.demo}>{t("result.demo")}</span>}
      </div>

      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <div className={styles.media}>
          <motion.div
            className={styles.hero}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
            <img src={entry.preview} alt={analysis.title} />
            <motion.div className={styles.heroBadge} variants={pop}>
              <CategoryBadge category={analysis.category} variant="glass" />
            </motion.div>
          </motion.div>

          {isDesktop && (
            <motion.div variants={rise} className={styles.panel}>
              {renderReminder(styles.panelButton)}
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
          <motion.header variants={rise} className={styles.header}>
            <h1>{analysis.title}</h1>
            <p className={styles.meta}>
              {formatDateTime(entry.createdAt, locale)}
              {!meta.demo && <> · {t("result.analyzedIn", { seconds: (meta.durationMs / 1000).toFixed(1) })}</>}
            </p>
            <ConfidenceMeter value={analysis.confidence} label={t("result.confidence")} />
            {meta.demo && <p className={styles.demoNote}>{t("result.demoNote")}</p>}
          </motion.header>

          <Section title={t("result.summary")} icon={<Sparkles />}>
            <p className={styles.summary}>{analysis.summary}</p>
          </Section>

          {analysis.nutrition && (
            <Section title={t("result.nutrition")} icon={<Utensils />}>
              <NutritionCard nutrition={analysis.nutrition} />
            </Section>
          )}

          {analysis.vehicle && (
            <Section title={t("result.vehicle")} icon={<Car />}>
              <VehicleCard vehicle={analysis.vehicle} />
            </Section>
          )}

          {analysis.recipe && (
            <Section title={t("result.recipe")} icon={<CookingPot />}>
              <RecipeCard recipe={analysis.recipe} />
            </Section>
          )}

          {analysis.document && (
            <Section title={`${t("result.document")} · ${analysis.document.type}`} icon={<FileText />}>
              <div className={styles.doc}>
                {analysis.document.keyPoints.length > 0 && (
                  <ul className={styles.bullets}>
                    {analysis.document.keyPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
                {analysis.document.dates.length > 0 && (
                  <div className={styles.dates}>
                    {analysis.document.dates.map((date) => (
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
              {analysis.document.actionItems.length > 0 && (
                  <div>
                    <h3 className={styles.subTitle}>
                      <ListChecks size={14} /> {t("result.actionItems")}
                    </h3>
                    <ul className={styles.checklist}>
                      {analysis.document.actionItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
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

          <Section title={t("chat.title")} icon={<MessageCircle />}>
            <ScanChat entry={entry} />
          </Section>

          {analysis.tags.length > 0 && (
            <motion.div variants={rise} className={styles.tags} aria-label={t("result.tags")}>
              {analysis.tags.map((tag, index) => (
                <motion.span
                  key={tag}
                  className={styles.tag}
                  initial={{ opacity: 0, scale: 0.6 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ ...spring, delay: index * 0.05 }}
                >
                  <Hash size={12} />
                  {tag}
                </motion.span>
              ))}
            </motion.div>
          )}

          {!isDesktop && (
            <motion.div variants={rise} className={styles.footer}>
              <Button href="/" variant="secondary" icon={<Plus />} block>
                {t("result.newScan")}
              </Button>
            </motion.div>
          )}
        </div>
      </motion.div>

      {!isDesktop && (
        <motion.div
          className={styles.actionBar}
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ ...spring, delay: 0.35 }}
        >
          {hasReminder ? (
            <>
              <Button variant="secondary" size="icon" onClick={() => void share()} aria-label={t("result.share")}>
                <Share2 />
              </Button>
              {renderReminder(styles.grow)}
            </>
          ) : (
            <Button variant="secondary" icon={<Share2 />} onClick={() => void share()} className={styles.grow}>
              {t("result.share")}
            </Button>
          )}
          <Button variant="danger" size="icon" onClick={() => void remove()} aria-label={t("result.delete")}>
            <Trash2 />
          </Button>
        </motion.div>
      )}
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

  function renderReminder(className: string) {
    if (forcedAt !== null) {
      // Scheduled automatically; the button only appears if notifications are off.
      return (
        <Button
          variant={reminderActive ? "secondary" : "primary"}
          icon={reminderActive ? <Lock /> : <Bell />}
          onClick={reminderActive ? undefined : () => void scheduleAt(forcedAt, reminderTexts.insurance(entry))}
          className={className}
          aria-label={reminderActive ? t("reminders.forcedLabel", { date: formatDateTime(entry.reminderAt!, locale) }) : undefined}
        >
          {reminderActive ? formatDateTime(entry.reminderAt!, locale) : t("reminders.enableInsurance")}
        </Button>
      );
    }
    return (
      <Button
        variant={reminderActive ? "secondary" : "primary"}
        icon={reminderActive ? <BellRing /> : <Bell />}
        onClick={openReminder}
        className={className}
      >
        {reminderActive ? formatDateTime(entry.reminderAt!, locale) : t("result.remind")}
      </Button>
    );
  }
}
