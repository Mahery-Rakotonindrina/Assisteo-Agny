import Link from "next/link";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { Pencil, BookOpen, CalendarDays, Car, FolderLock, Store, HandCoins, HeartPulse, House, Receipt, Sprout, Wallet, WalletCards } from "lucide-react";
import { PlanBadge } from "@/components/PlanBadge";
import { useHomeItems } from "@/hooks/useHomeItems";
import { useLoans } from "@/hooks/useLoans";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useVehicles } from "@/hooks/useVehicles";
import { usePlants } from "@/hooks/usePlants";
import { journalDay, totalIntake } from "@/lib/food";
import { billTotals, listBills } from "@/lib/bills";
import { formatAriary, formatNumber } from "@/lib/format";
import { dueReminders } from "@/lib/garage";
import { loanMoney, loansByPerson, loanTotals } from "@/lib/loans";
import { listPapers } from "@/lib/papers";
import { needsWater } from "@/lib/plants";
import { healthOverview } from "@/lib/health";
import { arrangeShortcuts, normalizeShortcuts, type HomeShortcutKey } from "@/lib/homeShortcuts";
import { useShortcutKeys } from "@/hooks/useShortcutKeys";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { ShortcutsEditor } from "./ShortcutsEditor";
import type { HistoryEntry } from "@/types/history";
import styles from "./Shortcuts.module.scss";

/** The tools built on the scans (food journal, papers, bills, garage), with what they hold today. */
export function Shortcuts({ entries }: { entries: HistoryEntry[] }) {
  const { t, locale } = useTranslation();
  const now = useNow(60_000);
  const eaten = journalDay(entries, now);
  const papers = listPapers(entries, now);
  const urgent = papers.filter((paper) => paper.status === "expired" || paper.status === "soon").length;
  const bills = listBills(entries, now);
  const { toPay } = billTotals(bills, now);
  const { has, planFor } = usePlan();
  const { vehicles } = useVehicles();
  const { loans } = useLoans();
  const owed = loanTotals(loansByPerson(loans, "lent", now));
  const { plants } = usePlants();
  const toWater = plants.filter((plant) => needsWater(plant, now)).length;
  const garageDue = vehicles.reduce((count, vehicle) => count + dueReminders(vehicle, now).length, 0);
  const { items: homeItems } = useHomeItems();
  // "Ma santé", for everyone (the emergency card): the treatments in progress, if any.
  const health = healthOverview(entries, now);
  const { settings } = useSettings();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const available = useShortcutKeys(entries);
  const { visible } = arrangeShortcuts(available, normalizeShortcuts(settings.homeShortcuts));

  // What each shortcut shows; which ones appear, and in what order, comes from lib/homeShortcuts.ts.
  const items: Partial<Record<HomeShortcutKey, ReactNode>> = {
    agenda: (
      <Link href="/agenda" className={styles.shortcut} style={{ "--tone": "var(--accent-text)" } as React.CSSProperties}>
        <CalendarDays size={18} />
        <span>
          <strong>{t("agenda.title")}</strong>
          <small>{t("shortcuts.agendaHint")}</small>
        </span>
      </Link>
    ),
    food: (
      <Link href="/food" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
        <BookOpen size={18} />
        <span>
          <strong>{t("food.title")}</strong>
          <small>
            {eaten.length > 0
              ? t("food.todayKcal", { count: formatNumber(Math.round(totalIntake(eaten).calories), locale) })
              : t("shortcuts.foodHint")}
          </small>
        </span>
      </Link>
    ),
    papers: (
      <Link href="/papers" className={styles.shortcut} style={{ "--tone": "var(--cat-document)" } as React.CSSProperties}>
        <FolderLock size={18} />
        <span>
          <strong>{t("papers.title")}</strong>
          <small data-urgent={urgent > 0 || undefined}>
            {urgent > 0 ? t("papers.shortcutUrgent", { count: urgent }) : papers.length > 0 ? t("papers.count", { count: papers.length }) : t("shortcuts.papersHint")}
          </small>
        </span>
      </Link>
    ),
    bills: (
      <Link href="/papers?tab=bills" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
        <Receipt size={18} />
        <span>
          <strong>{t("bills.title")}</strong>
          <small>{toPay > 0 ? t("bills.shortcutToPay", { amount: formatAriary(toPay, locale) }) : t("bills.shortcutPaid")}</small>
        </span>
      </Link>
    ),
    garage: (
      <Link href="/garage" className={styles.shortcut} style={{ "--tone": "var(--cat-vehicle)" } as React.CSSProperties}>
        <Car size={18} />
        <span>
          <strong>{t("garage.title")}</strong>
          <small data-urgent={(has("garage") && garageDue > 0) || undefined}>
            {!has("garage") ? (
              <PlanBadge plan={planFor("garage")} />
            ) : garageDue > 0 ? (
              t("garage.shortcutDue", { count: garageDue })
            ) : vehicles.length > 0 ? (
              t("garage.count", { count: vehicles.length })
            ) : (
              t("shortcuts.garageHint")
            )}
          </small>
        </span>
      </Link>
    ),
    inventory: (
      <Link href="/inventory" className={styles.shortcut} style={{ "--tone": "var(--cat-object)" } as React.CSSProperties}>
        <House size={18} />
        <span>
          <strong>{t("inventory.title")}</strong>
          <small>
            {!has("inventory") ? <PlanBadge plan={planFor("inventory")} /> : homeItems.length > 0 ? t("inventory.count", { count: homeItems.length }) : t("shortcuts.inventoryHint")}
          </small>
        </span>
      </Link>
    ),
    plants: (
      <Link href="/plants" className={styles.shortcut} style={{ "--tone": "var(--cat-plant)" } as React.CSSProperties}>
        <Sprout size={18} />
        <span>
          <strong>{t("plants.title")}</strong>
          <small data-urgent={(has("plants") && toWater > 0) || undefined}>
            {!has("plants") ? (
              <PlanBadge plan={planFor("plants")} />
            ) : toWater > 0 ? (
              t("plants.shortcutDue", { count: toWater })
            ) : plants.length > 0 ? (
              t("plants.count", { count: plants.length })
            ) : (
              t("shortcuts.plantsHint")
            )}
          </small>
        </span>
      </Link>
    ),
    health: (
      <Link href="/sante" className={styles.shortcut} style={{ "--tone": "var(--danger)" } as React.CSSProperties} data-testid="shortcut-health">
        <HeartPulse size={18} />
        <span>
          <strong>{t("health.title")}</strong>
          <small>{health.treatments.length > 0 ? t("health.shortcutOngoing", { count: health.treatments.length }) : t("health.shortcutHint")}</small>
        </span>
      </Link>
    ),
    shop: (
      <Link href="/boutique" className={styles.shortcut} style={{ "--tone": "var(--cat-object)" } as React.CSSProperties}>
        <Store size={18} />
        <span>
          <strong>{t("shop.title")}</strong>
          <small>{t("shortcuts.shopHint")}</small>
        </span>
      </Link>
    ),
    expenses: (
      <Link href="/expenses" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
        <Wallet size={18} />
        <span>
          <strong>{t("expenses.title")}</strong>
          <small>{t("shortcuts.expensesHint")}</small>
        </span>
      </Link>
    ),
    pockets: (
      <Link href="/pockets" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
        <WalletCards size={18} />
        <span>
          <strong>{t("expenses.pockets.title")}</strong>
          <small>{t("shortcuts.pocketsHint")}</small>
        </span>
      </Link>
    ),
    loans: (
      <Link href="/loans" className={styles.shortcut} style={{ "--tone": "var(--cat-document)" } as React.CSSProperties}>
        <HandCoins size={18} />
        <span>
          <strong>{t("loans.title")}</strong>
          <small data-urgent={owed.late > 0 || undefined}>
            {owed.late > 0
              ? t("loans.shortcutLate", { amount: loanMoney(owed.late, locale) })
              : owed.total > 0
                ? t("loans.shortcutOwed", { amount: loanMoney(owed.total, locale) })
                : t("shortcuts.loansHint")}
          </small>
        </span>
      </Link>
    ),
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <button ref={editButton} type="button" className={styles.edit} onClick={() => setEditing(true)} aria-label={t("shortcuts.editAria")}>
          <Pencil size={14} />
          {t("shortcuts.edit")}
        </button>
      </div>
      {visible.length > 0 ? (
        <nav className={styles.shortcuts} aria-label={t("shortcuts.label")}>
          {visible.map((key) => (
            <Fragment key={key}>{items[key as HomeShortcutKey]}</Fragment>
          ))}
        </nav>
      ) : (
        <p className={styles.empty}>{t("shortcuts.allHidden")}</p>
      )}
      <ShortcutsEditor
        open={editing}
        onClose={() => {
          setEditing(false);
          // Back to the button that opened the sheet.
          requestAnimationFrame(() => editButton.current?.focus());
        }}
        entries={entries}
      />
    </div>
  );
}
