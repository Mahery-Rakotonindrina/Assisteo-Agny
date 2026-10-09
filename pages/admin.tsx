import Head from "next/head";
import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { Download, Gauge, Gift, KeyRound, LockKeyhole, Smartphone, LogOut, MessageCircle, Minus, Plus, Save, ShieldAlert, Wifi } from "lucide-react";
import { AdminAiCost } from "@/components/AdminAiCost";
import { AdminPlans } from "@/components/AdminPlans";
import { AdminStats } from "@/components/AdminStats";
import { AdminSubscriptions } from "@/components/AdminSubscriptions";
import { AdminTwoFactor } from "@/components/AdminTwoFactor";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { rise, stagger } from "@/lib/motion";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";
import type { AdminLoginResponse } from "@/pages/api/admin/login";
import type { AdminTrialResponse } from "@/pages/api/admin/trial";
import type { AppVersionResponse } from "@/pages/api/app-version";
import styles from "@/styles/Admin.module.scss";

// A signed session from /api/admin/login (never the admin token itself).
const TOKEN_KEY = "admin-session";

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Owner-only page: subscribers, usage, free trial limits and app versions, without redeploying. */
export default function AdminPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { isAdmin } = usePlan();
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [config, setConfig] = useState<AdminTrialResponse | null>(null);
  const [limit, setLimit] = useState(7);
  const [ipLimit, setIpLimit] = useState(20);
  const [askLimit, setAskLimit] = useState(20);
  const [dailyLimit, setDailyLimit] = useState(200);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const headers = (value: string) => ({ Authorization: `Bearer ${value}` });

  const fetchConfig = (value: string) => httpClient.get<AdminTrialResponse>("/api/admin/trial", { headers: headers(value) });

  const keepSession = (value: string) => {
    setToken(value);
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      // Private mode: the session just won't survive a reload.
    }
  };

  const apply = (result: AdminTrialResponse, value: string) => {
    setError(null);
    setConfig(result);
    setLimit(result.limit);
    setIpLimit(result.ipLimit);
    setAskLimit(result.askLimit);
    setDailyLimit(result.dailyLimit);
    keepSession(value);
  };

  // The token, then the code of the authenticator app when the second factor is on.
  const unlock = async () => {
    setUnlocking(true);
    try {
      const login = await httpClient.post<AdminLoginResponse>("/api/admin/login", { token: draftToken.trim(), code: needCode ? draftCode.trim() : undefined });
      apply(await fetchConfig(login.session), login.session);
      setDraftToken("");
      setDraftCode("");
      setNeedCode(false);
    } catch (err) {
      setToken("");
      setConfig(null);
      if (err instanceof ApiError && err.code === "second_factor") {
        setError(needCode ? t("admin.badCode") : null);
        setNeedCode(true);
        setDraftCode("");
        return;
      }
      setError(
        err instanceof ApiError && err.status === 401
          ? t("admin.badToken")
          : err instanceof ApiError && err.status === 429
            ? t("admin.tooMany")
            : err instanceof ApiError && err.status === 503
              ? t("admin.disabled")
              : t("admin.error"),
      );
    } finally {
      setUnlocking(false);
    }
  };

  // Restore the session after a reload.
  useEffect(() => {
    const saved = readToken();
    if (!saved) return;
    fetchConfig(saved)
      .then((result) => apply(result, saved))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await httpClient.put<AdminTrialResponse>("/api/admin/trial", { limit, ipLimit, askLimit, dailyLimit }, { headers: headers(token) });
      setConfig(result);
      toast(t("admin.saved"));
    } catch {
      toast(t("admin.error"), "error");
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored.
    }
    setToken("");
    setConfig(null);
    setDraftToken("");
    setDraftCode("");
    setNeedCode(false);
  };

  const dirty = config !== null && (config.limit !== limit || config.ipLimit !== ipLimit || config.askLimit !== askLimit || config.dailyLimit !== dailyLimit);

  return (
    <>
      <Head>
        <title>{`${t("admin.title")} · ${t("meta.title")}`}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("admin.title")}</h1>
          <p>{t("admin.subtitle")}</p>
        </motion.header>

        {config && <AdminSubscriptions token={token} />}
        {config && <AdminPlans token={token} />}
        {config && <AdminAiCost token={token} />}
        {config && <AdminStats token={token} />}

        {!config ? (
          <motion.form
            variants={rise}
            className={styles.card}
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <label className={styles.label} htmlFor="admin-token">
              <LockKeyhole size={16} /> {t("admin.token")}
            </label>
            <input
              id="admin-token"
              className={styles.input}
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              autoComplete="off"
            />
            {needCode && (
              <>
                <label className={styles.label} htmlFor="admin-code">
                  <KeyRound size={16} /> {t("admin.code")}
                </label>
                <input
                  id="admin-code"
                  className={styles.input}
                  value={draftCode}
                  onChange={(event) => setDraftCode(event.target.value.slice(0, 20))}
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  autoFocus
                />
                <small className={styles.hint}>{t("admin.codeHint")}</small>
              </>
            )}
            {isAdmin && !error && !needCode && <p className={styles.hint}>{t("admin.adminAccount")}</p>}
            {error && <p className={styles.error}>{error}</p>}
            <Button type="submit" block disabled={!draftToken.trim() || (needCode && !draftCode.trim()) || unlocking}>
              {t("admin.unlock")}
            </Button>
          </motion.form>
        ) : (
          <motion.form variants={rise} className={styles.card} onSubmit={(event) => void save(event)}>
            {!config.durable && (
              <p className={styles.warning}>
                <ShieldAlert size={16} /> {t("admin.notDurable")}
              </p>
            )}

            <Stepper
              icon={<Gift size={18} />}
              label={t("admin.limit")}
              hint={t("admin.limitHint")}
              value={limit}
              min={0}
              max={1000}
              onChange={setLimit}
            />
            <Stepper
              icon={<Wifi size={18} />}
              label={t("admin.ipLimit")}
              hint={t("admin.ipLimitHint")}
              value={ipLimit}
              min={1}
              max={100000}
              onChange={setIpLimit}
            />

            <Stepper
              icon={<MessageCircle size={18} />}
              label={t("admin.askLimit")}
              hint={t("admin.askLimitHint")}
              value={askLimit}
              min={0}
              max={1000}
              onChange={setAskLimit}
            />

            <Stepper
              icon={<Gauge size={18} />}
              label={t("admin.dailyLimit")}
              hint={t("admin.dailyLimitHint", { used: config.todayUsed })}
              value={dailyLimit}
              min={0}
              max={1000000}
              onChange={setDailyLimit}
            />

            <Button type="submit" block icon={<Save />} disabled={!dirty || saving}>
              {t("admin.save")}
            </Button>
            <Button variant="ghost" block icon={<LogOut />} onClick={logout}>
              {t("admin.logout")}
            </Button>
          </motion.form>
        )}

        {config && <AppVersionCard token={token} />}
        {config && <AdminTwoFactor token={token} onSession={keepSession} />}
      </motion.div>
    </>
  );
}

type StepperProps = {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

function Stepper({ icon, label, hint, value, min, max, onChange }: StepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Number.isFinite(next) ? Math.round(next) : min));
  return (
    <div className={styles.stepper}>
      <div className={styles.stepperText}>
        <span className={styles.stepperLabel}>
          {icon} {label}
        </span>
        <small>{hint}</small>
      </div>
      <div className={styles.stepperControl}>
        <button type="button" onClick={() => onChange(clamp(value - 1))} aria-label="-1">
          <Minus size={16} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
          aria-label={label}
        />
        <button type="button" onClick={() => onChange(clamp(value + 1))} aria-label="+1">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

const VERSION_PATTERN = /^(\d+(\.\d+){0,2})?$/;

/** Minimum and latest app versions, checked by the native apps at launch. */
function AppVersionCard({ token }: { token: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [saved, setSaved] = useState<AppVersionResponse | null>(null);
  const [draft, setDraft] = useState<AppVersionResponse>({ minimum: "", latest: "", downloadUrl: "" });
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    httpClient
      .get<AppVersionResponse>("/api/admin/app", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        setSaved(result);
        setDraft(result);
      })
      .catch(() => undefined);
  }, [token]);

  const valid = VERSION_PATTERN.test(draft.minimum) && VERSION_PATTERN.test(draft.latest) && (!draft.downloadUrl || draft.downloadUrl.startsWith("https://"));
  const dirty = saved !== null && (saved.minimum !== draft.minimum || saved.latest !== draft.latest || saved.downloadUrl !== draft.downloadUrl);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await httpClient.put<AppVersionResponse>("/api/admin/app", draft, { headers });
      setSaved(result);
      toast(t("admin.saved"));
    } catch {
      toast(t("admin.error"), "error");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof AppVersionResponse, label: string, hint: string | null, icon: React.ReactNode, placeholder: string) => (
    <label className={styles.field}>
      <span className={styles.label}>
        {icon} {label}
      </span>
      <input
        className={styles.input}
        value={draft[key]}
        placeholder={placeholder}
        inputMode={key === "downloadUrl" ? "url" : "decimal"}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value.trim() })}
      />
      {hint && <small>{hint}</small>}
    </label>
  );

  return (
    <motion.form variants={rise} initial="hidden" animate="show" className={styles.card} onSubmit={(event) => void save(event)}>
      <div>
        <h2 className={styles.cardTitle}>{t("admin.appTitle")}</h2>
        <p className={styles.cardSubtitle}>{t("admin.appSubtitle")}</p>
      </div>
      {field("minimum", t("admin.minimum"), t("admin.minimumHint"), <ShieldAlert size={16} />, "1.0.0")}
      {field("latest", t("admin.latest"), t("admin.latestHint"), <Smartphone size={16} />, "1.0.0")}
      {field("downloadUrl", t("admin.downloadUrl"), null, <Download size={16} />, "https://…")}
      {!valid && <p className={styles.error}>{t("admin.invalidVersion")}</p>}
      <Button type="submit" block icon={<Save />} disabled={!dirty || !valid || saving}>
        {t("admin.save")}
      </Button>
    </motion.form>
  );
}
