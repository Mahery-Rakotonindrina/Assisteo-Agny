import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "motion/react";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { useTranslation } from "@/hooks/useTranslation";
import { config } from "@/lib/config";
import { LEGAL_UPDATED_AT, legalDocuments, type LegalKind } from "@/lib/legal";
import { rise, stagger } from "@/lib/motion";
import styles from "./LegalPage.module.scss";

/** Privacy policy or terms of use, in the app's language. Public URL for the stores. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const doc = legalDocuments[kind][locale];
  const other: LegalKind = kind === "privacy" ? "terms" : "privacy";
  const updated = new Date(`${LEGAL_UPDATED_AT}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  const back = () => {
    if (window.history.length > 1) router.back();
    else void router.push("/settings");
  };

  return (
    <>
      <Head>
        <title>{`${doc.title} · Assisteo Agny`}</title>
      </Head>
      <motion.article className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <div className={styles.topRow}>
            <Button variant="secondary" size="icon" onClick={back} aria-label={t("nav.back")}>
              <ArrowLeft />
            </Button>
            <Logo size={28} />
          </div>
          <h1>{doc.title}</h1>
          <p className={styles.updated}>{t("legal.updated", { date: updated })}</p>
          <p className={styles.intro}>{doc.intro}</p>
        </motion.header>

        {doc.sections.map((section) => (
          <motion.section key={section.heading} variants={rise} className={styles.section}>
            <h2>{section.heading}</h2>
            {section.body.map((block, index) =>
              typeof block === "string" ? (
                <p key={index}>{block}</p>
              ) : (
                <ul key={index}>
                  {block.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </motion.section>
        ))}

        {(config.publisher || config.contactEmail) && (
          <motion.section variants={rise} className={styles.section}>
            <h2>{config.publisher ? t("legal.publisherTitle") : t("legal.contactTitle")}</h2>
            {config.publisher && <p>{t("legal.publishedBy", { name: config.publisher })}</p>}
            {config.contactEmail && (
              <a className={styles.contact} href={`mailto:${config.contactEmail}`}>
                <Mail size={16} /> {config.contactEmail}
              </a>
            )}
          </motion.section>
        )}

        <motion.footer variants={rise} className={styles.footer}>
          <Link href={`/${other}`}>{t(`legal.${other}`)}</Link>
        </motion.footer>
      </motion.article>
    </>
  );
}
