import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { BellRing, CalendarDays, Car, FolderLock, HandCoins, HeartPulse, House, Package, Pill, Plus, Sprout, Syringe, Wallet, type LucideIcon } from "lucide-react";
import { Seo } from "@/components/Seo";
import { useExpenses } from "@/hooks/useExpenses";
import { useHistory } from "@/hooks/useHistory";
import { useHomeItems } from "@/hooks/useHomeItems";
import { useKeptLoans, useLoans } from "@/hooks/useLoans";
import { useNow } from "@/hooks/useNow";
import { useParcels } from "@/hooks/useParcels";
import { usePlan } from "@/hooks/usePlan";
import { usePlants } from "@/hooks/usePlants";
import { useTranslation } from "@/hooks/useTranslation";
import { useVehicles } from "@/hooks/useVehicles";
import { addDays, daysBetween, groupByDay, localDay } from "@/lib/agenda/days";
import { collectAgenda } from "@/lib/agenda/sources";
import type { AgendaItem, AgendaText } from "@/lib/agenda/types";
import type { PlanFeature } from "@/lib/plans";
import { formatAriary, formatTag, formatTime } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";
import { useSettings } from "@/lib/settings/SettingsProvider";
import styles from "@/styles/Agenda.module.scss";

/** The window: this many days, and as many more at each "Voir plus". */
const STEP_DAYS = 30;
const MAX_DAYS = 360;

/** Icon and colour of each domain; a source added later without an entry here gets the fallback. */
const domainStyle: Record<string, { icon: LucideIcon; tone: string }> = {
  reminders: { icon: BellRing, tone: "var(--accent-text)" },
  health: { icon: HeartPulse, tone: "var(--danger)" },
  vaccines: { icon: Syringe, tone: "var(--viz-1)" },
  pharmacy: { icon: Pill, tone: "var(--cat-list)" },
  loans: { icon: HandCoins, tone: "var(--cat-document)" },
  expenses: { icon: Wallet, tone: "var(--cat-food)" },
  parcels: { icon: Package, tone: "var(--cat-parcel)" },
  garage: { icon: Car, tone: "var(--cat-vehicle)" },
  home: { icon: House, tone: "var(--cat-object)" },
  papers: { icon: FolderLock, tone: "var(--cat-document)" },
  plants: { icon: Sprout, tone: "var(--cat-plant)" },
};
const fallbackStyle = { icon: CalendarDays, tone: "var(--cat-other)" };

/** "À venir": what is coming, day by day, from every part of the app, read on the device. */
export default function AgendaPage() {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const { has } = usePlan();
  const { settings } = useSettings();
  const { entries } = useHistory();
  const { loans } = useLoans();
  const { records } = useExpenses();
  const { parcels } = useParcels();
  const { vehicles } = useVehicles();
  const { items: homeItems } = useHomeItems();
  const { plants } = usePlants();
  // Loans stay reachable (read only) once their plan is off, like their shortcut.
  const keptLoans = useKeptLoans(!has("loans"));
  const [days, setDays] = useState(STEP_DAYS);
  const [filter, setFilter] = useState<string | null>(null);

  // Booleans, not `has` itself (a new function each render): the list is rebuilt only when the data, the plan or the window change, and a chip only filters it.
  const canReminders = has("reminders");
  const canExpenses = has("expenses");
  const canGarage = has("garage");
  const canHome = has("inventory");
  const canPlants = has("plants");
  const canLoans = has("loans") || keptLoans;
  const allowed = useMemo(() => {
    const granted: Partial<Record<PlanFeature, boolean>> = { reminders: canReminders, expenses: canExpenses, garage: canGarage, inventory: canHome, plants: canPlants };
    return (feature: PlanFeature) => granted[feature] ?? false;
  }, [canReminders, canExpenses, canGarage, canHome, canPlants]);

  const from = localDay(now);
  const to = addDays(from, days);

  const items = useMemo(
    () =>
      collectAgenda({
        now,
        from,
        to,
        has: allowed,
        data: { entries, appointments: settings.appointments, profiles: settings.healthProfiles, vaccines: settings.vaccines, pharmacy: settings.pharmacy, loans: canLoans ? loans : [], records, parcels, vehicles, homeItems, plants },
      }),
    [now, from, to, allowed, canLoans, entries, settings.appointments, settings.healthProfiles, settings.vaccines, settings.pharmacy, loans, records, parcels, vehicles, homeItems, plants],
  );

  const domains = useMemo(() => [...new Set(items.map((item) => item.domain))], [items]);
  const shown = filter ? items.filter((item) => item.domain === filter) : items;
  const late = shown.filter((item) => item.late).sort((a, b) => a.at - b.at);
  const coming = groupByDay(shown.filter((item) => !item.late));

  const text = (value: AgendaText) => t(value.key, value.params);
  const dayLabel = (day: number) => {
    const gap = daysBetween(now, day);
    if (gap === 0) return t("agenda.today");
    if (gap === 1) return t("agenda.tomorrow");
    return new Intl.DateTimeFormat(formatTag(locale), { weekday: "long", day: "numeric", month: "long" }).format(day);
  };
  const until = new Intl.DateTimeFormat(formatTag(locale), { day: "numeric", month: "long" }).format(to - 1);

  const row = (item: AgendaItem) => {
    const { icon: Icon, tone } = domainStyle[item.domain] ?? fallbackStyle;
    return (
      <li key={item.key}>
        <Link href={item.href} className={styles.row} style={{ "--tone": tone } as React.CSSProperties} data-late={item.late || undefined}>
          <span className={styles.icon} aria-hidden>
            <Icon size={18} />
          </span>
          <span className={styles.text}>
            <strong>{text(item.label)}</strong>
            {(item.detail || item.amountMga !== undefined) && (
              <small>{[item.detail && text(item.detail), item.amountMga !== undefined && formatAriary(item.amountMga, locale)].filter(Boolean).join(" · ")}</small>
            )}
          </span>
          {item.timed && <time className={styles.time}>{formatTime(item.at, locale)}</time>}
        </Link>
      </li>
    );
  };

  return (
    <>
      <Seo title={`${t("agenda.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("agenda.title")}</h1>
          <p>{t("agenda.lead")}</p>
        </motion.header>

        {domains.length > 1 && (
          <motion.div variants={rise} className={styles.chips} role="group" aria-label={t("agenda.filter")}>
            <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)}>
              {t("agenda.all")}
            </button>
            {domains.map((domain) => {
              const { icon: Icon, tone } = domainStyle[domain] ?? fallbackStyle;
              return (
                <button key={domain} type="button" aria-pressed={filter === domain} onClick={() => setFilter(filter === domain ? null : domain)} style={{ "--tone": tone } as React.CSSProperties}>
                  <Icon size={14} aria-hidden /> {t(`agenda.domains.${domain}`)}
                </button>
              );
            })}
          </motion.div>
        )}

        {late.length > 0 && (
          <motion.section variants={rise} className={styles.late} aria-labelledby="agenda-late">
            <h2 id="agenda-late">{t("agenda.late")}</h2>
            <ul className={styles.list}>{late.map(row)}</ul>
          </motion.section>
        )}

        {coming.length === 0 && late.length === 0 ? (
          <motion.p variants={rise} className={styles.empty}>
            {t("agenda.empty", { days })}
          </motion.p>
        ) : (
          coming.map((group) => (
            <motion.section key={group.day} variants={rise} className={styles.day} aria-label={dayLabel(group.day)}>
              <h2 data-today={daysBetween(now, group.day) === 0 || undefined}>{dayLabel(group.day)}</h2>
              <ul className={styles.list}>{group.items.map(row)}</ul>
            </motion.section>
          ))
        )}

        <motion.div variants={rise} className={styles.more}>
          <small>{t("agenda.until", { date: until })}</small>
          {days < MAX_DAYS && (
            <button type="button" onClick={() => setDays(days + STEP_DAYS)}>
              <Plus size={16} aria-hidden /> {t("agenda.more", { days: STEP_DAYS })}
            </button>
          )}
        </motion.div>
      </motion.div>
    </>
  );
}
