import Head from "next/head";
import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { Gauge, Gift, LockKeyhole, LogOut, MessageCircle, Minus, Plus, Save, ShieldAlert, Wifi } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { rise, stagger } from "@/lib/motion";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";
import type { AdminTrialResponse } from "@/pages/api/admin/trial";
import styles from "@/styles/Admin.module.scss";

const TOKEN_KEY = "admin-token";

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Owner-only page to change the free trial limits without redeploying. */
export default function AdminPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [config, setConfig] = useState<AdminTrialResponse | null>(null);
  const [limit, setLimit] = useState(7);
  const [ipLimit, setIpLimit] = useState(20);
  const [askLimit, setAskLimit] = useState(20);
  const [dailyLimit, setDailyLimit] = useState(200);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const headers = (value: string) => ({ Authorization: `Bearer ${value}` });

  const fetchConfig = (value: string) => httpClient.get<AdminTrialResponse>("/api/admin/trial", { headers: headers(value) });

  const apply = (result: AdminTrialResponse, value: string) => {
    setError(null);
    setConfig(result);
    setLimit(result.limit);
    setIpLimit(result.ipLimit);
    setAskLimit(result.askLimit);
    setDailyLimit(result.dailyLimit);
    setToken(value);
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      // Private mode: the token just won't survive a reload.
    }
  };

  const unlock = async (value: string) => {
    try {
      apply(await fetchConfig(value), value);
    } catch (err) {
      setToken("");
      setConfig(null);
      setError(
        err instanceof ApiError && err.status === 401
          ? t("admin.badToken")
          : err instanceof ApiError && err.status === 503
            ? t("admin.disabled")
            : t("admin.error"),
      );
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

        {!config ? (
          <motion.form
            variants={rise}
            className={styles.card}
            onSubmit={(event) => {
              event.preventDefault();
              void unlock(draftToken.trim());
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
            {error && <p className={styles.error}>{error}</p>}
            <Button type="submit" block disabled={!draftToken.trim()}>
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
