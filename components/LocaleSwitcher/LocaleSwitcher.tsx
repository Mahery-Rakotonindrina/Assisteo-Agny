import { SegmentedControl } from "@/components/SegmentedControl";
import { locales, type Locale } from "@/i18n.config";
import { useSettings } from "@/lib/settings/SettingsProvider";

const labels: Record<Locale, string> = { fr: "Français", en: "English" };

type LocaleSwitcherProps = {
  className?: string;
};

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { settings, update } = useSettings();

  return (
    <SegmentedControl
      className={className}
      ariaLabel="Language"
      value={settings.locale}
      onChange={(locale) => update({ locale })}
      options={locales.map((locale) => ({ value: locale, label: labels[locale] }))}
    />
  );
}
