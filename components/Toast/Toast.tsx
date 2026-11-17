import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { spring } from "@/lib/motion";
import styles from "./Toast.module.scss";

type Tone = "success" | "error";
/** A button in the message ("Annuler"): the message then stays longer, and goes once tapped. */
export type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; message: string; tone: Tone; action?: ToastAction };

/** How long a message with an action stays: time to read it and tap. */
export const TOAST_ACTION_MS = 6000;

const ToastContext = createContext<((message: string, tone?: Tone, action?: ToastAction) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counter = useRef(0);

  const show = useCallback((message: string, tone: Tone = "success", action?: ToastAction) => {
    clearTimeout(timer.current);
    counter.current += 1;
    setToast({ id: counter.current, message, tone, ...(action && { action }) });
    timer.current = setTimeout(() => setToast(null), action ? TOAST_ACTION_MS : 2600);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-live="polite">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              className={`${styles.toast} ${styles[toast.tone]}`}
              initial={{ opacity: 0, y: -24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.18 } }}
              transition={spring}
              role="status"
            >
              {toast.tone === "success" ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    clearTimeout(timer.current);
                    setToast(null);
                    toast.action?.onClick();
                  }}
                  data-testid="toast-action"
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}
