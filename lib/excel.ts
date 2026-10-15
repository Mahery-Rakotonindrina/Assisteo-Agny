// Shared bits of the Excel exports (parcels, payments): ExcelJS is loaded only
// when exporting, it is too big for the app's first load.

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Shown "120 000 Ar"; the value stays a number. */
export const ARIARY = '#,##0" Ar"';
export const DAY = "dd/mm/yyyy";

/** A calendar day for Excel, which reads dates as UTC (a local midnight could show the day before). */
export const excelDay = (time: number | null) => {
  if (time === null) return null;
  const date = new Date(time);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
};

// ExcelJS writes the totals row's value (read by previews that don't compute), its types forget it.
export type TableColumn = import("exceljs").TableColumnProperties & { totalsRowResult?: number };

export const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

export async function loadExcel() {
  const loaded = await import("exceljs");
  return (loaded.default ?? loaded) as typeof import("exceljs");
}

export type ExportHeading = {
  /** "Mes colis · octobre 2026" */
  title: string;
  /** "Exporté le 8 oct. 2026" */
  subtitle: string;
};

/** The heading above a sheet's table (rows 1 and 2; the table starts at row 4). */
export function sheetHeading(sheet: import("exceljs").Worksheet, heading: ExportHeading) {
  sheet.getCell("A1").value = heading.title;
  sheet.getCell("A1").font = { bold: true, size: 15 };
  sheet.getCell("A2").value = heading.subtitle;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF6A707B" } };
}
