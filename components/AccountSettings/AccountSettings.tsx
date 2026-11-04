import { useState, useSyncExternalStore } from "react";
import { CloudOff, LogOut, RefreshCw, Trash2, UserRound } from "lucide-react";
import { AccountSheet } from "@/components/AccountSheet";
import { PlanBadge } from "@/components/PlanBadge";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccount } from "@/lib/account/AccountProvider";
import { codeFrom, MIN_CODE_LENGTH } from "@/lib/signInCode";
import { sendSignInCode, verifySignInCode, type SignInError } from "@/services/account";
import { storageQuota } from "@/services/storageQuota";
import { ApiError } from "@/types/api";
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
  const { id, current: plan, color } = usePlan();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Deleting asks for a code sent to the account's e-mail first.
  const [deleteStep, setDeleteStep] = useState<"intro" | "code">("intro");
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteError, setDeleteError] = useState<SignInError | null>(null);
  const photosFull = useSyncExternalStore(storageQuota.subscribe, storageQuota.isFull, () => false);

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

  const closeDelete = () => {
    setConfirmDelete(false);
    setDeleteStep("intro");
    setDeleteCode("");
    setDeleteError(null);
  };

  const sendDeleteCode = async () => {
    if (!email) return;
    setDeleting(true);
    const failure = await sendSignInCode(email, { create: false });
    setDeleting(false);
    setDeleteError(failure);
    if (!failure) setDeleteStep("code");
  };

  const confirmDeletion = async () => {
    if (!email) return;
    setDeleting(true);
    setDeleteError(null);
    // The code opens a fresh session: the server only deletes right after one.
    const failure = await verifySignInCode(email, deleteCode);
    if (failure) {
      setDeleteError(failure);
      setDeleting(false);
      return;
    }
    try {
      await deleteAccount();
      toast(t("account.deleted"));
      closeDelete();
    } catch (error) {
      toast(t(error instanceof ApiError && error.code === "code_required" ? "account.deleteCodeAgain" : "account.deleteFailed"), "error");
      setDeleteStep("intro");
      setDeleteCode("");
    } finally {
      setDeleting(false);
    }
  };

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
        <span className={styles.avatar} data-plan={plan} data-plan-color={color()}>
          {(email ?? "?").charAt(0).toUpperCase()}
        </span>
        <div className={styles.text}>
          <strong>{email}</strong>
          {id !== "free" && <PlanBadge plan={plan} className={styles.plan} />}
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
      {photosFull && (
        <p className={styles.hint} role="status" data-testid="photos-full">
          {t("account.photosFull")}
        </p>
      )}

      {confirmDelete ? (
        <div className={styles.danger} role="alertdialog" aria-labelledby="delete-account-title">
          <strong id="delete-account-title">{t("account.deleteTitle")}</strong>
          <p>{t("account.deleteBody")}</p>
          {deleteStep === "intro" ? (
            <>
              <p>{t("account.deleteCodeIntro", { email: email ?? "" })}</p>
              {deleteError && <p role="alert">{t(`account.errors.${deleteError}`)}</p>}
              <div className={styles.actions}>
                <Button variant="danger" icon={<Trash2 />} disabled={deleting || !email} onClick={() => void sendDeleteCode()} data-testid="delete-send-code">
                  {t("account.sendCode")}
                </Button>
                <Button variant="ghost" disabled={deleting} onClick={closeDelete}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>{t("account.codeBody", { email: email ?? "" })}</p>
              <input
                className={styles.code}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={deleteCode}
                aria-label={t("account.codeTitle")}
                // No maxLength: a pasted subject would be cut before its code.
                onChange={(event) => {
                  setDeleteCode(codeFrom(event.target.value));
                  setDeleteError(null);
                }}
                disabled={deleting}
                data-testid="delete-code"
              />
              {deleteError && <p role="alert">{t(`account.errors.${deleteError}`)}</p>}
              <div className={styles.actions}>
                <Button variant="danger" icon={<Trash2 />} disabled={deleting || deleteCode.length < MIN_CODE_LENGTH} onClick={() => void confirmDeletion()} data-testid="delete-confirm">
                  {deleting ? t("account.deleting") : t("account.deleteConfirm")}
                </Button>
                <Button variant="ghost" disabled={deleting} onClick={closeDelete}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button type="button" className={styles.deleteLink} onClick={() => setConfirmDelete(true)}>
          {t("account.delete")}
        </button>
      )}
    </div>
  );
}
