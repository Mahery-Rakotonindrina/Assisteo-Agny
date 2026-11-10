import { useState, type FormEvent } from "react";
import { HeartPulse, MessageCircle, Pencil, Phone, Share2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { allergyTags, bloodGroups, bloodLabel, blankCard, CARD_TEXT_MAX, isCardEmpty, normalizeCard, telHref, type BloodGroup, type EmergencyCard as Card } from "@/lib/emergencyCard";
import { formatDate } from "@/lib/format";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { shareEmergencyCard, whatsappEmergencyCard } from "@/services/healthShare";
import styles from "./EmergencyCard.module.scss";

/**
 * "Fiche d'urgence", at the top of Ma santé: blood group, allergies,
 * long-term illnesses, who to call, a note. For everyone, read from the
 * settings (on the device, so offline too), written in a bottom sheet.
 */
export function EmergencyCard() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { settings, ready, update } = useSettings();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const card = settings.emergencyCard;
  const empty = isCardEmpty(card);

  const share = async (via: "share" | "whatsapp") => {
    if (!card || sharing) return;
    haptics.tap();
    if (via === "whatsapp") {
      whatsappEmergencyCard(card, t, locale);
      return;
    }
    setSharing(true);
    try {
      const outcome = await shareEmergencyCard(card, t, locale);
      if (outcome === "copied") toast(t("health.emergency.share.copied"));
      else if (outcome === "unavailable") toast(t("health.emergency.share.failed"), "error");
    } catch {
      toast(t("health.emergency.share.failed"), "error");
    } finally {
      setSharing(false);
    }
  };

  const save = (next: Card) => {
    haptics.success();
    update({ emergencyCard: next });
    setEditing(false);
    toast(t("health.emergency.saved"));
  };

  // Until the settings are read, nothing: never an empty card flashing over a filled one.
  if (!ready) return <section className={styles.card} aria-busy="true" data-testid="emergency-card" />;

  const call = card ? telHref(card.contactPhone) : null;

  return (
    <section className={styles.card} data-testid="emergency-card" aria-labelledby="emergency-title">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <HeartPulse size={20} />
        </span>
        <div className={styles.titles}>
          <h2 id="emergency-title">{t("health.emergency.title")}</h2>
          <p>{t("health.emergency.lead")}</p>
        </div>
      </div>

      {empty || !card ? (
        <>
          <p className={styles.empty}>{t("health.emergency.empty")}</p>
          <div className={styles.actions}>
            <Button icon={<Pencil />} onClick={() => setEditing(true)} data-testid="emergency-fill">
              {t("health.emergency.fill")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <dl className={styles.facts}>
            <div data-testid="emergency-blood">
              <dt>{t("health.emergency.blood")}</dt>
              <dd className={card.bloodGroup && card.bloodGroup !== "unknown" ? styles.blood : undefined}>
                {!card.bloodGroup ? t("health.emergency.notFilled") : card.bloodGroup === "unknown" ? t("health.emergency.bloodUnknown") : bloodLabel(card.bloodGroup)}
              </dd>
            </div>
            <div data-testid="emergency-allergies">
              <dt>{t("health.emergency.allergies")}</dt>
              <dd>
                {card.allergies ? (
                  <ul className={styles.tags}>
                    {allergyTags(card.allergies).map((tag, index) => (
                      <li key={`${index}-${tag}`}>{tag}</li>
                    ))}
                  </ul>
                ) : (
                  t("health.emergency.notFilled")
                )}
              </dd>
            </div>
            <div data-testid="emergency-conditions">
              <dt>{t("health.emergency.conditions")}</dt>
              <dd>{card.conditions || t("health.emergency.notFilled")}</dd>
            </div>
            <div data-testid="emergency-contact">
              <dt>{t("health.emergency.contact")}</dt>
              <dd>
                {card.contactName || card.contactPhone ? (
                  <span className={styles.contact}>
                    <strong>{[card.contactName, card.contactRelation && `(${card.contactRelation})`].filter(Boolean).join(" ")}</strong>
                    {card.contactPhone && <span>{card.contactPhone}</span>}
                  </span>
                ) : (
                  t("health.emergency.notFilled")
                )}
              </dd>
            </div>
            {card.note && (
              <div data-testid="emergency-note">
                <dt>{t("health.emergency.note")}</dt>
                <dd>{card.note}</dd>
              </div>
            )}
          </dl>

          {call && (
            // A plain link: the phone's dialer opens, in the app as on the site.
            <a className={styles.call} href={call} onClick={() => haptics.press()} data-testid="emergency-call">
              <Phone size={18} aria-hidden />
              {card.contactName ? t("health.emergency.call", { name: card.contactName }) : t("health.emergency.callPlain")}
            </a>
          )}

          <div className={styles.actions}>
            <Button variant="secondary" icon={<Share2 />} onClick={() => void share("share")} disabled={sharing} data-testid="emergency-share">
              {t("health.emergency.share.button")}
            </Button>
            <Button variant="secondary" icon={<MessageCircle />} onClick={() => void share("whatsapp")} data-testid="emergency-whatsapp">
              {t("health.emergency.share.whatsapp")}
            </Button>
            <Button variant="ghost" icon={<Pencil />} onClick={() => setEditing(true)} data-testid="emergency-edit">
              {t("health.emergency.edit")}
            </Button>
          </div>
          {card.updatedAt > 0 && <p className={styles.small}>{t("health.emergency.updated", { date: formatDate(card.updatedAt, locale) })}</p>}
        </>
      )}
      <p className={styles.small}>{t("health.emergency.privacy")}</p>

      <ExpenseSheet open={editing} title={t("health.emergency.title")} onClose={() => setEditing(false)}>
        {editing && <CardForm card={card} onSave={save} onCancel={() => setEditing(false)} />}
      </ExpenseSheet>
    </section>
  );
}

function CardForm({ card, onSave, onCancel }: { card: Card | null; onSave: (card: Card) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Card>(() => card ?? blankCard());
  const set = <K extends keyof Card>(key: K) => (value: Card[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(normalizeCard({ ...draft, updatedAt: Date.now() })!);
  };

  return (
    <form className={`${sheetStyles.form} ${styles.form}`} onSubmit={submit} data-testid="emergency-form">
      <label>
        {t("health.emergency.blood")}
        <select value={draft.bloodGroup ?? ""} onChange={(event) => set("bloodGroup")((event.target.value || null) as BloodGroup | null)} data-testid="emergency-blood-input">
          <option value="">{t("health.emergency.bloodPick")}</option>
          {bloodGroups.map((group) => (
            <option key={group} value={group}>
              {group === "unknown" ? t("health.emergency.bloodUnknown") : bloodLabel(group)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("health.emergency.allergies")}
        <textarea
          rows={2}
          maxLength={CARD_TEXT_MAX}
          value={draft.allergies}
          placeholder={t("health.emergency.allergiesHint")}
          onChange={(event) => set("allergies")(event.target.value)}
          data-testid="emergency-allergies-input"
        />
      </label>
      <label>
        {t("health.emergency.conditions")}
        <textarea
          rows={2}
          maxLength={CARD_TEXT_MAX}
          value={draft.conditions}
          placeholder={t("health.emergency.conditionsHint")}
          onChange={(event) => set("conditions")(event.target.value)}
          data-testid="emergency-conditions-input"
        />
      </label>
      <fieldset className={styles.group}>
        <legend>{t("health.emergency.contact")}</legend>
        <label>
          {t("health.emergency.contactName")}
          <input value={draft.contactName} maxLength={80} autoComplete="off" onChange={(event) => set("contactName")(event.target.value)} data-testid="emergency-contact-name" />
        </label>
        <label>
          {t("health.emergency.contactRelation")}
          <input
            value={draft.contactRelation}
            maxLength={60}
            autoComplete="off"
            placeholder={t("health.emergency.contactRelationHint")}
            onChange={(event) => set("contactRelation")(event.target.value)}
            data-testid="emergency-contact-relation"
          />
        </label>
        <label>
          {t("health.emergency.contactPhone")}
          <input
            type="tel"
            inputMode="tel"
            value={draft.contactPhone}
            maxLength={30}
            autoComplete="off"
            onChange={(event) => set("contactPhone")(event.target.value)}
            data-testid="emergency-contact-phone"
          />
        </label>
      </fieldset>
      <label>
        {t("health.emergency.note")}
        <textarea rows={2} maxLength={CARD_TEXT_MAX} value={draft.note} placeholder={t("health.emergency.noteHint")} onChange={(event) => set("note")(event.target.value)} data-testid="emergency-note-input" />
      </label>
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="emergency-save">
          {t("health.emergency.save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("health.emergency.cancel")}
        </Button>
      </div>
    </form>
  );
}
