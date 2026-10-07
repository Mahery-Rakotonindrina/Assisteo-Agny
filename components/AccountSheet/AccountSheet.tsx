import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Cloud, Loader2, Mail, X } from "lucide-react";
import { Button } from "@/components/Button";
import { LegalConsent } from "@/components/LegalConsent";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut, spring } from "@/lib/motion";
import { sendSignInCode, verifySignInCode, type SignInError } from "@/services/account";
import { haptics } from "@/services/device";
import styles from "./AccountSheet.module.scss";

type AccountSheetProps = {
  open: boolean;
  onClose: () => void;
};

const RESEND_DELAY_S = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Passwordless sign-in: e-mail, then the one-time code received by e-mail. */
export function AccountSheet({ open, onClose }: AccountSheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
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
                    maxLength={8}
                    value={code}
                    aria-label={t("account.codeTitle")}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
                      setCode(digits);
                      setError(null);
                      // Codes are 6 digits by default: submit as soon as it's complete.
                      if (digits.length === 6 && !busy) void verify(digits);
                    }}
                    disabled={busy}
                  />
                  {busy && (
                    <p className={styles.small}>
                      <Loader2 size={14} className={styles.spin} /> {t("account.verifying")}
                    </p>
                  )}
                  {error && <p className={styles.error}>{t(`account.errors.${error}`)}</p>}
                  {code.length > 6 && !busy && (
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
