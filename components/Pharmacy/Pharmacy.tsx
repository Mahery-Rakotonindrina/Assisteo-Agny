import { useEffect, useRef, useState, type FormEvent } from "react";
import { BellRing, Check, Pencil, Pill, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import formStyles from "@/components/EmergencyCard/EmergencyCard.module.scss";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import type { Locale } from "@/i18n.config";
import { formatDate, formatMonthYear } from "@/lib/format";
import { liveProfiles, ME } from "@/lib/healthProfiles";
import {
  expiryDay,
  expiryFrom,
  expiryStatus,
  fromScan,
  hasExpiryDay,
  homeMedicines,
  HOME_MEDICINE_NOTE_MAX,
  HOME_MEDICINE_TEXT_MAX,
  normalizeExpiry,
  pharmacyReminders,
  removeHomeMedicine,
  restoreHomeMedicine,
  scanMedicineId,
  saveHomeMedicine,
  type HomeMedicine,
  type HomeMedicineDraft,
} from "@/lib/pharmacy";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { createId } from "@/services/historyStore";
import { requestNotificationPermission } from "@/services/notifications";
import styles from "./Pharmacy.module.scss";

/** When a change is made (read in the handlers only). */
const clock = () => Date.now();

/** "mars 2027", or "15 mars 2027" when the day was written. */
export const expiryLabel = (expiry: string, locale: Locale) => (hasExpiryDay(expiry) ? formatDate(expiryDay(expiry), locale) : formatMonthYear(expiryDay(expiry), locale));

/** What a scanned box gives the form: its name, dosage and expiry if read. */
export type PharmacyPrefill = { name: string; strength: string; expiry: string | null; scanId: string; /** Its place among the scan's medicines. */ index: number };

/** Writes a medicine in the settings, and asks for the notifications once (the alerts need them). */
function useSaveMedicine() {
  const { settings, update } = useSettings();
  const { has } = usePlan();
  return async (id: string | null, draft: HomeMedicineDraft, newId: () => string = createId) => {
    haptics.success();
    update({ pharmacy: saveHomeMedicine(settings.pharmacy, id, draft, clock(), newId) });
    if (has("reminders")) await requestNotificationPermission().catch(() => undefined);
  };
}

/** The sheet: closed, a new medicine, or one being changed. */
type Editing = null | "new" | HomeMedicine;

/**
 * "Pharmacie de la maison" in Ma santé: what is kept at home, for the whole
 * household (whoever is picked above), the first to expire first, with a
 * badge 30 days before and once expired. Added by hand here, or from a
 * scanned box (AddToPharmacy). For everyone; the alerts from Lite.
 */
export function Pharmacy() {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { settings, ready, update } = useSettings();
  const { plan, has, planFor, name: planName } = usePlan();
  const reminders = has("reminders");
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Editing>(null);
  const saveMedicine = useSaveMedicine();
  const items = homeMedicines(settings.pharmacy);
  const statuses = new Map(items.map((item) => [item.id, expiryStatus(item.expiry, now)]));
  const anyExpired = [...statuses.values()].includes("expired");
  const alerted = new Set(reminders ? pharmacyReminders(items, now).map((reminder) => reminder.medicine.id) : []);
  const profiles = liveProfiles(settings.healthProfiles);
  const whoName = (forWho?: string) => (!forWho ? null : forWho === ME ? t("health.profiles.me") : (profiles.find((item) => item.id === forWho)?.name ?? null));

  const save = async (id: string | null, draft: HomeMedicineDraft) => {
    setEditing(null);
    toast(t(id ? "health.pharmacy.updated" : "health.pharmacy.added"));
    await saveMedicine(id, draft);
  };

  // The list as it is now, for "Annuler" tapped a few seconds later.
  const latest = useRef(settings.pharmacy);
  useEffect(() => {
    latest.current = settings.pharmacy;
  }, [settings.pharmacy]);

  const remove = (medicine: HomeMedicine, why: "thrown" | "finished") => {
    haptics.press();
    update({ pharmacy: removeHomeMedicine(settings.pharmacy, medicine.id, clock()) });
    // No confirmation: a few seconds to take it back instead, as it was.
    toast(t(`health.pharmacy.removed.${why}`, { name: medicine.name }), "success", {
      label: t("health.pharmacy.undo"),
      onClick: () => {
        update({ pharmacy: restoreHomeMedicine(latest.current, medicine, clock()) });
        toast(t("health.pharmacy.restored", { name: medicine.name }));
      },
    });
  };

  return (
    <section className={styles.section} id="pharmacy" data-testid="pharmacy" aria-labelledby="pharmacy-title">
      <h2 id="pharmacy-title">{t("health.pharmacy.title")}</h2>
      <p className={styles.lead}>{t("health.pharmacy.lead")}</p>
      <Button variant="secondary" icon={<Plus />} onClick={() => setEditing("new")} disabled={!ready} data-testid="pharmacy-add">
        {t("health.pharmacy.add")}
      </Button>
      {plan !== null && !reminders && items.length > 0 && <PlanLock plan={planFor("reminders")} text={t("health.pharmacy.locked", { plan: planName(planFor("reminders") ?? "lite") })} />}
      {ready && items.length === 0 && <p className={styles.empty}>{t("health.pharmacy.empty")}</p>}
      {anyExpired && (
        <p className={styles.warning} role="note" data-testid="pharmacy-expired-note">
          <TriangleAlert size={16} aria-hidden /> <span>{t("health.pharmacy.expiredNote")}</span>
        </p>
      )}
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((medicine) => {
            const status = statuses.get(medicine.id) ?? "ok";
            const who = whoName(medicine.forWho);
            return (
              <li key={medicine.id} className={styles.item} data-status={status} data-testid="pharmacy-item">
                <div className={styles.top}>
                  <p className={styles.name}>
                    <Pill size={16} aria-hidden />
                    <span>
                      <strong>{medicine.name}</strong>
                      {medicine.strength && <small>{medicine.strength}</small>}
                    </span>
                  </p>
                  {status !== "ok" && (
                    <span className={styles.badge} data-testid="pharmacy-badge">
                      {t(status === "expired" ? "health.pharmacy.expired" : status === "lastDay" ? "health.pharmacy.lastDay" : "health.pharmacy.soon")}
                    </span>
                  )}
                </div>
                <p className={styles.expiry}>{t("health.pharmacy.expiresOn", { date: expiryLabel(medicine.expiry, locale) })}</p>
                {(medicine.quantity || who) && <p className={styles.details}>{[medicine.quantity, who && t("health.pharmacy.for", { name: who })].filter(Boolean).join(" · ")}</p>}
                {medicine.note && <p className={styles.note}>{medicine.note}</p>}
                {alerted.has(medicine.id) && (
                  <p className={styles.bell} data-testid="pharmacy-alerted">
                    <BellRing size={13} aria-hidden /> {t("health.pharmacy.alerted")}
                  </p>
                )}
                <div className={styles.actions}>
                  <Button variant="ghost" icon={<Pencil />} onClick={() => setEditing(medicine)} data-testid="pharmacy-edit">
                    {t("health.pharmacy.editShort")}
                  </Button>
                  <Button variant="ghost" icon={<Trash2 />} onClick={() => remove(medicine, "thrown")} data-testid="pharmacy-thrown">
                    {t("health.pharmacy.thrown")}
                  </Button>
                  <Button variant="ghost" icon={<Check />} onClick={() => remove(medicine, "finished")} data-testid="pharmacy-finished">
                    {t("health.pharmacy.finished")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ExpenseSheet open={editing !== null} title={t(editing === "new" ? "health.pharmacy.add" : "health.pharmacy.edit")} onClose={() => setEditing(null)}>
        {editing !== null && (
          <PharmacyForm medicine={editing === "new" ? null : editing} onSave={(draft) => void save(editing === "new" ? null : editing.id, draft)} onCancel={() => setEditing(null)} />
        )}
      </ExpenseSheet>
    </section>
  );
}

/**
 * "Ajouter à ma pharmacie" on a scanned medicine box: the form opens with the
 * name, the dosage and the expiry read on it, to check and complete.
 */
export function AddToPharmacy({ prefill }: { prefill: PharmacyPrefill }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, ready } = useSettings();
  const saveMedicine = useSaveMedicine();
  const [open, setOpen] = useState(false);
  const added = fromScan(settings.pharmacy, prefill.scanId, prefill.name);

  return (
    <>
      <Button variant="secondary" icon={added ? <Check /> : <Plus />} onClick={() => setOpen(true)} disabled={!ready || added} data-testid="pharmacy-from-scan">
        {added ? t("health.pharmacy.inPharmacy", { name: prefill.name }) : t("health.pharmacy.addFromScan", { name: prefill.name })}
      </Button>
      <ExpenseSheet open={open} title={t("health.pharmacy.add")} onClose={() => setOpen(false)}>
        {open && (
          <PharmacyForm
            medicine={null}
            prefill={prefill}
            onSave={(draft) => {
              setOpen(false);
              toast(t("health.pharmacy.added"));
              // The same box from the same scan on two devices: one medicine once synced.
              void saveMedicine(null, draft, () => scanMedicineId(prefill.scanId, prefill.index));
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </ExpenseSheet>
    </>
  );
}

const split = (expiry: string | null) => {
  const [year, month, day] = (expiry ?? "").split("-").map(Number);
  return { year: year || null, month: month || null, day: day || null };
};

function PharmacyForm({ medicine, prefill, onSave, onCancel }: { medicine: HomeMedicine | null; prefill?: PharmacyPrefill; onSave: (draft: HomeMedicineDraft) => void; onCancel: () => void }) {
  const { t, locale } = useTranslation();
  const { settings } = useSettings();
  const profiles = liveProfiles(settings.healthProfiles);
  const start = split(medicine?.expiry ?? normalizeExpiry(prefill?.expiry ?? null));
  const [name, setName] = useState(medicine?.name ?? prefill?.name ?? "");
  const [strength, setStrength] = useState(medicine?.strength ?? prefill?.strength ?? "");
  const [quantity, setQuantity] = useState(medicine?.quantity ?? "");
  const [month, setMonth] = useState(start.month ? String(start.month) : "");
  const [year, setYear] = useState(start.year ? String(start.year) : "");
  const [day, setDay] = useState(start.day ? String(start.day) : "");
  const [forWho, setForWho] = useState(medicine?.forWho ?? "");
  const [note, setNote] = useState(medicine?.note ?? "");
  const [missing, setMissing] = useState<null | "name" | "expiry" | "day">(null);
  // The years offered: a few back (an old box found in a drawer) and ten ahead.
  const [years] = useState(() => {
    const now = new Date(clock()).getFullYear();
    const list = Array.from({ length: 14 }, (_, index) => now - 3 + index);
    return start.year && !list.includes(start.year) ? [start.year, ...list].sort((a, b) => a - b) : list;
  });
  const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { month: "long" }).format(new Date(2026, index, 1)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setMissing("name");
    if (!month || !year) return setMissing("expiry");
    const expiry = expiryFrom(Number(year), Number(month), day ? Number(day) : null);
    if (!expiry) return setMissing("day");
    onSave({ name, strength, quantity, expiry, ...(forWho && { forWho }), note, ...(prefill && { scanId: prefill.scanId }) });
  };

  return (
    <form className={`${sheetStyles.form} ${formStyles.form}`} onSubmit={submit} noValidate data-testid="pharmacy-form">
      <label>
        {t("health.pharmacy.name")}
        <input value={name} maxLength={HOME_MEDICINE_TEXT_MAX} autoComplete="off" placeholder={t("health.pharmacy.nameHint")} onChange={(event) => setName(event.target.value)} aria-invalid={missing === "name" || undefined} data-testid="pharmacy-name" />
      </label>
      <div className={styles.pair}>
        <label>
          {t("health.pharmacy.strength")}
          <input value={strength} maxLength={HOME_MEDICINE_TEXT_MAX} placeholder={t("health.pharmacy.strengthHint")} onChange={(event) => setStrength(event.target.value)} data-testid="pharmacy-strength" />
        </label>
        <label>
          {t("health.pharmacy.quantity")}
          <input value={quantity} maxLength={HOME_MEDICINE_TEXT_MAX} placeholder={t("health.pharmacy.quantityHint")} onChange={(event) => setQuantity(event.target.value)} data-testid="pharmacy-quantity" />
        </label>
      </div>
      <fieldset className={formStyles.group}>
        <legend>{t("health.pharmacy.expiry")}</legend>
        <div className={styles.expiryFields}>
          <label>
            {t("health.pharmacy.month")}
            <select value={month} onChange={(event) => setMonth(event.target.value)} aria-invalid={(missing === "expiry" && !month) || undefined} data-testid="pharmacy-month">
              <option value="">{t("health.pharmacy.pick")}</option>
              {monthNames.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("health.pharmacy.year")}
            <select value={year} onChange={(event) => setYear(event.target.value)} aria-invalid={(missing === "expiry" && !year) || undefined} data-testid="pharmacy-year">
              <option value="">{t("health.pharmacy.pick")}</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("health.pharmacy.day")}
            <select value={day} onChange={(event) => setDay(event.target.value)} aria-invalid={missing === "day" || undefined} data-testid="pharmacy-day">
              <option value="">{t("health.pharmacy.noDay")}</option>
              {Array.from({ length: 31 }, (_, index) => index + 1).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className={styles.hint}>{t("health.pharmacy.expiryHint")}</span>
      </fieldset>
      {missing && (
        <p className={styles.error} role="alert">
          {t(`health.pharmacy.missing.${missing}`)}
        </p>
      )}
      <label>
        {t("health.pharmacy.forWho")}
        <select value={forWho} onChange={(event) => setForWho(event.target.value)} data-testid="pharmacy-who">
          <option value="">{t("health.pharmacy.everyone")}</option>
          <option value={ME}>{t("health.profiles.me")}</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("health.pharmacy.note")}
        <textarea rows={2} maxLength={HOME_MEDICINE_NOTE_MAX} value={note} placeholder={t("health.pharmacy.noteHint")} onChange={(event) => setNote(event.target.value)} data-testid="pharmacy-note" />
      </label>
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="pharmacy-save">
          {t("health.pharmacy.save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("health.pharmacy.cancel")}
        </Button>
      </div>
    </form>
  );
}
