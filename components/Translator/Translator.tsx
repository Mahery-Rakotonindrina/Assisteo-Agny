import { useTranslation } from "@/hooks/useTranslation";

type TranslatorProps = {
  i18nKey: string;
  className?: string;
};

export function Translator({ i18nKey, className }: TranslatorProps) {
  const { t } = useTranslation();

  return <span className={className}>{t(i18nKey)}</span>;
}
