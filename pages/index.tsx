import Head from "next/head";
import Image from "next/image";
import { Button } from "@/components/Button";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Translator } from "@/components/Translator";
import { useTranslation } from "@/hooks/useTranslation";
import styles from "@/styles/Home.module.scss";

export default function Home() {
  // <title> and meta content only accept plain strings, not JSX, so they use t() directly.
  const { t } = useTranslation();

  return (
    <>
      <Head>
        <title>{t("meta.title")}</title>
        <meta name="description" content={t("meta.description")} />
      </Head>
      <div className={styles.page}>
        <LocaleSwitcher className={styles.localeSwitcher} />
        <main className={styles.main}>
          <Image
            className={styles.logo}
            src="/next.svg"
            alt="Next.js logo"
            width={100}
            height={20}
            priority
          />
          <div className={styles.hero}>
            <h1 className={styles.title}>
              <Translator i18nKey="home.titleBeforeCode" />
              <Translator i18nKey="home.titleCode" className={styles.code} />
              <Translator i18nKey="home.titleAfterCode" />
            </h1>
            <p className={styles.description}>
              <Translator i18nKey="home.descriptionBeforeTemplates" />
              <a
                href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
                className={styles.link}
              >
                <Translator i18nKey="home.templatesLink" />
              </a>
              <Translator i18nKey="home.descriptionBetween" />
              <a
                href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
                className={styles.link}
              >
                <Translator i18nKey="home.learningLink" />
              </a>
              <Translator i18nKey="home.descriptionAfterLearning" />
            </p>
          </div>
          <div className={styles.ctas}>
            <Button
              variant="primary"
              href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image
                className={styles.ctaIcon}
                src="/vercel.svg"
                alt="Vercel logomark"
                width={16}
                height={14}
              />
              <Translator i18nKey="home.deployButton" />
            </Button>
            <Button
              variant="secondary"
              href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Translator i18nKey="home.docsButton" />
            </Button>
          </div>
        </main>
      </div>
    </>
  );
}
