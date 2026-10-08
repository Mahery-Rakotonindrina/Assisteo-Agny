import type { Locale } from "@/i18n.config";
import { eventTime } from "@/lib/parcels";
import { parcelDueMga, parcelProfitMga, parcelTotalMga, type Parcel } from "@/services/parcelStore";
import { formatAriary } from "./format";
import { clientSummaries } from "./parcelReport";

// Reseller tools (Pro): the parcels as an Excel workbook. Two sheets, each a
// real Excel table (header, stripes, filters, a totals row): the parcels,
// then a recap per client. Amounts are numbers shown as "120 000 Ar", so
// they read like the app and still add up. ExcelJS is loaded only here,
// when exporting: it is too big for the app's first load.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Shown "120 000 Ar"; the value stays a number. */
const ARIARY = '#,##0" Ar"';
const DAY = "dd/mm/yyyy";

/** A calendar day for Excel, which reads dates as UTC (a local midnight could show the day before). */
const excelDay = (time: number | null) => {
  if (time === null) return null;
  const date = new Date(time);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
};

export type ParcelRow = {
  client: string | null;
  title: string;
  platform: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  status: string;
  orderedAt: Date | null;
  receivedAt: Date | null;
  items: string;
  priceMga: number | null;
  feesMga: number | null;
  feesDetail: string;
  totalMga: number | null;
  salePriceMga: number | null;
  paidMga: number | null;
  dueMga: number | null;
  profitMga: number | null;
};

/** One row per parcel, in the sheet's column order. */
export function parcelRows(parcels: Parcel[], t: Translate, locale: Locale): ParcelRow[] {
  return parcels.map((parcel) => {
    const { info } = parcel;
    const fees = parcel.fees ?? [];
    return {
      client: parcel.client?.trim() || null,
      title: parcel.title,
      platform: info.platform,
      orderNumber: info.orderNumber,
      trackingNumber: info.trackingNumber,
      carrier: info.carrier,
      status: parcel.receivedAt ? t("parcels.receivedLabel") : t(`parcel.statuses.${info.status}`),
      orderedAt: excelDay(eventTime(info.orderedAt)),
      receivedAt: excelDay(parcel.receivedAt ?? null),
      items: info.items
        .map((item) => [item.name, item.variant && `(${item.variant})`, item.quantity > 1 && `×${item.quantity}`].filter(Boolean).join(" "))
        .join(" + "),
      priceMga: parcel.priceMga ?? null,
      feesMga: fees.length ? fees.reduce((total, fee) => total + (fee.amountMga || 0), 0) : null,
      feesDetail: fees.map((fee) => `${fee.label} ${formatAriary(fee.amountMga, locale)}`).join(", "),
      totalMga: parcelTotalMga(parcel) || null,
      salePriceMga: parcel.salePriceMga ?? null,
      paidMga: parcel.paidMga ?? null,
      dueMga: parcel.salePriceMga ? parcelDueMga(parcel) : null,
      profitMga: parcelProfitMga(parcel),
    };
  });
}

const parcelColumns: Array<{ key: keyof ParcelRow; width: number; kind?: "money" | "day" }> = [
  { key: "client", width: 18 },
  { key: "title", width: 30 },
  { key: "platform", width: 13 },
  { key: "orderNumber", width: 22 },
  { key: "trackingNumber", width: 20 },
  { key: "carrier", width: 15 },
  { key: "status", width: 16 },
  { key: "orderedAt", width: 13, kind: "day" },
  { key: "receivedAt", width: 13, kind: "day" },
  { key: "items", width: 34 },
  { key: "priceMga", width: 17, kind: "money" },
  { key: "feesMga", width: 15, kind: "money" },
  { key: "feesDetail", width: 30 },
  { key: "totalMga", width: 17, kind: "money" },
  { key: "salePriceMga", width: 17, kind: "money" },
  { key: "paidMga", width: 17, kind: "money" },
  { key: "dueMga", width: 17, kind: "money" },
  { key: "profitMga", width: 17, kind: "money" },
];

// ExcelJS writes the totals row's value (read by previews that don't compute), its types forget it.
type TableColumn = import("exceljs").TableColumnProperties & { totalsRowResult?: number };

const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

export type ExportHeading = {
  /** "Mes colis · octobre 2026" */
  title: string;
  /** "Exporté le 8 oct. 2026" */
  subtitle: string;
};

/** The workbook's bytes (.xlsx). */
export async function parcelsWorkbook(parcels: Parcel[], t: Translate, locale: Locale, heading: ExportHeading): Promise<ArrayBuffer> {
  const loaded = await import("exceljs");
  const Excel = (loaded.default ?? loaded) as typeof import("exceljs");
  const workbook = new Excel.Workbook();
  workbook.creator = "Assisteo Agny";
  workbook.created = new Date();

  const label = (key: string) => t(`parcels.export.columns.${key}`);
  const rows = parcelRows(parcels, t, locale);
  const head = (sheet: import("exceljs").Worksheet) => {
    sheet.getCell("A1").value = heading.title;
    sheet.getCell("A1").font = { bold: true, size: 15 };
    sheet.getCell("A2").value = heading.subtitle;
    sheet.getCell("A2").font = { size: 10, color: { argb: "FF6A707B" } };
  };
  // The table starts under the heading; its header row stays visible when scrolling.
  const TOP = 4;

  // ---- Sheet 1: the parcels -------------------------------------------------------------
  const sheet = workbook.addWorksheet(t("parcels.export.sheetParcels"), { views: [{ state: "frozen", ySplit: TOP }] });
  head(sheet);
  sheet.addTable({
    name: "Colis",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: parcelColumns.map(({ key, kind }, index): TableColumn => ({
      name: label(key),
      filterButton: true,
      ...(index === 0 && { totalsRowLabel: t("parcels.export.total") }),
      ...(kind === "money" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(rows.map((row) => row[key] as number | null)) }),
    })),
    rows: rows.map((row) => parcelColumns.map(({ key }) => row[key] ?? "")),
  });
  parcelColumns.forEach(({ width, kind }, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = width;
    // Every row of the table, the totals row included.
    for (let line = TOP + 1; line <= TOP + rows.length + 1; line += 1) {
      const cell = sheet.getCell(line, index + 1);
      if (kind === "money") cell.numFmt = ARIARY;
      if (kind === "day") cell.numFmt = DAY;
      if (kind === "money" && line === TOP + rows.length + 1) cell.font = { bold: true };
    }
  });

  // ---- Sheet 2: per client --------------------------------------------------------------
  const summaries = clientSummaries(parcels);
  const recap = workbook.addWorksheet(t("parcels.export.sheetClients"), { views: [{ state: "frozen", ySplit: TOP }] });
  head(recap);
  recap.addTable({
    name: "ParClient",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: ([
      { name: t("parcels.export.clientColumns.client"), filterButton: true, totalsRowLabel: t("parcels.export.total") },
      { name: t("parcels.export.clientColumns.parcels"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: parcels.length },
      { name: t("parcels.export.clientColumns.ongoing"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(summaries.map((client) => client.ongoing)) },
      { name: t("parcels.export.clientColumns.received"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(summaries.map((client) => client.parcels - client.ongoing)) },
      { name: t("parcels.export.clientColumns.total"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(summaries.map((client) => client.totalMga)) },
      { name: t("parcels.export.clientColumns.due"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(summaries.map((client) => client.dueMga)) },
      { name: t("parcels.export.clientColumns.profit"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(summaries.map((client) => client.profitMga)) },
    ] satisfies TableColumn[]) as TableColumn[],
    rows: summaries.map((client) => [
      client.name ?? t("parcels.clients.none"),
      client.parcels,
      client.ongoing,
      client.parcels - client.ongoing,
      client.totalMga,
      client.dueMga,
      client.profitMga,
    ]),
  });
  [24, 10, 10, 10, 18, 18, 18].forEach((width, index) => (recap.getColumn(index + 1).width = width));
  for (let line = TOP + 1; line <= TOP + summaries.length + 1; line += 1) {
    for (const column of [5, 6, 7]) {
      const cell = recap.getCell(line, column);
      cell.numFmt = ARIARY;
      if (line === TOP + summaries.length + 1) cell.font = { bold: true };
    }
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The workbook's file name: "colis-2026-10.xlsx". */
export function exportFileName(suffix: string) {
  return `colis-${suffix}.xlsx`;
}

