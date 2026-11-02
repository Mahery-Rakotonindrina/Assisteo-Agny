import Link from "next/link";
import { BookOpen, Car, FolderLock, HandCoins, House, Receipt, Sprout, Wallet } from "lucide-react";
import { PlanBadge } from "@/components/PlanBadge";
import { useKeptExpenses } from "@/hooks/useExpenses";
import { useHomeItems } from "@/hooks/useHomeItems";
import { useInHousehold } from "@/hooks/useHousehold";
import { useKeptLoans, useLoans } from "@/hooks/useLoans";
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
  const inHousehold = useInHousehold();
  // Without the feature, one's kept expenses stay reachable (read only); false until mounted.
  const keptExpenses = useKeptExpenses(!has("expenses"));
  const { vehicles } = useVehicles();
  const keptLoans = useKeptLoans(!has("loans"));
  const { loans } = useLoans();
  const owed = loanTotals(loansByPerson(loans, "lent", now));
  const { plants } = usePlants();
  const toWater = plants.filter((plant) => needsWater(plant, now)).length;
  const garageDue = vehicles.reduce((count, vehicle) => count + dueReminders(vehicle, now).length, 0);
  const { items: homeItems } = useHomeItems();

  return (
    <nav className={styles.shortcuts} aria-label={t("shortcuts.label")}>
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
      <Link href="/papers" className={styles.shortcut} style={{ "--tone": "var(--cat-document)" } as React.CSSProperties}>
        <FolderLock size={18} />
        <span>
          <strong>{t("papers.title")}</strong>
          <small data-urgent={urgent > 0 || undefined}>
            {urgent > 0 ? t("papers.shortcutUrgent", { count: urgent }) : papers.length > 0 ? t("papers.count", { count: papers.length }) : t("shortcuts.papersHint")}
          </small>
        </span>
      </Link>
      {bills.length > 0 && (
        <Link href="/papers?tab=bills" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
          <Receipt size={18} />
          <span>
            <strong>{t("bills.title")}</strong>
            <small>{toPay > 0 ? t("bills.shortcutToPay", { amount: formatAriary(toPay, locale) }) : t("bills.shortcutPaid")}</small>
          </span>
        </Link>
      )}
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
      <Link href="/inventory" className={styles.shortcut} style={{ "--tone": "var(--cat-object)" } as React.CSSProperties}>
        <House size={18} />
        <span>
          <strong>{t("inventory.title")}</strong>
          <small>
            {!has("inventory") ? <PlanBadge plan={planFor("inventory")} /> : homeItems.length > 0 ? t("inventory.count", { count: homeItems.length }) : t("shortcuts.inventoryHint")}
          </small>
        </span>
      </Link>
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
      {(has("expenses") || inHousehold || keptExpenses) && (
        <Link href="/expenses" className={styles.shortcut} style={{ "--tone": "var(--cat-food)" } as React.CSSProperties}>
          <Wallet size={18} />
          <span>
            <strong>{t("expenses.title")}</strong>
            <small>{t("shortcuts.expensesHint")}</small>
          </span>
        </Link>
      )}
      {(has("loans") || keptLoans) && (
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
      )}
    </nav>
  );
}
