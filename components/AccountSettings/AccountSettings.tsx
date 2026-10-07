import { useState } from "react";
import { CloudOff, LogOut, RefreshCw, Trash2, UserRound } from "lucide-react";
import { AccountSheet } from "@/components/AccountSheet";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccount } from "@/lib/account/AccountProvider";
import styles from "./AccountSettings.module.scss";

function minutesAgo(now: number, at?: number) {
  return at ? Math.max(0, Math.round((now - at) / 60_000)) : null;
}

/** Sign-in entry point and sync status, at the top of Settings. */
export function AccountSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const now = useNow(30_000);
  const { session, email, syncStatus, syncNow, signOut, deleteAccount } = useAccount();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (session === undefined) return <div className={styles.wrap} aria-busy />;

  if (!session) {
    return (
      <div className={styles.wrap}>
        <div className={styles.row}>
          <span className={styles.avatarEmpty}>
            <UserRound size={20} />
          </span>
          <div className={styles.text}>
            <strong>{t("account.signedOutTitle")}</strong>
            <small>{t("account.signedOutBody")}</small>
          </div>
        </div>
        <Button block onClick={() => setSheetOpen(true)}>
          {t("account.signIn")}
        </Button>
        <AccountSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      </div>
    );
  }

  const ago = minutesAgo(now, syncStatus.lastSyncAt);
  const statusText =
    syncStatus.state === "syncing"
      ? t("account.syncing")
      : syncStatus.state === "offline"
        ? t("account.offline")
        : syncStatus.state === "error"
          ? t("account.syncError")
          : ago === null
            ? t("account.syncPending")
            : ago === 0
              ? t("account.syncedNow")
              : t("account.syncedAgo", { minutes: ago });

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <span className={styles.avatar}>{(email ?? "?").charAt(0).toUpperCase()}</span>
        <div className={styles.text}>
          <strong>{email}</strong>
          <small className={styles.status} data-state={syncStatus.state}>
            {syncStatus.state === "syncing" ? (
              <RefreshCw size={13} className={styles.spin} />
            ) : syncStatus.state === "offline" || syncStatus.state === "error" ? (
              <CloudOff size={13} />
            ) : (
              <span className={styles.dot} />
            )}
            {statusText}
          </small>
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="secondary" icon={<RefreshCw />} onClick={syncNow} disabled={syncStatus.state === "syncing"}>
          {t("account.syncNow")}
        </Button>
        <Button
          variant={confirmOut ? "danger" : "ghost"}
          icon={<LogOut />}
          onClick={async () => {
            if (!confirmOut) {
              setConfirmOut(true);
              return;
            }
            await signOut();
            setConfirmOut(false);
            toast(t("account.signedOut"));
          }}
        >
          {confirmOut ? t("account.confirmSignOut") : t("account.signOut")}
        </Button>
      </div>
      {confirmOut && <p className={styles.hint}>{t("account.signOutHint")}</p>}

      {confirmDelete ? (
        <div className={styles.danger} role="alertdialog" aria-labelledby="delete-account-title">
          <strong id="delete-account-title">{t("account.deleteTitle")}</strong>
          <p>{t("account.deleteBody")}</p>
          <div className={styles.actions}>
            <Button
              variant="danger"
              icon={<Trash2 />}
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await deleteAccount();
                  toast(t("account.deleted"));
                } catch {
                  toast(t("account.deleteFailed"), "error");
                } finally {
                  setDeleting(false);
                  setConfirmDelete(false);
                }
              }}
            >
              {deleting ? t("account.deleting") : t("account.deleteConfirm")}
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.deleteLink} onClick={() => setConfirmDelete(true)}>
          {t("account.delete")}
        </button>
      )}
    </div>
  );
}
