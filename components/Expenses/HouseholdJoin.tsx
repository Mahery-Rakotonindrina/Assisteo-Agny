import { useState, type FormEvent } from "react";
import { Home, KeyRound } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { householdErrorKey, normalizeInviteCode } from "@/lib/household";
import { haptics } from "@/services/device";
import { householdStore } from "@/services/household";
import { ApiError } from "@/types/api";
import styles from "./Expenses.module.scss";

/** The message for a failed household request. */
export const householdFailure = (error: unknown) => householdErrorKey(error instanceof ApiError ? error.code : "failed");

/** Not in a household yet: join one with a code, or create one (Admin plan while tested). */
export function HouseholdJoin({ canCreate, initialCode }: { canCreate: boolean; initialCode?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [code, setCode] = useState(initialCode ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (event: FormEvent, action: Parameters<typeof householdStore.act>[0], done: () => string) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await householdStore.act(action);
      haptics.success();
      toast(done());
    } catch (failure) {
      haptics.error();
      setError(t(householdFailure(failure)));
    } finally {
      setBusy(false);
    }
  };

  const cleanCode = normalizeInviteCode(code);
  const join = (event: FormEvent) => {
    if (!cleanCode) {
      event.preventDefault();
      setError(t("expenses.household.codeInvalid"));
      return;
    }
    void run(event, { action: "join", code: cleanCode }, () => t("expenses.household.joined"));
  };
  const create = (event: FormEvent) => void run(event, { action: "create", name: name.trim() }, () => t("expenses.household.created", { name: name.trim() }));

  return (
    <div className={styles.panel}>
      {error && (
        <p className={styles.banner} data-level="over" role="alert">
          {error}
        </p>
      )}
      <form className={`${styles.form} ${styles.householdCard}`} onSubmit={join} aria-label={t("expenses.household.joinTitle")}>
        <h2 className={styles.subTitle}>{t("expenses.household.joinTitle")}</h2>
        <p className={styles.hint}>{t("expenses.household.joinBody")}</p>
        <div className={styles.fields}>
          <label className={styles.wide}>
            <span>{t("expenses.household.code")}</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="4K7-P2Q" maxLength={9} className={styles.codeInput} />
          </label>
        </div>
        <div className={styles.row}>
          <Button type="submit" icon={<KeyRound />} disabled={busy || !code.trim()}>
            {t("expenses.household.join")}
          </Button>
        </div>
      </form>

      {canCreate && (
        <form className={`${styles.form} ${styles.householdCard}`} onSubmit={create} aria-label={t("expenses.household.createTitle")}>
          <h2 className={styles.subTitle}>{t("expenses.household.createTitle")}</h2>
          <p className={styles.hint}>{t("expenses.household.createBody")}</p>
          <div className={styles.fields}>
            <label className={styles.wide}>
              <span>{t("expenses.household.name")}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={t("expenses.household.namePlaceholder")} required />
            </label>
          </div>
          <div className={styles.row}>
            <Button type="submit" icon={<Home />} disabled={busy || !name.trim()}>
              {t("expenses.household.create")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
