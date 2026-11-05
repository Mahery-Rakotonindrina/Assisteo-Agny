import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { Gift, Save } from "lucide-react";
import { Button } from "@/components/Button";
import shared from "@/components/AdminSubscriptions/AdminSubscriptions.module.scss";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { rise } from "@/lib/motion";
import type { AdminReferralResponse } from "@/pages/api/admin/referral";
import { httpClient } from "@/services/httpClient";
import styles from "./AdminReferral.module.scss";

/** Admin: the scans a referral gives each of the two people, and the monthly cap per referrer. */
export function AdminReferral({ token }: { token: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<AdminReferralResponse | null>(null);
  const [scans, setScans] = useState("");
  const [cap, setCap] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    httpClient
      .get<AdminReferralResponse>("/api/admin/referral", { headers: { Authorization: `Bearer ${token}` } })
      .then((result) => {
        if (cancelled) return;
        setState(result);
        setScans(String(result.scans));
        setCap(String(result.capPerMonth));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await httpClient.put<AdminReferralResponse>("/api/admin/referral", { scans: Number(scans), capPerMonth: Number(cap) }, { headers: { Authorization: `Bearer ${token}` } });
      setState(result);
      toast(t("referralBonus.admin.saved"), "success");
    } catch {
      toast(t("admin.error"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form variants={rise} initial="hidden" animate="show" className={shared.card} onSubmit={(event) => void save(event)} data-testid="admin-referral">
      <div>
        <h2 className={shared.title}>
          <Gift size={18} /> {t("referralBonus.admin.title")}
        </h2>
        <p className={shared.subtitle}>{t("referralBonus.admin.subtitle")}</p>
      </div>
      {failed && <p className={shared.error}>{t("admin.error")}</p>}
      {state && (
        <>
          <label className={styles.field}>
            <span>{t("referralBonus.admin.scans")}</span>
            <input type="number" inputMode="numeric" min={0} max={100} value={scans} onChange={(event) => setScans(event.target.value)} data-testid="referral-scans" />
          </label>
          <label className={styles.field}>
            <span>{t("referralBonus.admin.cap")}</span>
            <input type="number" inputMode="numeric" min={0} max={1000} value={cap} onChange={(event) => setCap(event.target.value)} data-testid="referral-cap" />
          </label>
          <p className={shared.subtitle}>{t("referralBonus.admin.rewarded", { count: state.rewarded })}</p>
          <Button type="submit" block icon={<Save />} disabled={busy || scans === "" || cap === ""}>
            {t("referralBonus.admin.save")}
          </Button>
        </>
      )}
    </motion.form>
  );
}
