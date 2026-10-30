import { useCallback, useEffect, useRef } from "react";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { reconcileHomeReminders, type HomeReminderTexts } from "@/services/homeItemReminders";
import { homeItemStore } from "@/services/homeItemStore";

/**
 * Keeps the "Ma maison" warranty notifications (30 days before the end) in
 * line with the items and the plan, at launch and whenever either changes.
 * Without "Ma maison" or without the reminders they are cancelled, and come
 * back with them.
 */
export function HomeReminderKeeper() {
  const { t, locale } = useTranslation();
  const { ready } = useSettings();
  const { plan, has } = usePlan();
  // Unknown until the plan is read once (cache or server): nothing is cancelled meanwhile.
  const known = plan !== null;
  // Like the other screens' reminders: "Ma maison" (Premium) and the reminders (canRemind).
  const enabled = has("inventory") && has("reminders");
  const texts = useCallback<HomeReminderTexts>(
    (item, endsAt) => ({
      title: t("inventory.reminder.title", { name: item.name }),
      body: t("inventory.reminder.body", { name: item.name, date: formatDate(endsAt, locale) }),
    }),
    [t, locale],
  );
  const latest = useRef<HomeReminderTexts>(texts);

  useEffect(() => {
    latest.current = texts;
  }, [texts]);

  useEffect(() => {
    if (!ready || !known) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcileHomeReminders((item, endsAt) => latest.current(item, endsAt), enabled), 1200);
    };
    run();
    const unsubscribe = homeItemStore.subscribe(run);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // A language change re-runs it, so the texts follow.
  }, [ready, known, enabled, texts]);

  return null;
}
