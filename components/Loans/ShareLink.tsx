import { useEffect, useState } from "react";
import { Copy, Link2, Link2Off, MessageCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useLoanSharing } from "@/hooks/useLoans";
import { useTranslation } from "@/hooks/useTranslation";
import { whatsappLink, type PersonLoans } from "@/lib/loans";
import { copyText, haptics } from "@/services/device";
import { loanSharing } from "@/services/loanSharing";
import { ApiError } from "@/types/api";
import styles from "./Loans.module.scss";
import { useAccountName } from "./useAccountName";

/**
 * "Partager ce qu'il reste à rendre" (money lent only): a link the person
 * opens without an account (pages/pret.tsx), with a copy of their loans kept
 * up to date by the app. Signed in only; "bientôt disponible" before migration 0012.
 */
export function ShareLink({ person }: { person: PersonLoans }) {
  const { t } = useTranslation();
  const toast = useToast();
  const sharing = useLoanSharing();
  const accountName = useAccountName();
  const [asking, setAsking] = useState(false);
  // An e-mail is not a name to show: the field starts empty then.
  const [lender, setLender] = useState(() => (accountName.includes("@") ? "" : accountName));
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const live = sharing.kind === "ready" ? sharing.live[person.key] : undefined;

  // The link made on this device, once live (made elsewhere: only its token there knows it).
  useEffect(() => {
    let cancelled = false;
    if (!live) return;
    void loanSharing.link(person.key).then((url) => {
      if (!cancelled) setLink(url);
    });
    return () => {
      cancelled = true;
    };
  }, [live, person.key]);

  if (sharing.kind === "unknown" || sharing.kind === "off") return null;
  if (sharing.kind === "signedOut")
    return (
      <p className={styles.hint} data-testid="loan-share-signin">
        {t("loans.share.signIn")}
      </p>
    );
  if (sharing.kind === "soon")
    return (
      <p className={styles.hint} data-testid="loan-share-soon">
        {t("loans.share.soon")}
      </p>
    );

  const message = (url: string) => t("loans.share.message", { name: person.name, link: url });

  const create = async () => {
    if (!lender.trim()) {
      setMissing(true);
      haptics.error();
      return;
    }
    setBusy(true);
    try {
      const url = await loanSharing.create(person.key, lender, person.loans);
      if (url) {
        haptics.success();
        setLink(url);
        setAsking(false);
      }
    } catch (error) {
      toast(error instanceof ApiError && error.code === "unavailable" ? t("loans.share.soon") : t("loans.share.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await loanSharing.stop(person.key);
      setLink(null);
      toast(t("loans.share.stopped"));
    } catch {
      toast(t("loans.share.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    if (await copyText(message(url))) {
      haptics.success();
      toast(t("loans.share.copied"));
    } else toast(t("loans.share.copyFailed"), "error");
  };

  if (live) {
    const whatsapp = link ? (whatsappLink(person.phone, message(link)) ?? `https://wa.me/?text=${encodeURIComponent(message(link))}`) : null;
    return (
      <div className={styles.group} data-testid="loan-share">
        <p className={styles.hint}>{t("loans.share.live", { name: person.name })}</p>
        {!link && <p className={styles.hint}>{t("loans.share.elsewhere")}</p>}
        <div className={styles.row}>
          {link && whatsapp && (
            <>
              <Button icon={<MessageCircle />} onClick={() => window.open(whatsapp, "_blank", "noopener,noreferrer")}>
                {t("loans.share.whatsapp")}
              </Button>
              <Button variant="secondary" icon={<Copy />} onClick={() => void copy(link)}>
                {t("loans.share.copy")}
              </Button>
            </>
          )}
          {!link && (
            <Button variant="secondary" icon={<Link2 />} disabled={busy} onClick={() => setAsking(true)}>
              {t("loans.share.newLink")}
            </Button>
          )}
          <Button variant="ghost" icon={<Link2Off />} disabled={busy} onClick={() => void stop()} data-testid="loan-share-stop">
            {t("loans.share.stop")}
          </Button>
        </div>
        {asking && <LenderField lender={lender} missing={missing} busy={busy} onChange={setLender} onMissing={setMissing} onCreate={() => void create()} />}
      </div>
    );
  }

  return asking ? (
    <div className={styles.group} data-testid="loan-share">
      <p className={styles.hint}>{t("loans.share.intro", { name: person.name })}</p>
      <LenderField lender={lender} missing={missing} busy={busy} onChange={setLender} onMissing={setMissing} onCreate={() => void create()} />
    </div>
  ) : (
    <div className={styles.row}>
      <Button variant="secondary" icon={<Link2 />} onClick={() => setAsking(true)} data-testid="loan-share-open">
        {t("loans.share.button")}
      </Button>
    </div>
  );
}

function LenderField({ lender, missing, busy, onChange, onMissing, onCreate }: { lender: string; missing: boolean; busy: boolean; onChange: (value: string) => void; onMissing: (value: boolean) => void; onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <label className={styles.field}>
        <span>{t("loans.share.lender")}</span>
        <input
          value={lender}
          onChange={(event) => {
            onChange(event.target.value);
            onMissing(false);
          }}
          maxLength={60}
          autoComplete="name"
        />
      </label>
      {missing && (
        <p className={styles.error} role="alert">
          {t("loans.share.missingName")}
        </p>
      )}
      <div className={styles.row}>
        <Button icon={<Link2 />} disabled={busy} onClick={onCreate} data-testid="loan-share-create">
          {t("loans.share.create")}
        </Button>
      </div>
    </>
  );
}
