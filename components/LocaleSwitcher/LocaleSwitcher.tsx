import { SegmentedControl } from "@/components/SegmentedControl";
import { usePlan } from "@/hooks/usePlan";
import { locales, type Locale } from "@/i18n.config";
import { localeAllowed } from "@/lib/localeAccess";
import { useSettings } from "@/lib/settings/SettingsProvider";

const labels: Record<Locale, string> = { fr: "Français", en: "English", mg: "Malagasy" };

type LocaleSwitcherProps = {
  className?: string;
};

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { settings, update } = useSettings();
  const { has } = usePlan();
  // Malagasy is a plan feature (Admin → Features): offered only to who has it.
  const offered = locales.filter((locale) => localeAllowed(locale, has));

  return (
    <SegmentedControl
      className={className}
      ariaLabel="Language"
      value={settings.locale}
      onChange={(locale) => update({ locale })}
      options={offered.map((locale) => ({ value: locale, label: labels[locale] }))}
    />
  );
}
