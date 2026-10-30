import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useState } from "react";
import { ChevronRight, Droplets, Plus, ScanLine, Sprout } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PlanLock } from "@/components/PlanLock";
import { PlantDetail, PlantForm } from "@/components/Plants";
import styles from "@/components/Plants/Plants.module.scss";
import { Seo } from "@/components/Seo";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { usePlants } from "@/hooks/usePlants";
import { useTranslation } from "@/hooks/useTranslation";
import { rise, stagger } from "@/lib/motion";
import { daysUntilWater, needsWater, sortPlants, wateredToday } from "@/lib/plants";
import { haptics } from "@/services/device";
import { plantStore } from "@/services/plantStore";

/**
 * "Mes plantes": the user's plants, when to water them, and what to do when
 * one has a problem (Lite and up). Without the plan, plants already there
 * stay visible, read only (their reminder is paused).
 */
export default function PlantsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { plan, has, planFor } = usePlan();
  // Until the plan is read (cache or server), neither the lock nor the read-only banner: a subscriber would see them flash.
  const known = plan !== null;
  const now = useNow(60_000);
  const { plants, isLoading } = usePlants();
  const [creating, setCreating] = useState(false);
  const openId = typeof router.query.open === "string" ? router.query.open : null;
  const opened = plants.find((plant) => plant.id === openId);
  const readOnly = !has("plants");
  const sorted = sortPlants(plants, now);
  const toWater = sorted.filter((plant) => needsWater(plant, now));
  const later = sorted.filter((plant) => !needsWater(plant, now));
  const planName = t(`plans.names.${planFor("plants") ?? "lite"}`);

  const open = (id: string | null) =>
    void router.replace({ pathname: router.pathname, query: id ? { open: id } : {} }, undefined, { shallow: true, scroll: true });

  const row = (plant: (typeof plants)[number]) => {
    const days = daysUntilWater(plant, now);
    const done = wateredToday(plant, now);
    const due = !done && days <= 0;
    return (
      <li key={plant.id} className={styles.item}>
        <button type="button" className={styles.plant} onClick={() => open(plant.id)}>
          <span className={styles.thumb}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
            {plant.thumbnail ? <img src={plant.thumbnail} alt="" /> : <Sprout size={22} />}
          </span>
          <span className={styles.text}>
            <strong>{plant.name}</strong>
            <small>
              {done ? t("plants.wateredToday") : days < 0 ? t("plants.late", { count: -days }) : days === 0 ? t("plants.today") : t("plants.inDays", { count: days })}
            </small>
          </span>
          <ChevronRight size={18} className={styles.chevron} />
        </button>
        {due && !readOnly && (
          <Button
            variant="secondary"
            icon={<Droplets />}
            aria-label={t("plants.waterName", { name: plant.name })}
            onClick={() => {
              haptics.success();
              void plantStore.water(plant.id);
            }}
          >
            {t("plants.waterShort")}
          </Button>
        )}
      </li>
    );
  };

  return (
    <>
      <Seo title={`${t("plants.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("plants.title")}</h1>
          <p>{t("plants.subtitle")}</p>
        </motion.header>

        {known && readOnly && plants.length > 0 && (
          <motion.div variants={rise}>
            <PlanLock plan={planFor("plants")} text={t("plants.readOnly", { plan: planName })} />
          </motion.div>
        )}

        {!known || (readOnly && isLoading) ? null : readOnly && plants.length === 0 ? (
          <motion.div variants={rise} className={styles.locked}>
            <PlanLock plan={planFor("plants")} text={t("plants.locked", { plan: planName })} />
            <ul>
              {(["watering", "reminder", "check"] as const).map((key) => (
                <li key={key}>{t(`plants.pitch.${key}`)}</li>
              ))}
            </ul>
          </motion.div>
        ) : opened ? (
          <motion.div variants={rise}>
            <PlantDetail key={opened.id} plant={opened} onBack={() => open(null)} readOnly={readOnly} />
          </motion.div>
        ) : creating ? (
          <motion.div variants={rise}>
            <PlantForm
              onDone={(id) => {
                setCreating(false);
                if (id) open(id);
              }}
            />
          </motion.div>
        ) : !isLoading && plants.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("plants.emptyTitle")}
              body={t("plants.emptyBody")}
              action={
                <div className={styles.emptyActions}>
                  <Button href="/?mode=object" icon={<ScanLine />}>
                    {t("plants.scan")}
                  </Button>
                  <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
                    {t("plants.add")}
                  </Button>
                </div>
              }
            />
          </motion.div>
        ) : (
          <>
            {toWater.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                <h2 className={styles.subTitle}>{t("plants.toWaterToday")}</h2>
                <ul className={styles.plants}>{toWater.map(row)}</ul>
              </motion.section>
            )}
            {later.length > 0 && (
              <motion.section variants={rise} className={styles.group}>
                {toWater.length > 0 && <h2 className={styles.subTitle}>{t("plants.later")}</h2>}
                <ul className={styles.plants}>{later.map(row)}</ul>
              </motion.section>
            )}
            {!readOnly && (
              <motion.div variants={rise} className={styles.row}>
                <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
                  {t("plants.add")}
                </Button>
                <Button variant="ghost" href="/?mode=object" icon={<ScanLine />}>
                  {t("plants.scan")}
                </Button>
              </motion.div>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}
