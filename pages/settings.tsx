import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BellRing,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Cpu,
  Download,
  FileText,
  Globe,
  HeartPulse,
  Info,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Salad,
  Send,
  ShieldCheck,
  SignalLow,
  Smartphone,
  Sun,
  Trash2,
  Vibrate,
  X,
} from "lucide-react";
import { AccountSettings } from "@/components/AccountSettings";
import { AiKeySettings } from "@/components/AiKeySettings";
import { useAndroidDownload } from "@/hooks/useAndroidDownload";
import { PlanSettings } from "@/components/PlanSettings";
import { Button } from "@/components/Button";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Logo } from "@/components/Logo";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Toggle } from "@/components/Toggle";
import { useToast } from "@/components/Toast";
import { useAiStatus } from "@/hooks/useAiStatus";
import { useAppVersion } from "@/hooks/useAppVersion";
import { useHistory } from "@/hooks/useHistory";
import { useTranslation } from "@/hooks/useTranslation";
import { allergens, diets } from "@/lib/ai/schema";
import { rise, stagger } from "@/lib/motion";
import { useSettings, type ThemePreference } from "@/lib/settings/SettingsProvider";
import { accountsAvailable } from "@/lib/supabase";
import { connectionIsSlow, isSavingData, type DataSaverPreference } from "@/services/dataSaver";
import { isNative } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { keepParcelThumbnails } from "@/services/parcelLinking";
import { entryPhotoBytes, FULL_PHOTOS_KEPT } from "@/services/photoStorage";
import {
  getNotificationPermission,
  notify,
  requestNotificationPermission,
  type NotificationPermission,
} from "@/services/notifications";
import { getPermission, requestPermission, type PermissionKind, type PermissionStatus } from "@/services/permissions";
import styles from "@/styles/Settings.module.scss";

export default function SettingsPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { settings, update } = useSettings();
  const android = useAndroidDownload();
  const { entries } = useHistory();
  const [permission, setPermission] = useState<NotificationPermission>("prompt");
  const [cameraPermission, setCameraPermission] = useState<PermissionStatus>("prompt");
  const aiStatus = useAiStatus();
  const appVersion = useAppVersion();
  // Server snapshot is false so the prerendered HTML matches the first client render.
  const native = useSyncExternalStore(noSubscribe, isNative, () => false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Re-read on return to the app: the user may have changed them in the OS settings.
  useEffect(() => {
    const refresh = () => {
      void getNotificationPermission().then(setPermission);
      void getPermission("camera").then(setCameraPermission).catch(() => setCameraPermission("unsupported"));
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  // "Add my API key" links land on the AI engine section.
  const section = router.isReady ? router.query.section : undefined;
  useEffect(() => {
    const target = section === "ai" ? "ai-engine" : section === "account" ? "account" : section === "plan" ? "plan" : section === "food" ? "food" : null;
    if (!target) return;
    const timer = setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(timer);
  }, [section]);

  const allow = async (kind: PermissionKind) => {
    const result = await requestPermission(kind);
    if (kind === "camera") setCameraPermission(result);
    else setPermission(result);
    if (result === "denied") toast(t("settings.permissionDeniedHint"), "error");
  };

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
    // The parcels keep their own photo: they stay recognisable without their scans.
    await keepParcelThumbnails().catch(() => undefined);
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
    live: `${t("settings.aiLive")} · ${aiStatus.label ?? "IA"}${aiStatus.ownKey ? ` · ${t("settings.aiOwnKey")}` : ""}`,
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

        {accountsAvailable && (
          <Group id="account" title={t("account.section")}>
            <AccountSettings />
          </Group>
        )}

        <Group id="plan" title={t("plans.section")}>
          <PlanSettings />
        </Group>

        <Group id="food" title={t("food.settingsSection")}>
          <Row icon={<HeartPulse />} label={t("food.myAllergies")} hint={t("food.myAllergiesHint")} stacked>
            <div className={styles.chips} role="group" aria-label={t("food.myAllergies")}>
              {allergens.map((value) => {
                const on = settings.allergies.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => update({ allergies: on ? settings.allergies.filter((item) => item !== value) : [...settings.allergies, value] })}
                  >
                    {on && <Check size={13} strokeWidth={3} />}
                    {t(`food.allergens.${value}`)}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row icon={<Salad />} label={t("food.myDiets")} hint={t("food.myDietsHint")} stacked>
            <div className={styles.chips} role="group" aria-label={t("food.myDiets")}>
              {diets.map((value) => {
                const on = settings.diets.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => update({ diets: on ? settings.diets.filter((item) => item !== value) : [...settings.diets, value] })}
                  >
                    {on && <Check size={13} strokeWidth={3} />}
                    {t(`food.diets.${value}`)}
                  </button>
                );
              })}
            </div>
          </Row>
          <Link href="/food" className={styles.linkRow}>
            <span className={styles.rowIcon}>
              <BookOpen />
            </span>
            <span className={styles.linkLabel}>{t("food.title")}</span>
            <ChevronRight size={16} />
          </Link>
        </Group>

        {android && (
          <Group title={t("settings.androidApp")}>
            <Row
              icon={<Smartphone />}
              label={t("settings.androidAppLabel")}
              hint={android.version ? t("settings.androidAppHint", { version: android.version }) : t("settings.androidAppHintNoVersion")}
            >
              <Button href={android.url} size="md" icon={<Download />}>
                {t("settings.androidAppDownload")}
              </Button>
            </Row>
          </Group>
        )}

        <Group id="ai-engine" title={t("settings.aiEngine")}>
          <AiKeySettings requestOpen={section === "ai"} />
        </Group>

        <Group title={t("settings.permissions")}>
          {(
            [
              ["camera", cameraPermission, <Camera key="camera" />],
              ["notifications", permission, <BellRing key="notifications" />],
            ] as const
          ).map(([kind, status, icon]) => (
            <Row
              key={kind}
              icon={icon}
              label={t(kind === "camera" ? "settings.permissionCamera" : "settings.permissionNotifications")}
              hint={t(`settings.permissionStatus.${status}`)}
            >
              {status === "prompt" ? (
                <Button size="md" onClick={() => void allow(kind)}>
                  {t("settings.permissionAllow")}
                </Button>
              ) : (
                <span className={styles.permission} data-status={status}>
                  {status === "granted" ? <Check size={16} strokeWidth={3} /> : status === "denied" ? <X size={16} strokeWidth={3} /> : null}
                </span>
              )}
            </Row>
          ))}
          {(cameraPermission === "denied" || permission === "denied") && (
            <p className={styles.warning}>{t("settings.permissionDeniedHint")}</p>
          )}
          {native && (
            <div className={styles.rowAction}>
              <Button variant="ghost" icon={<RotateCcw />} onClick={() => update({ onboardingDone: false })} block>
                {t("settings.replayOnboarding")}
              </Button>
            </div>
          )}
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
          <Row
            icon={<SignalLow />}
            label={t("settings.dataSaver")}
            hint={
              settings.dataSaver === "auto"
                ? `${t("settings.dataSaverHint")} ${t(isSavingData("auto") ? (connectionIsSlow() ? "settings.dataSaverAutoOn" : "settings.dataSaverOn") : "settings.dataSaverAutoOff")}`
                : t("settings.dataSaverHint")
            }
            stacked
          >
            <SegmentedControl
              ariaLabel={t("settings.dataSaver")}
              value={settings.dataSaver}
              onChange={(dataSaver: DataSaverPreference) => update({ dataSaver })}
              options={(["auto", "on", "off"] as const).map((value) => ({ value, label: t(`settings.dataSaverModes.${value}`) }))}
            />
          </Row>
          <Row
            icon={<Smartphone />}
            label={t("settings.storage", { count: entries.length, size: formatBytes(entries.reduce((total, entry) => total + entryPhotoBytes(entry), 0), locale) })}
            hint={t("settings.storageHint", { count: FULL_PHOTOS_KEPT })}
          />
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
            <span className={styles.value}>{appVersion}</span>
          </Row>
          <Link href="/privacy" className={styles.linkRow}>
            <span className={styles.rowIcon}>
              <ShieldCheck />
            </span>
            <span className={styles.linkLabel}>{t("legal.privacy")}</span>
            <ChevronRight size={16} />
          </Link>
          <Link href="/terms" className={styles.linkRow}>
            <span className={styles.rowIcon}>
              <FileText />
            </span>
            <span className={styles.linkLabel}>{t("legal.terms")}</span>
            <ChevronRight size={16} />
          </Link>
          <p className={styles.privacy}>{t("settings.privacy")}</p>
        </Group>

        <motion.footer variants={rise} className={styles.brandFooter}>
          <Logo size={30} />
          <p>{t("meta.description")}</p>
          <small>{appVersion}</small>
        </motion.footer>
      </motion.div>
    </>
  );
}

function Group({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <motion.section id={id} variants={rise} className={styles.group}>
      <h2>{title}</h2>
      <div className={styles.card}>{children}</div>
    </motion.section>
  );
}

const noSubscribe = () => () => {};

function formatBytes(bytes: number, locale: string) {
  const [kb, mb] = locale === "fr" ? ["Ko", "Mo"] : ["KB", "MB"];
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1
    ? `${megabytes.toLocaleString(locale, { maximumFractionDigits: 1 })} ${mb}`
    : `${Math.max(0, Math.round(bytes / 1024)).toLocaleString(locale)} ${kb}`;
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
