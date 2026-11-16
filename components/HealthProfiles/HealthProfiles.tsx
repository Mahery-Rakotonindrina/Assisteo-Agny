import { useState, type FormEvent } from "react";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/Button";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import sheetStyles from "@/components/Expenses/Expenses.module.scss";
import formStyles from "@/components/EmergencyCard/EmergencyCard.module.scss";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { useMeasures } from "@/hooks/useMeasures";
import { useTranslation } from "@/hooks/useTranslation";
import { liveAppointments, reassignAppointments } from "@/lib/appointments";
import { ageOf, liveProfiles, ME, PROFILE_NAME_MAX, relations, removeProfile, saveProfile, type HealthProfile, type Relation } from "@/lib/healthProfiles";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { haptics } from "@/services/device";
import { createId, historyStore } from "@/services/historyStore";
import { healthSpendStore } from "@/services/healthSpendStore";
import { measureStore } from "@/services/measureStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./HealthProfiles.module.scss";

/** When a change is made (read in the handlers only). */
const clock = () => Date.now();

type Sheet = null | { kind: "edit"; profile: HealthProfile | null } | { kind: "remove"; profile: HealthProfile };

/**
 * "Pour qui ?" at the top of Ma santé: one chip per person ("Moi" first),
 * which filters the screen; "Ajouter un proche"; and for a relative picked,
 * edit or remove (their things come back to "Moi", after a confirmation).
 * Local profiles, not accounts, kept in the synced settings.
 */
export function HealthProfiles({ selected, onSelect, entries }: { selected: string; onSelect: (profileId: string) => void; entries: HistoryEntry[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const { settings, ready, update } = useSettings();
  const [sheet, setSheet] = useState<Sheet>(null);
  const { measures } = useMeasures();
  const profiles = liveProfiles(settings.healthProfiles);
  const current = profiles.find((profile) => profile.id === selected) ?? null;

  const save = (id: string | null, draft: Parameters<typeof saveProfile>[2]) => {
    haptics.success();
    const at = clock();
    const next = saveProfile(settings.healthProfiles, id, draft, at, createId);
    update({ healthProfiles: next });
    setSheet(null);
    toast(t(id ? "health.profiles.updated" : "health.profiles.added", { name: draft.name.trim() }));
    // A new relative: their screen, ready for a first appointment or card.
    if (!id) onSelect(next.find((item) => item.createdAt === at && !item.deletedAt)?.id ?? ME);
  };

  const remove = async (profile: HealthProfile) => {
    haptics.press();
    const at = clock();
    update({ healthProfiles: removeProfile(settings.healthProfiles, profile.id, at), appointments: reassignAppointments(settings.appointments, profile.id, at) });
    // Their prescriptions and treatments come back to "Moi" too (synced with the scans).
    for (const entry of entries.filter((item) => item.profileId === profile.id)) await historyStore.update(entry.id, { profileId: undefined }).catch(() => undefined);
    await measureStore.reassign(profile.id).catch(() => undefined);
    await healthSpendStore.reassign(profile.id).catch(() => undefined);
    setSheet(null);
    onSelect(ME);
    toast(t("health.profiles.removed", { name: profile.name }));
  };

  // "1 an", "2 ans"; nothing under a year (the "…One" form, like the other counted texts).
  const ageText = (age: number | null) => (!age || age < 1 ? null : age === 1 ? t("health.profiles.ageOne") : t("health.profiles.age", { count: age }));

  if (!ready) return null;

  return (
    <div className={styles.bar} data-testid="health-profiles">
      <div className={styles.chips} role="group" aria-label={t("health.profiles.forWho")}>
        <button type="button" className={styles.chip} aria-pressed={selected === ME} onClick={() => onSelect(ME)} data-testid="health-profile" data-profile={ME}>
          {t("health.profiles.me")}
        </button>
        {profiles.map((profile) => (
          <button key={profile.id} type="button" className={styles.chip} aria-pressed={selected === profile.id} onClick={() => onSelect(profile.id)} data-testid="health-profile" data-profile={profile.id} title={profile.name}>
            <span className={styles.label}>{profile.name}</span>
          </button>
        ))}
        <button type="button" className={`${styles.chip} ${styles.add}`} onClick={() => setSheet({ kind: "edit", profile: null })} data-testid="health-profile-add">
          <UserPlus size={16} aria-hidden />
          {t("health.profiles.add")}
        </button>
      </div>

      {current && (
        <div className={styles.current} data-testid="health-profile-current">
          <p>
            <strong>{current.name}</strong>
            <span>{[t(`health.profiles.relations.${current.relation}`), ageText(ageOf(current, now))].filter(Boolean).join(" · ")}</span>
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" icon={<Pencil />} onClick={() => setSheet({ kind: "edit", profile: current })} data-testid="health-profile-edit">
              {t("health.profiles.edit")}
            </Button>
            <Button variant="ghost" icon={<Trash2 />} onClick={() => setSheet({ kind: "remove", profile: current })} data-testid="health-profile-remove">
              {t("health.profiles.remove")}
            </Button>
          </div>
        </div>
      )}

      <ExpenseSheet
        open={sheet !== null}
        title={!sheet ? "" : sheet.kind === "remove" ? t("health.profiles.removeTitle", { name: sheet.profile.name }) : sheet.profile ? t("health.profiles.editTitle", { name: sheet.profile.name }) : t("health.profiles.add")}
        onClose={() => setSheet(null)}
      >
        {sheet?.kind === "edit" && <ProfileForm profile={sheet.profile} onSave={(draft) => save(sheet.profile?.id ?? null, draft)} onCancel={() => setSheet(null)} />}
        {sheet?.kind === "remove" && (
          <RemoveProfile
            profile={sheet.profile}
            appointments={liveAppointments(settings.appointments).filter((item) => item.profileId === sheet.profile.id).length}
            scans={entries.filter((item) => item.profileId === sheet.profile.id).length}
            measures={measures.filter((item) => item.profileId === sheet.profile.id).length}
            onConfirm={() => void remove(sheet.profile)}
            onCancel={() => setSheet(null)}
          />
        )}
      </ExpenseSheet>
    </div>
  );
}

function ProfileForm({ profile, onSave, onCancel }: { profile: HealthProfile | null; onSave: (draft: Parameters<typeof saveProfile>[2]) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(profile?.name ?? "");
  const [relation, setRelation] = useState<Relation>(profile?.relation ?? "child");
  const [year, setYear] = useState(profile?.birthYear ? String(profile.birthYear) : "");
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setMissing(true);
      return;
    }
    onSave({ name, relation, birthYear: year ? Number(year) : undefined });
  };

  return (
    <form className={`${sheetStyles.form} ${formStyles.form}`} onSubmit={submit} noValidate data-testid="health-profile-form">
      <label>
        {t("health.profiles.name")}
        <input value={name} maxLength={PROFILE_NAME_MAX} autoComplete="off" onChange={(event) => setName(event.target.value)} aria-invalid={(missing && !name.trim()) || undefined} data-testid="health-profile-name" />
      </label>
      {missing && (
        <p className={styles.error} role="alert">
          {t("health.profiles.nameMissing")}
        </p>
      )}
      <label>
        {t("health.profiles.relation")}
        <select value={relation} onChange={(event) => setRelation(event.target.value as Relation)} data-testid="health-profile-relation">
          {relations.map((item) => (
            <option key={item} value={item}>
              {t(`health.profiles.relations.${item}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("health.profiles.birthYear")}
        <input inputMode="numeric" value={year} placeholder={t("health.profiles.birthYearHint")} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} data-testid="health-profile-year" />
      </label>
      <div className={sheetStyles.row}>
        <Button type="submit" data-testid="health-profile-save">
          {t("health.profiles.save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("health.profiles.cancel")}
        </Button>
      </div>
    </form>
  );
}

function RemoveProfile({
  profile,
  appointments,
  scans,
  measures,
  onConfirm,
  onCancel,
}: {
  profile: HealthProfile;
  appointments: number;
  scans: number;
  measures: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.remove} data-testid="health-profile-remove-window">
      <ul>
        {appointments > 0 && <li>{t(appointments === 1 ? "health.profiles.backAppointmentsOne" : "health.profiles.backAppointments", { count: appointments })}</li>}
        {scans > 0 && <li>{t(scans === 1 ? "health.profiles.backScansOne" : "health.profiles.backScans", { count: scans })}</li>}
        {measures > 0 && <li>{t(measures === 1 ? "health.profiles.backMeasuresOne" : "health.profiles.backMeasures", { count: measures })}</li>}
        {profile.card && <li>{t("health.profiles.cardGoes", { name: profile.name })}</li>}
        {appointments === 0 && scans === 0 && measures === 0 && !profile.card && <li>{t("health.profiles.nothingElse")}</li>}
      </ul>
      <div className={styles.actions}>
        <Button variant="danger" icon={<Trash2 />} block onClick={onConfirm} data-testid="health-profile-remove-confirm">
          {t("health.profiles.removeConfirm")}
        </Button>
        <Button variant="secondary" block onClick={onCancel}>
          {t("health.profiles.cancel")}
        </Button>
      </div>
    </div>
  );
}
