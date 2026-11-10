import { useState, type FormEvent } from "react";
import { BellRing, CalendarPlus, Clock, MapPin, Pencil, Stethoscope, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import formStyles from "@/components/EmergencyCard/EmergencyCard.module.scss";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { APPOINTMENT_TEXT_MAX, appointmentTime, remindedKinds, removeAppointment, saveAppointment, splitAppointments, type Appointment } from "@/lib/appointments";
import { formatDay, formatTime, toDateInput } from "@/lib/format";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { createId } from "@/services/historyStore";
import { requestNotificationPermission } from "@/services/notifications";
import styles from "./Appointments.module.scss";

/** When a change is made (read in the handlers only). */
const clock = () => Date.now();

/** The sheet: closed, a new appointment, or one being changed. */
type Editing = null | "new" | Appointment;

/**
 * "Rendez-vous" in Ma santé: the next appointments first, the past ones
 * folded. Written in a bottom sheet; kept in the settings (on the device,
 * synced with the account). The list is for everyone, the reminders (the
 * day before at 18 h, 2 h before) from Lite.
 */
export function Appointments() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, ready, update } = useSettings();
  const { plan, has, planFor, name: planName } = usePlan();
  const reminders = has("reminders");
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Editing>(null);
  const { upcoming, past } = splitAppointments(settings.appointments, now);

  const save = async (id: string | null, draft: Parameters<typeof saveAppointment>[2]) => {
    haptics.success();
    update({ appointments: saveAppointment(settings.appointments, id, draft, clock(), createId) });
    setEditing(null);
    toast(t(id ? "health.appointments.updated" : "health.appointments.added"));
    // The reminders need the notifications: asked when one is written, never otherwise.
    if (reminders) await requestNotificationPermission().catch(() => undefined);
  };

  const remove = (appointment: Appointment) => {
    haptics.press();
    update({ appointments: removeAppointment(settings.appointments, appointment.id, clock()) });
    toast(t("health.appointments.removed"));
  };

  return (
    <section className={styles.section} id="appointments" data-testid="appointments" aria-labelledby="appointments-title">
      <h2 id="appointments-title">{t("health.appointments.title")}</h2>
      <Button variant="secondary" icon={<CalendarPlus />} onClick={() => setEditing("new")} disabled={!ready} data-testid="appointment-add">
        {t("health.appointments.add")}
      </Button>
      {plan !== null && !reminders && <PlanLock plan={planFor("reminders")} text={t("health.appointments.locked", { plan: planName(planFor("reminders") ?? "lite") })} />}
      {ready && upcoming.length === 0 && <p className={styles.empty}>{t("health.appointments.empty")}</p>}
      {upcoming.length > 0 && (
        <ul className={styles.list}>
          {upcoming.map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} reminders={reminders} now={now} onEdit={() => setEditing(appointment)} onRemove={() => remove(appointment)} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className={styles.past} data-testid="appointments-past">
          <summary>{t("health.appointments.past", { count: past.length })}</summary>
          <ul className={styles.list}>
            {past.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} past now={now} onEdit={() => setEditing(appointment)} onRemove={() => remove(appointment)} />
            ))}
          </ul>
        </details>
      )}

      <ExpenseSheet open={editing !== null} title={t(editing === "new" ? "health.appointments.add" : "health.appointments.edit")} onClose={() => setEditing(null)}>
        {editing !== null && (
          <AppointmentForm appointment={editing === "new" ? null : editing} onSave={(draft) => void save(editing === "new" ? null : editing.id, draft)} onCancel={() => setEditing(null)} />
        )}
      </ExpenseSheet>
    </section>
  );
}

function AppointmentCard({ appointment, past, reminders, now, onEdit, onRemove }: { appointment: Appointment; past?: boolean; reminders?: boolean; now: number; onEdit: () => void; onRemove: () => void }) {
  const { t, locale } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  // Only what will really ring: nothing once both moments are gone by.
  const kinds = reminders && !past ? remindedKinds(appointment, now) : [];

  return (
    <li className={styles.card} data-testid="appointment" data-past={past || undefined}>
      <p className={styles.when}>
        <Clock size={16} aria-hidden />
        <span>
          <strong>{formatDay(appointment.at, locale)}</strong>
          <span>{formatTime(appointment.at, locale)}</span>
        </span>
      </p>
      {appointment.who && (
        <p className={styles.line}>
          <Stethoscope size={15} aria-hidden /> <span>{appointment.who}</span>
        </p>
      )}
      {appointment.place && (
        <p className={styles.line}>
          <MapPin size={15} aria-hidden /> <span>{appointment.place}</span>
        </p>
      )}
      {appointment.note && <p className={styles.note}>{appointment.note}</p>}
      {kinds.length > 0 && (
        <p className={styles.reminder} data-testid="appointment-reminded">
          <BellRing size={14} aria-hidden /> <span>{t(kinds.includes("eve") ? "health.appointments.reminded" : "health.appointments.remindedSoon")}</span>
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" icon={<Pencil />} onClick={onEdit} data-testid="appointment-edit">
          {t("health.appointments.editShort")}
        </Button>
        <Button
          variant={confirm ? "danger" : "ghost"}
          icon={<Trash2 />}
          onClick={() => {
            if (confirm) onRemove();
            else setConfirm(true);
          }}
          data-testid="appointment-remove"
        >
          {t(confirm ? "health.appointments.removeConfirm" : "health.appointments.remove")}
        </Button>
      </div>
    </li>
  );
}

function AppointmentForm({ appointment, onSave, onCancel }: { appointment: Appointment | null; onSave: (draft: Parameters<typeof saveAppointment>[2]) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const at = appointment?.at;
  const [day, setDay] = useState(() => (at ? toDateInput(at) : ""));
  const [hour, setHour] = useState(() => (at ? `${String(new Date(at).getHours()).padStart(2, "0")}:${String(new Date(at).getMinutes()).padStart(2, "0")}` : ""));
  const [who, setWho] = useState(appointment?.who ?? "");
  const [place, setPlace] = useState(appointment?.place ?? "");
  const [note, setNote] = useState(appointment?.note ?? "");
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const time = appointmentTime(day, hour);
    if (time === null) {
      setMissing(true);
      return;
    }
    onSave({ at: time, who, place, note });
  };

  return (
    <form className={`${sheetStyles.form} ${formStyles.form}`} onSubmit={submit} noValidate data-testid="appointment-form">
      <div className={styles.pair}>
        <label>
          {t("health.appointments.day")}
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} aria-invalid={(missing && !day) || undefined} data-testid="appointment-day" />
        </label>
        <label>
          {t("health.appointments.hour")}
          <input type="time" value={hour} onChange={(event) => setHour(event.target.value)} aria-invalid={(missing && !hour) || undefined} data-testid="appointment-hour" />
        </label>
      </div>
      {missing && (
        <p className={styles.error} role="alert">
          {t("health.appointments.whenMissing")}
        </p>
      )}
      <label>
        {t("health.appointments.who")}
        <input value={who} maxLength={APPOINTMENT_TEXT_MAX} placeholder={t("health.appointments.whoHint")} onChange={(event) => setWho(event.target.value)} data-testid="appointment-who" />
      </label>
      <label>
        {t("health.appointments.place")}
        <input value={place} maxLength={APPOINTMENT_TEXT_MAX} placeholder={t("health.appointments.placeHint")} onChange={(event) => setPlace(event.target.value)} data-testid="appointment-place" />
      </label>
      <label>
        {t("health.appointments.note")}
        <textarea rows={2} maxLength={APPOINTMENT_TEXT_MAX} value={note} placeholder={t("health.appointments.noteHint")} onChange={(event) => setNote(event.target.value)} data-testid="appointment-note" />
      </label>
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="appointment-save">
          {t("health.appointments.save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("health.appointments.cancel")}
        </Button>
      </div>
    </form>
  );
}
