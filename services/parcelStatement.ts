import type { Locale } from "@/i18n.config";
import { formatAriary, formatDate } from "@/lib/format";
import { eventTime, shippingModeOf } from "@/lib/parcels";
import { parcelDate } from "@/lib/parcelReport";
import { pdfFileName, PdfWriter } from "@/lib/pdf";
import { shareFile } from "./fileShare";
import { parcelDueMga, type Parcel } from "./parcelStore";

// Reseller tools (Pro): a statement to send to one client, as a PDF that
// reads well on a phone. It shows where their parcels are and what they owe,
// never what the parcels cost the reseller (price, fees, profit).

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Line = { label: string; value: string };

/** What the client is charged (sale prices only), has paid and still owes, in ariary. */
export function statementTotals(parcels: Parcel[]) {
  const sold = parcels.filter((parcel) => parcel.salePriceMga);
  return {
    totalMga: sold.reduce((total, parcel) => total + (parcel.salePriceMga ?? 0), 0),
    paidMga: sold.reduce((total, parcel) => total + (parcel.paidMga ?? 0), 0),
    dueMga: sold.reduce((total, parcel) => total + parcelDueMga(parcel), 0),
  };
}

/** One parcel's lines on the statement; the empty ones are left out. */
export function statementLines(parcel: Parcel, t: Translate, locale: Locale): Line[] {
  const { info } = parcel;
  const label = (key: string) => t(`parcels.export.columns.${key}`);
  const mode = shippingModeOf(parcel).mode;
  const orderedAt = eventTime(info.orderedAt);
  const lines: Array<Line | null> = [
    {
      label: label("status"),
      value: parcel.receivedAt
        ? t("parcels.statement.receivedOn", { date: formatDate(parcel.receivedAt, locale) })
        : t(`parcel.statuses.${info.status}`),
    },
    mode && { label: label("shipping"), value: t(`parcel.shipping.${mode}`) },
    info.trackingNumber ? { label: label("trackingNumber"), value: info.trackingNumber } : null,
    info.carrier ? { label: label("carrier"), value: info.carrier } : null,
    orderedAt !== null ? { label: label("orderedAt"), value: formatDate(orderedAt, locale) } : null,
    info.items.length > 0
      ? {
          label: label("items"),
          value: info.items.map((item) => [item.name, item.variant && `(${item.variant})`, item.quantity > 1 && `×${item.quantity}`].filter(Boolean).join(" ")).join(" + "),
        }
      : null,
  ];
  if (parcel.salePriceMga) {
    lines.push(
      { label: t("parcels.statement.amount"), value: formatAriary(parcel.salePriceMga, locale) },
      { label: t("parcels.statement.paid"), value: formatAriary(parcel.paidMga ?? 0, locale) },
      { label: t("parcels.statement.due"), value: formatAriary(parcelDueMga(parcel), locale) },
    );
  }
  return lines.filter((line): line is Line => Boolean(line));
}

/**
 * The client's parcels of a period in one PDF, oldest first, with what they
 * owe on top. Handed to the share sheet (WhatsApp…), or downloaded.
 */
export async function exportClientStatement(
  client: string,
  parcels: Parcel[],
  period: { label: string; suffix: string },
  t: Translate,
  locale: Locale,
) {
  const sorted = [...parcels].sort((a, b) => parcelDate(a) - parcelDate(b));
  const pdf = await PdfWriter.create();
  pdf.title(t("parcels.statement.title", { name: client }));
  pdf.caption(t("parcels.statement.caption", { count: sorted.length, period: period.label, date: formatDate(Date.now(), locale) }));

  const totals = statementTotals(sorted);
  if (totals.totalMga > 0) {
    pdf.pairs([
      { label: t("parcels.statement.total"), value: formatAriary(totals.totalMga, locale) },
      { label: t("parcels.statement.paid"), value: formatAriary(totals.paidMga, locale) },
      { label: t("parcels.statement.due"), value: formatAriary(totals.dueMga, locale) },
    ]);
  }
  for (const parcel of sorted) {
    pdf.rule();
    pdf.subtitle(parcel.title);
    pdf.pairs(statementLines(parcel, t, locale));
  }

  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(`releve-${client}-${period.suffix}`), bytes, "application/pdf", t("parcels.statement.title", { name: client }));
}
