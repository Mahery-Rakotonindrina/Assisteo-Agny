import { ARIARY, DAY, excelDay, loadExcel, sheetHeading, sum, type ExportHeading, type TableColumn } from "./excel";
import { personLedger, type LedgerLine } from "./loanLedger";
import { loanSides } from "./loanReport";
import type { Loan } from "./loans";

// "Prêts": the loans as an Excel workbook, like the parcels (lib/parcelExport.ts).
// Each way ("On me doit", "Je dois") has its own two sheets, so a totals row
// never adds what is owed to the user to what they owe: one row per loan,
// then a recap per person. Ways without any loan are left out. One person's
// account ("Compte avec Rakoto") adds its statement, with "Reste" after each line.

type Translate = (key: string, params?: Record<string, string | number>) => string;

export { XLSX_TYPE, type ExportHeading } from "./excel";

const loanColumns = [
  { key: "person", width: 20 },
  { key: "at", width: 13, kind: "day" },
  { key: "amountMga", width: 16, kind: "money" },
  { key: "interestMga", width: 14, kind: "money" },
  { key: "totalMga", width: 16, kind: "money" },
  { key: "paidMga", width: 16, kind: "money" },
  { key: "remainingMga", width: 16, kind: "money" },
  { key: "dueAt", width: 13, kind: "day" },
  { key: "status", width: 14 },
  { key: "note", width: 28 },
] as const;

/** What a statement's line is called in the exports: what it was for, and its kind. */
export function ledgerLabels(line: LedgerLine, t: Translate) {
  const kind =
    line.kind === "loan" ? t(`loans.line.loan.${line.loan.direction}`) : line.kind === "interest" ? t("loans.line.interest") : t(`loans.line.repayment.${line.loan.direction}`, { name: line.loan.person.trim() });
  return { kind, what: line.kind === "loan" ? line.loan.note?.trim() || kind : kind };
}

/** The workbook's bytes (.xlsx); `account`: one person's loans, with their statement. */
export async function loansWorkbook(loans: Loan[], now: number, t: Translate, heading: ExportHeading, { account = false }: { account?: boolean } = {}): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const workbook = new Excel.Workbook();
  workbook.creator = "Assisteo Agny";
  workbook.created = new Date(now);
  const TOP = 4;
  const label = (key: string) => t(`loans.export.columns.${key}`);

  for (const { direction, rows, people } of loanSides(loans, now)) {
    const total = t(`loans.export.totalBy.${direction}`);
    // Table names: letters only, unique in the workbook.
    const suffix = direction === "lent" ? "OnMeDoit" : "JeDois";

    // ---- The loans of this way -------------------------------------------------------
    const sheet = workbook.addWorksheet(t(`loans.export.sheetLoansBy.${direction}`), { views: [{ state: "frozen", ySplit: TOP }] });
    sheetHeading(sheet, heading);
    sheet.addTable({
      name: `Prets${suffix}`,
      ref: `A${TOP}`,
      headerRow: true,
      totalsRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: loanColumns.map((column, index): TableColumn => ({
        name: label(column.key),
        filterButton: true,
        ...(index === 0 && { totalsRowLabel: total }),
        ...("kind" in column && column.kind === "money" && { totalsRowFunction: "sum" as const, totalsRowResult: sum(rows.map((row) => row[column.key])) }),
      })),
      rows: rows.map((row) =>
        loanColumns.map(({ key }) => {
          if (key === "status") return t(`loans.export.status.${row.status}`);
          if (key === "at" || key === "dueAt") return excelDay(row[key]) ?? "";
          return row[key];
        }),
      ),
    });
    loanColumns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width;
      if (!("kind" in column)) return;
      for (let line = TOP + 1; line <= TOP + rows.length + 1; line += 1) {
        const cell = sheet.getCell(line, index + 1);
        cell.numFmt = column.kind === "money" ? ARIARY : DAY;
        if (column.kind === "money" && line === TOP + rows.length + 1) cell.font = { bold: true };
      }
    });

    // ---- Per person, this way --------------------------------------------------------
    const recap = workbook.addWorksheet(t(`loans.export.sheetPeopleBy.${direction}`), { views: [{ state: "frozen", ySplit: TOP }] });
    sheetHeading(recap, heading);
    const money = (values: number[]) => ({ filterButton: true, totalsRowFunction: "sum" as const, totalsRowResult: sum(values) });
    recap.addTable({
      name: `ParPersonne${suffix}`,
      ref: `A${TOP}`,
      headerRow: true,
      totalsRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: [
        { name: label("person"), filterButton: true, totalsRowLabel: total },
        { name: label("loans"), ...money(people.map((person) => person.loans)) },
        { name: label("totalMga"), ...money(people.map((person) => person.totalMga)) },
        { name: label("paidMga"), ...money(people.map((person) => person.paidMga)) },
        { name: label("remainingMga"), ...money(people.map((person) => person.remainingMga)) },
        { name: label("lateMga"), ...money(people.map((person) => person.lateMga)) },
      ] as TableColumn[],
      rows: people.map((person) => [person.name, person.loans, person.totalMga, person.paidMga, person.remainingMga, person.lateMga]),
    });
    [22, 10, 17, 17, 17, 17].forEach((width, index) => (recap.getColumn(index + 1).width = width));
    for (let line = TOP + 1; line <= TOP + people.length + 1; line += 1) {
      for (const column of [3, 4, 5, 6]) {
        const cell = recap.getCell(line, column);
        cell.numFmt = ARIARY;
        if (line === TOP + people.length + 1) cell.font = { bold: true };
      }
    }

    // ---- One person: the statement, "Reste" after each line ----------------------------
    if (!account) continue;
    const lines = personLedger(loans.filter((loan) => loan.direction === direction));
    const statement = workbook.addWorksheet(t(`loans.export.sheetAccountBy.${direction}`), { views: [{ state: "frozen", ySplit: TOP }] });
    sheetHeading(statement, heading);
    statement.addTable({
      name: `Compte${suffix}`,
      ref: `A${TOP}`,
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: ["at", "what", "kind", "addedMga", "repaidMga", "balanceMga"].map((key) => ({ name: label(key), filterButton: true })),
      rows: lines.map((line) => {
        const { kind, what } = ledgerLabels(line, t);
        return [excelDay(line.at) ?? "", what, kind, line.kind === "repayment" ? null : line.amountMga, line.kind === "repayment" ? line.amountMga : null, line.balanceMga];
      }),
    });
    [13, 28, 18, 16, 16, 16].forEach((width, index) => (statement.getColumn(index + 1).width = width));
    for (let line = TOP + 1; line <= TOP + lines.length; line += 1) {
      statement.getCell(line, 1).numFmt = DAY;
      for (const column of [4, 5, 6]) statement.getCell(line, column).numFmt = ARIARY;
      statement.getCell(line, 6).font = { bold: true };
    }
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
