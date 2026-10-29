import type { Locale } from "@/i18n.config";
import { amountInWords } from "@/lib/amountWords";
import { formatAriary, formatDate } from "@/lib/format";
import { loanSides } from "@/lib/loanReport";
import { loanInterest, loanPaid, loanRemaining, loanTotal, personKey, type Loan } from "@/lib/loans";
import { pdfFileName, PdfWriter } from "@/lib/pdf";
import { shareFile } from "./fileShare";

// "Prêts" as PDFs: the debt acknowledgment of one loan ("Reconnaissance de
// dette"), and the recap per person. Handed to the share sheet, or downloaded.

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A name left empty: a line to write it by hand. */
const BLANK = "____________________";

export type Acknowledgment = {
  title: string;
  paragraphs: string[];
  /** The installments, when paid back in several times. */
  installments: string[];
  /** "Fait à …, le …" */
  signedAt: string;
  signatures: [string, string];
  /** The title of each proof joined in annex, one page each. */
  annexes: string[];
};

/**
 * What the debt acknowledgment says. `me` is the user (from the account,
 * corrected in the sheet): the lender when they lent, the borrower when they
 * borrowed. The amount owed is the total to pay back, in figures and words.
 * `annexCount` proofs follow, each on a page of its own.
 */
export function acknowledgment(loan: Loan, names: { me: string; place: string }, now: number, t: Translate, locale: Locale, annexCount = 0): Acknowledgment {
  const money = (value: number) => formatAriary(value, locale);
  const me = names.me.trim() || BLANK;
  const other = loan.person.trim() || BLANK;
  const [debtor, creditor] = loan.direction === "lent" ? [other, me] : [me, other];
  const total = loanTotal(loan);
  const interest = loanInterest(loan);
  const paid = loanPaid(loan);
  const date = formatDate(loan.at, locale);
  const paragraphs = [
    t("loans.ack.owe", {
      debtor,
      creditor,
      words: amountInWords(total, locale),
      amount: money(total),
    }),
    interest > 0
      ? t("loans.ack.withInterest", {
          amount: money(loan.amountMga),
          date,
          interest: money(interest),
        })
      : t("loans.ack.lentOn", { date }),
  ];
  const schedule = loan.schedule ?? [];
  if (schedule.length > 0) paragraphs.push(t("loans.ack.schedule", { count: schedule.length }));
  else if (loan.dueAt !== undefined) paragraphs.push(t("loans.ack.dueOn", { date: formatDate(loan.dueAt, locale) }));
  else paragraphs.push(t("loans.ack.noDue"));
  if (paid > 0)
    paragraphs.push(
      t("loans.ack.alreadyPaid", {
        paid: money(paid),
        left: money(loanRemaining(loan)),
      }),
    );
  return {
    title: t("loans.ack.title"),
    paragraphs,
    installments: schedule.map((item) =>
      t("loans.ack.installment", {
        amount: money(item.amountMga),
        date: formatDate(item.dueAt, locale),
      }),
    ),
    signedAt: t("loans.ack.signedAt", {
      place: names.place.trim() || BLANK,
      date: formatDate(now, locale),
    }),
    signatures: [t("loans.ack.signDebtor", { name: debtor }), t("loans.ack.signCreditor", { name: creditor })],
    annexes: Array.from({ length: annexCount }, (_, index) => t("loans.ack.annex", { number: index + 1 })),
  };
}

/** "Reconnaissance de dette (PDF)", with the proofs' photos (`annexes`, data URLs) in annex. */
export async function exportAcknowledgment(loan: Loan, names: { me: string; place: string }, now: number, t: Translate, locale: Locale, annexes: string[] = []) {
  const text = acknowledgment(loan, names, now, t, locale, annexes.length);
  const pdf = await PdfWriter.create();
  pdf.title(text.title);
  pdf.space(6);
  for (const paragraph of text.paragraphs) pdf.paragraph(paragraph);
  if (text.installments.length) pdf.bullets(text.installments);
  pdf.space(4);
  pdf.paragraph(text.signedAt);
  pdf.space(4);
  pdf.signatures(text.signatures);
  annexes.forEach((image, index) => {
    pdf.newPage();
    pdf.subtitle(text.annexes[index]);
    pdf.image(image, 240);
  });
  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(`${t("loans.ack.file")}-${loan.person}`), bytes, "application/pdf", text.title);
}

/** The recap per way, then per person: what each one owes (or is owed), then their loans. Each way has its own totals. */
export async function exportLoansPdf(loans: Loan[], now: number, heading: { title: string; subtitle: string; file: string }, t: Translate, locale: Locale) {
  const money = (value: number) => formatAriary(value, locale);
  const pdf = await PdfWriter.create();
  pdf.title(heading.title);
  pdf.caption(heading.subtitle);
  for (const { direction, rows, people, totals } of loanSides(loans, now)) {
    pdf.heading(t(`loans.directions.${direction}`));
    pdf.pairs([
      { label: t(`loans.export.totalBy.${direction}`), value: money(totals.totalMga) },
      { label: t("loans.export.columns.paidMga"), value: money(totals.paidMga) },
      { label: t("loans.export.columns.remainingMga"), value: money(totals.remainingMga) },
    ]);
    pdf.rule();
    for (const person of people) {
      pdf.subtitle(person.name);
      pdf.pairs([
        { label: t("loans.export.columns.totalMga"), value: money(person.totalMga) },
        { label: t("loans.export.columns.paidMga"), value: money(person.paidMga) },
        { label: t("loans.export.columns.remainingMga"), value: money(person.remainingMga) },
        ...(person.lateMga > 0 ? [{ label: t("loans.export.columns.lateMga"), value: money(person.lateMga) }] : []),
      ]);
      pdf.bullets(
        rows
          .filter((row) => personKey(row.person) === personKey(person.name))
          .map((row) => t("loans.export.line", { date: formatDate(row.at, locale), total: money(row.totalMga), left: money(row.remainingMga), status: t(`loans.export.status.${row.status}`) })),
      );
      pdf.rule();
    }
  }
  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(heading.file), bytes, "application/pdf", heading.title);
}
