import type { Locale } from "@/i18n.config";
import { formatDateTime } from "@/lib/format";
import { pdfFileName, PdfWriter } from "@/lib/pdf";
import type { HistoryEntry } from "@/types/history";
import { shareFile } from "./fileShare";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * A scanned document as a clean PDF: each page photo on an A4 page, then
 * what the AI found (summary, key points, dates, actions) and the full text
 * when it was read. Handed to the share sheet, or downloaded on a computer.
 */
export async function exportDocumentPdf(entry: HistoryEntry, t: Translate, locale: Locale) {
  const { analysis } = entry;
  const pdf = await PdfWriter.create();
  for (const photo of [entry.preview, ...(entry.pages ?? [])]) if (photo) pdf.fullPageImage(photo);

  pdf.newPage();
  pdf.title(analysis.title);
  pdf.caption(t("pdf.scannedOn", { date: formatDateTime(entry.createdAt, locale) }));
  pdf.heading(t("result.summary"));
  pdf.paragraph(analysis.summary);
  const document = analysis.document;
  if (document?.keyPoints.length) {
    pdf.heading(t("pdf.keyPoints"));
    pdf.bullets(document.keyPoints);
  }
  if (document?.dates.length) {
    pdf.heading(t("pdf.dates"));
    pdf.pairs(document.dates.map((date) => ({ label: date.label, value: date.date })));
  }
  if (document?.actionItems.length) {
    pdf.heading(t("result.actionItems"));
    pdf.bullets(document.actionItems);
  }
  if (analysis.facts.length) {
    pdf.heading(t("result.facts"));
    pdf.pairs(analysis.facts);
  }
  if (entry.transcript?.text) {
    pdf.heading(t("text.title"));
    pdf.paragraph(entry.transcript.text);
  }

  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(analysis.title), bytes, "application/pdf", analysis.title);
}
