import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Mic, RotateCcw, Sparkles, Square, Trash2, Volume2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { PLANS_HREF } from "@/components/Trial";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut } from "@/lib/motion";
import { askAboutScan } from "@/services/chatService";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { planStore } from "@/services/plan";
import { voice, VoiceError } from "@/services/voice";
import { ApiError } from "@/types/api";
import type { ChatEntry, HistoryEntry } from "@/types/history";
import styles from "./ScanChat.module.scss";

const MAX_LENGTH = 2000;

// Message timestamps, taken in event handlers (never during render).
const timestamp = () => Date.now();

const noSubscribe = () => () => {};

/** Renders "**bold**" and "- " lists from a plain-text answer, without injecting HTML. */
function renderAnswer(text: string) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>,
    );
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return blocks;
}

type ErrorKind = "network" | "rate_limited" | "refused" | "unavailable" | "ask_limit" | "server_busy" | "plan_required" | "invalid_key" | "billing" | "unknown";

type ScanChatProps = {
  entry: HistoryEntry;
  /** A question tapped elsewhere on the result, sent as soon as the chat opens. */
  initialQuestion?: string | null;
  onInitialQuestion?: () => void;
};

/** A conversation about one scan: the AI sees the photo and its own analysis. */
export function ScanChat({ entry, initialQuestion, onInitialQuestion }: ScanChatProps) {
  const { t, list, locale } = useTranslation();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  // Voice: listening for a question, and the answer being read aloud (by its time).
  const canListen = useSyncExternalStore(noSubscribe, voice.canListen, () => false);
  const canSpeak = useSyncExternalStore(noSubscribe, voice.canSpeak, () => false);
  const [listening, setListening] = useState(false);
  const [speakingAt, setSpeakingAt] = useState<number | null>(null);
  // A question asked aloud gets its answer read aloud.
  const readAloud = useRef(false);

  // Leaving the conversation stops the voice.
  useEffect(() => () => void voice.stopSpeaking(), []);

  const speak = async (at: number, text: string) => {
    if (speakingAt === at) {
      await voice.stopSpeaking();
      setSpeakingAt(null);
      return;
    }
    await voice.stopSpeaking();
    setSpeakingAt(at);
    try {
      await voice.speak(text, locale);
    } catch {
      toast(t("chat.voiceUnavailable"), "error");
    } finally {
      setSpeakingAt((current) => (current === at ? null : current));
    }
  };
  const chat = entry.chat ?? [];
  const awaitingAnswer = chat.length > 0 && chat[chat.length - 1].role === "user";
  // The questions the AI suggested for this scan (older scans: common ones for the category), not asked yet.
  const suggested = entry.analysis.questions.length > 0 ? entry.analysis.questions : list(`chat.suggestions.${entry.analysis.category}`);
  const asked = new Set(chat.filter((message) => message.role === "user").map((message) => message.content.trim().toLowerCase()));
  const suggestions = suggested.filter((question) => !asked.has(question.trim().toLowerCase())).slice(0, 3);

  useEffect(() => {
    if (chat.length > 0 || sending) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length, sending]);

  const requestAnswer = async (conversation: ChatEntry[]) => {
    setSending(true);
    setError(null);
    try {
      const { answer, usage } = await askAboutScan(
        entry,
        conversation.map(({ role, content }) => ({ role, content })),
        locale,
      );
      if (usage) planStore.setUsage({ questionsToday: usage.used });
      const at = timestamp();
      await historyStore.update(entry.id, { chat: [...conversation, { role: "assistant", content: answer, at }] });
      haptics.tap();
      if (readAloud.current && canSpeak) void speak(at, answer);
      readAloud.current = false;
    } catch (err) {
      haptics.error();
      const code = err instanceof ApiError ? err.code : "unknown";
      const known: ErrorKind[] = ["network", "rate_limited", "refused", "unavailable", "ask_limit", "server_busy", "plan_required", "invalid_key", "billing"];
      setError(known.includes(code as ErrorKind) ? (code as ErrorKind) : "unknown");
    } finally {
      setSending(false);
    }
  };

  const send = async (text: string) => {
    const content = text.trim().slice(0, MAX_LENGTH);
    if (!content || sending) return;
    haptics.press();
    setDraft("");
    const conversation: ChatEntry[] = [...chat, { role: "user", content, at: timestamp() }];
    await historyStore.update(entry.id, { chat: conversation });
    await requestAnswer(conversation);
  };

  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialQuestion || sentInitial.current) return;
    sentInitial.current = true;
    // Next tick, so no state changes while the effect runs. Not cancelled: the
    // parent clears the question, which re-renders this before the timer fires.
    setTimeout(() => {
      onInitialQuestion?.();
      void send(initialQuestion);
    }, 0);
  }, [initialQuestion, onInitialQuestion, send]);

  const listen = async () => {
    if (listening) {
      voice.stopListening();
      return;
    }
    haptics.tap();
    await voice.stopSpeaking();
    setListening(true);
    try {
      const heard = await voice.listen(locale, t("chat.voicePrompt"));
      readAloud.current = true;
      await send(heard);
    } catch (err) {
      const reason = err instanceof VoiceError ? err.reason : "no_speech";
      if (reason !== "no_speech") toast(t(reason === "denied" ? "chat.voiceDenied" : "chat.voiceUnavailable"), "error");
    } finally {
      setListening(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends on a keyboard; Shift+Enter adds a line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };

  const clear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await historyStore.update(entry.id, { chat: [] });
    setConfirmClear(false);
    setError(null);
  };

  return (
    <div className={styles.chat}>
      {chat.length === 0 && !sending ? (
        <div className={styles.empty}>
          <p>{t("chat.intro")}</p>
          <div className={styles.suggestions}>
            {suggestions.map((question) => (
              <button key={question} type="button" className={styles.suggestion} onClick={() => void send(question)}>
                <Sparkles size={13} />
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.thread} aria-live="polite">
          <AnimatePresence initial={false}>
            {chat.map((message) => (
              <motion.div
                key={message.at}
                className={`${styles.bubble} ${message.role === "user" ? styles.user : styles.assistant}`}
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25, ease: easeOut }}
              >
                {message.role === "user" ? <p>{message.content}</p> : renderAnswer(message.content)}
                {message.role === "assistant" && canSpeak && (
                  <div className={styles.answerActions}>
                    <button type="button" onClick={() => void speak(message.at, message.content)} aria-pressed={speakingAt === message.at}>
                      {speakingAt === message.at ? <Square size={13} /> : <Volume2 size={14} />}
                      {speakingAt === message.at ? t("chat.stopListening") : t("chat.listen")}
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {sending && (
            <motion.div className={`${styles.bubble} ${styles.assistant} ${styles.typing}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-label={t("chat.thinking")}>
              <span />
              <span />
              <span />
            </motion.div>
          )}
          {!sending && !awaitingAnswer && suggestions.length > 0 && (
            <div className={styles.more}>
              <small>{t("chat.alsoAsk")}</small>
              <div className={styles.suggestions}>
                {suggestions.map((question) => (
                  <button key={question} type="button" className={styles.suggestion} onClick={() => void send(question)}>
                    <Sparkles size={13} />
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <p>{error === "ask_limit" ? t("chat.limit") : t(`errors.${error}`)}</p>
          <div className={styles.errorActions}>
            {error === "ask_limit" || error === "server_busy" || error === "plan_required" ? (
              <Link href={PLANS_HREF}>{t("trial.seeOffers")}</Link>
            ) : (
              awaitingAnswer && (
                <button type="button" onClick={() => void requestAnswer(chat)}>
                  <RotateCcw size={14} /> {t("chat.retry")}
                </button>
              )
            )}
          </div>
        </div>
      )}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          id={`chat-${entry.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={onKeyDown}
          placeholder={listening ? t("chat.listening") : t("chat.placeholder")}
          rows={1}
          disabled={sending}
          aria-label={t("chat.placeholder")}
        />
        {canListen && !draft.trim() && (
          <button
            type="button"
            className={styles.mic}
            data-listening={listening || undefined}
            onClick={() => void listen()}
            disabled={sending}
            aria-label={listening ? t("chat.stopVoice") : t("chat.voice")}
          >
            <Mic size={18} />
          </button>
        )}
        <button type="submit" className={styles.send} disabled={!draft.trim() || sending} aria-label={t("chat.send")}>
          <ArrowUp size={18} />
        </button>
      </form>

      {chat.length > 0 && (
        <button type="button" className={styles.clear} onClick={() => void clear()}>
          <Trash2 size={13} /> {confirmClear ? t("chat.confirmClear") : t("chat.clear")}
        </button>
      )}
    </div>
  );
}
