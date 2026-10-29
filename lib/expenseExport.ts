import type { Locale } from "@/i18n.config";
import { ARIARY, DAY, excelDay, loadExcel, sheetHeading, sum, type ExportHeading, type TableColumn } from "./excel";
import { monthStart, shiftMonth, type BudgetLine, type ExpenseRecord, type IncomeItem, type MonthItem } from "./expenses";
import { formatDate } from "./format";
import type { ActivityMonth } from "./resale";
import { goalSaved, goalsOf, savingsMoves, tontinesOf, tontineStatus } from "./savings";
import { activeWallets, lineWallet, type WalletBook, type WalletLine } from "./wallets";

// "Mes dépenses": the month as an Excel workbook (the expenses, then a recap
// per category with the budget, the incomes, the pockets, the money set
// aside and the activity) and the lines of its PDF. Shared bits in ./excel.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export { XLSX_TYPE } from "./excel";

export type ExpenseExport = {
  month: string;
  items: MonthItem[];
  incomes: IncomeItem[];
  budget: BudgetLine[];
  categoryName: (category: string) => string;
  /** The pockets: their sheet and the "Pocket" columns. Without any, neither shows. */
  book?: WalletBook;
  /** Every record: the savings goals and the tontines. */
  records?: ExpenseRecord[];
  /** "Mon activité": given with the reseller tools and the activity kept apart only. */
  activity?: ActivityMonth | null;
};

const hasPockets = (book: WalletBook | undefined): book is WalletBook => Boolean(book && book.context.wallets.length > 0);

/** The pocket a line is counted in, by name; "" without pockets. */
function walletName(book: WalletBook | undefined, line: WalletLine) {
  if (!hasPockets(book)) return "";
  const id = lineWallet(book.context, line);
  return (id && book.context.byId.get(id)?.name) || "";
}

export type ExpenseRow = {
  date: Date | null;
  category: string;
  label: string;
  origin: string;
  payment: string;
  wallet: string;
  original: string;
  amountMga: number;
  counted: string;
};

/** One row per line of the month, the oldest first, in the sheet's column order. */
export function expenseRows({ items, categoryName, book }: Pick<ExpenseExport, "items" | "categoryName" | "book">, t: Translate): ExpenseRow[] {
  return [...items]
    .sort((a, b) => a.at - b.at)
    .map((item) => ({
      date: excelDay(item.at),
      category: categoryName(item.category),
      label: item.label ?? "",
      origin: t(`expenses.origins.${item.origin}`),
      payment: item.record?.payment ? t(`expenses.payments.${item.record.payment}`) : "",
      wallet: walletName(book, item),
      original: item.record?.currency && item.record.originalAmount ? `${item.record.originalAmount} ${item.record.currency} (${item.record.rate})` : "",
      amountMga: item.amountMga,
      counted: item.excluded ? t("expenses.export.no") : t("expenses.export.yes"),
    }));
}

type Column<Row> = { key: keyof Row & string; width: number; kind?: "money" | "day" };

const columns: Array<Column<ExpenseRow>> = [
  { key: "date", width: 13, kind: "day" },
  { key: "category", width: 22 },
  { key: "label", width: 30 },
  { key: "origin", width: 16 },
  { key: "payment", width: 15 },
  { key: "wallet", width: 16 },
  { key: "original", width: 22 },
  { key: "amountMga", width: 17, kind: "money" },
  { key: "counted", width: 12 },
];

export type IncomeRow = { date: Date | null; kind: string; label: string; origin: string; wallet: string; amountMga: number; counted: string };

/** One row per income of the month (typed in, every month, sales, Mobile Money received), the oldest first. */
export function incomeRows({ incomes, book }: Pick<ExpenseExport, "incomes" | "book">, t: Translate): IncomeRow[] {
  return [...incomes]
    .sort((a, b) => a.at - b.at)
    .map((item) => ({
      date: excelDay(item.at),
      kind: t(`expenses.incomes.${item.income}`),
      label: item.label ?? "",
      origin: t(`expenses.origins.${item.origin === "receipt" ? "mobile_money" : item.origin}`),
      wallet: walletName(book, item),
      amountMga: item.amountMga,
      counted: item.excluded ? t("expenses.export.no") : t("expenses.export.yes"),
    }));
}

const incomeColumns: Array<Column<IncomeRow>> = [
  { key: "date", width: 13, kind: "day" },
  { key: "kind", width: 20 },
  { key: "label", width: 30 },
  { key: "origin", width: 16 },
  { key: "wallet", width: 16 },
  { key: "amountMga", width: 17, kind: "money" },
  { key: "counted", width: 12 },
];

/** A sheet's columns: the "Pocket" one only once there are pockets. */
const shown = <Row>(list: Array<Column<Row>>, book: WalletBook | undefined) => (hasPockets(book) ? list : list.filter((column) => column.key !== "wallet"));

/** The column's title: the "Pocket" one is shared by both sheets. */
const columnTitle = (t: Translate, group: "columns" | "incomeColumns", key: string) => (key === "wallet" ? t("expenses.exportMore.wallet") : t(`expenses.export.${group}.${key}`));

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

// ---- Pockets, money set aside, activity -------------------------------------------------

export type PocketMonth = { name: string; start: number; incomes: number; expenses: number; moves: number; end: number };

const monthBounds = (month: string) => ({ from: monthStart(month), to: monthStart(shiftMonth(month, 1)) });

/**
 * Each pocket shown (archived ones left out, like "Dans tes poches") over
 * the month, read back from what it holds now and its movements
 * (lib/wallets.ts): the balance at the start, the incomes, the expenses,
 * the rest (moves between pockets, money set aside, corrections) and the
 * balance at the end. A pocket set after the month is left out; one set
 * during it starts with what it held then.
 */
export function pocketMonths(book: WalletBook, month: string): PocketMonth[] {
  const { from, to } = monthBounds(month);
  return activeWallets(book.context.wallets)
    .filter((wallet) => wallet.startAt < to)
    .map((wallet) => {
      const movements = book.movements.get(wallet.id) ?? [];
      const balance = book.balances.get(wallet.id) ?? 0;
      const since = (time: number) => sum(movements.filter((movement) => movement.at >= time).map((movement) => movement.amountMga));
      const during = movements.filter((movement) => movement.at >= from && movement.at < to);
      const of = (test: (type: string) => boolean) => sum(during.filter((movement) => test(movement.type)).map((movement) => movement.amountMga));
      return {
        name: wallet.name,
        start: balance - since(from),
        incomes: of((type) => type === "income"),
        // 0 - x, not -x: no "-0" in the sheet.
        expenses: 0 - of((type) => type === "expense"),
        moves: of((type) => type !== "income" && type !== "expense"),
        end: balance - since(to),
      };
    });
}

/** "Dans tes poches" at the start and at the end of the month; null without pockets. */
export function pocketTotals(book: WalletBook | undefined, month: string) {
  if (!hasPockets(book)) return null;
  const rows = pocketMonths(book, month);
  if (rows.length === 0) return null;
  return { start: sum(rows.map((row) => row.start)), end: sum(rows.map((row) => row.end)) };
}

export type GoalRow = { name: string; target: number; saved: number; left: number; month: number };
export type TontineRow = { name: string; paid: number; pot: number; received: boolean; potAt: number; month: number };
export type SavingsMoveRow = { at: number; name: string; type: "saved" | "unsaved" | "paid" | "pot"; wallet: string; amountMga: number };

/**
 * The goals (aimed at, set aside, left, and this month's net), the tontines
 * (paid in, the pot, received or when it comes, and this month's payments)
 * and the month's movements of the money set aside, the oldest first.
 */
export function savingsMonth(records: ExpenseRecord[], month: string, book?: WalletBook) {
  const { from, to } = monthBounds(month);
  const during = (at: number) => at >= from && at < to;
  const goals: GoalRow[] = goalsOf(records).map((goal) => ({
    name: goal.name,
    target: goal.targetMga,
    saved: goalSaved(goal),
    left: Math.max(0, goal.targetMga - goalSaved(goal)),
    month: sum((goal.deposits ?? []).filter((deposit) => during(deposit.at)).map((deposit) => deposit.amountMga)),
  }));
  const tontines: TontineRow[] = tontinesOf(records).map((tontine) => {
    const status = tontineStatus(tontine, from);
    return {
      name: tontine.name,
      paid: status.paid,
      pot: tontine.received?.amountMga || status.pot,
      received: status.received,
      potAt: tontine.received?.at ?? status.turnAt,
      month: sum((tontine.deposits ?? []).filter((deposit) => during(deposit.at)).map((deposit) => deposit.amountMga)),
    };
  });
  const pocket = (id: string) => book?.context.byId.get(id)?.name ?? "";
  const moves: SavingsMoveRow[] = savingsMoves(records)
    .filter((move) => during(move.at))
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    .map((move) => ({
      at: move.at,
      name: move.name,
      // A tontine's payment reads as such, not as money put aside in a goal.
      type: move.type === "saved" && move.key.startsWith("tontine:") ? "paid" : move.type,
      wallet: pocket(move.wallet),
      amountMga: Math.abs(move.amountMga),
    }));
  return { goals, tontines, moves };
}

/** The activity's lines: bought, sold, profit, still to collect. */
function activityRows(activity: ActivityMonth, t: Translate): Array<[string, number, number | null]> {
  return [
    [t("expenses.activity.bought"), activity.boughtMga, activity.bought],
    [t("expenses.activity.sales"), activity.salesMga, activity.sold],
    [t("expenses.activity.profit"), activity.profitMga, null],
    [t("expenses.activity.toCollect"), activity.toCollectMga, null],
  ];
}

const shownActivity = (activity: ActivityMonth | null | undefined): activity is ActivityMonth => Boolean(activity?.active);

// ---- The workbook ---------------------------------------------------------------------

type Worksheet = import("exceljs").Worksheet;
type Cell = string | number | Date | null;
type TableSpec = {
  name: string;
  row: number;
  columns: Array<{ title: string; width: number; kind?: "money" | "day"; total?: boolean }>;
  rows: Cell[][];
  /** A totals row, with this label. */
  totals?: string;
};

/** A table of the newer sheets, its money and days formatted; returns its last row. */
function addTable(sheet: Worksheet, { name, row, columns: list, rows, totals }: TableSpec) {
  sheet.addTable({
    name,
    ref: `A${row}`,
    headerRow: true,
    totalsRow: Boolean(totals),
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: list.map(({ title, total }, index): TableColumn => ({
      name: title,
      filterButton: true,
      ...(totals && index === 0 && { totalsRowLabel: totals }),
      ...(totals && total && { totalsRowFunction: "sum" as const, totalsRowResult: sum(rows.map((cells) => (typeof cells[index] === "number" ? (cells[index] as number) : 0))) }),
    })),
    rows: rows.map((cells) => cells.map((cell) => cell ?? "")),
  });
  const last = row + rows.length + (totals ? 1 : 0);
  list.forEach(({ width, kind }, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.max(column.width ?? 0, width);
    for (let line = row + 1; line <= last; line += 1) {
      const cell = sheet.getCell(line, index + 1);
      if (kind === "money") cell.numFmt = ARIARY;
      if (kind === "day") cell.numFmt = DAY;
      if (totals && line === last) cell.font = { bold: true };
    }
  });
  return last;
}

/** A small bold title above a table. */
function tableTitle(sheet: Worksheet, row: number, text: string) {
  sheet.getCell(row, 1).value = text;
  sheet.getCell(row, 1).font = { bold: true, size: 12 };
}

/** The workbook's bytes (.xlsx). */
export async function expensesWorkbook(data: ExpenseExport, t: Translate, heading: ExportHeading): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  workbook.creator = "Assisteo Agny";
  workbook.created = new Date();
  const TOP = 4;
  const rows = expenseRows(data, t);
  const expenseColumns = shown(columns, data.book);

  const sheet = workbook.addWorksheet(t("expenses.export.sheetExpenses"), { views: [{ state: "frozen", ySplit: TOP }] });
  sheetHeading(sheet, heading);
  sheet.addTable({
    name: "Depenses",
    ref: `A${TOP}`,
    headerRow: true,
    totalsRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: expenseColumns.map(({ key, kind }, index): TableColumn => ({
      name: columnTitle(t, "columns", key),
      filterButton: true,
      ...(index === 0 && { totalsRowLabel: t("expenses.export.total") }),
      ...(kind === "money" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(rows.map((row) => row.amountMga)) }),
    })),
    rows: rows.map((row) => expenseColumns.map(({ key }) => row[key] ?? "")),
  });
  expenseColumns.forEach(({ width, kind }, index) => {
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

  // The incomes, on their own sheet (after the two kept from before).
  const incomes = incomeRows(data, t);
  const incomeShown = shown(incomeColumns, data.book);
  if (incomes.length > 0) {
    const third = workbook.addWorksheet(t("expenses.export.sheetIncomes"), { views: [{ state: "frozen", ySplit: TOP }] });
    sheetHeading(third, heading);
    third.addTable({
      name: "Revenus",
      ref: `A${TOP}`,
      headerRow: true,
      totalsRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: incomeShown.map(({ key, kind }, index): TableColumn => ({
        name: columnTitle(t, "incomeColumns", key),
        filterButton: true,
        ...(index === 0 && { totalsRowLabel: t("expenses.export.total") }),
        ...(kind === "money" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(incomes.map((row) => row.amountMga)) }),
      })),
      rows: incomes.map((row) => incomeShown.map(({ key }) => row[key] ?? "")),
    });
    incomeShown.forEach(({ width, kind }, index) => {
      third.getColumn(index + 1).width = width;
      for (let line = TOP + 1; line <= TOP + incomes.length + 1; line += 1) {
        const cell = third.getCell(line, index + 1);
        if (kind === "money") cell.numFmt = ARIARY;
        if (kind === "day") cell.numFmt = DAY;
      }
    });
  }

  // The pockets over the month, their total being "Dans tes poches".
  const pockets = hasPockets(data.book) ? pocketMonths(data.book, data.month) : [];
  if (pockets.length > 0) {
    const fourth = workbook.addWorksheet(t("expenses.exportMore.sheetPockets"), { views: [{ state: "frozen", ySplit: TOP }] });
    sheetHeading(fourth, heading);
    const title = (key: string) => t(`expenses.exportMore.pocketColumns.${key}`);
    addTable(fourth, {
      name: "Poches",
      row: TOP,
      totals: t("expenses.exportMore.inPockets"),
      columns: [
        { title: title("name"), width: 22 },
        ...(["start", "incomes", "expenses", "moves", "end"] as const).map((key) => ({ title: title(key), width: 17, kind: "money" as const, total: true })),
      ],
      rows: pockets.map((row) => [row.name, row.start, row.incomes, row.expenses, row.moves, row.end]),
    });
  }

  // The money set aside: the goals, the tontines, then the month's movements.
  const savings = data.records ? savingsMonth(data.records, data.month, data.book) : { goals: [], tontines: [], moves: [] };
  if (savings.goals.length > 0 || savings.tontines.length > 0) {
    const fifth = workbook.addWorksheet(t("expenses.exportMore.sheetSavings"));
    sheetHeading(fifth, heading);
    const title = (group: string, key: string) => t(`expenses.exportMore.${group}.${key}`);
    let row = TOP;
    if (savings.goals.length > 0) {
      tableTitle(fifth, row, t("expenses.savings.goals"));
      const last = addTable(fifth, {
        name: "Objectifs",
        row: row + 1,
        totals: t("expenses.export.total"),
        columns: [
          { title: title("goalColumns", "name"), width: 24 },
          ...(["target", "saved", "left", "month"] as const).map((key) => ({ title: title("goalColumns", key), width: 17, kind: "money" as const, total: true })),
        ],
        rows: savings.goals.map((goal) => [goal.name, goal.target, goal.saved, goal.left, goal.month]),
      });
      row = last + 2;
    }
    if (savings.tontines.length > 0) {
      tableTitle(fifth, row, t("expenses.savings.tontines"));
      const last = addTable(fifth, {
        name: "Tontines",
        row: row + 1,
        columns: [
          { title: title("tontineColumns", "name"), width: 24 },
          { title: title("tontineColumns", "paid"), width: 17, kind: "money" },
          { title: title("tontineColumns", "pot"), width: 17, kind: "money" },
          { title: title("tontineColumns", "potStatus"), width: 17 },
          { title: title("tontineColumns", "potDay"), width: 17, kind: "day" },
          { title: title("tontineColumns", "month"), width: 17, kind: "money" },
        ],
        rows: savings.tontines.map((tontine) => [
          tontine.name,
          tontine.paid,
          tontine.pot,
          t(`expenses.exportMore.${tontine.received ? "received" : "upcoming"}`),
          excelDay(tontine.potAt),
          tontine.month,
        ]),
      });
      row = last + 2;
    }
    if (savings.moves.length > 0) {
      tableTitle(fifth, row, t("expenses.exportMore.moves"));
      addTable(fifth, {
        name: "MouvementsEpargne",
        row: row + 1,
        columns: [
          { title: title("moveColumns", "date"), width: 13, kind: "day" },
          { title: title("moveColumns", "name"), width: 24 },
          { title: title("moveColumns", "type"), width: 17 },
          { title: title("moveColumns", "wallet"), width: 17 },
          { title: title("moveColumns", "amountMga"), width: 17, kind: "money" },
        ],
        rows: savings.moves.map((move) => [excelDay(move.at), move.name, t(`expenses.exportMore.moveTypes.${move.type}`), move.wallet, move.amountMga]),
      });
    }
  }

  // "Mon activité": the reselling kept apart from the household's budget.
  if (shownActivity(data.activity)) {
    const sixth = workbook.addWorksheet(t("expenses.exportMore.sheetActivity"));
    sheetHeading(sixth, heading);
    const title = (key: string) => t(`expenses.exportMore.activityColumns.${key}`);
    addTable(sixth, {
      name: "Activite",
      row: TOP,
      columns: [
        { title: title("line"), width: 28 },
        { title: title("amountMga"), width: 17, kind: "money" },
        { title: title("parcels"), width: 10 },
      ],
      rows: activityRows(data.activity, t),
    });
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The month's figures, for the PDF and the sheet heading. */
export function monthFigures({ items, incomes }: Pick<ExpenseExport, "items" | "incomes">) {
  const spent = sum(items.filter((item) => !item.excluded).map((item) => item.amountMga));
  const earned = sum(incomes.filter((item) => !item.excluded).map((item) => item.amountMga));
  return { spent, earned, left: earned - spent };
}

/** One line per expense for the PDF: "12 oct. 2026 · Marché · Espèces · 12 000 Ar". */
export function pdfLines(data: Pick<ExpenseExport, "items" | "categoryName" | "book">, t: Translate, locale: Locale, money: (value: number) => string) {
  return [...data.items]
    .sort((a, b) => a.at - b.at)
    .map((item) =>
      [
        formatDate(item.at, locale),
        data.categoryName(item.category),
        item.label,
        item.origin !== "manual" && t(`expenses.origins.${item.origin}`),
        walletName(data.book, item),
        money(item.amountMga),
        item.excluded && t("expenses.excluded"),
      ]
        .filter(Boolean)
        .join(" · "),
    );
}

/** One line per income for the PDF: "30 oct. 2026 · Salaire · MVola · 450 000 Ar". */
export function pdfIncomeLines(data: Pick<ExpenseExport, "incomes" | "book">, t: Translate, locale: Locale, money: (value: number) => string) {
  return incomeRows(data, t).map((row, index) => {
    const item = [...data.incomes].sort((a, b) => a.at - b.at)[index];
    return [formatDate(item.at, locale), row.kind, row.label, item.origin !== "manual" && row.origin, row.wallet, money(row.amountMga), item.excluded && t("expenses.excluded")].filter(Boolean).join(" · ");
  });
}

export type PdfSection = { heading: string; bullets?: string[]; pairs?: Array<{ label: string; value: string }>; more?: { heading: string; bullets: string[] } };

/** The PDF's sections after the incomes: the pockets, the money set aside, the activity (the empty ones left out). */
export function pdfMoreSections(data: ExpenseExport, t: Translate, locale: Locale, money: (value: number) => string): PdfSection[] {
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
  const sections: PdfSection[] = [];
  const pockets = hasPockets(data.book) ? pocketMonths(data.book, data.month) : [];
  if (pockets.length > 0) {
    sections.push({
      heading: t("expenses.exportMore.sheetPockets"),
      bullets: pockets.map((row) =>
        t("expenses.exportMore.pocketLine", { name: row.name, start: money(row.start), incomes: signed(row.incomes), expenses: signed(-row.expenses), moves: signed(row.moves), end: money(row.end) }),
      ),
      pairs: [{ label: t("expenses.exportMore.inPockets"), value: `${money(sum(pockets.map((row) => row.start)))} → ${money(sum(pockets.map((row) => row.end)))}` }],
    });
  }
  const savings = data.records ? savingsMonth(data.records, data.month, data.book) : { goals: [], tontines: [], moves: [] };
  if (savings.goals.length > 0 || savings.tontines.length > 0) {
    sections.push({
      heading: t("expenses.exportMore.sheetSavings"),
      bullets: [
        ...savings.goals.map((goal) => t("expenses.exportMore.goalLine", { name: goal.name, saved: money(goal.saved), target: money(goal.target), left: money(goal.left) })),
        ...savings.tontines.map((tontine) =>
          t("expenses.exportMore.tontineLine", {
            name: tontine.name,
            paid: money(tontine.paid),
            pot: money(tontine.pot),
            status: t(`expenses.exportMore.${tontine.received ? "potReceived" : "potUpcoming"}`, { date: formatDate(tontine.potAt, locale) }),
          }),
        ),
      ],
      ...(savings.moves.length > 0 && {
        more: {
          heading: t("expenses.exportMore.moves"),
          bullets: savings.moves.map((move) =>
            [formatDate(move.at, locale), move.name, t(`expenses.exportMore.moveTypes.${move.type}`), move.wallet, money(move.amountMga)].filter(Boolean).join(" · "),
          ),
        },
      }),
    });
  }
  if (shownActivity(data.activity))
    sections.push({
      heading: t("expenses.exportMore.sheetActivity"),
      pairs: activityRows(data.activity, t).map(([label, amount]) => ({ label, value: money(amount) })),
    });
  return sections;
}

/** The file name: "depenses-2026-10.xlsx" or ".pdf". */
export const expenseFileName = (month: string, extension: "xlsx" | "pdf") => `depenses-${month}.${extension}`;
