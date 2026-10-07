import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut, rise } from "@/lib/motion";
import type { FeedbackRequest } from "@/pages/api/feedback";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { httpClient } from "@/services/httpClient";
import type { FeedbackReason, HistoryEntry } from "@/types/history";
import styles from "./Result.module.scss";

const reasons: FeedbackReason[] = ["wrong_subject", "wrong_info", "other"];

// Vote time, taken in event handlers (never during render).
const timestamp = () => Date.now();

/** "Was this answer right?" at the end of the summary. Remembers the vote on the scan. */
export function AnswerFeedback({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const [choosingReason, setChoosingReason] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const given = entry.feedback;

  const send = async (vote: "up" | "down", reason?: FeedbackReason) => {
    setSending(true);
    setFailed(false);
    const { analysis, meta, mode } = entry;
    const body: FeedbackRequest = {
      vote,
      reason,
      category: analysis.category,
      mode,
      model: meta.model,
      confidence: analysis.confidence,
      title: analysis.title,
    };
    try {
      await httpClient.post<void>("/api/feedback", body);
      await historyStore.update(entry.id, { feedback: { vote, reason, at: timestamp() } });
      haptics.success();
      setChoosingReason(false);
    } catch {
      haptics.error();
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.section variants={rise} className={styles.feedback} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {given ? (
          <motion.p key="thanks" className={styles.feedbackThanks} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: easeOut }}>
            <Check size={16} strokeWidth={3} />
            {t("feedback.thanks")}
          </motion.p>
        ) : choosingReason ? (
          <motion.div key="reasons" className={styles.feedbackBody} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: easeOut }}>
            <strong>{t("feedback.why")}</strong>
            <div className={styles.feedbackReasons}>
              {reasons.map((reason) => (
                <button key={reason} type="button" disabled={sending} onClick={() => void send("down", reason)}>
                  {t(`feedback.reasons.${reason}`)}
                </button>
              ))}
            </div>
            <button type="button" className={styles.feedbackSkip} disabled={sending} onClick={() => void send("down")}>
              {t("feedback.skip")}
            </button>
          </motion.div>
        ) : (
          <motion.div key="ask" className={styles.feedbackAsk} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <strong>{t("feedback.title")}</strong>
            <div className={styles.feedbackVotes}>
              <button type="button" disabled={sending} onClick={() => void send("up")} aria-label={t("feedback.yes")}>
                <ThumbsUp size={17} /> {t("feedback.yes")}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  haptics.tap();
                  setChoosingReason(true);
                }}
                aria-label={t("feedback.no")}
              >
                <ThumbsDown size={17} /> {t("feedback.no")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {failed && <p className={styles.feedbackError}>{t("feedback.error")}</p>}
    </motion.section>
  );
}
