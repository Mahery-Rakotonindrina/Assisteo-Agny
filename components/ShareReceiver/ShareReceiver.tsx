import Router from "next/router";
import { useEffect } from "react";
import { isNative } from "@/services/device";
import { incomingShare } from "@/services/incomingShare";

/**
 * "Partager vers Assisteo": photos shared from another app (Android) open the
 * scan screen, which analyses them. Also when the share started the app: the
 * plugin keeps the event until this listener is there. Renders nothing.
 */
export function ShareReceiver() {
  useEffect(() => {
    if (!isNative()) return;
    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;
    void import("@capgo/capacitor-share-target")
      .then(({ CapacitorShareTarget }) =>
        CapacitorShareTarget.addListener("shareReceived", (event) => {
          if (incomingShare.receive(event.files ?? []) && Router.pathname !== "/") void Router.push("/");
        }),
      )
      .then((listener) => {
        if (cancelled) void listener.remove();
        else handle = listener;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, []);

  return null;
}
