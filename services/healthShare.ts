import type { Locale } from "@/i18n.config";
import { cardText, type EmergencyCard } from "@/lib/emergencyCard";
import { formatDate, formatDateTime, formatMeasure } from "@/lib/format";
import { measureReport, measuresText, type Measure, type ShareOptions } from "@/lib/measures";
import { treatmentLines, treatmentsText, type Treatment } from "@/lib/health";
import { pdfFileName, PdfWriter } from "@/lib/pdf";
import type { HistoryEntry } from "@/types/history";
import { openExternal, shareText } from "./device";
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

// "Partager ma fiche" (fiche d'urgence): only by the person's choice, as a message.

export function shareEmergencyCard(card: EmergencyCard, t: Translate, locale: Locale, name: string | null = null) {
  // A relative's card: their first name in the share sheet's title too.
  return shareText(name ? t("health.emergency.share.headingOf", { name }) : t("health.emergency.share.heading"), cardText(card, t, (at) => formatDate(at, locale), name), { copyTitle: false });
}

/** The card in WhatsApp: the person picks whom to send it to. */
export function whatsappEmergencyCard(card: EmergencyCard, t: Translate, locale: Locale, name: string | null = null) {
  openExternal(`https://wa.me/?text=${encodeURIComponent(cardText(card, t, (at) => formatDate(at, locale), name))}`);
}

// "Partager mes mesures": a period's measures for the doctor, as a message or
// a PDF, always with the neutral line ("Montre ces valeurs à ton médecin").

const measureFormat = (locale: Locale) => ({
  date: (at: number) => formatDate(at, locale),
  dateTime: (at: number) => formatDateTime(at, locale),
  number: (value: number, decimals: number) => formatMeasure(value, decimals, locale),
});

export function shareMeasures(measures: Measure[], options: ShareOptions, t: Translate, locale: Locale) {
  const report = measureReport(measures, options, t, measureFormat(locale));
  return shareText(report.title, measuresText(measures, options, t, measureFormat(locale)), { copyTitle: false });
}

export async function exportMeasuresPdf(measures: Measure[], options: ShareOptions, t: Translate, locale: Locale) {
  const report = measureReport(measures, options, t, measureFormat(locale));
  const pdf = await PdfWriter.create();
  pdf.title(report.title);
  pdf.caption(report.period);
  for (const section of report.sections) {
    pdf.rule();
    pdf.subtitle(section.title);
    pdf.bullets(section.lines);
  }
  pdf.rule();
  pdf.paragraph(report.doctor);
  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(report.title), bytes, "application/pdf", report.title);
}
