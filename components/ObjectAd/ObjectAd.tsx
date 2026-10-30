import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Copy, Megaphone, MessageCircle, PenLine, RefreshCw, Share2, Sparkles, Tag, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { PLANS_HREF } from "@/components/Trial";
import { useTranslation } from "@/hooks/useTranslation";
import { objectConditions, type ObjectCondition } from "@/lib/ai/schema";
import { formatAriary } from "@/lib/format";
import { spring } from "@/lib/motion";
import { adShareText, guessCondition, whatsappShareUrl } from "@/lib/objectAd";
import { copyText, haptics, openExternal } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { adPlace, shareAd, writeAd } from "@/services/objectAd";
import { planStore } from "@/services/plan";
import { ApiError } from "@/types/api";
import type { HistoryEntry, SavedAd } from "@/types/history";
import styles from "./ObjectAd.module.scss";

const noSubscribe = () => () => {};
const timestamp = () => Date.now();
const FACEBOOK_URL = "https://www.facebook.com/marketplace/create/item";

type ErrorKind = "network" | "rate_limited" | "refused" | "unavailable" | "ask_limit" | "server_busy" | "unknown";
const knownErrors: ErrorKind[] = ["network", "rate_limited", "refused", "unavailable", "ask_limit", "server_busy"];

/** Under an object's summary: "I want to sell it", or the ad already written. */
export function ObjectAdControls({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  return (
    <div className={styles.controls}>
      {entry.ad ? (
        <p className={styles.status}>
          <Tag size={15} />
          <span>{t("objectAd.saved", { title: entry.ad.title, price: formatAriary(entry.ad.price, locale) })}</span>
        </p>
      ) : (
        <p className={styles.hint}>{t("objectAd.hint")}</p>
      )}
      <div className={styles.row}>
        <Button variant={entry.ad ? "secondary" : "primary"} icon={entry.ad ? <PenLine /> : <Megaphone />} onClick={() => setOpen(true)}>
          {entry.ad ? t("objectAd.open") : t("objectAd.sell")}
        </Button>
      </div>
      {mounted && createPortal(<AnimatePresence>{open && <AdSheet key={entry.id} entry={entry} onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </div>
  );
}

function AdSheet({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [condition, setCondition] = useState<ObjectCondition>(entry.ad?.condition ?? guessCondition(entry.analysis));
  const [place, setPlace] = useState(() => entry.ad?.place ?? adPlace.get());
  const [malagasy, setMalagasy] = useState(Boolean(entry.ad?.textMg));
  const [ad, setAd] = useState<SavedAd | null>(entry.ad ?? null);
  const [editing, setEditing] = useState(!entry.ad);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);

  const write = async () => {
    haptics.press();
    setBusy(true);
    setError(null);
    adPlace.set(place);
    try {
      const response = await writeAd(entry, { condition, place, malagasy, locale });
      if (response.usage) planStore.setUsage({ questionsToday: response.usage.used });
      const next: SavedAd = { ...response.ad, condition, ...(place.trim() && { place: place.trim() }), at: timestamp() };
      await historyStore.update(entry.id, { ad: next });
      setAd(next);
      setDemo(response.demo);
      setEditing(false);
      haptics.success();
    } catch (err) {
      haptics.error();
      const code = err instanceof ApiError ? err.code : "unknown";
      setError(knownErrors.includes(code as ErrorKind) ? (code as ErrorKind) : "unknown");
    } finally {
      setBusy(false);
    }
  };

  // The user's edits stay with the scan.
  const edit = (patch: Partial<SavedAd>) => setAd((current) => (current ? { ...current, ...patch } : current));
  const keep = () => {
    if (ad) void historyStore.update(entry.id, { ad });
  };

  const fullText = ad ? adShareText(ad, t("objectAd.priceLabel"), locale) : "";
  const copy = async () => {
    keep();
    if (await copyText(fullText)) {
      haptics.tap();
      toast(t("objectAd.copied"));
    } else toast(t("errors.unknown"), "error");
  };
  const facebook = async () => {
    keep();
    // Facebook takes no text from a link: copied first, then pasted in the post.
    await copyText(fullText);
    toast(t("objectAd.facebookHint"));
    openExternal(FACEBOOK_URL);
  };
  const share = async () => {
    if (!ad) return;
    keep();
    const outcome = await shareAd(ad.title, fullText, entry.preview);
    if (outcome === "copied") toast(t("objectAd.copied"));
  };

  return (
    <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="object-ad-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.top}>
          <h2 id="object-ad-title">{t("objectAd.sheetTitle")}</h2>
          <button
            type="button"
            className={styles.close}
            onClick={() => {
              keep();
              onClose();
            }}
            aria-label={t("objectAd.close")}
          >
            <X size={18} />
          </button>
        </div>

        {editing || !ad ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void write();
            }}
          >
            <fieldset className={styles.field}>
              <legend>{t("objectAd.condition")}</legend>
              <div className={styles.chips} role="radiogroup" aria-label={t("objectAd.condition")}>
                {objectConditions.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={condition === value} className={styles.chip} onClick={() => setCondition(value)}>
                    {t(`objectAd.conditions.${value}`)}
                  </button>
                ))}
              </div>
              <small>{t("objectAd.conditionHint")}</small>
            </fieldset>
            <label className={styles.field}>
              <span>{t("objectAd.place")}</span>
              <input value={place} onChange={(event) => setPlace(event.target.value.slice(0, 60))} placeholder={t("objectAd.placePlaceholder")} autoComplete="address-level2" />
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={malagasy} onChange={(event) => setMalagasy(event.target.checked)} />
              <span>{t("objectAd.malagasy")}</span>
            </label>

            {error && (
              <div className={styles.error} role="alert">
                <p>{error === "ask_limit" ? t("chat.limit") : t(`errors.${error}`)}</p>
                {(error === "ask_limit" || error === "server_busy") && <Link href={PLANS_HREF}>{t("trial.seeOffers")}</Link>}
              </div>
            )}

            <Button type="submit" block icon={<Sparkles />} disabled={busy}>
              {busy ? t("objectAd.writing") : ad ? t("objectAd.regenerate") : t("objectAd.write")}
            </Button>
            <small className={styles.note}>{t("objectAd.countsAsQuestion")}</small>
          </form>
        ) : (
          <div className={styles.form}>
            {demo && <p className={styles.note}>{t("objectAd.demo")}</p>}
            <div className={styles.price}>
              <span>{t("objectAd.price")}</span>
              <strong>{formatAriary(ad.price, locale)}</strong>
              <small>{t("objectAd.priceRange", { low: formatAriary(ad.priceLow, locale), high: formatAriary(ad.priceHigh, locale) })}</small>
              <small>{t("objectAd.priceNote")}</small>
            </div>
            <label className={styles.field}>
              <span>{t("objectAd.title")}</span>
              <input value={ad.title} onChange={(event) => edit({ title: event.target.value.slice(0, 120) })} onBlur={keep} />
            </label>
            <label className={styles.field}>
              <span>{t("objectAd.text")}</span>
              <textarea rows={6} value={ad.text} onChange={(event) => edit({ text: event.target.value.slice(0, 2000) })} onBlur={keep} />
            </label>
            {ad.textMg !== null && (
              <label className={styles.field}>
                <span>{t("objectAd.textMg")}</span>
                <textarea rows={5} value={ad.textMg} onChange={(event) => edit({ textMg: event.target.value.slice(0, 2000) })} onBlur={keep} />
              </label>
            )}
            {ad.keywords.length > 0 && (
              <div className={styles.field}>
                <span>{t("objectAd.keywords")}</span>
                <ul className={styles.keywords}>
                  {ad.keywords.map((word) => (
                    <li key={word}>#{word.replace(/\s+/g, "")}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className={styles.actions}>
              <Button icon={<Copy />} onClick={() => void copy()}>
                {t("objectAd.copy")}
              </Button>
              <Button
                variant="secondary"
                icon={<MessageCircle />}
                onClick={() => {
                  keep();
                  openExternal(whatsappShareUrl(fullText));
                }}
              >
                {t("objectAd.whatsapp")}
              </Button>
              <Button variant="secondary" onClick={() => void facebook()}>
                {t("objectAd.facebook")}
              </Button>
              <Button variant="secondary" icon={<Share2 />} onClick={() => void share()}>
                {t("objectAd.share")}
              </Button>
            </div>
            <Button variant="ghost" icon={<RefreshCw />} onClick={() => setEditing(true)}>
              {t("objectAd.again")}
            </Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
