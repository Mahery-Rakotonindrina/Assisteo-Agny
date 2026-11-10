import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/Button";
import { Seo } from "@/components/Seo";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { callbackFrom } from "@/lib/googleSignIn";
import { haptics } from "@/services/device";
import { finishGoogleSignIn } from "@/services/googleSignIn";
import styles from "@/styles/AuthCallback.module.scss";

/**
 * Back from Google's sign-in (site and Android app): the code in the address
 * becomes the session, then the user goes back where they were. A static
 * page, read on the client (the APK's export has no server).
 */
export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    const callback = callbackFrom(new URLSearchParams(window.location.search + window.location.hash.replace(/^#/, "&")));
    // Cancelled or refused on Google's side: nothing to exchange.
    const finishing = callback && "code" in callback ? finishGoogleSignIn(callback.code) : Promise.resolve({ error: true as const });
    void finishing.then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        haptics.error();
        setFailed(true);
        return;
      }
      haptics.success();
      // Already signed in (a replayed or refused link): said plainly, nothing silently dropped.
      toast(t(result.alreadySignedIn ? "googleSignIn.alreadySignedIn" : "googleSignIn.signedIn"));
      // The code leaves the address and the history.
      void router.replace(result.returnTo);
    });
    return () => {
      cancelled = true;
    };
    // Once, when the address is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return (
    <>
      <Seo title={`${t("googleSignIn.pageTitle")} · ${t("meta.title")}`} noindex />
      <div className={styles.page} data-testid="auth-callback">
        {failed ? (
          <>
            <p role="alert">{t("googleSignIn.failed")}</p>
            <Button href="/settings">{t("googleSignIn.back")}</Button>
          </>
        ) : (
          <p>
            <Loader2 size={18} className={styles.spin} /> {t("googleSignIn.finishing")}
          </p>
        )}
      </div>
    </>
  );
}
