import Head from "next/head";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { BellRing, Cpu, Globe, Info, Moon, Monitor, Palette, Send, Smartphone, Sun, Trash2, Vibrate } from "lucide-react";
import { Button } from "@/components/Button";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Toggle } from "@/components/Toggle";
import { useToast } from "@/components/Toast";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useHistory } from "@/hooks/useHistory";
import { useTranslation } from "@/hooks/useTranslation";
import { config } from "@/lib/config";
import { rise, stagger } from "@/lib/motion";
import { useSettings, type ThemePreference } from "@/lib/settings/SettingsProvider";
import { historyStore } from "@/services/historyStore";
import {
  getNotificationPermission,
  notify,
  requestNotificationPermission,
  type NotificationPermission,
} from "@/services/notifications";
import styles from "@/styles/Settings.module.scss";

export default function SettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, update } = useSettings();
  const { entries } = useHistory();
  const [permission, setPermission] = useState<NotificationPermission>("prompt");
  const aiStatus = useAiStatus();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void getNotificationPermission().then(setPermission);
  }, []);

  const toggleNotifyOnResult = async (enabled: boolean) => {
    if (enabled && permission !== "granted") {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result !== "granted") {
        toast(t("settings.notificationsDenied"), "error");
        return;
      }
    }
    update({ notifyOnResult: enabled });
  };

  const sendTest = async () => {
    const result = permission === "granted" ? permission : await requestNotificationPermission();
    setPermission(result);
    if (result !== "granted") {
      toast(t("settings.notificationsDenied"), "error");
      return;
    }
    await notify({ title: t("settings.testTitle"), body: t("settings.testBody") });
  };

  const clearHistory = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await historyStore.clear();
    setConfirmClear(false);
    toast(t("settings.cleared"));
  };

  const themeOptions: { value: ThemePreference; icon: ReactNode }[] = [
    { value: "system", icon: <Monitor /> },
    { value: "light", icon: <Sun /> },
    { value: "dark", icon: <Moon /> },
  ];

  const aiLabel = {
    checking: "…",
    live: `${t("settings.aiLive")} · ${aiStatus.provider === "gemini" ? "Gemini" : "Claude"}`,
    demo: t("settings.aiDemo"),
    offline: t("settings.aiOffline"),
  }[aiStatus.status];

  return (
    <>
      <Head>
        <title>{`${t("settings.title")} · ${t("meta.title")}`}</title>
      </Head>

      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("settings.title")}</h1>
        </motion.header>

        <Group title={t("settings.appearance")}>
          <Row icon={<Globe />} label={t("settings.language")} stacked>
            <LocaleSwitcher />
          </Row>
          <Row icon={<Palette />} label={t("settings.theme")} stacked>
            <SegmentedControl
              ariaLabel={t("settings.theme")}
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={themeOptions.map(({ value, icon }) => ({ value, icon, label: t(`settings.themes.${value}`) }))}
            />
          </Row>
        </Group>

        <Group title={t("settings.notifications")}>
          <Row icon={<BellRing />} label={t("settings.notifyOnResult")} hint={t("settings.notifyOnResultHint")}>
            <Toggle
              label={t("settings.notifyOnResult")}
              checked={settings.notifyOnResult && permission === "granted"}
              onChange={(enabled) => void toggleNotifyOnResult(enabled)}
              disabled={permission === "unsupported"}
            />
          </Row>
          {permission === "denied" && <p className={styles.warning}>{t("settings.notificationsDenied")}</p>}
          <Row icon={<Vibrate />} label={t("settings.haptics")} hint={t("settings.hapticsHint")}>
            <Toggle label={t("settings.haptics")} checked={settings.haptics} onChange={(haptics) => update({ haptics })} />
          </Row>
          <div className={styles.rowAction}>
            <Button variant="secondary" icon={<Send />} onClick={() => void sendTest()} disabled={permission === "unsupported"} block>
              {t("settings.testNotification")}
            </Button>
          </div>
        </Group>

        <Group title={t("settings.data")}>
          <Row icon={<Smartphone />} label={t("settings.storage", { count: entries.length })} />
          <div className={styles.rowAction}>
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={() => void clearHistory()}
              disabled={entries.length === 0}
              block
            >
              {confirmClear ? t("settings.clearConfirm") : t("settings.clearHistory")}
            </Button>
          </div>
        </Group>

        <Group title={t("settings.about")}>
          <Row icon={<Cpu />} label={t("settings.aiStatus")}>
            <span className={styles.status} data-status={aiStatus.status}>
              <span className={styles.statusDot} />
              {aiLabel}
            </span>
          </Row>
          {aiStatus.model && aiStatus.status === "live" && (
            <Row icon={<span className={styles.mono}>AI</span>} label={t("settings.aiProvider")}>
              <span className={styles.value}>{aiStatus.model}</span>
            </Row>
          )}
          <Row icon={<Info />} label={t("settings.version")}>
            <span className={styles.value}>{config.appVersion}</span>
          </Row>
          <p className={styles.privacy}>{t("settings.privacy")}</p>
        </Group>
      </motion.div>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.section variants={rise} className={styles.group}>
      <h2>{title}</h2>
      <div className={styles.card}>{children}</div>
    </motion.section>
  );
}

type RowProps = {
  icon: ReactNode;
  label: string;
  hint?: string;
  stacked?: boolean;
  children?: ReactNode;
};

function Row({ icon, label, hint, stacked, children }: RowProps) {
  return (
    <div className={`${styles.row} ${stacked ? styles.stacked : ""}`}>
      <div className={styles.rowMain}>
        <span className={styles.rowIcon}>{icon}</span>
        <span className={styles.rowText}>
          <span>{label}</span>
          {hint && <small>{hint}</small>}
        </span>
        {!stacked && children}
      </div>
      {stacked && children}
    </div>
  );
}
