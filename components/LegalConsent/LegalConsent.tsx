import Link from "next/link";
import { useTranslation } from "@/hooks/useTranslation";
import styles from "./LegalConsent.module.scss";

/** "By continuing, you accept the terms and the privacy policy", with both links. */
export function LegalConsent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <p className={styles.consent}>
      {t("legal.consent")
        .split(/(\{terms\}|\{privacy\})/)
        .map((part, index) =>
          part === "{terms}" || part === "{privacy}" ? (
            <Link key={index} href={part === "{terms}" ? "/terms" : "/privacy"} onClick={onNavigate}>
              {t(part === "{terms}" ? "legal.terms" : "legal.privacy")}
            </Link>
          ) : (
            part
          ),
        )}
    </p>
  );
}
