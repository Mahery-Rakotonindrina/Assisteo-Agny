import type { Session } from "@supabase/supabase-js";
import Router from "next/router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pick } from "@/lib/account/pick";
import { syncedSettingKeys, useSettings, type SyncedSettings } from "@/lib/settings/SettingsProvider";
import { accountsAvailable, supabase } from "@/lib/supabase";
import { deleteAccountOnServer, onSessionChange, signOutAccount } from "@/services/account";
import { aiKeyStore } from "@/services/aiKeyStore";
import { accountKeyApi } from "@/services/accountKeyApi";
import { cancelAllNotifications } from "@/services/notifications";
import { parcelStore } from "@/services/parcelStore";
import { startParcelSync, syncParcels } from "@/services/parcelSync";
import { registerPush, unregisterPush } from "@/services/push";
import { sync, type SyncStatus } from "@/services/sync";
import { trialStore } from "@/services/trial";

type AccountContextValue = {
  /** Accounts are configured for this build (Supabase env present). */
  available: boolean;
  /** Undefined while the stored session is being read. */
  session: Session | null | undefined;
  email: string | null;
  syncStatus: SyncStatus;
  syncNow: () => void;
  signOut: () => Promise<void>;
  /** Deletes the account on the server, then wipes this device. Throws if the server refuses. */
  deleteAccount: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

/**
 * Wires the signed-in account to the device: history sync, settings and the
 * user's own AI key. Signing out stops syncing and wipes the device (the
 * account keeps everything).
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { settings, ready, update } = useSettings();
  const [session, setSession] = useState<Session | null | undefined>(accountsAvailable ? undefined : null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(sync.status());
  const userId = session?.user.id ?? null;
  const settingsRef = useRef(settings);
  // Settings reconciliation happens once per sign-in before local pushes start.
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => onSessionChange(setSession), []);

  // The free trial is also counted per account: refresh it on sign-in and sign-out.
  const sessionKnown = session !== undefined;
  useEffect(() => {
    if (sessionKnown) void trialStore.refresh();
  }, [userId, sessionKnown]);
  useEffect(() => sync.subscribe(() => setSyncStatus(sync.status())), []);

  // Reminder pushes on this device (Android builds with Firebase only).
  useEffect(() => {
    if (!userId) return;
    void registerPush((entryId) => void Router.push({ pathname: "/result", query: { id: entryId } })).catch(() => undefined);
  }, [userId]);

  // "Mes colis".
  useEffect(() => {
    if (!userId) return;
    return startParcelSync(userId);
  }, [userId]);

  // History.
  useEffect(() => {
    if (!userId) return;
    sync.start(userId);
    const resume = () => {
      if (document.visibilityState === "visible") void sync.now();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [userId]);

  // Settings: newest side wins on sign-in, then local changes are pushed.
  useEffect(() => {
    if (!userId || !ready) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase().from("user_settings").select("data, updated_at").maybeSingle();
      if (cancelled) return;
      const local = settingsRef.current;
      const remoteAt = data ? new Date(data.updated_at).getTime() : 0;
      if (data && remoteAt > local.updatedAt) {
        update(pick(data.data as Partial<SyncedSettings>, syncedSettingKeys), { fromSync: true, updatedAt: remoteAt });
      } else if (local.updatedAt > remoteAt) {
        await supabase()
          .from("user_settings")
          .upsert({ user_id: userId, data: pick(local, syncedSettingKeys), updated_at: new Date(local.updatedAt).toISOString() });
      }
      if (!cancelled) setSettingsReady(true);
    })().catch(() => setSettingsReady(true));
    return () => {
      cancelled = true;
      setSettingsReady(false);
    };
  }, [userId, ready, update]);

  useEffect(() => {
    if (!userId || !settingsReady || !settings.updatedAt) return;
    const timer = setTimeout(() => {
      void supabase()
        .from("user_settings")
        .upsert({ user_id: userId, data: pick(settings, syncedSettingKeys), updated_at: new Date(settings.updatedAt).toISOString() });
    }, 800);
    return () => clearTimeout(timer);
  }, [userId, settingsReady, settings]);

  // Own AI key: reconcile on sign-in, then mirror local saves and removals.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const [remote, local] = await Promise.all([accountKeyApi.get(), aiKeyStore.get()]);
      if (cancelled) return;
      if (remote && (!local || remote.updatedAt > (local.updatedAt ?? 0))) {
        await aiKeyStore.save({ ...remote.key, presetId: remote.presetId, updatedAt: remote.updatedAt }, { fromSync: true });
      } else if (local && (!remote || (local.updatedAt ?? 0) > remote.updatedAt)) {
        await accountKeyApi.put(local);
      }
    })().catch(() => undefined);
    const unsubscribe = aiKeyStore.onLocalChange((change) => {
      void (change.type === "save" ? accountKeyApi.put(change.key) : accountKeyApi.remove()).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    await unregisterPush().catch(() => undefined);
    await sync.now()?.catch(() => undefined);
    await sync.stop({ wipe: true });
    if (userId) await syncParcels(userId).catch(() => undefined);
    await parcelStore.wipe();
    await aiKeyStore.clear({ fromSync: true });
    await signOutAccount();
  }, [userId]);

  const deleteAccount = useCallback(async () => {
    // Stop pushing first so nothing is re-uploaded while the server deletes.
    await sync.stop({ wipe: false });
    await unregisterPush().catch(() => undefined);
    try {
      await deleteAccountOnServer();
    } catch (error) {
      if (userId) sync.start(userId);
      throw error;
    }
    await sync.stop({ wipe: true });
    await parcelStore.wipe();
    await aiKeyStore.clear({ fromSync: true });
    await cancelAllNotifications();
    // The user no longer exists on the server: only forget the session here.
    await signOutAccount().catch(() => undefined);
  }, [userId]);

  const value = useMemo<AccountContextValue>(
    () => ({
      available: accountsAvailable,
      session,
      email: session?.user.email ?? null,
      syncStatus,
      syncNow: () => void sync.now(),
      signOut,
      deleteAccount,
    }),
    [session, signOut, deleteAccount, syncStatus],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useAccount must be used inside <AccountProvider>.");
  return context;
}
