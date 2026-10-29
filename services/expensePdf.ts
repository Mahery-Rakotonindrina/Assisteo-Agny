import type { Locale } from "@/i18n.config";
import { categoryRecap, monthFigures, overallCap, pdfIncomeLines, pdfLines, pdfMoreSections, type ExpenseExport } from "@/lib/expenseExport";
import { formatAriary } from "@/lib/format";
import { PdfWriter } from "@/lib/pdf";

// "Mes dépenses": the month as a PDF, built on the device (jsPDF, lib/pdf.ts).

type Translate = (key: string, params?: Record<string, string | number>) => string;

export async function expensesPdf(data: ExpenseExport, t: Translate, locale: Locale, heading: { title: string; subtitle: string }) {
  const money = (value: number) => formatAriary(value, locale);
  const { spent, earned, left } = monthFigures(data);
  const cap = overallCap(data.budget);
  const pdf = await PdfWriter.create();
  pdf.title(heading.title);
  pdf.caption(heading.subtitle);
  pdf.pairs([
    { label: t("expenses.month.spent"), value: money(spent) },
    ...(cap !== null ? [{ label: t("expenses.budget.overall"), value: money(cap) }] : []),
    ...(earned > 0 ? [{ label: t("expenses.income.total"), value: money(earned) }, { label: t("expenses.income.left"), value: money(left) }] : []),
  ]);
  const recap = categoryRecap(data);
  if (recap.length > 0) {
    pdf.heading(t("expenses.month.byCategory"));
    pdf.pairs(recap.map((line) => ({ label: line.category, value: line.cap ? `${money(line.spent)} / ${money(line.cap)}` : money(line.spent) })));
  }
  pdf.heading(t("expenses.month.list"));
  const lines = pdfLines(data, t, locale, money);
  if (lines.length > 0) pdf.bullets(lines);
  else pdf.paragraph(t("expenses.month.empty.title"));
  const incomes = pdfIncomeLines(data, t, locale, money);
  if (incomes.length > 0) {
    pdf.heading(t("expenses.income.list"));
    pdf.bullets(incomes);
  }
  // The pockets, the money set aside and the activity, when there are some.
  for (const section of pdfMoreSections(data, t, locale, money)) {
    pdf.heading(section.heading);
    if (section.bullets?.length) pdf.bullets(section.bullets);
    if (section.pairs?.length) pdf.pairs(section.pairs);
    if (section.more) {
      pdf.heading(section.more.heading);
      pdf.bullets(section.more.bullets);
    }
  }
  return pdf.finish("Assisteo Agny");
}
