import { useRouter } from "next/router";
import { motion } from "motion/react";
import { useState } from "react";
import { BellRing, Car, ChevronRight, FileText, Plus, ScanLine } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { VehicleDetail, VehicleForm } from "@/components/Garage";
import styles from "@/components/Garage/Garage.module.scss";
import { PlanLock } from "@/components/PlanLock";
import { Seo } from "@/components/Seo";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { useVehicles } from "@/hooks/useVehicles";
import { formatNumber } from "@/lib/format";
import { dueReminders, latestReading } from "@/lib/garage";
import { rise, stagger } from "@/lib/motion";

/**
 * "Mon garage": the user's vehicles, service log, reminders, fuel and
 * expenses (Premium and up). Below Premium, vehicles already there stay
 * visible, read only (their reminders are paused).
 */
export default function GaragePage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const { plan, has, planFor } = usePlan();
  // Until the plan is read (cache or server), neither the lock nor the read-only banner: a Premium user would see them flash.
  const known = plan !== null;
  const now = useNow(60_000);
  const { vehicles, isLoading } = useVehicles();
  const [creating, setCreating] = useState(false);
  const openId = typeof router.query.open === "string" ? router.query.open : null;
  const opened = vehicles.find((vehicle) => vehicle.id === openId);
  const readOnly = !has("garage");

  const open = (id: string | null) =>
    void router.replace({ pathname: router.pathname, query: id ? { open: id } : {} }, undefined, { shallow: true, scroll: true });

  const header = (
    <motion.header variants={rise} className={styles.header}>
      <h1>{t("garage.title")}</h1>
      <p>{t("garage.subtitle")}</p>
    </motion.header>
  );

  return (
    <>
      <Seo title={`${t("garage.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        {header}

        {known && readOnly && vehicles.length > 0 && (
          <motion.div variants={rise}>
            <PlanLock plan={planFor("garage")} text={t("garage.readOnly", { plan: t(`plans.names.${planFor("garage") ?? "premium"}`) })} />
          </motion.div>
        )}

        {!known || (readOnly && isLoading) ? null : readOnly && vehicles.length === 0 ? (
          <motion.div variants={rise} className={styles.locked}>
            <PlanLock plan={planFor("garage")} text={t("garage.locked", { plan: t(`plans.names.${planFor("garage") ?? "premium"}`) })} />
            <ul>
              {(["sheet", "reminders", "fuel", "registration"] as const).map((key) => (
                <li key={key}>{t(`garage.pitch.${key}`)}</li>
              ))}
            </ul>
          </motion.div>
        ) : opened ? (
          <motion.div variants={rise}>
            <VehicleDetail key={opened.id} vehicle={opened} onBack={() => open(null)} readOnly={readOnly} />
          </motion.div>
        ) : creating ? (
          <motion.div variants={rise}>
            <VehicleForm
              onDone={(id) => {
                setCreating(false);
                if (id) open(id);
              }}
            />
          </motion.div>
        ) : !isLoading && vehicles.length === 0 ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("garage.emptyTitle")}
              body={t("garage.emptyBody")}
              action={
                <div className={styles.emptyActions}>
                  <Button href="/?mode=vehicle" icon={<ScanLine />}>
                    {t("garage.scanVehicle")}
                  </Button>
                  <Button href="/?mode=document" variant="secondary" icon={<FileText />}>
                    {t("garage.scanRegistration")}
                  </Button>
                  <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
                    {t("garage.add")}
                  </Button>
                </div>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.ul variants={rise} className={styles.vehicles}>
              {vehicles.map((vehicle) => {
                const reading = latestReading(vehicle);
                const due = readOnly ? 0 : dueReminders(vehicle, now).length;
                const subtitle = [[vehicle.make, vehicle.model].filter(Boolean).join(" "), vehicle.plate].filter(Boolean).join(" · ");
                return (
                  <li key={vehicle.id}>
                    <button type="button" className={styles.vehicle} onClick={() => open(vehicle.id)}>
                      <span className={styles.thumb}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                        {vehicle.thumbnail ? <img src={vehicle.thumbnail} alt="" /> : <Car size={22} />}
                      </span>
                      <span className={styles.text}>
                        <strong>{vehicle.name}</strong>
                        {subtitle && <small>{subtitle}</small>}
                        {reading && <small>{formatNumber(reading.km, locale)} km</small>}
                      </span>
                      {due > 0 && (
                        <span className={styles.due}>
                          <BellRing size={14} /> {due}
                        </span>
                      )}
                      <ChevronRight size={18} className={styles.chevron} />
                    </button>
                  </li>
                );
              })}
            </motion.ul>
            {!readOnly && (
            <motion.div variants={rise} className={styles.row}>
              <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
                {t("garage.add")}
              </Button>
              <Button variant="ghost" href="/?mode=document" icon={<FileText />}>
                {t("garage.scanRegistration")}
              </Button>
            </motion.div>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}
