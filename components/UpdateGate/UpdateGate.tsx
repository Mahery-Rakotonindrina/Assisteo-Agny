import { App } from "@capacitor/app";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut } from "@/lib/motion";
import { updateState, type UpdateState } from "@/lib/version";
import type { AppVersionResponse } from "@/pages/api/app-version";
import { isNative } from "@/services/device";
import { httpClient } from "@/services/httpClient";
import styles from "./UpdateGate.module.scss";

const DISMISSED_KEY = "update-dismissed";

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Installed version: the native app's own, or a dev override to try the UI in a browser. */
async function installedVersion() {
  if (isNative()) return (await App.getInfo()).version;
  return process.env.NODE_ENV !== "production" ? readStorage("debug-app-version") : null;
}

type Check = { status: UpdateState; latest: string; downloadUrl: string };

/**
 * Checks the installed app against the versions the server accepts, at launch
 * and whenever the app comes back to the foreground. Too old: a blocking
 * screen with the download link. Merely outdated: a dismissible banner.
 */
export function UpdateGate() {
  const { t } = useTranslation();
  const [check, setCheck] = useState<Check>({ status: "ok", latest: "", downloadUrl: "" });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const installed = await installedVersion().catch(() => null);
      if (!installed) return;
      const remote = await httpClient.get<AppVersionResponse>("/api/app-version").catch(() => null);
      if (!remote || cancelled) return;
      setDismissed(readStorage(DISMISSED_KEY));
      setCheck({ status: updateState(installed, remote), latest: remote.latest, downloadUrl: remote.downloadUrl });
    };
    void run();
    const listener = isNative() ? App.addListener("resume", () => void run()) : null;
    return () => {
      cancelled = true;
      void listener?.then((handle) => handle.remove());
    };
  }, []);

  const download = () => {
    // Capacitor opens external https links in the system browser.
    if (check.downloadUrl) window.open(check.downloadUrl, "_blank");
  };

  const dismiss = () => {
    setDismissed(check.latest);
    try {
      localStorage.setItem(DISMISSED_KEY, check.latest);
    } catch {
      // Not remembered: the banner comes back next launch.
    }
  };

  const showBanner = check.status === "available" && dismissed !== check.latest;

  return (
    <AnimatePresence>
      {check.status === "required" && (
        <motion.div
          key="required"
          className={styles.blocker}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="update-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: easeOut }}
        >
          <motion.div className={styles.panel} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.45, ease: easeOut }}>
            <span className={styles.icon} aria-hidden>
              <RefreshCw />
            </span>
            <h2 id="update-title">{t("update.requiredTitle")}</h2>
            <p>{t("update.requiredBody")}</p>
            {check.downloadUrl ? (
              <Button size="lg" block icon={<Download />} onClick={download}>
                {t("update.download")}
              </Button>
            ) : (
              <p className={styles.hint}>{t("update.noLink")}</p>
            )}
          </motion.div>
        </motion.div>
      )}
      {showBanner && (
        <motion.div
          key="available"
          className={styles.banner}
          role="status"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.35, ease: easeOut }}
        >
          <RefreshCw size={18} className={styles.bannerIcon} />
          <div className={styles.bannerText}>
            <strong>{t("update.availableTitle", { version: check.latest })}</strong>
            <small>{t("update.availableBody")}</small>
          </div>
          {check.downloadUrl && (
            <button type="button" className={styles.bannerAction} onClick={download}>
              {t("update.update")}
            </button>
          )}
          <button type="button" className={styles.bannerClose} onClick={dismiss} aria-label={t("update.later")}>
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
