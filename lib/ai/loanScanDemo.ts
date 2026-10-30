import type { LoanReading } from "./schema";

// Demo mode (no AI key on the server, end-to-end tests): the debt
// acknowledgment "read" from any photo. Names stay as written, whatever the language.

export function mockLoanReading(locale: "fr" | "en"): LoanReading {
  return {
    isAcknowledgment: true,
    lender: "Rasoa Marie",
    borrower: "Rakoto Jean",
    amountFigures: 150000,
    amountWords: locale === "fr" ? "cent cinquante mille ariary" : "one hundred and fifty thousand ariary",
    amountWordsValue: 150000,
    date: "2026-10-15",
    dueDate: "2026-12-15",
    installments: [],
    interest: null,
    place: "Antananarivo",
  };
}
