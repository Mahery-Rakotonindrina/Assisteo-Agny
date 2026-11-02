import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BellRing, BellOff, Smartphone } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccount } from "@/lib/account/AccountProvider";
import { webPushState } from "@/lib/webPush";
import { isNative } from "@/services/device";
import { fetchWebPushStatus, isIos, isStandalone, subscribeWebPush, unsubscribeWebPush, webPushSubscribed, webPushSupported } from "@/services/webPush";
import settingsStyles from "@/styles/Settings.module.scss";
import styles from "./WebPushSettings.module.scss";

// "Receive reminders on this iPhone" in the notification settings: Web Push for
// the site opened from the home screen (and browsers). Hidden in the Android
// app, without the server's VAPID keys and in demo; on an iPhone in Safari,
// the three steps to add the site to the home screen first.

const noSubscribe = () => () => {};

export function WebPushSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useAccount();
  const { has, planFor, name: planName } = usePlan();
  // Read after hydration (server snapshot false), like `native` in the settings page.
  const native = useSyncExternalStore(noSubscribe, isNative, () => false);
  const ios = useSyncExternalStore(noSubscribe, isIos, () => false);
  const standalone = useSyncExternalStore(noSubscribe, isStandalone, () => false);
  const supported = useSyncExternalStore(noSubscribe, webPushSupported, () => false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const signedIn = Boolean(session);
  // "Stop" only when the server confirms this browser's row (a failed save leaves "Turn on").
  useEffect(() => {
    if (native) return;
    void fetchWebPushStatus()
      .then(async (status) => {
        setPublicKey(status.publicKey);
        setSubscribed(await webPushSubscribed(status.registered));
      })
      .catch(() => undefined);
  }, [native, signedIn]);

  const state = webPushState({ publicKey, native, ios, standalone, supported, signedIn, canRemind: has("reminders") });
  if (state === "hidden") return null;
  const label = t(ios ? "webPush.titleIphone" : "webPush.titleDevice");

  const toggle = async () => {
    if (!publicKey || busy) return;
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeWebPush();
        setSubscribed(false);
        toast(t("webPush.unsubscribed"));
        return;
      }
      const outcome = await subscribeWebPush(publicKey);
      if (outcome === "subscribed") {
        setSubscribed(true);
        toast(t("webPush.subscribed"));
      } else toast(t(outcome === "denied" ? "webPush.denied" : "webPush.error"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${settingsStyles.row} ${settingsStyles.stacked}`} data-testid="web-push">
      <div className={settingsStyles.rowMain}>
        <span className={settingsStyles.rowIcon}>{state === "install" ? <Smartphone /> : <BellRing />}</span>
        <span className={settingsStyles.rowText}>
          <span>{label}</span>
          <small>{t(state === "install" ? "webPush.installHint" : state === "signin" ? "webPush.signIn" : "webPush.hint")}</small>
        </span>
        {state === "locked" && (
          <Link href="/plans" aria-label={t("webPush.locked", { plan: planName(planFor("reminders") ?? "lite") })}>
            <PlanBadge plan={planFor("reminders")} />
          </Link>
        )}
      </div>
      {state === "install" && (
        <ol className={styles.steps}>
          <li>{t("webPush.step1")}</li>
          <li>{t("webPush.step2")}</li>
          <li>{t("webPush.step3")}</li>
        </ol>
      )}
      {state === "ready" && (
        <Button variant={subscribed ? "secondary" : "primary"} icon={subscribed ? <BellOff /> : <BellRing />} onClick={() => void toggle()} disabled={busy} block>
          {t(subscribed ? "webPush.off" : "webPush.on")}
        </Button>
      )}
    </div>
  );
}
