import { useTranslation } from "@/hooks/useTranslation";
import { liveProfiles, ME } from "@/lib/healthProfiles";
import { useSettings } from "@/lib/settings/SettingsProvider";
import styles from "./HealthProfiles.module.scss";

/**
 * "Pour qui ?" in a form (an appointment, dose reminders): "Moi" or a
 * relative. Nothing to ask without relatives: then it is not shown.
 */
export function WhoField({ value, onChange }: { value: string; onChange: (profileId: string) => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const profiles = liveProfiles(settings.healthProfiles);
  if (profiles.length === 0) return null;
  return (
    <label className={styles.who}>
      <span>{t("health.profiles.forWho")}</span>
      <select value={profiles.some((item) => item.id === value) ? value : ME} onChange={(event) => onChange(event.target.value)} data-testid="health-who">
        <option value={ME}>{t("health.profiles.me")}</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </label>
  );
}
