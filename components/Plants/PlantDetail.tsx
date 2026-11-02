import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Camera, Droplets, Image as ImageIcon, Pencil, Sprout, Stethoscope, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLock } from "@/components/PlanLock";
import { useToast } from "@/components/Toast";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { daysUntilWater, wateredToday, type Plant, type PlantCheck } from "@/lib/plants";
import { CaptureCancelledError, capturePhoto, type PhotoSource } from "@/services/camera";
import { haptics } from "@/services/device";
import { planStore } from "@/services/plan";
import { plantStore } from "@/services/plantStore";
import { ApiError } from "@/types/api";
import { PlantForm } from "./PlantForm";
import styles from "./Plants.module.scss";

/** One plant: its watering, "Watered today", what it has had, and "My plant has a problem". */
export function PlantDetail({ plant, onBack, readOnly }: { plant: Plant; onBack: () => void; readOnly: boolean }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const { planFor } = usePlan();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [checking, setChecking] = useState(false);
  const [demo, setDemo] = useState(false);

  if (editing) return <PlantForm plant={plant} onDone={() => setEditing(false)} />;

  const days = daysUntilWater(plant, now);
  const done = wateredToday(plant, now);
  const next = done
    ? t("plants.wateredToday")
    : days < 0
      ? t("plants.late", { count: -days })
      : days === 0
        ? t("plants.today")
        : t("plants.inDays", { count: days });

  const water = async () => {
    haptics.success();
    await plantStore.water(plant.id);
    toast(t("plants.watered", { name: plant.name }));
  };

  const check = async (source: PhotoSource) => {
    if (checking) return;
    let src: string;
    try {
      src = await capturePhoto(source);
    } catch (captureError) {
      if (!(captureError instanceof CaptureCancelledError)) toast(t("plants.check.errors.failed"), "error");
      return;
    }
    setChecking(true);
    try {
      const { checkPlant } = await import("@/services/plantDiagnosis");
      const { diagnosis, demo: sample, thumbnail } = await checkPlant(src, plant, locale);
      if (!diagnosis.isPlant) {
        toast(t("plants.check.notPlant"), "error");
        return;
      }
      await plantStore.addCheck(plant.id, diagnosis, thumbnail);
      setDemo(sample);
      void planStore.refresh();
      haptics.success();
    } catch (checkError) {
      haptics.error();
      const code = checkError instanceof ApiError ? checkError.code : "unknown";
      const key = code === "plan_limit" ? "limit" : code === "sign_in_required" ? "signIn" : code === "network" ? "offline" : code === "plan_required" ? "plan" : "failed";
      toast(t(`plants.check.errors.${key}`), "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={styles.detail}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ArrowLeft size={16} /> {t("plants.title")}
      </button>
      <div className={styles.detailHead}>
        <span className={styles.thumb} data-large>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          {plant.thumbnail ? <img src={plant.thumbnail} alt="" /> : <Sprout size={26} />}
        </span>
        <span className={styles.text}>
          <h2>{plant.name}</h2>
          <small>{[plant.species && plant.species !== plant.name ? plant.species : null, t(`plants.places.${plant.place}`)].filter(Boolean).join(" · ")}</small>
        </span>
      </div>

      <section className={styles.card}>
        <h3 className={styles.subTitle}>{t("plants.watering")}</h3>
        <p className={styles.next} data-due={(!done && days <= 0) || undefined}>
          <Droplets size={18} /> {next}
        </p>
        <small className={styles.hint}>
          {t("plants.every", { count: plant.waterEveryDays })}
          {plant.lastWateredAt ? ` · ${t("plants.lastWatered", { date: formatDate(plant.lastWateredAt, locale) })}` : ""}
        </small>
        {!readOnly && (
          <Button icon={<Droplets />} onClick={() => void water()} disabled={done}>
            {done ? t("plants.wateredToday") : t("plants.water")}
          </Button>
        )}
      </section>

      {plant.notes && <p className={styles.notes}>{plant.notes}</p>}

      <section className={styles.card}>
        <h3 className={styles.subTitle}>{t("plants.check.title")}</h3>
        {readOnly ? (
          <PlanLock plan={planFor("plants")} text={t("plants.locked", { plan: t(`plans.names.${planFor("plants") ?? "lite"}`) })} />
        ) : (
          <>
            <small className={styles.hint}>{t("plants.check.hint")}</small>
            <div className={styles.row}>
              <Button icon={<Camera />} onClick={() => void check("camera")} disabled={checking}>
                {checking ? t("plants.check.reading") : t("plants.check.camera")}
              </Button>
              <Button variant="secondary" icon={<ImageIcon />} onClick={() => void check("gallery")} disabled={checking}>
                {t("plants.check.gallery")}
              </Button>
            </div>
            {demo && <small className={styles.hint}>{t("plants.check.demo")}</small>}
          </>
        )}
        {plant.checks.length > 0 && (
          <ul className={styles.checks}>
            {plant.checks.map((item) => (
              <CheckItem key={item.id} item={item} onRemove={readOnly ? undefined : () => void plantStore.removeCheck(plant.id, item.id)} />
            ))}
          </ul>
        )}
      </section>

      {plant.scanIds.length > 0 && (
        <Link href={{ pathname: "/result", query: { id: plant.scanIds[0] } }} className={styles.link}>
          {t("plants.openScan")}
        </Link>
      )}

      {!readOnly && (
        <div className={styles.row}>
          <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
            {t("plants.edit")}
          </Button>
          {confirmRemove ? (
            <>
              <Button
                variant="danger"
                icon={<Trash2 />}
                onClick={() => {
                  haptics.tap();
                  void plantStore.remove(plant.id).then(onBack);
                }}
              >
                {t("plants.removeConfirm")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmRemove(true)}>
              {t("plants.remove")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CheckItem({ item, onRemove }: { item: PlantCheck; onRemove?: () => void }) {
  const { t, locale } = useTranslation();
  return (
    <li className={styles.check}>
      <div className={styles.checkHead}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
        {item.thumbnail && <img src={item.thumbnail} alt="" />}
        <span className={styles.text}>
          <strong>
            <Stethoscope size={15} /> {item.problem}
          </strong>
          <small>{formatDate(item.at, locale)}</small>
        </span>
        <span className={styles.urgency} data-urgency={item.healthy ? "none" : item.urgency}>
          {item.healthy ? t("plants.check.healthy") : t(`plants.check.urgency.${item.urgency}`)}
        </span>
      </div>
      <p>{item.cause}</p>
      {item.treatment.length > 0 && (
        <ol>
          {item.treatment.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {item.note && <small className={styles.hint}>{item.note}</small>}
      {onRemove && (
        <button type="button" className={styles.removeCheck} onClick={onRemove} aria-label={t("plants.check.remove")}>
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
