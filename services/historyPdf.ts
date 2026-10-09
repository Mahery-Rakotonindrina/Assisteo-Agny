import type { Locale } from "@/i18n.config";
import { formatDate, formatDateTime } from "@/lib/format";
import { PdfWriter } from "@/lib/pdf";
import type { HistoryEntry } from "@/types/history";
import { shareFile } from "./fileShare";

type Translate = (key: string, params?: Record<string, string | number>) => string;

// Taken when exporting (never during render).
const today = () => Date.now();

/**
 * Several scans in one PDF, oldest first: for each, its photo, what it is,
 * the summary and the key facts. Handed to the share sheet, or downloaded.
 */
export async function exportHistoryPdf(entries: HistoryEntry[], t: Translate, locale: Locale) {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const pdf = await PdfWriter.create();
  pdf.title(t("historyPdf.title"));
  const first = sorted[0]?.createdAt ?? today();
  const last = sorted.at(-1)?.createdAt ?? today();
  pdf.caption(
    t("historyPdf.caption", {
      count: sorted.length,
      from: formatDate(first, locale),
      to: formatDate(last, locale),
      date: formatDate(today(), locale),
    }),
  );

  sorted.forEach((entry, index) => {
    const { analysis } = entry;
    if (index > 0) pdf.rule();
    pdf.subtitle(analysis.title);
    pdf.caption([formatDateTime(entry.createdAt, locale), t(`categories.${analysis.category}`), entry.folder].filter(Boolean).join(" · "));
    const photo = entry.preview || entry.thumbnail;
    if (photo) pdf.image(photo, 70);
    pdf.paragraph(analysis.summary);
    if (analysis.document?.keyPoints.length) pdf.bullets(analysis.document.keyPoints);
    if (analysis.facts.length) pdf.pairs(analysis.facts);
  });

  const bytes = pdf.finish(t("pdf.footer"));
  const name = `assisteo-scans-${new Date(today()).toISOString().slice(0, 10)}.pdf`;
  return shareFile(name, bytes, "application/pdf", t("historyPdf.title"));
}
