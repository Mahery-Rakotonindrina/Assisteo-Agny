import { Pill, TriangleAlert } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import type { Analysis } from "@/lib/ai/schema";
import { hasReadableName, unreadableNote } from "@/lib/medication";
import styles from "./Medicine.module.scss";

type Medicine = NonNullable<Analysis["medicine"]>;

/** Always shown with a prescription or a medicine box: the app never replaces a doctor or a pharmacist. */
export function MedicineDisclaimer() {
  const { t } = useTranslation();
  return (
    <p className={styles.disclaimer} role="note" data-testid="medicine-disclaimer">
      <TriangleAlert size={18} />
      <span>{t("medicine.disclaimer")}</span>
    </p>
  );
}

/**
 * What the prescription or the box says, medicine by medicine: the dosage
 * and duration only as written (never filled in), then usual precautions and
 * general contraindications.
 */
export function MedicineCard({ medicine }: { medicine: Medicine }) {
  const { t } = useTranslation();
  return (
    <div className={styles.card}>
      <MedicineDisclaimer />
      {medicine.unreadable && (
        <p className={styles.unreadable} data-testid="medicine-unreadable">
          {t("medicine.unreadable", { what: unreadableNote(medicine.unreadable) })}
        </p>
      )}
      {medicine.items.length === 0 ? (
        <p className={styles.muted}>{t("medicine.none")}</p>
      ) : (
        <ul className={styles.items}>
          {medicine.items.map((item, index) => (
            <li key={`${item.name}-${index}`} data-testid="medicine-item">
              <h3>
                <Pill size={16} /> {hasReadableName(item.name) ? item.name : t("medicine.nameUnreadable")}
                {item.strength && <small>{item.strength}</small>}
              </h3>
              <dl>
                <div>
                  <dt>{t("medicine.dose")}</dt>
                  <dd data-missing={item.dose ? undefined : ""}>{item.dose ?? t("medicine.notWritten")}</dd>
                </div>
                <div>
                  <dt>{t("medicine.duration")}</dt>
                  <dd data-missing={item.durationDays ? undefined : ""}>{item.durationDays ? t("medicine.days", { count: item.durationDays }) : t("medicine.notWritten")}</dd>
                </div>
              </dl>
              {item.precautions.length > 0 && (
                <>
                  <h4>{t("medicine.precautions")}</h4>
                  <ul>
                    {item.precautions.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
              {item.contraindications.length > 0 && (
                <>
                  <h4>{t("medicine.contraindications")}</h4>
                  <ul>
                    {item.contraindications.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
