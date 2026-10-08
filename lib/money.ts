// Amounts read on shop screens ("¥221,45", "US $12.99", "1 234,50 €", "88 元"),
// to convert a price paid abroad into ariary.

export type ForeignCurrency = "CNY" | "USD" | "EUR";
export type ForeignAmount = { currency: ForeignCurrency; amount: number };

const currencyOf = (text: string): ForeignCurrency | null => {
  if (/[¥￥元]|\bCNY\b|\bRMB\b/i.test(text)) return "CNY";
  if (/\$|\bUSD\b/i.test(text)) return "USD";
  if (/€|\bEUR\b/i.test(text)) return "EUR";
  return null;
};

/** "1 234,56", "1,234.56", "221,45", "88" → a number; null when there is none. */
export function parseNumber(text: string): number | null {
  const raw = text.match(/\d[\d\s\u00a0\u202f.,']*/)?.[0]?.replace(/[\s\u00a0\u202f']/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalised = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the last one is the decimal mark.
    normalised = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "221,45" is a decimal; "1,234" a thousands separator.
    normalised = raw.length - lastComma - 1 === 3 && raw.indexOf(",") === lastComma ? raw.replace(",", "") : raw.replace(/,/g, ".");
  } else if (lastDot >= 0 && raw.length - lastDot - 1 === 3 && raw.indexOf(".") !== lastDot) {
    normalised = raw.replace(/\./g, "");
  }
  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? value : null;
}

/** A price in yuan, dollars or euros, or null for anything else (ariary, unknown). */
export function parseForeignAmount(text: string | null | undefined): ForeignAmount | null {
  if (!text) return null;
  const currency = currencyOf(text);
  const amount = parseNumber(text);
  return currency && amount !== null && amount > 0 ? { currency, amount } : null;
}

export const currencySymbols: Record<ForeignCurrency, string> = { CNY: "¥", USD: "$", EUR: "€" };
