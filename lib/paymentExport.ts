import { ARIARY, DAY, excelDay, loadExcel, sheetHeading, sum, type ExportHeading, type TableColumn } from "./excel";
import { toDateInput } from "./format";
import { paidPlans, type Subscription } from "./plans";

// Admin: the payments recorded in /admin as an Excel workbook for the
// accounts. Three sheets, each an Excel table with a totals row: every
// payment, the totals per month (and per plan), the totals per payment
// method. A payment counts on the day it was recorded, as "Encaissé" does.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const paymentPeriods = ["month", "lastMonth", "year", "all"] as const;
export type PaymentPeriod = (typeof paymentPeriods)[number];

const monthOf = (time: number) => toDateInput(time).slice(0, 7);

/** Whether a record falls in the period (by the day it was recorded). */
export function inPaymentPeriod(row: Pick<Subscription, "createdAt">, period: PaymentPeriod, now: number) {
  const time = Date.parse(row.createdAt);
  if (period === "all") return true;
  if (period === "year") return new Date(time).getFullYear() === new Date(now).getFullYear();
  const date = new Date(now);
  const target = period === "month" ? now : new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
  return monthOf(time) === monthOf(target);
}

/** The records with money in, oldest first (offered accesses are not payments). */
export function payments(rows: Subscription[]) {
  return rows.filter((row) => (row.amountMga ?? 0) > 0).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export type MonthTotal = { month: string; count: number; byPlan: Partial<Record<Subscription["plan"], number>>; totalMga: number };

/** Per month ("2026-10"), oldest first: how many payments, and how much per plan. */
export function paymentsByMonth(rows: Subscription[]): MonthTotal[] {
  const months = new Map<string, MonthTotal>();
  for (const row of payments(rows)) {
    const month = monthOf(Date.parse(row.createdAt));
    const total = months.get(month) ?? { month, count: 0, byPlan: {}, totalMga: 0 };
    total.count += 1;
    total.byPlan[row.plan] = (total.byPlan[row.plan] ?? 0) + (row.amountMga ?? 0);
    total.totalMga += row.amountMga ?? 0;
    months.set(month, total);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Per payment method, the biggest first; null for records without one, last among equals. */
export function paymentsByMethod(rows: Subscription[]) {
  const methods = new Map<string | null, { method: string | null; count: number; totalMga: number }>();
  for (const row of payments(rows)) {
    const total = methods.get(row.paymentMethod) ?? { method: row.paymentMethod, count: 0, totalMga: 0 };
    total.count += 1;
    total.totalMga += row.amountMga ?? 0;
    methods.set(row.paymentMethod, total);
  }
  return [...methods.values()].sort((a, b) => b.totalMga - a.totalMga || Number(a.method === null) - Number(b.method === null));
}

const TOP = 4;

/** Formats a table's columns: widths, then money or day cells down to the totals row. */
function shape(sheet: import("exceljs").Worksheet, columns: Array<{ width: number; kind?: "money" | "day" }>, rowCount: number) {
  columns.forEach(({ width, kind }, index) => {
    sheet.getColumn(index + 1).width = width;
    for (let line = TOP + 1; line <= TOP + rowCount + 1; line += 1) {
      const cell = sheet.getCell(line, index + 1);
      if (kind === "money") cell.numFmt = ARIARY;
      if (kind === "day") cell.numFmt = DAY;
      if (kind === "money" && line === TOP + rowCount + 1) cell.font = { bold: true };
    }
  });
}

/** The workbook's bytes (.xlsx). */
/** `planName`: a plan's name, created plans included (the locales' names by default). */
export async function paymentsWorkbook(rows: Subscription[], t: Translate, heading: ExportHeading, planName: (plan: Subscription["plan"]) => string = (plan) => t(`plans.names.${plan}`)): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  workbook.creator = "Assisteo Agny";
  workbook.created = new Date();
  const label = (key: string) => t(`admin.export.columns.${key}`);
  const method = (value: string | null) => (value ? t(`admin.subs.methods.${value}`) : "");
  const list = payments(rows);
  const table = (sheet: import("exceljs").Worksheet, name: string, columns: TableColumn[], body: unknown[][]) =>
    sheet.addTable({ name, ref: `A${TOP}`, headerRow: true, totalsRow: true, style: { theme: "TableStyleMedium2", showRowStripes: true }, columns, rows: body });

  // ---- Sheet 1: every payment ----------------------------------------------------------
  const all = workbook.addWorksheet(t("admin.export.sheetPayments"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(all, heading);
  const columns = [
    { key: "date", width: 13, kind: "day" as const },
    { key: "email", width: 30 },
    { key: "plan", width: 12 },
    { key: "from", width: 13, kind: "day" as const },
    { key: "to", width: 13, kind: "day" as const },
    { key: "amount", width: 16, kind: "money" as const },
    { key: "method", width: 16 },
    { key: "ref", width: 20 },
    { key: "note", width: 30 },
  ];
  table(
    all,
    "Paiements",
    columns.map(({ key }, index) => ({
      name: label(key),
      filterButton: true,
      ...(index === 0 && { totalsRowLabel: t("admin.export.total") }),
      ...(key === "amount" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(list.map((row) => row.amountMga)) }),
    })),
    list.map((row) => [
      excelDay(Date.parse(row.createdAt)),
      row.email,
      planName(row.plan),
      excelDay(Date.parse(row.startsAt)),
      // The last day included of an exclusive end.
      row.endsAt ? excelDay(Date.parse(row.endsAt) - 1) : "",
      row.amountMga,
      method(row.paymentMethod),
      row.paymentRef ?? "",
      row.note ?? "",
    ]),
  );
  shape(all, columns, list.length);

  // ---- Sheet 2: per month --------------------------------------------------------------
  const months = paymentsByMonth(list);
  // The built-in plans in their order, then the created ones paid for.
  const plans = [...paidPlans.filter((plan) => list.some((row) => row.plan === plan)), ...new Set(list.map((row) => row.plan).filter((plan) => !(paidPlans as readonly string[]).includes(plan)))];
  const perMonth = workbook.addWorksheet(t("admin.export.sheetMonths"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(perMonth, heading);
  table(
    perMonth,
    "ParMois",
    [
      { name: label("month"), filterButton: true, totalsRowLabel: t("admin.export.total") },
      { name: label("count"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: list.length },
      ...plans.map((plan): TableColumn => ({ name: planName(plan), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(months.map((month) => month.byPlan[plan] ?? 0)) })),
      { name: label("amount"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(months.map((month) => month.totalMga)) },
    ],
    months.map((month) => [month.month, month.count, ...plans.map((plan) => month.byPlan[plan] ?? 0), month.totalMga]),
  );
  shape(perMonth, [{ width: 12 }, { width: 12 }, ...plans.map(() => ({ width: 16, kind: "money" as const })), { width: 18, kind: "money" }], months.length);

  // ---- Sheet 3: per payment method -----------------------------------------------------
  const methods = paymentsByMethod(list);
  const perMethod = workbook.addWorksheet(t("admin.export.sheetMethods"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(perMethod, heading);
  table(
    perMethod,
    "ParMoyen",
    [
      { name: label("method"), filterButton: true, totalsRowLabel: t("admin.export.total") },
      { name: label("count"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: list.length },
      { name: label("amount"), filterButton: true, totalsRowFunction: "sum", totalsRowResult: sum(methods.map((item) => item.totalMga)) },
    ],
    methods.map((item) => [method(item.method) || t("admin.export.noMethod"), item.count, item.totalMga]),
  );
  shape(perMethod, [{ width: 20 }, { width: 12 }, { width: 18, kind: "money" }], methods.length);

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
