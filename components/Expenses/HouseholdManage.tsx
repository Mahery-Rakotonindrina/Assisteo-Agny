import { useState, type FormEvent } from "react";
import { Ban, Check, Crown, KeyRound, LogOut, Share2, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { config } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { formatInviteCode, type HouseholdAction, type HouseholdInfo } from "@/lib/household";
import { haptics, shareText } from "@/services/device";
import { householdStore } from "@/services/household";
import { parseAmount } from "./ExpenseForm";
import { householdFailure } from "./HouseholdJoin";
import styles from "./Expenses.module.scss";

/**
 * The household's members and settings. Its creator invites (a code for 48 h),
 * removes members, renames it and sets the shared budget; a member can leave.
 */
export function HouseholdManage({ household, me }: { household: HouseholdInfo; me: string | null }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const owner = household.role === "owner";
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const act = async (action: HouseholdAction, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await householdStore.act(action);
      haptics.success();
      if (done) toast(done);
      setConfirm(null);
    } catch (failure) {
      haptics.error();
      toast(t(householdFailure(failure)), "error");
    } finally {
      setBusy(false);
    }
  };

  const share = async (code: string) => {
    const message = t("expenses.household.shareText", { name: household.name, code: formatInviteCode(code) });
    const link = config.siteUrl ? ` ${config.siteUrl}/expenses?join=${code}` : "";
    if ((await shareText(t("expenses.household.shareTitle"), message + link)) === "copied") toast(t("expenses.household.copied"));
  };

  return (
    <section className={`${styles.panel} ${styles.householdCard}`} aria-label={t("expenses.household.manage")}>
      <h2 className={styles.subTitle}>{t("expenses.household.manage")}</h2>

      {owner && (
        <div className={styles.invite}>
          <strong>{t("expenses.household.inviteTitle")}</strong>
          {household.invite ? (
            <>
              <span className={styles.code} data-testid="household-code">
                {formatInviteCode(household.invite.code)}
              </span>
              <small className={styles.hint}>{t("expenses.household.expires", { date: formatDateTime(new Date(household.invite.expiresAt).getTime(), locale) })}</small>
              <div className={styles.row}>
                <Button icon={<Share2 />} onClick={() => void share(household.invite!.code)}>
                  {t("expenses.household.share")}
                </Button>
                <Button variant="ghost" icon={<KeyRound />} disabled={busy} onClick={() => void act({ action: "invite" })}>
                  {t("expenses.household.newCode")}
                </Button>
                <Button variant="ghost" icon={<Ban />} disabled={busy} onClick={() => void act({ action: "revoke" }, t("expenses.household.revoked"))}>
                  {t("expenses.household.revoke")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <small className={styles.hint}>{t("expenses.household.inviteBody")}</small>
              <div className={styles.row}>
                <Button icon={<KeyRound />} disabled={busy} onClick={() => void act({ action: "invite" })}>
                  {t("expenses.household.makeCode")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <div>
        <h3 className={styles.subTitle}>{t("expenses.household.members", { count: household.members.length })}</h3>
        <ul className={styles.entries}>
          {household.members.map((member) => {
            const self = member.userId === me;
            const asking = confirm === `remove:${member.userId}`;
            return (
              <li key={member.userId} className={styles.entry}>
                <span className={styles.entryMain}>
                  {member.role === "owner" ? <Crown size={16} aria-hidden /> : <i className={styles.dot} />}
                  <span className={styles.entryText}>
                    <strong>{self ? t("expenses.household.you") : member.label}</strong>
                    <small>{member.role === "owner" ? t("expenses.household.owner") : t("expenses.household.member")}</small>
                  </span>
                  {owner && !self && member.role === "member" && (
                    <Button
                      variant={asking ? "danger" : "ghost"}
                      icon={<UserMinus />}
                      disabled={busy}
                      onClick={() => (asking ? void act({ action: "remove", userId: member.userId }) : setConfirm(`remove:${member.userId}`))}
                    >
                      {asking ? t("expenses.household.removeConfirm") : t("expenses.household.remove")}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {owner && <OwnerSettings household={household} busy={busy} act={act} />}

      {confirm === "leave" && <p className={styles.hint}>{t(owner ? "expenses.household.deleteHint" : "expenses.household.leaveHint", { name: household.name })}</p>}
      <div className={styles.row}>
        <Button
          variant={confirm === "leave" ? "danger" : "ghost"}
          icon={owner ? <Trash2 /> : <LogOut />}
          disabled={busy}
          onClick={() =>
            confirm === "leave"
              ? void act({ action: owner ? "delete" : "leave" }, t(owner ? "expenses.household.deleted" : "expenses.household.left"))
              : setConfirm("leave")
          }
        >
          {confirm === "leave" ? t("expenses.household.confirm") : t(owner ? "expenses.household.delete" : "expenses.household.leave")}
        </Button>
        {confirm && (
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            {t("expenses.cancel")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** The creator's settings: the name and the shared budget (built-in categories only). */
function OwnerSettings({ household, busy, act }: { household: HouseholdInfo; busy: boolean; act: (action: HouseholdAction, done?: string) => Promise<void> }) {
  const { t } = useTranslation();
  const { categories } = useExpenseLabels([]);
  const [name, setName] = useState(household.name);
  const [total, setTotal] = useState(household.budget.total ? String(household.budget.total) : "");
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(household.budget.categories).map(([key, value]) => [key, String(value)])));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const kept = Object.fromEntries(Object.entries(caps).flatMap(([key, value]) => {
      const amount = parseAmount(value);
      return amount ? [[key, Math.round(amount)]] : [];
    }));
    const cap = parseAmount(total);
    void act({ action: "update", name: name.trim() || household.name, budget: { total: cap ? Math.round(cap) : undefined, categories: kept } }, t("expenses.household.saved"));
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={t("expenses.household.settings")}>
      <h3 className={styles.subTitle}>{t("expenses.household.budgetTitle")}</h3>
      <p className={styles.hint}>{t("expenses.household.budgetHint")}</p>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.household.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
        </label>
        <label className={styles.wide}>
          <span>{t("expenses.budget.overall")}</span>
          <input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="numeric" placeholder="Ar" />
        </label>
        {categories.map((category) => (
          <label key={category.id}>
            <span>{category.name}</span>
            <input value={caps[category.id] ?? ""} onChange={(event) => setCaps({ ...caps, [category.id]: event.target.value })} inputMode="numeric" placeholder="Ar" />
          </label>
        ))}
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={busy}>
          {t("expenses.save")}
        </Button>
      </div>
    </form>
  );
}
