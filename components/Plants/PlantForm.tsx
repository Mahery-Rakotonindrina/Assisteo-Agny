import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { toDateInput } from "@/lib/format";
import { cleanWaterDays, DEFAULT_WATER_DAYS, MAX_WATER_DAYS, plantPlaces, type Plant, type PlantPlace } from "@/lib/plants";
import { haptics } from "@/services/device";
import { requestNotificationPermission } from "@/services/notifications";
import { plantStore, type PlantFields } from "@/services/plantStore";
import styles from "./Plants.module.scss";

const timestamp = () => Date.now();

/** "YYYY-MM-DD" of a date input: midday that day (now when it is today); undefined when empty. */
function dayToTime(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const now = timestamp();
  if (day === toDateInput(now)) return now;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12).getTime();
}

/** Adds a plant (no `plant`) or edits one. */
export function PlantForm({ plant, onDone }: { plant?: Plant; onDone: (id?: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(plant?.name ?? "");
  const [place, setPlace] = useState<PlantPlace>(plant?.place ?? "indoor");
  const [every, setEvery] = useState(String(plant?.waterEveryDays ?? DEFAULT_WATER_DAYS));
  const [lastDay, setLastDay] = useState(plant?.lastWateredAt ? toDateInput(plant.lastWateredAt) : "");
  const [notes, setNotes] = useState(plant?.notes ?? "");
  const today = toDateInput(timestamp());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    haptics.success();
    const fields: PlantFields = { name, place, waterEveryDays: cleanWaterDays(Number(every)), lastWateredAt: dayToTime(lastDay), notes };
    // The morning reminder needs the notifications: asked here, where the user expects it.
    await requestNotificationPermission().catch(() => undefined);
    if (plant) {
      await plantStore.edit(plant.id, fields);
      onDone(plant.id);
    } else {
      const created = await plantStore.create(fields, t("plants.defaultName"));
      onDone(created.id);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <h2 className={styles.formTitle}>{plant ? t("plants.editTitle") : t("plants.addTitle")}</h2>
      <div className={styles.fields}>
        <label className={styles.wide}>
          {t("plants.fields.name")}
          <input value={name} onChange={(event) => setName(event.target.value.slice(0, 60))} placeholder={t("plants.fields.namePlaceholder")} required />
        </label>
        <label>
          {t("plants.fields.place")}
          <select value={place} onChange={(event) => setPlace(event.target.value as PlantPlace)}>
            {plantPlaces.map((value) => (
              <option key={value} value={value}>
                {t(`plants.places.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("plants.fields.every")}
          <input type="number" inputMode="numeric" min={1} max={MAX_WATER_DAYS} value={every} onChange={(event) => setEvery(event.target.value)} required />
        </label>
        <label>
          {t("plants.fields.lastWatered")}
          <input type="date" value={lastDay} max={today} onChange={(event) => setLastDay(event.target.value)} />
        </label>
        <label className={styles.wide}>
          {t("plants.fields.notes")}
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value.slice(0, 500))} placeholder={t("plants.fields.notesPlaceholder")} />
        </label>
      </div>
      <small className={styles.hint}>{t("plants.fields.everyHint")}</small>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />}>
          {plant ? t("plants.save") : t("plants.add")}
        </Button>
        <Button variant="ghost" onClick={() => onDone(plant?.id)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
