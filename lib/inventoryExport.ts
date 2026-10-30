import type { Locale } from "@/i18n.config";
import { ARIARY, DAY, excelDay, loadExcel, sheetHeading, sum, type ExportHeading, type TableColumn } from "./excel";
import { formatAriary, formatDate } from "./format";
import { inventoryTotals, itemsByRoom, warrantyStatus, type HomeItem } from "./inventory";
import { parseDay } from "./papers";

// "Ma maison" exported for an insurer after a theft, a fire or a flood: the
// things room by room, with their photo, price, shop, warranty and serial
// number, and the total value. Excel here, PDF in services/inventoryPdf.ts.

export { XLSX_TYPE, type ExportHeading } from "./excel";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One thing as the exports show it. */
export type InventoryRow = {
  item: HomeItem;
  room: string;
  category: string;
  boughtOn: number | null;
  priceMga: number | null;
  store: string;
  warrantyUntil: number | null;
  warranty: string;
  serial: string;
  papers: number;
  note: string;
};

/** The rows, room by room (the order of the app), by name within a room. */
export function inventoryRows(items: HomeItem[], t: Translate, now: number): InventoryRow[] {
  return itemsByRoom(items).flatMap(({ room, items: inRoom }) =>
    inRoom.map((item) => {
      const status = warrantyStatus(item, now);
      return {
        item,
        room: t(`inventory.rooms.${room}`),
        category: item.category ? t(`inventory.categories.${item.category}`) : "",
        boughtOn: parseDay(item.boughtOn),
        priceMga: item.priceMga ?? null,
        store: item.store ?? "",
        warrantyUntil: parseDay(item.warrantyUntil),
        warranty: status ? t(`inventory.warranty.${status}`) : "",
        serial: item.serial ?? "",
        papers: item.scanIds.length,
        note: item.note ?? "",
      };
    }),
  );
}

/** The lines beside a thing's photo in the PDF: its name, then what is known of it. */
export function pdfItemLines(row: InventoryRow, t: Translate, locale: Locale): string[] {
  const bought = [row.boughtOn !== null && formatDate(row.boughtOn, locale), row.store].filter(Boolean).join(" · ");
  return [
    [row.item.name, row.priceMga !== null ? formatAriary(row.priceMga, locale) : ""].filter(Boolean).join(" · "),
    ...(row.category ? [row.category] : []),
    ...(bought ? [t("inventory.export.bought", { what: bought })] : []),
    ...(row.warrantyUntil !== null ? [`${row.warranty} · ${t("inventory.export.warrantyUntil", { date: formatDate(row.warrantyUntil, locale) })}`] : []),
    ...(row.serial ? [t("inventory.export.serial", { serial: row.serial })] : []),
    ...(row.papers > 0 ? [t("inventory.export.papers", { count: row.papers })] : []),
    ...(row.note ? [row.note] : []),
  ];
}

/** The figures on top of both exports. */
export function inventorySummary(items: HomeItem[], t: Translate, locale: Locale) {
  const totals = inventoryTotals(items);
  return [
    { label: t("inventory.export.count"), value: String(totals.count) },
    { label: t("inventory.export.total"), value: formatAriary(totals.totalMga, locale) },
    ...(totals.unpriced > 0 ? [{ label: t("inventory.export.unpriced"), value: String(totals.unpriced) }] : []),
  ];
}

const columns = [
  { key: "photo", width: 12 },
  { key: "name", width: 26 },
  { key: "room", width: 16 },
  { key: "category", width: 18 },
  { key: "boughtOn", width: 13, kind: "day" },
  { key: "priceMga", width: 16, kind: "money" },
  { key: "store", width: 20 },
  { key: "warrantyUntil", width: 14, kind: "day" },
  { key: "warranty", width: 16 },
  { key: "serial", width: 20 },
  { key: "papers", width: 10 },
  { key: "note", width: 32 },
] as const;

// A row high enough for its thumbnail (points), and the thumbnail's size (pixels).
const PHOTO_ROW = 48;
const PHOTO_PX = 58;

const base64Of = (dataUrl: string | undefined) => {
  const match = dataUrl?.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  return match ? { extension: (match[1] === "png" ? "png" : "jpeg") as "png" | "jpeg", base64: match[2] } : null;
};

/** The workbook: the things with their thumbnails and the total value, then the value per room. */
export async function inventoryWorkbook(items: HomeItem[], t: Translate, heading: ExportHeading, now: number): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  workbook.creator = "Assisteo Agny";
  workbook.created = new Date();
  const rows = inventoryRows(items, t, now);
  const TOP = 4;

  // ---- Sheet 1: the things ----------------------------------------------------------
  const sheet = workbook.addWorksheet(t("inventory.export.sheetItems"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(sheet, heading);
  sheet.addTable({
    name: "Maison",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: columns.map(({ key }): TableColumn => ({
      name: t(`inventory.export.columns.${key}`),
      filterButton: key !== "photo",
      ...(key === "name" && { totalsRowLabel: t("inventory.export.total") }),
      ...(key === "priceMga" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(rows.map((row) => row.priceMga)) }),
    })),
    rows: rows.map((row) =>
      columns.map(({ key }) => {
        if (key === "photo") return "";
        if (key === "name") return row.item.name;
        if (key === "boughtOn" || key === "warrantyUntil") return excelDay(row[key]) ?? "";
        return row[key] ?? "";
      }),
    ),
  });
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
    for (let line = TOP + 1; line <= TOP + rows.length + 1; line += 1) {
      const cell = sheet.getCell(line, index + 1);
      if ("kind" in column && column.kind === "money") cell.numFmt = ARIARY;
      if ("kind" in column && column.kind === "day") cell.numFmt = DAY;
      if ("kind" in column && column.kind === "money" && line === TOP + rows.length + 1) cell.font = { bold: true };
      cell.alignment = { vertical: "middle", wrapText: column.key === "note" };
    }
  });
  rows.forEach((row, index) => {
    const image = base64Of(row.item.thumbnail);
    if (!image) return;
    sheet.getRow(TOP + 1 + index).height = PHOTO_ROW;
    const id = workbook.addImage(image);
    // Columns and rows count from 0 here: the photo column, the row under the header.
    sheet.addImage(id, { tl: { col: 0.1, row: TOP + index + 0.1 }, ext: { width: PHOTO_PX, height: PHOTO_PX } });
  });

  // ---- Sheet 2: per room ------------------------------------------------------------
  const groups = itemsByRoom(items);
  const recap = workbook.addWorksheet(t("inventory.export.sheetRooms"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(recap, heading);
  recap.addTable({
    name: "ParPiece",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: ([
      { name: t("inventory.export.columns.room"), filterButton: true, totalsRowLabel: t("inventory.export.total") },
      { name: t("inventory.export.count"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: items.length },
      { name: t("inventory.export.columns.priceMga"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(groups.map((group) => group.totalMga)) },
    ] satisfies TableColumn[]) as TableColumn[],
    rows: groups.map((group) => [t(`inventory.rooms.${group.room}`), group.items.length, group.totalMga]),
  });
  [22, 12, 18].forEach((width, index) => (recap.getColumn(index + 1).width = width));
  for (let line = TOP + 1; line <= TOP + groups.length + 1; line += 1) {
    const cell = recap.getCell(line, 3);
    cell.numFmt = ARIARY;
    if (line === TOP + groups.length + 1) cell.font = { bold: true };
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The export's file name: "ma-maison-2026-10-30.xlsx". */
export function inventoryFileName(day: string, kind: "xlsx" | "pdf") {
  return `ma-maison-${day}.${kind}`;
}
