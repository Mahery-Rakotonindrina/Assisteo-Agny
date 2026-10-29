import { useEffect, useState, useSyncExternalStore } from "react";
import { BellRing } from "lucide-react";
import expenseStyles from "@/components/Expenses/Expenses.module.scss";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { useTranslation } from "@/hooks/useTranslation";
import { isNative } from "@/services/device";
import { loanReminderSetting, useLoanReminderSetting } from "@/services/loanReminders";
import { getNotificationPermission, requestNotificationPermission } from "@/services/notifications";

const noSubscribe = () => () => {};

/**
 * "Me rappeler les échéances", on by default: the day before the next
 * payment, and the day itself to chase money lent. The Android app only: on
 * the web, it says so. Scheduled by LoanReminderKeeper.
 */
export function LoanReminderSetting() {
  const { t } = useTranslation();
  const toast = useToast();
  const on = useLoanReminderSetting();
  // Known once mounted: the server and the hydration render the web's line.
  const native = useSyncExternalStore(noSubscribe, isNative, () => false);
  // On by default, but nothing rings until the notifications are allowed.
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    if (!native || !on) return;
    let cancelled = false;
    void getNotificationPermission()
      .then((permission) => {
        if (!cancelled) setAllowed(permission === "granted");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [native, on]);

  const allow = async () => {
    const permission = await requestNotificationPermission().catch(() => "denied");
    setAllowed(permission === "granted");
    if (permission !== "granted") toast(t("loans.reminders.denied"), "error");
  };

  const turn = async (value: boolean) => {
    if (value && (await requestNotificationPermission().catch(() => "denied")) !== "granted") {
      toast(t("loans.reminders.denied"), "error");
      return;
    }
    loanReminderSetting.set(value);
  };

  return (
    <section className={expenseStyles.evening} aria-labelledby="loans-reminders" data-testid="loan-reminders">
      <div className={expenseStyles.switchRow}>
        <span>
          <strong id="loans-reminders">
            <BellRing size={16} aria-hidden /> {t("loans.reminders.label")}
          </strong>
          <small className={expenseStyles.hint}>{native ? t("loans.reminders.hint") : t("loans.reminders.appOnly")}</small>
        </span>
        {native && <Toggle checked={on} onChange={(value) => void turn(value)} label={t("loans.reminders.label")} />}
      </div>
      {native && on && !allowed && (
        <Button variant="secondary" icon={<BellRing />} onClick={() => void allow()}>
          {t("loans.reminders.allow")}
        </Button>
      )}
    </section>
  );
}
