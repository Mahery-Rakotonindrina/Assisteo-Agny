import { motion } from "motion/react";
import { Car, Lightbulb, TriangleAlert, Wrench } from "lucide-react";
import type { Analysis } from "@/lib/ai/schema";
import { useTranslation } from "@/hooks/useTranslation";
import { easeOut } from "@/lib/motion";
import styles from "./Vehicle.module.scss";

type Vehicle = NonNullable<Analysis["vehicle"]>;

/** Prices, specs, maintenance schedule and owner/buyer advice for a vehicle. */
export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const { t } = useTranslation();

  return (
    <div className={styles.vehicle}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <Car size={22} />
        </span>
        <div>
          <h3>
            {vehicle.make} {vehicle.model}
          </h3>
          <p>{[vehicle.kind, vehicle.generation].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      {(vehicle.priceNew || vehicle.priceUsed) && (
        <div className={styles.prices}>
          {vehicle.priceNew && (
            <div className={styles.price}>
              <small>{t("result.vehiclePriceNew")}</small>
              <strong>{vehicle.priceNew}</strong>
            </div>
          )}
          {vehicle.priceUsed && (
            <div className={styles.price}>
              <small>{t("result.vehiclePriceUsed")}</small>
              <strong>{vehicle.priceUsed}</strong>
            </div>
          )}
        </div>
      )}
      <p className={styles.estimate}>{t("result.vehiclePriceNote")}</p>

      {vehicle.specs.length > 0 && (
        <div className={styles.block}>
          <h4>{t("result.vehicleSpecs")}</h4>
          <dl className={styles.specs}>
            {vehicle.specs.map((spec) => (
              <div key={spec.label}>
                <dt>{spec.label}</dt>
                <dd>{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {vehicle.maintenance.length > 0 && (
        <div className={styles.block}>
          <h4>
            <Wrench size={15} /> {t("result.vehicleMaintenance")}
          </h4>
          <ul className={styles.maintenance}>
            {vehicle.maintenance.map((item, index) => (
              <motion.li
                key={`${item.task}-${index}`}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, ease: easeOut, delay: Math.min(index, 6) * 0.05 }}
              >
                <span>{item.task}</span>
                <span className={styles.interval}>{item.interval}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {vehicle.tips.length > 0 && (
        <div className={styles.block}>
          <h4>
            <Lightbulb size={15} /> {t("result.vehicleTips")}
          </h4>
          <ul className={styles.bullets}>
            {vehicle.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      {vehicle.watchOuts.length > 0 && (
        <div className={`${styles.block} ${styles.watch}`}>
          <h4>
            <TriangleAlert size={15} /> {t("result.vehicleWatchOuts")}
          </h4>
          <ul className={styles.bullets}>
            {vehicle.watchOuts.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
