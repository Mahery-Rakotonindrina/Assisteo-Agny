import type { Locale } from "@/i18n.config";
import { formatAriary } from "@/lib/format";
import { itemsByRoom, type HomeItem } from "@/lib/inventory";
import { inventoryRows, inventorySummary, pdfItemLines, type ExportHeading } from "@/lib/inventoryExport";
import { PdfWriter } from "@/lib/pdf";

// "Ma maison" as a PDF for an insurer, built on the device (jsPDF, lib/pdf.ts):
// the total value, then each room with its things, a thumbnail beside each.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export async function inventoryPdf(items: HomeItem[], t: Translate, locale: Locale, heading: ExportHeading, now: number) {
  const pdf = await PdfWriter.create();
  pdf.title(heading.title);
  pdf.caption(heading.subtitle);
  pdf.pairs(inventorySummary(items, t, locale));
  const rows = inventoryRows(items, t, now);
  for (const group of itemsByRoom(items)) {
    pdf.heading(`${t(`inventory.rooms.${group.room}`)} · ${formatAriary(group.totalMga, locale)}`);
    for (const row of rows.filter((line) => (line.item.room ?? "other") === group.room)) pdf.thumbRow(row.item.thumbnail, pdfItemLines(row, t, locale));
  }
  if (items.length === 0) pdf.paragraph(t("inventory.emptyTitle"));
  pdf.caption(t("inventory.export.disclaimer"));
  return pdf.finish("Assisteo Agny");
}
