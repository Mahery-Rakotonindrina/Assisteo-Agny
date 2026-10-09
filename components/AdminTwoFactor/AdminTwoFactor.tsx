import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { rise } from "@/lib/motion";
import type { AdminTwoFactorResponse } from "@/pages/api/admin/two-factor";
import { httpClient } from "@/services/httpClient";
import { ApiError } from "@/types/api";
import styles from "./AdminTwoFactor.module.scss";

type Asking = "disable" | "recovery" | null;

/** The second factor of /admin: turn it on with an authenticator app, off, or renew the recovery codes. */
export function AdminTwoFactor({ token, onSession }: { token: string; onSession: (session: string) => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<AdminTwoFactorResponse | null>(null);
  const [setup, setSetup] = useState<AdminTwoFactorResponse["setup"] | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    httpClient
      .get<AdminTwoFactorResponse>("/api/admin/two-factor", { headers: { Authorization: `Bearer ${token}` } })
      .then(setData)
      .catch(() => undefined);
  }, [token]);

  if (!data) return <div className={styles.card} aria-busy />;

  const send = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await httpClient.post<AdminTwoFactorResponse>("/api/admin/two-factor", body, { headers });
      setData(result);
      if (result.session) onSession(result.session.session);
      return result;
    } catch (err) {
      setError(err instanceof ApiError && err.code === "second_factor" ? t("admin.twoFactor.badCode") : t("admin.error"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const result = await send({ action: "start" });
    if (result?.setup) {
      setSetup(result.setup);
      setCode("");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const action = setup ? "confirm" : asking;
    if (!action) return;
    const result = await send({ action, code: code.trim() });
    if (!result) return;
    setCode("");
    setSetup(null);
    setAsking(null);
    if (result.recoveryCodes?.length) setCodes(result.recoveryCodes);
    if (action === "confirm") toast(t("admin.twoFactor.enabled"));
    if (action === "disable") toast(t("admin.twoFactor.disabled"));
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes?.join("\n") ?? "");
      toast(t("admin.twoFactor.copied"));
    } catch {
      toast(t("admin.error"), "error");
    }
  };

  const cancel = () => {
    setSetup(null);
    setAsking(null);
    setCode("");
    setError(null);
  };

  const codeField = (label: string) => (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        value={code}
        onChange={(event) => setCode(event.target.value.slice(0, 20))}
        inputMode={setup ? "numeric" : "text"}
        autoComplete="one-time-code"
        placeholder="123 456"
        autoFocus
      />
    </label>
  );

  return (
    <motion.section variants={rise} initial="hidden" animate="show" className={styles.card}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>
            {data.enabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />} {t("admin.twoFactor.title")}
          </h2>
          <p className={styles.subtitle}>{t("admin.twoFactor.subtitle")}</p>
        </div>
        <span className={styles.status} data-on={data.enabled}>
          {data.enabled ? t("admin.twoFactor.on") : t("admin.twoFactor.off")}
        </span>
      </div>

      {!data.available && !data.enabled && (
        <p className={styles.warning}>
          <ShieldAlert size={16} /> {t("admin.twoFactor.unavailable")}
        </p>
      )}
      {!data.durable && (
        <p className={styles.warning}>
          <ShieldAlert size={16} /> {t("admin.twoFactor.notDurable")}
        </p>
      )}

      {codes && (
        <div className={styles.codes}>
          <strong>
            <KeyRound size={16} /> {t("admin.twoFactor.recoveryTitle")}
          </strong>
          <p>{t("admin.twoFactor.recoveryHint")}</p>
          <ul>
            {codes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button variant="secondary" icon={<Copy />} onClick={() => void copyCodes()}>
              {t("admin.twoFactor.copy")}
            </Button>
            <Button icon={<Check />} onClick={() => setCodes(null)}>
              {t("admin.twoFactor.done")}
            </Button>
          </div>
        </div>
      )}

      {data.enabled && !asking && (
        <>
          <p className={styles.since}>
            {data.since && t("admin.twoFactor.since", { date: formatDate(Date.parse(data.since), locale) })} · {t("admin.twoFactor.recoveryLeft", { count: data.recoveryLeft })}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" icon={<RefreshCw />} onClick={() => setAsking("recovery")}>
              {t("admin.twoFactor.renew")}
            </Button>
            <Button variant="ghost" icon={<ShieldOff />} onClick={() => setAsking("disable")}>
              {t("admin.twoFactor.disable")}
            </Button>
          </div>
        </>
      )}

      {!data.enabled && !setup && data.available && (
        <Button block icon={<ShieldCheck />} disabled={busy} onClick={() => void start()}>
          {t("admin.twoFactor.enable")}
        </Button>
      )}

      {(setup || asking) && (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          {setup && (
            <>
              <p className={styles.step}>{t("admin.twoFactor.scan")}</p>
              <div className={styles.qr}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made by the server */}
                <img src={setup.qr} alt={t("admin.twoFactor.qrAlt")} width={180} height={180} />
              </div>
              <p className={styles.secret}>
                {t("admin.twoFactor.orType")} <code>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
              </p>
              <a className={styles.openApp} href={setup.uri}>
                <Smartphone size={15} /> {t("admin.twoFactor.openApp")}
              </a>
              {codeField(t("admin.twoFactor.enterCode"))}
            </>
          )}
          {asking && codeField(t("admin.twoFactor.codeFor"))}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={cancel}>
              {t("admin.twoFactor.cancel")}
            </Button>
            <Button type="submit" variant={asking === "disable" ? "danger" : "primary"} disabled={busy || !code.trim()}>
              {setup ? t("admin.twoFactor.confirm") : asking === "disable" ? t("admin.twoFactor.confirmDisable") : t("admin.twoFactor.confirmRenew")}
            </Button>
          </div>
        </form>
      )}
    </motion.section>
  );
}
