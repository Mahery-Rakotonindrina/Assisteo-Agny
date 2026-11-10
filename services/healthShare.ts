import type { Locale } from "@/i18n.config";
import { formatDate } from "@/lib/format";
import { treatmentLines, treatmentsText, type Treatment } from "@/lib/health";
import { pdfFileName, PdfWriter } from "@/lib/pdf";
import type { HistoryEntry } from "@/types/history";
import { shareText } from "./device";
import { shareFile } from "./fileShare";

// "Partager mes traitements" (Ma santé): the treatments in progress, as a
// message (WhatsApp, the share sheet, else copied) or as a PDF, always with
// the medical warning.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function shareTreatments(treatments: Array<Treatment<HistoryEntry>>, t: Translate, locale: Locale) {
  return shareText(t("health.share.heading"), treatmentsText(treatments, t, (at) => formatDate(at, locale)), { copyTitle: false });
}

export async function exportTreatmentsPdf(treatments: Array<Treatment<HistoryEntry>>, t: Translate, locale: Locale) {
  const pdf = await PdfWriter.create();
  pdf.title(t("health.share.heading"));
  pdf.caption(t("health.share.caption", { date: formatDate(Date.now(), locale) }));
  pdf.paragraph(t("medicine.disclaimer"));
  for (const treatment of treatments) {
    const { title, lines } = treatmentLines(treatment, t, (at) => formatDate(at, locale));
    pdf.rule();
    pdf.subtitle(title);
    pdf.bullets(lines);
  }
  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(t("health.share.heading")), bytes, "application/pdf", t("health.share.heading"));
}
