import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { ChevronRight, Download, HandCoins, HeartPulse, History, Package, Receipt, Store, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import { useToast } from "@/components/Toast";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseSources } from "@/hooks/useExpenseSources";
import { useHistory } from "@/hooks/useHistory";
import { useLoans } from "@/hooks/useLoans";
import { useHealthSpending } from "@/hooks/useHealthSpending";
import { useMeasures } from "@/hooks/useMeasures";
import { useParcels } from "@/hooks/useParcels";
import { useShop } from "@/hooks/useShop";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccount } from "@/lib/account/AccountProvider";
import { liveAppointments, removeAllAppointments } from "@/lib/appointments";
import { liveProfiles, removeAllProfiles } from "@/lib/healthProfiles";
import { blankCard, isCardEmpty } from "@/lib/emergencyCard";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { computedLineCount, expenseResetCounts, loanResetCounts, pocketResetCounts, shopResetCounts, type ResetScreen } from "@/lib/screenReset";
import { ResetOfflineError, resetScreen } from "@/services/screenReset";
import styles from "./ScreenReset.module.scss";

const icons: Record<ResetScreen, ReactNode> = {
  history: <History />,
  expenses: <Receipt />,
  pockets: <Wallet />,
  loans: <HandCoins />,
  parcels: <Package />,
  shop: <Store />,
  health: <HeartPulse />,
};

/** One line of "what goes": its key, with the "…One" form for a single one. */
type Line = { key: string; count?: number };

/**
 * "Remettre à zéro" in Réglages: one line per screen, each opening a window
 * that says what goes (with the counts) and what stays, then "Oui, tout
 * effacer". Only one's own data: the household's is never touched
 * (services/screenReset.ts).
 */
export function ScreenReset() {
  const { t } = useTranslation();
  const toast = useToast();
  const { has } = usePlan();
  const { session } = useAccount();
  const { entries } = useHistory();
  const { records } = useExpenses();
  const { loans } = useLoans();
  const { parcels } = useParcels();
  const { records: shopRecords } = useShop();
  const sources = useExpenseSources();
  const { settings, update } = useSettings();
  const hasCard = !isCardEmpty(settings.emergencyCard);
  const appointmentCount = liveAppointments(settings.appointments).length;
  const profileCount = liveProfiles(settings.healthProfiles).length;
  const { measures } = useMeasures();
  const { spends } = useHealthSpending();
  const hasHealth = hasCard || appointmentCount > 0 || profileCount > 0 || measures.length > 0 || spends.length > 0;
  const [open, setOpen] = useState<ResetScreen | null>(null);
  const [working, setWorking] = useState(false);

  const expenseCounts = expenseResetCounts(records);
  const pocketCounts = pocketResetCounts(records);
  const loanCounts = loanResetCounts(loans);
  const shopCounts = shopResetCounts(shopRecords);
  // The lines Dépenses takes from the scans, parcels, bills… since the last reset: only shown with "Mes dépenses".
  const computed = has("expenses") ? computedLineCount(sources) : 0;

  const goes: Record<ResetScreen, Line[]> = {
    history: [{ key: "analyses", count: entries.length }],
    expenses: [
      { key: "expenses", count: expenseCounts.expenses },
      { key: "incomes", count: expenseCounts.incomes },
      { key: "recurring", count: expenseCounts.recurring },
      { key: "savings", count: expenseCounts.savings },
      ...(expenseCounts.budget ? [{ key: "budget" }] : []),
      { key: "computed", count: computed },
    ],
    pockets: [{ key: "pockets", count: pocketCounts.pockets }, { key: "moves", count: pocketCounts.moves }, { key: "picks", count: pocketCounts.picks }],
    loans: [{ key: "loans", count: loanCounts.loans }, { key: "repayments", count: loanCounts.repayments }, { key: "proofs", count: loanCounts.proofs }, { key: "links" }],
    parcels: [{ key: "parcels", count: parcels.length }, { key: "parcelReminders" }],
    shop: [{ key: "shopSales", count: shopCounts.sales }, { key: "shopProducts", count: shopCounts.products }, { key: "shopPayments", count: shopCounts.payments }],
    health: [...(hasCard ? [{ key: "emergencyCard" }] : []), { key: "appointments", count: appointmentCount }, { key: "healthProfiles", count: profileCount }, { key: "measures", count: measures.length }, { key: "healthSpending", count: spends.length }],
  };
  const hasData: Record<ResetScreen, boolean> = {
    history: entries.length > 0,
    expenses: expenseCounts.expenses + expenseCounts.incomes + expenseCounts.recurring + expenseCounts.savings + computed > 0 || expenseCounts.budget,
    pockets: pocketCounts.pockets + pocketCounts.moves + pocketCounts.picks > 0,
    loans: loanCounts.loans > 0,
    parcels: parcels.length > 0,
    shop: shopCounts.sales + shopCounts.products + shopCounts.payments > 0,
    health: hasHealth,
  };
  // A screen of a feature the plan doesn't have shows only when something is kept from it.
  const shown: Record<ResetScreen, boolean> = {
    history: true,
    expenses: has("expenses") || hasData.expenses,
    pockets: has("expenses") || hasData.pockets,
    loans: has("loans") || hasData.loans,
    parcels: true,
    shop: has("shop") || hasData.shop,
    // Ma santé's emergency card and appointments: only once written.
    health: hasHealth,
  };
  const screens = (["history", "expenses", "pockets", "loans", "parcels", "shop", "health"] as const).filter((screen) => shown[screen]);

  const close = useCallback(() => {
    if (!working) setOpen(null);
  }, [working]);

  const confirm = async (screen: ResetScreen) => {
    setWorking(true);
    try {
      // The emergency card and the appointments are settings: emptied here, dated so the other devices follow.
      if (screen === "health") {
        const now = Date.now();
        update({
          ...(settings.emergencyCard && { emergencyCard: blankCard(now) }),
          ...(settings.appointments && { appointments: removeAllAppointments(settings.appointments, now) }),
          // The relatives go with their cards; their scans come back to "Moi" by themselves (lib/healthProfiles.ts ownerOf).
          ...(settings.healthProfiles && { healthProfiles: removeAllProfiles(settings.healthProfiles, now) }),
        });
        // The measures and the health expenses are records of their own (tables health_measures, health_spending).
        await resetScreen(screen);
      } else await resetScreen(screen);
      setOpen(null);
      toast(t(`settings.reset.done.${screen}`));
    } catch (error) {
      toast(t(error instanceof ResetOfflineError ? "settings.reset.offline" : "settings.reset.failed"), "error");
    } finally {
      setWorking(false);
    }
  };

  const line = ({ key, count }: Line) =>
    count === undefined ? t(`settings.reset.goes.${key}`) : count === 1 ? t(`settings.reset.goes.${key}One`) : t(`settings.reset.goes.${key}`, { count });

  return (
    <>
      <p className={styles.intro}>{t("settings.reset.intro")}</p>
      {screens.map((screen) => (
        <button
          key={screen}
          type="button"
          className={styles.row}
          onClick={() => setOpen(screen)}
          disabled={!hasData[screen]}
          data-testid="reset-row"
          data-screen={screen}
        >
          <span className={styles.icon}>{icons[screen]}</span>
          <span className={styles.text}>
            <span>{t(`settings.reset.screens.${screen}`)}</span>
            <small>{hasData[screen] ? t(`settings.reset.hints.${screen}`) : t("settings.reset.empty")}</small>
          </span>
          {hasData[screen] && <ChevronRight className={styles.chevron} aria-hidden />}
        </button>
      ))}

      <ExpenseSheet open={open !== null} title={open ? t("settings.reset.title", { name: t(`settings.reset.screens.${open}`) }) : ""} onClose={close}>
        {open && (
          <div className={styles.window} data-testid="reset-window">
            <section>
              <h3>{t("settings.reset.goesTitle")}</h3>
              <ul className={styles.goes}>
                {goes[open]
                  .filter((item) => item.count !== 0)
                  .map((item) => (
                    <li key={item.key}>{line(item)}</li>
                  ))}
              </ul>
            </section>
            <section>
              <h3>{t("settings.reset.staysTitle")}</h3>
              <p>{t(`settings.reset.stays.${open}`)}</p>
            </section>
            <p className={styles.warning}>{session ? t("settings.reset.everywhere") : t("settings.reset.final")}</p>
            {open === "expenses" && (
              <Link href="/expenses?tab=month#expenses-export" className={styles.export}>
                <Download size={16} aria-hidden />
                {t("settings.reset.exportFirst")}
              </Link>
            )}
            <div className={styles.actions}>
              <Button variant="danger" icon={<Trash2 />} block onClick={() => void confirm(open)} disabled={working} data-testid="reset-confirm">
                {t("settings.reset.confirm")}
              </Button>
              <Button variant="secondary" block onClick={close} disabled={working}>
                {t("settings.reset.cancel")}
              </Button>
            </div>
          </div>
        )}
      </ExpenseSheet>
    </>
  );
}
