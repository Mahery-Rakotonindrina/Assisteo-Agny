import Head from "next/head";
import { useTranslation } from "@/hooks/useTranslation";
import { config } from "@/lib/config";
import { absoluteUrl, jsonLd, OG_IMAGE } from "@/lib/seo";

type SeoProps = {
  title: string;
  /** Shown under the title in search results and share previews. */
  description?: string;
  /** Public path of the page ("/plans"): its canonical address. */
  path?: string;
  /** Screens of the user's own data: kept out of search results. */
  noindex?: boolean;
  /** schema.org data (JSON-LD). */
  structuredData?: object;
};

/** Title, search and share preview tags of a page (Google, WhatsApp, Facebook…). */
export function Seo({ title, description, path = "/", noindex = false, structuredData }: SeoProps) {
  const { locale } = useTranslation();

  if (noindex) {
    return (
      <Head>
        <title>{title}</title>
        <meta name="robots" content="noindex" key="robots" />
      </Head>
    );
  }

  const url = absoluteUrl(config.siteUrl, path);
  const image = absoluteUrl(config.siteUrl, OG_IMAGE.path);
  return (
    <Head>
      <title>{title}</title>
      {description && <meta name="description" content={description} key="description" />}
      {url && <link rel="canonical" href={url} key="canonical" />}
      <meta property="og:type" content="website" key="og:type" />
      <meta property="og:site_name" content="Assisteo Agny" key="og:site_name" />
      <meta property="og:locale" content={locale === "en" ? "en_US" : "fr_FR"} key="og:locale" />
      <meta property="og:title" content={title} key="og:title" />
      {description && <meta property="og:description" content={description} key="og:description" />}
      {url && <meta property="og:url" content={url} key="og:url" />}
      {image && <meta property="og:image" content={image} key="og:image" />}
      {image && <meta property="og:image:width" content={String(OG_IMAGE.width)} key="og:image:width" />}
      {image && <meta property="og:image:height" content={String(OG_IMAGE.height)} key="og:image:height" />}
      <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
      {structuredData && (
        <script
          type="application/ld+json"
          key="structured-data"
          dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }}
        />
      )}
    </Head>
  );
}
