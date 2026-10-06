import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Check, Cpu, ExternalLink, Eye, EyeOff, Globe, KeyRound, ListRestart, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { useTrial } from "@/hooks/useTrial";
import { findPreset, providerPresets, type ProviderPreset } from "@/lib/ai/presets";
import type { AiOverride, VerifyFailure } from "@/lib/ai/schema";
import { easeOut, spring } from "@/lib/motion";
import { aiKeyStore, maskKey, type SavedKey } from "@/services/aiKeyStore";
import { analysisService } from "@/services/analysisService";
import { haptics } from "@/services/device";
import styles from "./AiKeySettings.module.scss";

type Draft = { model: string; baseUrl: string };
type Failure = { reason: VerifyFailure | "network"; detail?: string };

const MAX_SUGGESTIONS = 12;

function toOverride(preset: ProviderPreset, apiKey: string, draft: Draft): AiOverride {
  const model = draft.model.trim();
  if (preset.protocol === "openai") {
    return { provider: "openai", apiKey, model, baseUrl: (preset.baseUrl ?? draft.baseUrl).trim() };
  }
  return { provider: preset.protocol, apiKey, model };
}

/** Lets the user analyse with their own key for any provider instead of the server's AI. */
export function AiKeySettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const trial = useTrial();
  const [saved, setSaved] = useState<SavedKey | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsFailure, setModelsFailure] = useState<VerifyFailure | "network" | null>(null);

  useEffect(() => {
    void aiKeyStore.get().then((current) => {
      setSaved(current);
      if (current) {
        setChosen(current.presetId);
        setDrafts((all) => ({
          ...all,
          [current.presetId]: { model: current.model, baseUrl: current.provider === "openai" ? current.baseUrl : "" },
        }));
      }
    });
  }, []);

  // Once the free trial is over, start on Gemini (free keys) rather than the server.
  const choice = chosen ?? (trial.exhausted && !saved ? "gemini" : "server");
  const preset = choice === "server" ? undefined : findPreset(choice);
  const draft: Draft = (preset && drafts[preset.id]) ?? { model: preset?.suggestedModels[0] ?? "", baseUrl: "" };
  const savedForChoice = saved && saved.presetId === choice ? saved : null;
  const apiKey = key.trim() || savedForChoice?.apiKey || "";
  const needsBaseUrl = preset?.protocol === "openai" && !preset.baseUrl;

  const updateDraft = (patch: Partial<Draft>) => {
    if (!preset) return;
    setDrafts((all) => ({ ...all, [preset.id]: { ...draft, ...patch } }));
    setFailure(null);
  };

  const select = (next: string) => {
    if (next === choice) return;
    haptics.tap();
    setChosen(next);
    setKey("");
    setFailure(null);
    setModels(null);
    setModelsFailure(null);
  };

  const suggestions = useMemo(() => {
    const pool = [...new Set([...(preset?.suggestedModels ?? []), ...(models ?? [])])];
    const needle = draft.model.trim().toLowerCase();
    const matches = needle ? pool.filter((model) => model.toLowerCase().includes(needle) && model !== draft.model) : pool;
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [draft.model, models, preset]);

  const loadModels = async () => {
    if (!preset || !apiKey) return;
    setLoadingModels(true);
    setModelsFailure(null);
    try {
      const request =
        preset.protocol === "openai"
          ? { provider: "openai" as const, apiKey, baseUrl: (preset.baseUrl ?? draft.baseUrl).trim() }
          : { provider: preset.protocol, apiKey };
      const result = await analysisService.listModels(request);
      if (result.ok) setModels(result.models);
      else setModelsFailure(result.reason);
    } catch {
      setModelsFailure("network");
    } finally {
      setLoadingModels(false);
    }
  };

  const testAndSave = async () => {
    if (!preset || !apiKey || !draft.model.trim()) return;
    const override = toOverride(preset, apiKey, draft);
    setTesting(true);
    setFailure(null);
    try {
      const result = await analysisService.verifyKey(override);
      if (result.ok) {
        const next: SavedKey = { ...override, presetId: preset.id };
        await aiKeyStore.save(next);
        setSaved(next);
        setKey("");
        haptics.success();
        toast(t("settings.aiKeySaved"));
      } else {
        haptics.error();
        setFailure({ reason: result.reason, detail: result.detail });
      }
    } catch {
      haptics.error();
      setFailure({ reason: "network" });
    } finally {
      setTesting(false);
    }
  };

  const removeKey = async () => {
    await aiKeyStore.clear();
    setSaved(null);
    setChosen("server");
    setKey("");
    toast(t("settings.aiKeyRemoved"));
  };

  const changed =
    savedForChoice &&
    (savedForChoice.model !== draft.model.trim() ||
      (savedForChoice.provider === "openai" && needsBaseUrl && savedForChoice.baseUrl !== draft.baseUrl.trim()));
  const canTest = Boolean(preset && apiKey && draft.model.trim() && (!needsBaseUrl || draft.baseUrl.trim()) && (key.trim() || changed));

  return (
    <div className={styles.wrap}>
      <div className={styles.providers} role="radiogroup" aria-label={t("settings.aiProvider")}>
        {[{ id: "server", name: t("settings.aiServer"), free: false }, ...providerPresets].map((item) => {
          const active = item.id === choice;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.provider} ${active ? styles.providerActive : ""}`}
              onClick={() => select(item.id)}
            >
              {active && <motion.span layoutId="ai-provider-pill" className={styles.providerPill} transition={spring} />}
              <span className={styles.providerName}>
                {item.id === "custom" ? t("settings.aiCustom") : item.name}
                {item.free && <span className={styles.free}>{t("settings.aiFree")}</span>}
                {saved?.presetId === item.id && <Check size={13} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={choice}
          className={styles.panel}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: easeOut }}
        >
          {!preset ? (
            <>
              <p className={styles.hint}>{t("settings.aiServerHint")}</p>
              {trial.limited && trial.remaining !== null && (
                <p className={trial.exhausted ? styles.error : styles.trial}>
                  {trial.exhausted
                    ? t("trial.settingsOver")
                    : t("trial.settingsLeft", { remaining: trial.remaining, limit: trial.limit ?? 0 })}
                </p>
              )}
              {saved && (
                <Button variant="secondary" block onClick={() => void removeKey()}>
                  {t("settings.aiUseServer")}
                </Button>
              )}
            </>
          ) : (
            <>
              {savedForChoice && !key && (
                <div className={styles.active}>
                  <span className={styles.activeIcon}>
                    <Check size={16} strokeWidth={3} />
                  </span>
                  <div>
                    <strong>{t("settings.aiKeyActive")}</strong>
                    <small>
                      {maskKey(savedForChoice.apiKey)} · {savedForChoice.model}
                    </small>
                  </div>
                  <button type="button" className={styles.iconButton} onClick={() => void removeKey()} aria-label={t("settings.aiKeyRemove")}>
                    <Trash2 size={17} />
                  </button>
                </div>
              )}

              {needsBaseUrl && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ai-base-url">
                    {t("settings.aiBaseUrl")}
                  </label>
                  <div className={styles.input}>
                    <Globe size={17} />
                    <input
                      id="ai-base-url"
                      type="url"
                      inputMode="url"
                      value={draft.baseUrl}
                      onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                      placeholder="https://api.example.com/v1"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                    />
                  </div>
                  <p className={styles.hint}>{t("settings.aiBaseUrlHint")}</p>
                </div>
              )}

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
                    placeholder={preset.keyPlaceholder}
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
                {preset.keyUrl && (
                  <a className={styles.link} href={preset.keyUrl} target="_blank" rel="noopener noreferrer">
                    {t("settings.aiGetKey", { name: preset.name })} <ExternalLink size={13} />
                  </a>
                )}
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="ai-model">
                    {t("settings.aiModel")}
                  </label>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => void loadModels()}
                    disabled={!apiKey || loadingModels || (needsBaseUrl && !draft.baseUrl.trim())}
                  >
                    {loadingModels ? <Loader2 size={14} className={styles.spin} /> : <ListRestart size={14} />}
                    {t("settings.aiLoadModels")}
                  </button>
                </div>
                <div className={styles.input}>
                  <Cpu size={17} />
                  <input
                    id="ai-model"
                    value={draft.model}
                    onChange={(event) => updateDraft({ model: event.target.value })}
                    placeholder={t("settings.aiModelPlaceholder")}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </div>
                {suggestions.length > 0 && (
                  <div className={styles.suggestions}>
                    {suggestions.map((model) => (
                      <button key={model} type="button" className={styles.suggestion} onClick={() => updateDraft({ model })}>
                        {model}
                      </button>
                    ))}
                  </div>
                )}
                <p className={styles.hint}>
                  {modelsFailure
                    ? t(`settings.aiKeyErrors.${modelsFailure}`, { detail: "" })
                    : models
                      ? t("settings.aiModelsLoaded", { count: models.length })
                      : t("settings.aiModelHint")}
                </p>
              </div>

              {failure && (
                <p className={styles.error} role="alert">
                  {t(`settings.aiKeyErrors.${failure.reason}`, { detail: failure.detail ?? "" })}
                </p>
              )}

              <Button
                block
                icon={testing ? <Loader2 className={styles.spin} /> : <ShieldCheck />}
                onClick={() => void testAndSave()}
                disabled={testing || !canTest}
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
