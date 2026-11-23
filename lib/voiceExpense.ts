import type { BuiltInCategory, PaymentMethod, WalletType } from "@/lib/expenses";

// "Dire ou écrire" in "Mes dépenses": a sentence ("hier 12000 ariary au marché
// en MVola") read on the device, with no AI and no network. It only fills the
// add form, which the user checks before saving, so what isn't recognised
// stays empty: never guessed. Pure, so it can be tested.

export type VoiceExpense = {
  amountMga?: number;
  category?: BuiltInCategory;
  /** A moment of the day it was spent (noon, or now for today). */
  at?: number;
  payment?: PaymentMethod;
  /** The pocket type named ("MVola", "cash"…), when exactly one is. */
  wallet?: WalletType;
  /** What is left of the sentence. */
  note: string;
};

/** Lower case, no accents, same length as the text (so a position found in one is valid in the other). */
function fold(text: string) {
  let out = "";
  for (const char of text) {
    const plain = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += plain.length === char.length ? plain : char;
  }
  return out.replace(/[  ’]/g, (c) => (c === "’" ? "'" : " "));
}

const edge = "(?<![a-z0-9])";
const after = "(?![a-z0-9])";
const word = (source: string, flags = "g") => new RegExp(`${edge}(?:${source})${after}`, flags);

type Span = [number, number];

// ---- Amount ------------------------------------------------------------------------

// "5 000", "45.000", "1,500,000" (groups of three), or "5000", "2,5".
const NUMBER = "\\d{1,3}(?:[ .,]\\d{3})+|\\d+(?:[.,]\\d+)?";
const AMOUNT = new RegExp(`(?<![\\d.,])(${NUMBER})(?:\\s?(k|ar|ariary|ariarys|mga|fmg)${after})?`, "g");
// A number followed by one of these is a quantity, a time or a distance.
const NOT_MONEY = /^\s?(?:kg|g|l|litres?|liters?|m|km|h\d*|jours?|days?|x|fois|pieces?|pcs|%)(?![a-z0-9])/;

function toNumber(raw: string, suffix: string | undefined): number | undefined {
  let digits = raw;
  const grouped = /^\d{1,3}(?:[ .,]\d{3})+$/.test(raw);
  if (grouped) digits = raw.replace(/[ .,]/g, "");
  else digits = raw.replace(",", ".");
  let value = Number(digits);
  if (!Number.isFinite(value)) return undefined;
  if (suffix === "k") value *= 1000;
  value = Math.round(value);
  return value > 0 ? value : undefined;
}

function readAmount(text: string): { value?: number; spans: Span[] } {
  // Times ("à 14h30") and dates ("12/11") are not amounts.
  const blanked = text.replace(/\d{1,2}\s?h(?:\d{2})?(?![a-z0-9])|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/g, (m) => " ".repeat(m.length));
  const found: { value: number; marked: boolean; span: Span }[] = [];
  for (const match of blanked.matchAll(AMOUNT)) {
    const end = match.index + match[0].length;
    if (!match[2] && NOT_MONEY.test(blanked.slice(end))) continue;
    const value = toNumber(match[1], match[2]);
    if (value !== undefined) found.push({ value, marked: Boolean(match[2]), span: [match.index, end] });
  }
  const marked = found.filter((item) => item.marked);
  // One amount with its unit wins; several numbers and nothing to tell them apart: none.
  const chosen = marked.length === 1 ? marked[0] : marked.length === 0 && found.length === 1 ? found[0] : undefined;
  // Numbers not chosen stay in the note, so the user still sees them.
  return chosen ? { value: chosen.value, spans: [chosen.span] } : { spans: [] };
}

// ---- Day ----------------------------------------------------------------------------

const weekdays: [number, string][] = [
  [1, "lundi|monday"],
  [2, "mardi|tuesday"],
  [3, "mercredi|wednesday"],
  [4, "jeudi|thursday"],
  [5, "vendredi|friday"],
  [6, "samedi|saturday"],
  [0, "dimanche|sunday"],
];

const dayAt = (now: Date, back: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12).getTime();

function readDay(text: string, now: Date): { at?: number; spans: Span[] } {
  const rules: { pattern: RegExp; at: () => number }[] = [
    { pattern: word("avant[- ]hier|day before yesterday"), at: () => dayAt(now, 2) },
    { pattern: word("hier(?:\\s+(?:matin|soir|apres[- ]midi))?|yesterday(?:\\s+(?:morning|evening|afternoon))?|last night"), at: () => dayAt(now, 1) },
    {
      pattern: word("aujourd'?\\s?hui|ce matin|ce soir|cet apres[- ]midi|cette nuit|today|this (?:morning|evening|afternoon)|tonight"),
      at: () => now.getTime(),
    },
    // The most recent one in the past: the same weekday as today means a week ago.
    ...weekdays.map(([index, names]) => ({
      pattern: word(`(?:last\\s+)?(?:${names})(?:\\s+(?:dernier|derniere))?`),
      at: () => dayAt(now, (now.getDay() - index + 7) % 7 || 7),
    })),
  ];
  for (const rule of rules) {
    const match = [...text.matchAll(rule.pattern)][0];
    if (match) return { at: rule.at(), spans: [[match.index, match.index + match[0].length]] };
  }
  return { spans: [] };
}

// ---- Pocket -------------------------------------------------------------------------

const pocketRules: { type: WalletType; pattern: RegExp }[] = [
  { type: "orange_money", pattern: word("orange\\s?money|(?:par|en|via|avec|sur|by|with|in)\\s+orange(?!\\s?money)") },
  { type: "airtel_money", pattern: word("airtel\\s?money|(?:par|en|via|avec|sur|by|with|in)\\s+airtel(?!\\s?money)") },
  { type: "mvola", pattern: word("m[- ]?vola") },
  { type: "bank", pattern: word("banque|bank|carte\\s+(?:bancaire|de credit)|(?:bank|credit|debit)\\s+card|visa") },
  { type: "cash", pattern: word("especes?|cash|liquide|en main") },
];

const paymentOf: Record<string, PaymentMethod> = { cash: "cash", bank: "card", mvola: "mobile", orange_money: "mobile", airtel_money: "mobile" };

function readPocket(text: string): { wallet?: WalletType; spans: Span[] } {
  const hits = pocketRules.flatMap((rule) => [...text.matchAll(rule.pattern)].map((match) => ({ type: rule.type, span: [match.index, match.index + match[0].length] as Span })));
  const types = new Set(hits.map((hit) => hit.type));
  // Two pockets named: which one paid is unclear.
  return { wallet: types.size === 1 ? hits[0].type : undefined, spans: hits.map((hit) => hit.span) };
}

// ---- Category -----------------------------------------------------------------------

// Order matters: the most specific first ("credit" before "marche"…).
const categoryRules: { category: BuiltInCategory; pattern: RegExp }[] = [
  { category: "jirama", pattern: word("jirama|electricite|courant|eau et electricite|facture d'?eau|electricity|water bill|power bill|utilities", "") },
  { category: "phone", pattern: word("credit(?!\\s+card)(?: telephone| tel| de communication)?|recharge|forfait|internet|wifi|airtime|phone credit|top[- ]?up", "") },
  { category: "rent", pattern: word("loyer|rent", "") },
  { category: "school", pattern: word("ecolage|ecole|scolarite|frais scolaires?|cantine|cahiers?|fournitures?|universite|tuition|school(?: fees)?|books?", "") },
  { category: "health", pattern: word("pharmacie|medicaments?|medecin|docteur|consultation|hopital|clinique|dentiste|analyses?|pharmacy|medicine|doctor|hospital|clinic|dentist", "") },
  { category: "car", pattern: word("garage|vidange|pneus?|reparation voiture|assurance auto|entretien voiture|car repair|oil change|tyres?|tires?", "") },
  { category: "transport", pattern: word("taxi[- ]?be|taxi|bus|tuk[- ]?tuk|pousse[- ]?pousse|carburant|essence|gasoil|gazoil|diesel|transport|fuel|petrol", "") },
  { category: "market", pattern: word("marche|riz|legumes?|viande|poisson|poulet|zebu|fruits?|pain|courses?|epicerie|supermarche|shoppie|jumbo|manger|repas|restaurant|resto|nourriture|bananes?|lait|oeufs?|huile|sucre|market|groceries|grocery|rice|food|meat|fish|vegetables?|bread|lunch|dinner|breakfast|meal", "") },
  { category: "family", pattern: word("enfants?|bebe|couches?|cadeau|famille|mariage|funerailles|obseques|famadihana|fete|family|kids?|baby|diapers?|gift|wedding", "") },
  { category: "online", pattern: word("netflix|spotify|abonnement|aliexpress|amazon|temu|shein|en ligne|subscription|online", "") },
  { category: "leisure", pattern: word("cinema|sortie|loisirs?|boisson|biere|concert|sport|movies?|drinks?|beer|outing|leisure", "") },
  { category: "savings", pattern: word("epargne|tontine|cotisation|savings?", "") },
];

const readCategory = (text: string): BuiltInCategory | undefined => categoryRules.find((rule) => rule.pattern.test(text))?.category;

// ---- The sentence -------------------------------------------------------------------

// Words that only join the rest: cut from the ends of the note.
const connectors = new Set(
  [
    "de", "du", "des", "d'", "en", "par", "a", "au", "aux", "pour", "avec", "via", "sur", "le", "la", "les", "l'", "un", "une", "et", "j'ai", "jai", "paye", "payee", "depense", "depense", "achete", "pris",
    "of", "for", "to", "at", "on", "in", "by", "with", "paid", "spent", "bought", "the", "an", "i", "and", "my", "ma", "mon", "mes", "ai", "recu", "ce", "cet", "cette", "this", "last", "-",
  ].map((item) => fold(item)),
);

function noteOf(sentence: string, spans: Span[]) {
  let rest = "";
  let from = 0;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (start < from) continue;
    rest += `${sentence.slice(from, start)} `;
    from = end;
  }
  rest += sentence.slice(from);
  const words = rest.split(/\s+/).filter(Boolean);
  const isConnector = (item: string) => connectors.has(fold(item).replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, "")) || /^[^\p{L}\p{N}]+$/u.test(item);
  while (words.length > 0 && isConnector(words[0])) words.shift();
  while (words.length > 0 && isConnector(words[words.length - 1])) words.pop();
  return words.join(" ").replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, "").slice(0, 200);
}

/** Reads a spoken or typed sentence into the values of an expense. */
export function parseVoiceExpense(sentence: string, now: Date = new Date()): VoiceExpense {
  const text = fold(sentence);
  const amount = readAmount(text);
  const day = readDay(text, now);
  const pocket = readPocket(text);
  const category = readCategory(text);
  return {
    ...(amount.value !== undefined && { amountMga: amount.value }),
    ...(category && { category }),
    ...(day.at !== undefined && { at: day.at }),
    ...(pocket.wallet && { wallet: pocket.wallet, payment: paymentOf[pocket.wallet] }),
    note: noteOf(sentence, [...amount.spans, ...day.spans, ...pocket.spans]),
  };
}
