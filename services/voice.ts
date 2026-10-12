import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import type { Locale } from "@/i18n.config";

// Talking to the app: a question said aloud, an answer read aloud. In the
// app, the phone's own recognizer (Google voice input dialog) and voices; in
// a browser, the Web Speech API where it exists (Chrome, Edge, Safari).

const speechTags: Record<Locale, string> = { fr: "fr-FR", en: "en-US" };

export type VoiceFailure = "unavailable" | "denied" | "no_speech";

export class VoiceError extends Error {
  constructor(readonly reason: VoiceFailure) {
    super(reason);
  }
}

// The browser API isn't in TypeScript's DOM types yet.
type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionConstructor = new () => BrowserRecognition;

const browserRecognition = () =>
  typeof window === "undefined"
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition);

let listening: BrowserRecognition | null = null;

/** Answers can hold "**bold**" and "- " lists: read them as plain sentences. */
export function speakableText(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export const voice = {
  /** Whether a question can be asked aloud here. */
  canListen: () => Capacitor.isNativePlatform() || Boolean(browserRecognition()),

  /** Listens for one sentence; the words heard, or a VoiceError. */
  async listen(locale: Locale, prompt: string): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      const { available } = await SpeechRecognition.available().catch(() => ({ available: false }));
      if (!available) throw new VoiceError("unavailable");
      const permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted") throw new VoiceError("denied");
      // The system dialog: familiar, and it stops by itself at the end of the sentence.
      const { matches } = await SpeechRecognition.start({ language: speechTags[locale], maxResults: 1, prompt, popup: true, partialResults: false }).catch(() => ({
        matches: [],
      }));
      const heard = matches?.[0]?.trim();
      if (!heard) throw new VoiceError("no_speech");
      return heard;
    }

    const Recognition = browserRecognition();
    if (!Recognition) throw new VoiceError("unavailable");
    return new Promise((resolve, reject) => {
      const recognition = new Recognition();
      listening = recognition;
      recognition.lang = speechTags[locale];
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      let heard = "";
      recognition.onresult = (event) => {
        heard = event.results[0]?.[0]?.transcript?.trim() ?? "";
      };
      recognition.onerror = (event) => {
        listening = null;
        reject(new VoiceError(event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : "no_speech"));
      };
      recognition.onend = () => {
        listening = null;
        if (heard) resolve(heard);
        else reject(new VoiceError("no_speech"));
      };
      recognition.start();
    });
  },

  /** Stops listening in a browser (the app's dialog has its own button). */
  stopListening() {
    listening?.stop();
  },

  canSpeak: () => Capacitor.isNativePlatform() || (typeof window !== "undefined" && "speechSynthesis" in window),

  /** Reads a text aloud; resolves when done or stopped. */
  async speak(text: string, locale: Locale) {
    const words = speakableText(text);
    if (Capacitor.isNativePlatform()) {
      await TextToSpeech.speak({ text: words, lang: speechTags[locale], rate: 1, category: "playback" });
      return;
    }
    if (!voice.canSpeak()) throw new VoiceError("unavailable");
    window.speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(words);
      utterance.lang = speechTags[locale];
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  },

  async stopSpeaking() {
    if (Capacitor.isNativePlatform()) await TextToSpeech.stop().catch(() => undefined);
    else if (voice.canSpeak()) window.speechSynthesis.cancel();
  },
};
