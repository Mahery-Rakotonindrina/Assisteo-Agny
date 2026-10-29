import type { Locale } from "@/i18n.config";

// An amount written out in words, for papers where the figures alone could
// be changed (the debt acknowledgment of "Prêts"): "cent vingt mille ariary".
// French follows the traditional spelling: "vingt et un", "quatre-vingts",
// "deux cents", "deux cent mille", "deux millions". Whole numbers only.

const FR_UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const FR_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/** 0 to 99; `last` when nothing follows but a noun (million) or the end, so "quatre-vingts" takes its s. */
function frBelow100(n: number, last: boolean): string {
  if (n < 17) return FR_UNITS[n];
  if (n < 20) return `dix-${FR_UNITS[n - 10]}`;
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (tens <= 6) return unit === 0 ? FR_TENS[tens] : unit === 1 ? `${FR_TENS[tens]} et un` : `${FR_TENS[tens]}-${FR_UNITS[unit]}`;
  if (tens === 7) return unit === 1 ? "soixante et onze" : `soixante-${frBelow100(10 + unit, last)}`;
  if (tens === 8) return unit === 0 ? `quatre-vingt${last ? "s" : ""}` : `quatre-vingt-${FR_UNITS[unit]}`;
  return `quatre-vingt-${frBelow100(10 + unit, last)}`;
}

function frBelow1000(n: number, last: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return frBelow100(rest, last);
  const head = hundreds === 1 ? "cent" : `${FR_UNITS[hundreds]} cent`;
  if (rest === 0) return `${head}${hundreds > 1 && last ? "s" : ""}`;
  return `${head} ${frBelow100(rest, last)}`;
}

function frenchWords(n: number) {
  if (n === 0) return FR_UNITS[0];
  const parts: string[] = [];
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  // "milliard" and "million" are nouns: what comes before them agrees.
  if (billions) parts.push(`${frenchWords(billions)} milliard${billions > 1 ? "s" : ""}`);
  if (millions) parts.push(`${frBelow1000(millions, true)} million${millions > 1 ? "s" : ""}`);
  // "mille" never takes an s, nor does what comes before it.
  if (thousands) parts.push(thousands === 1 ? "mille" : `${frBelow1000(thousands, false)} mille`);
  if (rest) parts.push(frBelow1000(rest, true));
  return parts.join(" ");
}

const EN_UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enBelow1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const tail = rest < 20 ? EN_UNITS[rest] : `${EN_TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${EN_UNITS[rest % 10]}` : ""}`;
  if (hundreds === 0) return tail;
  return rest === 0 ? `${EN_UNITS[hundreds]} hundred` : `${EN_UNITS[hundreds]} hundred ${tail}`;
}

function englishWords(n: number): string {
  if (n === 0) return EN_UNITS[0];
  const scales: Array<[number, string]> = [
    [1e9, "billion"],
    [1e6, "million"],
    [1000, "thousand"],
  ];
  const parts: string[] = [];
  let left = n;
  for (const [size, name] of scales) {
    const count = Math.floor(left / size);
    if (count) parts.push(`${size === 1e9 ? englishWords(count) : enBelow1000(count)} ${name}`);
    left %= size;
  }
  if (left) parts.push(enBelow1000(left));
  return parts.join(" ");
}

/** A whole number in words ("vingt et un", "twenty-one"); negatives and fractions are rounded off to their size. */
export function numberInWords(value: number, locale: Locale) {
  const n = Math.abs(Math.round(Number.isFinite(value) ? value : 0));
  return locale === "fr" ? frenchWords(n) : englishWords(n);
}

/** "cent vingt mille ariary". */
export function amountInWords(valueMga: number, locale: Locale) {
  return `${numberInWords(valueMga, locale)} ariary`;
}
