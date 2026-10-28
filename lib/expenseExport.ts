import type { Locale } from "@/i18n.config";
import { ARIARY, DAY, excelDay, loadExcel, sheetHeading, sum, type ExportHeading, type TableColumn } from "./excel";
import type { BudgetLine, IncomeItem, MonthItem } from "./expenses";
import { formatDate } from "./format";

// "Mes dépenses": the month as an Excel workbook (the expenses, then a recap
// per category with the budget) and the lines of its PDF. Shared bits in ./excel.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export { XLSX_TYPE } from "./excel";

export type ExpenseExport = {
  month: string;
  items: MonthItem[];
  incomes: IncomeItem[];
  budget: BudgetLine[];
  categoryName: (category: string) => string;
};

export type ExpenseRow = {
  date: Date | null;
  category: string;
  label: string;
  origin: string;
  payment: string;
  original: string;
  amountMga: number;
  counted: string;
};

/** One row per line of the month, the oldest first, in the sheet's column order. */
export function expenseRows({ items, categoryName }: Pick<ExpenseExport, "items" | "categoryName">, t: Translate): ExpenseRow[] {
  return [...items]
    .sort((a, b) => a.at - b.at)
    .map((item) => ({
      date: excelDay(item.at),
      category: categoryName(item.category),
      label: item.label ?? "",
      origin: t(`expenses.origins.${item.origin}`),
      payment: item.record?.payment ? t(`expenses.payments.${item.record.payment}`) : "",
      original: item.record?.currency && item.record.originalAmount ? `${item.record.originalAmount} ${item.record.currency} (${item.record.rate})` : "",
      amountMga: item.amountMga,
      counted: item.excluded ? t("expenses.export.no") : t("expenses.export.yes"),
    }));
}

const columns: Array<{ key: keyof ExpenseRow; width: number; kind?: "money" | "day" }> = [
  { key: "date", width: 13, kind: "day" },
  { key: "category", width: 22 },
  { key: "label", width: 30 },
  { key: "origin", width: 16 },
  { key: "payment", width: 15 },
  { key: "original", width: 22 },
  { key: "amountMga", width: 17, kind: "money" },
  { key: "counted", width: 12 },
];

/** The recap per category: what was spent (excluded lines left out) and its cap. */
export function categoryRecap({ items, budget, categoryName }: Pick<ExpenseExport, "items" | "budget" | "categoryName">) {
  const totals = new Map<string, number>();
  for (const item of items) if (!item.excluded) totals.set(item.category, (totals.get(item.category) ?? 0) + item.amountMga);
  for (const line of budget) if (line.scope !== "total" && !totals.has(line.scope)) totals.set(line.scope, 0);
  return [...totals.entries()]
    .map(([category, spent]) => ({ category: categoryName(category), spent, cap: budget.find((line) => line.scope === category)?.cap ?? null }))
    .sort((a, b) => b.spent - a.spent);
}

/** The month's overall budget: the total cap, else the categories' caps added up; null without any. */
export function overallCap(budget: BudgetLine[]) {
  const total = budget.find((line) => line.scope === "total");
  if (total) return total.cap;
  const caps = budget.filter((line) => line.scope !== "total");
  return caps.length > 0 ? sum(caps.map((line) => line.cap)) : null;
}

/** The workbook's bytes (.xlsx). */
export async function expensesWorkbook(data: ExpenseExport, t: Translate, heading: ExportHeading): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  workbook.creator = "Assisteo Agny";
  workbook.created = new Date();
  const TOP = 4;
  const rows = expenseRows(data, t);

  const sheet = workbook.addWorksheet(t("expenses.export.sheetExpenses"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(sheet, heading);
  sheet.addTable({
    name: "Depenses",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: columns.map(({ key, kind }, index): TableColumn => ({
      name: t(`expenses.export.columns.${key}`),
      filterButton: true,
      ...(index === 0 && { totalsRowLabel: t("expenses.export.total") }),
      ...(kind === "money" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(rows.map((row) => row.amountMga)) }),
    })),
    rows: rows.map((row) => columns.map(({ key }) => row[key] ?? "")),
  });
  columns.forEach(({ width, kind }, index) => {
    sheet.getColumn(index + 1).width = width;
    for (let line = TOP + 1; line <= TOP + rows.length + 1; line += 1) {
      const cell = sheet.getCell(line, index + 1);
      if (kind === "money") cell.numFmt = ARIARY;
      if (kind === "day") cell.numFmt = DAY;
    }
  });

  const recap = categoryRecap(data);
  const totalCap = overallCap(data.budget);
  const second = workbook.addWorksheet(t("expenses.export.sheetCategories"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(second, heading);
  second.addTable({
    name: "ParCategorie",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: ([
      { name: t("expenses.export.categoryColumns.category"), filterButton: true, totalsRowLabel: t("expenses.export.total") },
      { name: t("expenses.export.categoryColumns.spent"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(recap.map((line) => line.spent)) },
      {
        name: t("expenses.export.categoryColumns.cap"),
        filterButton: true,
        // The overall budget, not a sum: the categories' caps needn't add up to it.
        ...(totalCap !== null && { totalsRowFunction: "custom" as const, totalsRowFormula: String(totalCap), totalsRowResult: totalCap }),
      },
    ] satisfies TableColumn[]) as TableColumn[],
    rows: recap.map((line) => [line.category, line.spent, line.cap ?? ""]),
  });
  [26, 18, 18].forEach((width, index) => (second.getColumn(index + 1).width = width));
  for (let line = TOP + 1; line <= TOP + recap.length + 1; line += 1)
    for (const column of [2, 3]) {
      const cell = second.getCell(line, column);
      cell.numFmt = ARIARY;
      if (line === TOP + recap.length + 1) cell.font = { bold: true };
    }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The month's figures, for the PDF and the sheet heading. */
export function monthFigures({ items, incomes }: Pick<ExpenseExport, "items" | "incomes">) {
  const spent = sum(items.filter((item) => !item.excluded).map((item) => item.amountMga));
  const earned = sum(incomes.map((item) => item.amountMga));
  return { spent, earned, left: earned - spent };
}

/** One line per expense for the PDF: "12 oct. 2026 · Marché · 12 000 Ar". */
export function pdfLines(data: Pick<ExpenseExport, "items" | "categoryName">, t: Translate, locale: Locale, money: (value: number) => string) {
  return [...data.items]
    .sort((a, b) => a.at - b.at)
    .map((item) =>
      [formatDate(item.at, locale), data.categoryName(item.category), item.label, item.origin !== "manual" && t(`expenses.origins.${item.origin}`), money(item.amountMga), item.excluded && t("expenses.excluded")]
        .filter(Boolean)
        .join(" · "),
    );
}

/** The file name: "depenses-2026-10.xlsx" or ".pdf". */
export const expenseFileName = (month: string, extension: "xlsx" | "pdf") => `depenses-${month}.${extension}`;
