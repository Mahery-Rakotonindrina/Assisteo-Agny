import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { userModels, type AiOverride, type VerifyKeyResponse } from "@/lib/ai/schema";
import { easeOut } from "@/lib/motion";
import { aiKeyStore, maskKey } from "@/services/aiKeyStore";
import { analysisService } from "@/services/analysisService";
import { haptics } from "@/services/device";
import styles from "./AiKeySettings.module.scss";

type Choice = "server" | AiOverride["provider"];
type Provider = AiOverride["provider"];

const keyLinks: Record<Provider, string> = {
  gemini: "https://aistudio.google.com/app/apikey",
  claude: "https://console.anthropic.com/settings/keys",
};

const keyPlaceholders: Record<Provider, string> = {
  gemini: "AIza… / AQ.…",
  claude: "sk-ant-…",
};

const defaultModels: Record<Provider, AiOverride["model"]> = {
  gemini: "gemini-flash-latest",
  claude: "claude-opus-5-5",
};

/** Lets the user analyse with their own Claude or Gemini key instead of the server's. */
export function AiKeySettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [saved, setSaved] = useState<AiOverride | null>(null);
  const [choice, setChoice] = useState<Choice>("server");
  const [models, setModels] = useState(defaultModels);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [failure, setFailure] = useState<Extract<VerifyKeyResponse, { ok: false }>["reason"] | "network" | null>(null);

  useEffect(() => {
    void aiKeyStore.get().then((override) => {
      setSaved(override);
      if (override) {
        setChoice(override.provider);
        setModels((current) => ({ ...current, [override.provider]: override.model }));
      }
    });
  }, []);

  const provider = choice === "server" ? null : choice;
  const savedForChoice = saved && saved.provider === provider ? saved : null;
  const modelChanged = savedForChoice && savedForChoice.model !== models[savedForChoice.provider];

  const select = (next: Choice) => {
    setChoice(next);
    setKey("");
    setFailure(null);
  };

  const testAndSave = async () => {
    if (!provider) return;
    const apiKey = key.trim() || savedForChoice?.apiKey;
    if (!apiKey) return;
    const override = { provider, apiKey, model: models[provider] } as AiOverride;
    setTesting(true);
    setFailure(null);
    try {
      const result = await analysisService.verifyKey(override);
      if (result.ok) {
        await aiKeyStore.save(override);
        setSaved(override);
        setKey("");
        haptics.success();
        toast(t("settings.aiKeySaved"));
      } else {
        haptics.error();
        setFailure(result.reason);
      }
    } catch {
      haptics.error();
      setFailure("network");
    } finally {
      setTesting(false);
    }
  };

  const removeKey = async () => {
    await aiKeyStore.clear();
    setSaved(null);
    setChoice("server");
    setKey("");
    toast(t("settings.aiKeyRemoved"));
  };

  return (
    <div className={styles.wrap}>
      <SegmentedControl
        ariaLabel={t("settings.aiEngine")}
        value={choice}
        onChange={select}
        options={[
          { value: "server", label: t("settings.aiServer") },
          { value: "gemini", label: "Gemini" },
          { value: "claude", label: "Claude" },
        ]}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={choice}
          className={styles.panel}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: easeOut }}
        >
          {!provider ? (
            <>
              <p className={styles.hint}>{t("settings.aiServerHint")}</p>
              {saved && (
                <Button variant="secondary" block onClick={() => void removeKey()}>
                  {t("settings.aiUseServer")}
                </Button>
              )}
            </>
          ) : (
            <>
              <div className={styles.field}>
                <span className={styles.label}>{t("settings.aiModel")}</span>
                <SegmentedControl
                  ariaLabel={t("settings.aiModel")}
                  value={models[provider]}
                  onChange={(model) => setModels((current) => ({ ...current, [provider]: model }))}
                  options={userModels[provider].map((model) => ({ value: model, label: t(`settings.aiModels.${model}`) }))}
                />
                <p className={styles.hint}>{t(`settings.aiModelHints.${models[provider]}`)}</p>
              </div>

              {savedForChoice && !key ? (
                <div className={styles.active}>
                  <span className={styles.activeIcon}>
                    <Check size={16} strokeWidth={3} />
                  </span>
                  <div>
                    <strong>{t("settings.aiKeyActive")}</strong>
                    <small>
                      {maskKey(savedForChoice.apiKey)} · {t(`settings.aiModels.${savedForChoice.model}`)}
                    </small>
                  </div>
                  <button type="button" className={styles.iconButton} onClick={() => void removeKey()} aria-label={t("settings.aiKeyRemove")}>
                    <Trash2 size={17} />
                  </button>
                </div>
              ) : null}

              <div className={styles.field}>
                <label className={styles.label} htmlFor="ai-key">
                  {savedForChoice ? t("settings.aiKeyReplace") : t("settings.aiKey")}
                </label>
                <div className={styles.input}>
                  <KeyRound size={17} />
                  <input
                    id="ai-key"
                    type={showKey ? "text" : "password"}
                    value={key}
                    onChange={(event) => {
                      setKey(event.target.value);
                      setFailure(null);
                    }}
                    placeholder={keyPlaceholders[provider]}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => setShowKey((current) => !current)}
                    aria-label={showKey ? t("settings.aiKeyHide") : t("settings.aiKeyShow")}
                  >
                    {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <a className={styles.link} href={keyLinks[provider]} target="_blank" rel="noopener noreferrer">
                  {t(`settings.aiGetKey.${provider}`)} <ExternalLink size={13} />
                </a>
              </div>

              {failure && (
                <p className={styles.error} role="alert">
                  {t(`settings.aiKeyErrors.${failure}`)}
                </p>
              )}

              <Button
                block
                icon={testing ? <Loader2 className={styles.spin} /> : <ShieldCheck />}
                onClick={() => void testAndSave()}
                disabled={testing || (!key.trim() && !(savedForChoice && modelChanged))}
              >
                {testing ? t("settings.aiKeyTesting") : t("settings.aiKeyTest")}
              </Button>

              <p className={styles.privacy}>{t("settings.aiKeyPrivacy")}</p>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
