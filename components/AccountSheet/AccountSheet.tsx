import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ClipboardPaste, Cloud, Loader2, Mail, X } from "lucide-react";
import { Button } from "@/components/Button";
import { LegalConsent } from "@/components/LegalConsent";
import { useToast } from "@/components/Toast";
import { useSheetKeyboard } from "@/hooks/useSheetKeyboard";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut, spring } from "@/lib/motion";
import { CODE_LENGTH, codeFrom, MIN_CODE_LENGTH } from "@/lib/signInCode";
import { sendSignInCode, verifySignInCode, type SignInError } from "@/services/account";
import { haptics, readClipboard } from "@/services/device";
import { googleSignInAvailable, startGoogleSignIn } from "@/services/googleSignIn";
import styles from "./AccountSheet.module.scss";

type AccountSheetProps = {
  open: boolean;
  onClose: () => void;
};

const RESEND_DELAY_S = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Google's "G", in its colours (as Google asks for its sign-in buttons). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Passwordless sign-in: e-mail, then the one-time code received by e-mail; or Google, when switched on. */
export function AccountSheet({ open, onClose }: AccountSheetProps) {
  const backdrop = useSheetKeyboard(open);
  const { t } = useTranslation();
  const toast = useToast();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  // "Continuer avec Google": only once Google is switched on in Supabase.
  const [google, setGoogle] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void googleSignInAvailable().then((value) => {
      if (!cancelled) setGoogle(value);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const withGoogle = async () => {
    haptics.tap();
    setLeaving(true);
    const started = await startGoogleSignIn(window.location.pathname + window.location.search).catch(() => false);
    setLeaving(false);
    if (!started) {
      haptics.error();
      toast(t("googleSignIn.failed"), "error");
      return;
    }
    // The site leaves for Google; the app opened it in the browser and comes back by its link.
    close();
  };

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const close = () => {
    onClose();
    // Reset after the closing animation.
    setTimeout(() => {
      setStep("email");
      setCode("");
      setError(null);
    }, 300);
  };

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setError("invalid_email");
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await sendSignInCode(address);
    setBusy(false);
    if (failure) {
      haptics.error();
      setError(failure);
      return;
    }
    setEmail(address);
    setStep("code");
    setResendIn(RESEND_DELAY_S);
  };

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    const failure = await verifySignInCode(email, value);
    setBusy(false);
    if (failure) {
      haptics.error();
      setError(failure);
      setCode("");
      return;
    }
    haptics.success();
    toast(t("account.signedIn"));
    close();
  };

  /** A full code, typed or pasted, is checked at once. */
  const takeCode = (digits: string) => {
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LENGTH && !busy) void verify(digits);
  };

  // « Coller le code »: the code copied from the e-mail, even with the words around it.
  const paste = async () => {
    const digits = codeFrom((await readClipboard()) ?? "");
    if (digits.length < MIN_CODE_LENGTH) {
      toast(t("account.pasteNone"), "error");
      codeRef.current?.focus();
      return;
    }
    takeCode(digits);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={backdrop}
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            className={styles.sheet}
            role="dialog"
            aria-modal
            aria-labelledby="account-title"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.top}>
              {step === "code" ? (
                <button type="button" className={styles.iconButton} onClick={() => setStep("email")} aria-label={t("account.changeEmail")}>
                  <ArrowLeft size={20} />
                </button>
              ) : (
                <span />
              )}
              <button type="button" className={styles.iconButton} onClick={close} aria-label={t("common.cancel")}>
                <X size={20} />
              </button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {step === "email" ? (
                <motion.form
                  key="email"
                  className={styles.step}
                  onSubmit={(event) => void sendCode(event)}
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.25, ease: easeOut }}
                >
                  <span className={styles.icon} aria-hidden>
                    <Cloud size={30} />
                  </span>
                  <h2 id="account-title">{t("account.title")}</h2>
                  <p>{t("account.body")}</p>
                  {google && (
                    <>
                      <Button type="button" variant="secondary" size="lg" block icon={leaving ? <Loader2 className={styles.spin} /> : <GoogleMark />} disabled={leaving} onClick={() => void withGoogle()}>
                        {t("googleSignIn.button")}
                      </Button>
                      <p className={styles.or}>
                        <span>{t("googleSignIn.or")}</span>
                      </p>
                    </>
                  )}
                  <label className={styles.field}>
                    <Mail size={18} />
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={t("account.emailPlaceholder")}
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setError(null);
                      }}
                      autoFocus
                    />
                  </label>
                  {error && <p className={styles.error}>{t(`account.errors.${error}`)}</p>}
                  <Button type="submit" size="lg" block disabled={busy || !email.trim()} icon={busy ? <Loader2 className={styles.spin} /> : undefined}>
                    {t("account.sendCode")}
                  </Button>
                  <p className={styles.small}>{t("account.noPassword")}</p>
                  <LegalConsent onNavigate={close} />
                </motion.form>
              ) : (
                <motion.div
                  key="code"
                  className={styles.step}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 30 }}
                  transition={{ duration: 0.25, ease: easeOut }}
                >
                  <span className={styles.icon} aria-hidden>
                    <Mail size={30} />
                  </span>
                  <h2 id="account-title">{t("account.codeTitle")}</h2>
                  <p>{t("account.codeBody", { email })}</p>
                  <input
                    ref={codeRef}
                    className={styles.code}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={"•".repeat(CODE_LENGTH)}
                    value={code}
                    aria-label={t("account.codeTitle")}
                    // No maxLength: a pasted subject ("Ton code … : 12345678") would be cut before its code.
                    onChange={(event) => takeCode(codeFrom(event.target.value))}
                    disabled={busy}
                  />
                  {!busy && code.length < MIN_CODE_LENGTH && (
                    <Button variant="secondary" block icon={<ClipboardPaste />} onClick={() => void paste()}>
                      {t("account.pasteCode")}
                    </Button>
                  )}
                  {busy && (
                    <p className={styles.small}>
                      <Loader2 size={14} className={styles.spin} /> {t("account.verifying")}
                    </p>
                  )}
                  {error && <p className={styles.error}>{t(`account.errors.${error}`)}</p>}
                  {code.length >= MIN_CODE_LENGTH && !busy && (
                    <Button block onClick={() => void verify(code)}>
                      {t("account.verify")}
                    </Button>
                  )}
                  <button type="button" className={styles.link} disabled={resendIn > 0 || busy} onClick={() => void sendCode()}>
                    {resendIn > 0 ? t("account.resendIn", { seconds: resendIn }) : t("account.resend")}
                  </button>
                  <p className={styles.small}>{t("account.checkSpam")}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
