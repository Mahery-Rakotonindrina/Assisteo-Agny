import Link from "next/link";
import { useRouter } from "next/router";
import { locales } from "@/i18n.config";
import styles from "./LocaleSwitcher.module.scss";

type LocaleSwitcherProps = {
  className?: string;
};

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { pathname, query, asPath, locale: activeLocale } = useRouter();

  return (
    <nav
      className={[styles.switcher, className].filter(Boolean).join(" ")}
      aria-label="Language switcher"
    >
      {locales.map((locale) => (
        <Link
          key={locale}
          href={{ pathname, query }}
          as={asPath}
          locale={locale}
          className={locale === activeLocale ? styles.active : styles.link}
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}
