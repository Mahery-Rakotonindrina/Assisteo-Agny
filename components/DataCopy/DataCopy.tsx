import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccount } from "@/lib/account/AccountProvider";
import { photosSize } from "@/lib/dataExport";
import { formatBytes, formatDate } from "@/lib/format";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { CopyCancelled, downloadDataCopy, readDevice, type CopyStep } from "@/services/dataExport";
import { ApiError } from "@/types/api";
import styles from "./DataCopy.module.scss";

/**
 * "Télécharger une copie de mes données" in Réglages: a ZIP of everything
 * (services/dataExport.ts), photos included unless unticked, with the
 * account's part when signed in. Open to every plan.
 */
export function DataCopy() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { settings } = useSettings();
  const { session, syncAll } = useAccount();
  const [withPhotos, setWithPhotos] = useState(true);
  // The photos' weight: reading it loads every photo, so only when asked
  // ("Voir la taille", or the switch turned on), never on opening Réglages.
  const [size, setSize] = useState<number | "unknown" | "measuring">("unknown");
  const [step, setStep] = useState<CopyStep | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const measure = useCallback(() => {
    setSize("measuring");
    readDevice({})
      .then((data) => mounted.current && setSize(photosSize(data)))
      .catch(() => mounted.current && setSize("unknown"));
  }, []);

  const switchPhotos = (on: boolean) => {
    setWithPhotos(on);
    if (on && size === "unknown") measure();
  };

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setStep(session ? "sync" : "device");
    try {
      const now = Date.now();
      const { outcome, accountMissing } = await downloadDataCopy({
        withPhotos,
        settings: { ...settings },
        signedIn: Boolean(session),
        syncAll,
        texts: { t, date: formatDate(now, locale), title: t("settings.dataCopy.fileTitle") },
        onStep: setStep,
        signal: controller.signal,
        now,
      });
      if (outcome === "cancelled") toast(t("settings.dataCopy.cancelled"));
      else if (accountMissing) toast(t("settings.dataCopy.accountMissing"), "error");
      else toast(t("settings.dataCopy.done"));
    } catch (error) {
      if (error instanceof CopyCancelled || (error instanceof DOMException && error.name === "AbortError")) toast(t("settings.dataCopy.cancelled"));
      else toast(t(error instanceof ApiError && error.status === 0 ? "settings.dataCopy.offline" : "settings.dataCopy.failed"), "error");
    } finally {
      abort.current = null;
      setStep(null);
    }
  };

  const sizeText =
    size === "measuring" ? t("settings.dataCopy.measuring") : size === "unknown" ? null : size > 0 ? t("settings.dataCopy.photosSize", { size: formatBytes(size, locale) }) : t("settings.dataCopy.photosNone");

  return (
    <div className={styles.copy} data-testid="data-copy">
      <p className={styles.intro}>{t("settings.dataCopy.intro")}</p>
      <p className={styles.intro}>{t(session ? "settings.dataCopy.introAccount" : "settings.dataCopy.introDevice")}</p>
      <div className={styles.row}>
        <span className={styles.icon}>
          <ImageIcon aria-hidden />
        </span>
        <span className={styles.text}>
          <span>{t("settings.dataCopy.photos")}</span>
          {sizeText === null ? (
            <button type="button" className={styles.measure} onClick={measure} data-testid="data-copy-measure">
              {t("settings.dataCopy.photosSizeAsk")}
            </button>
          ) : (
            <small data-testid="data-copy-size">{sizeText}</small>
          )}
        </span>
        <Toggle checked={withPhotos} onChange={switchPhotos} label={t("settings.dataCopy.photos")} disabled={step !== null} />
      </div>
      <div className={styles.actions}>
        {step === null ? (
          <Button icon={<Download />} block onClick={() => void start()} data-testid="data-copy-start">
            {t("settings.dataCopy.download")}
          </Button>
        ) : (
          <>
            <p className={styles.progress} role="status" data-testid="data-copy-progress">
              <LoaderCircle className={styles.spin} aria-hidden />
              {t(`settings.dataCopy.steps.${step}`)}
            </p>
            <Button variant="secondary" icon={<X />} block onClick={() => abort.current?.abort()} disabled={step === "save"}>
              {t("settings.dataCopy.cancel")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
