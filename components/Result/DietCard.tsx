import Link from "next/link";
import { Check, CircleHelp, Info, TriangleAlert, X } from "lucide-react";
import type { Analysis } from "@/lib/ai/schema";
import { useTranslation } from "@/hooks/useTranslation";
import { useSettings } from "@/lib/settings/SettingsProvider";
import styles from "./Food.module.scss";

type Diet = NonNullable<Analysis["diet"]>;

const fitIcons = { yes: Check, no: X, unsure: CircleHelp } as const;

/** Allergens and diets of a food, the user's own ones highlighted. */
export function DietCard({ diet }: { diet: Diet }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  // The model may repeat a diet: keep its first answer.
  const diets = diet.diets.filter((item, index) => diet.diets.findIndex((other) => other.diet === item.diet) === index);
  const hasProfile = settings.allergies.length > 0 || settings.diets.length > 0;

  return (
    <div className={styles.diet}>
      <div>
        <h4 className={styles.dietTitle}>{t("food.allergensTitle")}</h4>
        {diet.allergens.length === 0 ? (
          <p className={styles.muted}>{t("food.noAllergen")}</p>
        ) : (
          <ul className={styles.chips}>
            {diet.allergens.map((allergen) => (
              <li key={allergen} data-mine={settings.allergies.includes(allergen) || undefined}>
                {settings.allergies.includes(allergen) && <TriangleAlert size={13} />}
                {t(`food.allergens.${allergen}`)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className={styles.dietTitle}>{t("food.dietsTitle")}</h4>
        <ul className={styles.diets}>
          {diets.map(({ diet: value, fits }) => {
            const Icon = fitIcons[fits];
            return (
              <li key={value} data-fits={fits} data-mine={settings.diets.includes(value) || undefined}>
                <Icon size={14} strokeWidth={2.6} />
                <span>{t(`food.diets.${value}`)}</span>
                <small>{t(`food.fits.${fits}`)}</small>
              </li>
            );
          })}
        </ul>
      </div>

      {diet.note && (
        <p className={styles.note}>
          <Info size={15} />
          <span>{diet.note}</span>
        </p>
      )}
      <p className={styles.estimate}>
        {t("food.estimate")} <Link href="/settings?section=food">{hasProfile ? t("food.editProfile") : t("food.setProfile")}</Link>
      </p>
    </div>
  );
}
