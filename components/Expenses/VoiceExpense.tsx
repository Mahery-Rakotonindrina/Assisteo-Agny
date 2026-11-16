import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import type { ManualExpense } from "@/lib/expenses";
import { parseVoiceExpense } from "@/lib/voiceExpense";
import { haptics } from "@/services/device";
import { voice, VoiceError } from "@/services/voice";
import { ExpenseSheet } from "./ExpenseSheet";
import styles from "./Expenses.module.scss";
import type { PocketChoice } from "./WalletChips";

const noSubscribe = () => () => {};

type Props = {
  pockets?: PocketChoice;
  /** The values read from the sentence: the add form opens with them, to be checked. */
  onFill: (values: Partial<ManualExpense>) => void;
};

/**
 * "Dire ou écrire": one sentence, said with the phone's voice input or typed,
 * read on the device (lib/voiceExpense.ts) into the add form. Nothing is saved here.
 */
export function VoiceExpense({ pockets, onFill }: Props) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  // Bumped when the sheet closes: an answer heard after that is dropped, never put back in the field.
  const session = useRef(0);
  const canListen = useSyncExternalStore(noSubscribe, voice.canListen, () => false);

  const close = () => {
    session.current += 1;
    voice.stopListening();
    setOpen(false);
    setText("");
  };

  const listen = async () => {
    if (listening) {
      voice.stopListening();
      return;
    }
    haptics.tap();
    setListening(true);
    const mine = session.current;
    try {
      const heard = await voice.listen(locale, t("expenses.voice.prompt"));
      if (mine !== session.current) return;
      setText((current) => `${current.trim()} ${heard}`.trim().slice(0, 300));
    } catch (err) {
      const reason = err instanceof VoiceError ? err.reason : "no_speech";
      if (mine === session.current && reason !== "no_speech") toast(t(reason === "denied" ? "expenses.voice.denied" : "expenses.voice.unavailable"), "error");
    } finally {
      setListening(false);
    }
  };

  const fill = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const read = parseVoiceExpense(text);
    // The pocket named, when the user has one of that kind. Without it, nothing is chosen: not the payment either, which would pick another Mobile Money pocket.
    const wallet = read.wallet ? pockets?.wallets.find((item) => item.type === read.wallet)?.id : undefined;
    const payment = read.wallet && !wallet ? undefined : read.payment;
    haptics.success();
    onFill({
      ...(read.amountMga !== undefined && { amountMga: read.amountMga }),
      ...(read.category && { category: read.category }),
      ...(read.at !== undefined && { at: read.at }),
      ...(payment && { payment }),
      ...(wallet && { wallet }),
      note: read.note,
    });
    toast(t(read.amountMga === undefined ? "expenses.voice.noAmount" : "expenses.voice.check"));
    close();
  };

  return (
    <>
      <Button size="lg" variant="secondary" icon={<Mic />} onClick={() => setOpen(true)}>
        {t("expenses.voice.button")}
      </Button>
      <ExpenseSheet open={open} title={t("expenses.voice.title")} onClose={close}>
        <form className={styles.voiceForm} onSubmit={fill} aria-label={t("expenses.voice.title")}>
          <p className={styles.hint}>{t("expenses.voice.hint")}</p>
          <div className={styles.voiceBox} data-listening={listening || undefined}>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, 300))}
              placeholder={listening ? t("expenses.voice.listening") : t("expenses.voice.placeholder")}
              rows={3}
              aria-label={t("expenses.voice.title")}
              autoFocus
            />
            {canListen && (
              <button type="button" className={styles.voiceMic} data-listening={listening || undefined} onClick={() => void listen()} aria-label={listening ? t("expenses.voice.stop") : t("expenses.voice.mic")}>
                <Mic size={20} />
              </button>
            )}
          </div>
          <ul className={styles.voiceExamples}>
            {(["example1", "example2", "example3"] as const).map((key) => (
              <li key={key}>
                <button type="button" onClick={() => setText(t(`expenses.voice.${key}`))}>
                  {t(`expenses.voice.${key}`)}
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <Button type="submit" icon={<Sparkles />} disabled={!text.trim()}>
              {t("expenses.voice.fill")}
            </Button>
            <Button variant="ghost" onClick={close}>
              {t("expenses.cancel")}
            </Button>
          </div>
        </form>
      </ExpenseSheet>
    </>
  );
}
