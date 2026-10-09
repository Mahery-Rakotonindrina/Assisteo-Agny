import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Copy, Languages, LoaderCircle, RotateCcw, ScanText } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { translateLanguages, type TranslateLanguage } from "@/lib/ai/schema";
import { easeOut } from "@/lib/motion";
import { askAboutScan } from "@/services/chatService";
import { copyText, haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { planStore } from "@/services/plan";
import type { HistoryEntry } from "@/types/history";
import { ApiError } from "@/types/api";
import styles from "./DocumentText.module.scss";

/** What the AI answers when the photos hold no text (lib/ai/prompt.ts). */
const NO_TEXT = "NO_TEXT";
const ERRORS = ["network", "rate_limited", "refused", "unavailable", "ask_limit", "server_busy", "plan_required", "invalid_key", "billing"];

type Shown = "original" | TranslateLanguage;

/**
 * The full text of the photo (every page of a multi-page scan), read by the AI
 * on demand, to copy, and translated. Each costs one question of the day;
 * the results stay on the device, so opening them again is free.
 */
export function DocumentText({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>("original");
  // The photo was reduced to its thumbnail (old scan, data saver): too small to read.
  const readable = entry.preview !== entry.thumbnail;

  const text = shown === "original" ? entry.transcript?.text : entry.translations?.[shown]?.text;

  const read = async (target: Shown) => {
    setShown(target);
    setError(null);
    if (target === "original" ? entry.transcript : entry.translations?.[target]) return;
    haptics.press();
    setBusy(target);
    try {
      const task = target === "original" ? "transcribe" : "translate";
      const { answer, usage } = await askAboutScan(entry, [{ role: "user", content: task }], locale, undefined, {
        task,
        ...(target !== "original" && { target }),
      });
      if (usage) planStore.setUsage({ questionsToday: usage.used });
      const result = { text: answer.trim() === NO_TEXT ? "" : answer.trim(), at: Date.now() };
      await historyStore.update(
        entry.id,
        target === "original" ? { transcript: result } : { translations: { ...entry.translations, [target]: result } },
      );
      haptics.tap();
    } catch (err) {
      haptics.error();
      const code = err instanceof ApiError ? err.code : "unknown";
      setError(code === "ask_limit" ? t("chat.limit") : t(`errors.${ERRORS.includes(code) ? code : "unknown"}`));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!text) return;
    haptics.tap();
    const copied = await copyText(text);
    toast(copied ? t("text.copied") : t("codes.copyFailed"), copied ? "success" : "error");
  };

  if (!entry.transcript && busy !== "original") {
    return (
      <div className={styles.start}>
        <p>{readable ? t("text.intro") : t("text.tooSmall")}</p>
        {error && <p className={styles.error}>{error}</p>}
        <Button icon={<ScanText />} onClick={() => void read("original")} disabled={!readable} block>
          {t("text.read")}
        </Button>
        <small>{t("text.cost")}</small>
      </div>
    );
  }

  return (
    <div className={styles.text}>
      <div className={styles.languages} role="tablist" aria-label={t("text.translate")}>
        <button type="button" role="tab" aria-selected={shown === "original"} onClick={() => void read("original")}>
          {t("text.original")}
        </button>
        {translateLanguages.map((language) => (
          <button key={language} type="button" role="tab" aria-selected={shown === language} onClick={() => void read(language)} disabled={busy !== null && busy !== language}>
            {language === shown || entry.translations?.[language] ? null : <Languages size={13} />} {t(`text.languages.${language}`)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${shown}-${busy ?? ""}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: easeOut }}
          className={styles.panel}
        >
          {busy === shown ? (
            <p className={styles.loading}>
              <LoaderCircle size={16} className={styles.spin} /> {shown === "original" ? t("text.reading") : t("text.translating")}
            </p>
          ) : error ? (
            <div className={styles.failed}>
              <p className={styles.error}>{error}</p>
              <Button variant="secondary" icon={<RotateCcw />} onClick={() => void read(shown)}>
                {t("chat.retry")}
              </Button>
            </div>
          ) : text === "" ? (
            <p className={styles.empty}>{t("text.none")}</p>
          ) : text ? (
            <>
              <pre className={styles.content}>{text}</pre>
              <Button variant="secondary" icon={<Copy />} onClick={() => void copy()} block>
                {shown === "original" ? t("text.copy") : t("text.copyTranslation")}
              </Button>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
