import { useId, useState, type FormEvent } from "react";
import { BellRing, CalendarClock, FileDown, MessageCircle, Pencil, Share2, Syringe, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import formStyles from "@/components/EmergencyCard/EmergencyCard.module.scss";
import { WhoField } from "@/components/HealthProfiles/WhoField";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, toDateInput } from "@/lib/format";
import { liveProfiles, ME } from "@/lib/healthProfiles";
import { useSettings } from "@/lib/settings/SettingsProvider";
import {
  nextDoses,
  removeVaccine,
  saveVaccine,
  vaccineDay,
  vaccineHistory,
  vaccineOwner,
  vaccineReminders,
  vaccinesOf,
  VACCINE_DOSE_MAX,
  VACCINE_NOTE_MAX,
  VACCINE_TEXT_MAX,
  type Vaccine,
  type VaccineDraft,
} from "@/lib/vaccines";
import { haptics } from "@/services/device";
import { exportVaccinesPdf, shareVaccines, whatsappVaccines } from "@/services/healthShare";
import { createId } from "@/services/historyStore";
import { requestNotificationPermission } from "@/services/notifications";
import styles from "./Vaccines.module.scss";

/** When a change is made (read in the handlers only). */
const clock = () => Date.now();

/** The sheet: closed, a new vaccine (maybe started from a next dose), or one being changed. */
type Editing = null | { kind: "new"; name?: string } | { kind: "edit"; vaccine: Vaccine };

/**
 * "Vaccins" in Ma santé: the next doses written on the booklet first, then
 * the vaccines done, the latest first. Written by hand in a bottom sheet:
 * nothing is worked out, nothing advised. Kept in the settings (on the
 * device, synced with the account). The record is for everyone, the
 * reminder (the day before at 9 h) from Lite. Only the person picked at the
 * top of the screen ("Pour qui ?").
 */
export function Vaccines({ profileId = ME }: { profileId?: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { settings, ready, update } = useSettings();
  const { plan, has, planFor, name: planName } = usePlan();
  const reminders = has("reminders");
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Editing>(null);
  const [sharing, setSharing] = useState(false);
  // An orphan (its relative no longer here) is in no one's record, never "Moi"'s.
  const mine = vaccinesOf(settings.vaccines, profileId, settings.healthProfiles);
  const next = nextDoses(mine, now);
  const history = vaccineHistory(mine);
  // Only what will really ring (the day before is still to come).
  const reminded = new Set(reminders ? vaccineReminders(mine, now).map((reminder) => reminder.vaccine.id) : []);
  const name = profileId === ME ? null : (liveProfiles(settings.healthProfiles).find((item) => item.id === profileId)?.name ?? null);

  const save = async (id: string | null, draft: VaccineDraft) => {
    haptics.success();
    update({ vaccines: saveVaccine(settings.vaccines, id, draft, clock(), createId) });
    setEditing(null);
    toast(t(id ? "health.vaccines.updated" : "health.vaccines.added"));
    // The reminder needs the notifications: asked when a next dose is written, never otherwise.
    if (reminders && draft.nextAt) await requestNotificationPermission().catch(() => undefined);
  };

  const remove = (vaccine: Vaccine) => {
    haptics.press();
    update({ vaccines: removeVaccine(settings.vaccines, vaccine.id, clock()) });
    toast(t("health.vaccines.removed"));
  };

  const share = async (via: "text" | "whatsapp" | "pdf") => {
    if (sharing || history.length === 0) return;
    haptics.tap();
    if (via === "whatsapp") {
      whatsappVaccines(mine, t, locale, name);
      return;
    }
    setSharing(true);
    try {
      const outcome = via === "pdf" ? await exportVaccinesPdf(mine, t, locale, name) : await shareVaccines(mine, t, locale, name);
      if (outcome === "copied") toast(t("health.vaccines.share.copied"));
      else if (outcome === "downloaded") toast(t("pdf.downloaded"));
      else if (outcome === "unavailable") toast(t("health.vaccines.share.failed"), "error");
    } catch {
      toast(t("health.vaccines.share.failed"), "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className={styles.section} id="vaccines" data-testid="vaccines" aria-labelledby="vaccines-title">
      <h2 id="vaccines-title">{t("health.vaccines.title")}</h2>
      <Button variant="secondary" icon={<Syringe />} onClick={() => setEditing({ kind: "new" })} disabled={!ready} data-testid="vaccine-add">
        {t("health.vaccines.add")}
      </Button>
      {plan !== null && !reminders && next.length > 0 && <PlanLock plan={planFor("reminders")} text={t("health.vaccines.locked", { plan: planName(planFor("reminders") ?? "lite") })} />}

      {next.length > 0 && (
        <ul className={styles.next} aria-label={t("health.vaccines.nextTitle")} data-testid="vaccine-next-list">
          {next.map(({ vaccine, at, overdue }) => (
            <li key={vaccine.id} className={styles.dose} data-overdue={overdue || undefined} data-testid="vaccine-next">
              <CalendarClock size={18} aria-hidden />
              <div className={styles.doseText}>
                <p>
                  <strong>{t("health.vaccines.next", { name: vaccine.name, date: formatDate(at, locale) })}</strong>
                </p>
                {overdue ? (
                  <p className={styles.late} data-testid="vaccine-overdue">
                    {t("health.vaccines.overdue")}
                  </p>
                ) : (
                  reminded.has(vaccine.id) && (
                    <p className={styles.bell} data-testid="vaccine-reminded">
                      <BellRing size={13} aria-hidden /> {t("health.vaccines.reminded")}
                    </p>
                  )
                )}
              </div>
              <Button variant="ghost" size="md" onClick={() => setEditing({ kind: "new", name: vaccine.name })} data-testid="vaccine-done">
                {t("health.vaccines.markDone")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {ready && history.length === 0 && <p className={styles.empty}>{name ? t("health.vaccines.emptyOf", { name }) : t("health.vaccines.empty")}</p>}
      {history.length > 0 && (
        <>
          <ol className={styles.history} aria-label={t("health.vaccines.historyTitle")}>
            {history.map((vaccine) => (
              <VaccineRow key={vaccine.id} vaccine={vaccine} onEdit={() => setEditing({ kind: "edit", vaccine })} onRemove={() => remove(vaccine)} />
            ))}
          </ol>
          <div className={styles.share}>
            <Button variant="secondary" size="md" icon={<Share2 />} onClick={() => void share("text")} disabled={sharing} data-testid="vaccines-share">
              {t("health.vaccines.share.button")}
            </Button>
            <Button variant="secondary" size="md" icon={<MessageCircle />} onClick={() => void share("whatsapp")} data-testid="vaccines-whatsapp">
              {t("health.vaccines.share.whatsapp")}
            </Button>
            <Button variant="secondary" size="md" icon={<FileDown />} onClick={() => void share("pdf")} disabled={sharing} data-testid="vaccines-pdf">
              {t("health.vaccines.share.pdf")}
            </Button>
          </div>
        </>
      )}

      <ExpenseSheet open={editing !== null} title={t(editing?.kind === "edit" ? "health.vaccines.edit" : "health.vaccines.add")} onClose={() => setEditing(null)}>
        {editing !== null && (
          <VaccineForm
            vaccine={editing.kind === "edit" ? editing.vaccine : null}
            startName={editing.kind === "new" ? editing.name : undefined}
            owner={editing.kind === "new" ? profileId : (vaccineOwner(editing.vaccine, settings.healthProfiles) ?? profileId)}
            onSave={(draft) => void save(editing.kind === "edit" ? editing.vaccine.id : null, draft)}
            onCancel={() => setEditing(null)}
          />
        )}
      </ExpenseSheet>
    </section>
  );
}

function VaccineRow({ vaccine, onEdit, onRemove }: { vaccine: Vaccine; onEdit: () => void; onRemove: () => void }) {
  const { t, locale } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const details = [vaccine.dose && t("health.vaccines.doseShown", { dose: vaccine.dose }), vaccine.place, vaccine.lot && t("health.vaccines.lotShown", { lot: vaccine.lot })].filter(Boolean);

  return (
    <li className={styles.row} id={`vax-${vaccine.id}`} data-testid="vaccine">
      <p className={styles.when}>{formatDate(vaccine.at, locale)}</p>
      <div className={styles.body}>
        <p className={styles.name}>{vaccine.name}</p>
        {details.length > 0 && <p className={styles.details}>{details.join(" · ")}</p>}
        {vaccine.note && <p className={styles.note}>{vaccine.note}</p>}
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" size="md" icon={<Pencil />} onClick={onEdit} data-testid="vaccine-edit">
          {t("health.vaccines.editShort")}
        </Button>
        <Button
          variant={confirm ? "danger" : "ghost"}
          size="md"
          icon={<Trash2 />}
          onClick={() => {
            if (confirm) onRemove();
            else setConfirm(true);
          }}
          data-testid="vaccine-remove"
        >
          {t(confirm ? "health.vaccines.removeConfirm" : "health.vaccines.remove")}
        </Button>
      </div>
    </li>
  );
}

function VaccineForm({
  vaccine,
  startName,
  owner,
  onSave,
  onCancel,
}: {
  vaccine: Vaccine | null;
  startName?: string;
  owner: string;
  onSave: (draft: VaccineDraft) => void;
  onCancel: () => void;
}) {
  const { t, list } = useTranslation();
  const suggestions = useId();
  const [name, setName] = useState(vaccine?.name ?? startName ?? "");
  // A next dose being noted as done: today, ready to change.
  const [day, setDay] = useState(() => (vaccine ? toDateInput(vaccine.at) : startName ? toDateInput(clock()) : ""));
  const [dose, setDose] = useState(vaccine?.dose ?? "");
  const [place, setPlace] = useState(vaccine?.place ?? "");
  const [lot, setLot] = useState(vaccine?.lot ?? "");
  const [note, setNote] = useState(vaccine?.note ?? "");
  const [nextDay, setNextDay] = useState(vaccine?.nextAt ? toDateInput(vaccine.nextAt) : "");
  const [forWho, setForWho] = useState(owner);
  const [missing, setMissing] = useState<null | "name" | "day" | "next">(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const at = vaccineDay(day);
    const nextAt = nextDay ? vaccineDay(nextDay) : null;
    if (!name.trim()) return setMissing("name");
    if (at === null) return setMissing("day");
    if (nextDay && (nextAt === null || nextAt <= at)) return setMissing("next");
    onSave({ name, at, dose, place, lot, note, ...(nextAt && { nextAt }), profileId: forWho });
  };

  return (
    <form className={`${sheetStyles.form} ${formStyles.form}`} onSubmit={submit} noValidate data-testid="vaccine-form">
      <WhoField value={forWho} onChange={setForWho} />
      <label>
        {t("health.vaccines.name")}
        <input
          value={name}
          list={suggestions}
          maxLength={VACCINE_TEXT_MAX}
          autoComplete="off"
          placeholder={t("health.vaccines.nameHint")}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={missing === "name" || undefined}
          data-testid="vaccine-name"
        />
        <datalist id={suggestions}>
          {list("health.vaccines.suggestions").map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <div className={styles.pair}>
        <label>
          {t("health.vaccines.day")}
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} aria-invalid={missing === "day" || undefined} data-testid="vaccine-day" />
        </label>
        <label>
          {t("health.vaccines.dose")}
          <input value={dose} maxLength={VACCINE_DOSE_MAX} placeholder={t("health.vaccines.doseHint")} onChange={(event) => setDose(event.target.value)} data-testid="vaccine-dose" />
        </label>
      </div>
      {missing && (
        <p className={styles.error} role="alert">
          {t(`health.vaccines.missing.${missing}`)}
        </p>
      )}
      <label>
        {t("health.vaccines.place")}
        <input value={place} maxLength={VACCINE_TEXT_MAX} placeholder={t("health.vaccines.placeHint")} onChange={(event) => setPlace(event.target.value)} data-testid="vaccine-place" />
      </label>
      <label>
        {t("health.vaccines.lot")}
        <input value={lot} maxLength={VACCINE_TEXT_MAX} autoComplete="off" onChange={(event) => setLot(event.target.value)} data-testid="vaccine-lot" />
      </label>
      <label>
        {t("health.vaccines.note")}
        <textarea rows={2} maxLength={VACCINE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} data-testid="vaccine-note" />
      </label>
      <label>
        {t("health.vaccines.nextDay")}
        <input type="date" value={nextDay} onChange={(event) => setNextDay(event.target.value)} aria-invalid={missing === "next" || undefined} data-testid="vaccine-next-day" />
        <span className={styles.hint}>{t("health.vaccines.nextHint")}</span>
      </label>
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="vaccine-save">
          {t("health.vaccines.save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("health.vaccines.cancel")}
        </Button>
      </div>
    </form>
  );
}
