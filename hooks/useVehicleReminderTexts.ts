import { useCallback } from "react";
import { ODOMETER_STALE_DAYS, type Vehicle, type VehicleReminder } from "@/lib/garage";
import { formatDate, formatNumber } from "@/lib/format";
import { useTranslation } from "./useTranslation";

/** What a "Mon garage" reminder says, in the notification, on the screen and in the calendar. */
export function useVehicleReminderTexts() {
  const { t, locale } = useTranslation();
  return useCallback(
    (vehicle: Vehicle, reminder: VehicleReminder) => {
      const params = { name: vehicle.name, date: formatDate(reminder.dueAt, locale) };
      const title = t(`garage.reminders.${reminder.kind}Title`, params);
      if (reminder.kind === "oilChange") {
        const body =
          reminder.byKm && reminder.dueKm
            ? t("garage.reminders.oilChangeByKm", { ...params, km: formatNumber(reminder.dueKm, locale) })
            : t("garage.reminders.oilChangeBody", params);
        return { title, body };
      }
      if (reminder.kind === "odometer") return { title, body: t("garage.reminders.odometerBody", { ...params, days: ODOMETER_STALE_DAYS }) };
      return { title, body: t(`garage.reminders.${reminder.kind}Body`, params) };
    },
    [t, locale],
  );
}
