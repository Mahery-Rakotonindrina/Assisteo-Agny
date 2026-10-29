import { useSyncExternalStore } from "react";
import { BellRing } from "lucide-react";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { useTranslation } from "@/hooks/useTranslation";
import { eveningTime, parseEveningTime } from "@/lib/eveningReminder";
import { isNative } from "@/services/device";
import { eveningSetting, useEveningSetting } from "@/services/eveningReminder";
import { requestNotificationPermission } from "@/services/notifications";
import styles from "./Expenses.module.scss";

const noSubscribe = () => () => {};

/**
 * "Me rappeler chaque soir de noter mes dépenses", with its time (20:00 by
 * default). The Android app only: on the web, it says so. Scheduled by
 * ExpenseReminderKeeper.
 */
export function EveningReminder() {
  const { t } = useTranslation();
  const toast = useToast();
  const setting = useEveningSetting();
  // Known once mounted: the server and the hydration render the web's line.
  const native = useSyncExternalStore(noSubscribe, isNative, () => false);

  const turn = async (on: boolean) => {
    if (on && (await requestNotificationPermission().catch(() => "denied")) !== "granted") {
      toast(t("expenses.evening.denied"), "error");
      return;
    }
    eveningSetting.set({ ...setting, on });
  };

  return (
    <section className={styles.evening} aria-labelledby="expenses-evening">
      <div className={styles.switchRow}>
        <span>
          <strong id="expenses-evening">
            <BellRing size={16} aria-hidden /> {t("expenses.evening.label")}
          </strong>
          <small className={styles.hint}>{native ? t("expenses.evening.hint") : t("expenses.evening.appOnly")}</small>
        </span>
        {native && <Toggle checked={setting.on} onChange={(on) => void turn(on)} label={t("expenses.evening.label")} />}
      </div>
      {native && setting.on && (
        <label className={styles.eveningTime}>
          <span>{t("expenses.evening.time")}</span>
          <input type="time" value={eveningTime(setting)} onChange={(event) => eveningSetting.set({ ...setting, ...parseEveningTime(event.target.value) })} />
        </label>
      )}
    </section>
  );
}
