import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/Button";
import { useTranslation } from "@/hooks/useTranslation";
import { vehicleEnergies, type VehicleEnergy } from "@/lib/ai/schema";
import { NOTICE_DAY_CHOICES, vehicleKinds, type Vehicle, type VehicleKind } from "@/lib/garage";
import { parseNumber } from "@/lib/money";
import { haptics } from "@/services/device";
import { requestNotificationPermission } from "@/services/notifications";
import { vehicleStore, type VehicleFields } from "@/services/vehicleStore";
import styles from "./Garage.module.scss";

/** A number typed in a field ("45 000", "6,5"); undefined when empty. */
export const parseField = (value: string) => parseNumber(value) ?? undefined;

const text = (value: number | undefined) => (value === undefined ? "" : String(value));

/** Adds a vehicle (no `vehicle`) or edits one. */
export function VehicleForm({ vehicle, onDone }: { vehicle?: Vehicle; onDone: (id?: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(vehicle?.name ?? "");
  const [kind, setKind] = useState<VehicleKind>(vehicle?.kind ?? "car");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [year, setYear] = useState(text(vehicle?.year));
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [energy, setEnergy] = useState<VehicleEnergy | "">(vehicle?.energy ?? "");
  const [km, setKm] = useState("");
  const [insuranceUntil, setInsuranceUntil] = useState(vehicle?.insuranceUntil ?? "");
  const [inspectionUntil, setInspectionUntil] = useState(vehicle?.inspectionUntil ?? "");
  const [noticeDays, setNoticeDays] = useState(vehicle?.noticeDays ?? 5);
  const [oilKm, setOilKm] = useState(text(vehicle?.oilIntervalKm));
  const [oilMonths, setOilMonths] = useState(text(vehicle?.oilIntervalMonths));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    haptics.success();
    const fields: VehicleFields = {
      name,
      kind,
      make,
      model,
      year: parseField(year),
      plate,
      energy: energy || undefined,
      insuranceUntil,
      inspectionUntil,
      noticeDays,
      oilIntervalKm: parseField(oilKm),
      oilIntervalMonths: parseField(oilMonths),
    };
    // Dated reminders need the notifications: asked here, where the user expects them.
    if (insuranceUntil || inspectionUntil || fields.oilIntervalKm || fields.oilIntervalMonths) await requestNotificationPermission().catch(() => undefined);
    if (vehicle) {
      await vehicleStore.edit(vehicle.id, fields);
      const reading = parseField(km);
      if (reading !== undefined) await vehicleStore.addReading(vehicle.id, reading);
      onDone(vehicle.id);
    } else {
      const created = await vehicleStore.create({ ...fields, km: parseField(km) }, t("garage.defaultName"));
      onDone(created.id);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("garage.fields.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("garage.fields.namePlaceholder")} maxLength={60} autoFocus={!vehicle} />
        </label>
        <label>
          <span>{t("garage.fields.kind")}</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as VehicleKind)}>
            {vehicleKinds.map((value) => (
              <option key={value} value={value}>
                {t(`garage.kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("garage.fields.energy")}</span>
          <select value={energy} onChange={(event) => setEnergy(event.target.value as VehicleEnergy | "")}>
            <option value="">—</option>
            {vehicleEnergies.map((value) => (
              <option key={value} value={value}>
                {t(`garage.energies.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("garage.fields.make")}</span>
          <input value={make} onChange={(event) => setMake(event.target.value)} maxLength={60} />
        </label>
        <label>
          <span>{t("garage.fields.model")}</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} maxLength={60} />
        </label>
        <label>
          <span>{t("garage.fields.year")}</span>
          <input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" maxLength={4} />
        </label>
        <label>
          <span>{t("garage.fields.plate")}</span>
          <input value={plate} onChange={(event) => setPlate(event.target.value)} maxLength={20} />
        </label>
        <label>
          <span>{vehicle ? t("garage.fields.kmNow") : t("garage.fields.km")}</span>
          <input value={km} onChange={(event) => setKm(event.target.value)} inputMode="numeric" placeholder={t("garage.fields.kmPlaceholder")} />
        </label>
        <label>
          <span>{t("garage.fields.insuranceUntil")}</span>
          <input type="date" value={insuranceUntil} onChange={(event) => setInsuranceUntil(event.target.value)} />
        </label>
        <label>
          <span>{t("garage.fields.inspectionUntil")}</span>
          <input type="date" value={inspectionUntil} onChange={(event) => setInspectionUntil(event.target.value)} />
        </label>
        <label>
          <span>{t("garage.fields.noticeDays")}</span>
          <select value={noticeDays} onChange={(event) => setNoticeDays(Number(event.target.value))}>
            {NOTICE_DAY_CHOICES.map((days) => (
              <option key={days} value={days}>
                {t("garage.fields.noticeDaysValue", { count: days })}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("garage.fields.oilKm")}</span>
          <input value={oilKm} onChange={(event) => setOilKm(event.target.value)} inputMode="numeric" placeholder="10 000" />
        </label>
        <label>
          <span>{t("garage.fields.oilMonths")}</span>
          <input value={oilMonths} onChange={(event) => setOilMonths(event.target.value)} inputMode="numeric" placeholder="12" />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />}>
          {vehicle ? t("garage.save") : t("garage.create")}
        </Button>
        <Button variant="ghost" onClick={() => onDone(vehicle?.id)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
