import { useTranslation } from "@/hooks/useTranslation";

type TranslatorProps = {
  i18nKey: string;
  params?: Record<string, string | number>;
  className?: string;
};

export function Translator({ i18nKey, params, className }: TranslatorProps) {
  const { t } = useTranslation();

  return <span className={className}>{t(i18nKey, params)}</span>;
}
