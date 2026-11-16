import { describe, expect, it } from "vitest";
import { dayString } from "@/lib/papers";
import { parseVoiceExpense } from "@/lib/voiceExpense";

// Wednesday 18 November 2026, 9:30.
const now = new Date(2026, 10, 18, 9, 30);
const parse = (sentence: string) => parseVoiceExpense(sentence, now);
const day = (sentence: string) => {
  const { at } = parse(sentence);
  return at === undefined ? undefined : dayString(at);
};

describe("voice expense: amount", () => {
  it.each([
    ["5 000 Ar de taxi-be", 5000],
    ["5 000 Ar taxi", 5000],
    ["5 000 ar taxi", 5000],
    ["45.000 JIRAMA", 45000],
    ["45,000 JIRAMA", 45000],
    ["1 500 000 Ar loyer", 1500000],
    ["loyer 150 000", 150000],
    ["12000 ariary au marché", 12000],
    ["12000ariary au marché", 12000],
    ["5k de taxi", 5000],
    ["5 K taxi", 5000],
    ["2,5k de riz", 2500],
    ["riz 800 ar", 800],
    ["taxi 1500 MGA", 1500],
    ["spent 7,500 Ar on lunch", 7500],
    ["paid 20k for rent", 20000],
  ])("reads %s", (sentence, amount) => {
    expect(parse(sentence).amountMga).toBe(amount);
  });

  it("leaves the amount empty without a number", () => {
    expect(parse("taxi-be ce matin").amountMga).toBeUndefined();
    expect(parse("").amountMga).toBeUndefined();
    expect(parse("j'ai payé le loyer").amountMga).toBeUndefined();
  });

  it("takes the amount marked with its unit among several numbers", () => {
    expect(parse("2 courses de taxi 5000 Ar").amountMga).toBe(5000);
    expect(parse("3 kg de riz 9000 ariary").amountMga).toBe(9000);
  });

  it("leaves the amount empty when two numbers can't be told apart", () => {
    expect(parse("taxi 2000 puis marché 3000").amountMga).toBeUndefined();
    expect(parse("5000 Ar et 3000 Ar").amountMga).toBeUndefined();
  });

  it("does not take a quantity, a time or a date for money", () => {
    expect(parse("3 kg de riz").amountMga).toBeUndefined();
    expect(parse("à 14h30 taxi 2000").amountMga).toBe(2000);
    expect(parse("à 14h 3000 Ar taxi").amountMga).toBe(3000);
    expect(parse("taxi à 14h 12 000 Ar").amountMga).toBe(12000);
    expect(parse("le 12/11 taxi 2000").amountMga).toBe(2000);
    expect(parse("taxi 3 fois").amountMga).toBeUndefined();
  });

  it("keeps the numbers it did not choose in the note", () => {
    expect(parse("taxi 2000 puis marché 3000").note).toContain("3000");
  });
});

describe("voice expense: category", () => {
  it.each([
    ["5 000 Ar de taxi-be", "transport"],
    ["taxi 3000", "transport"],
    ["carburant 20000", "transport"],
    ["essence moto 10k", "transport"],
    ["JIRAMA 45.000", "jirama"],
    ["facture d'eau 8000", "jirama"],
    ["loyer 150 000", "rent"],
    ["au marché 12000", "market"],
    ["riz 2500", "market"],
    ["écolage 80 000", "school"],
    ["pharmacie 6000", "health"],
    ["médicaments 4500", "health"],
    ["crédit téléphone 2000", "phone"],
    ["crédit Airtel 1000", "phone"],
    ["recharge 5000", "phone"],
    ["vidange 40 000", "car"],
    ["cadeau pour maman 15000", "family"],
    ["taxi 3000", "transport"],
    ["bus fare 1500", "transport"],
    ["groceries 30000", "market"],
    ["rent 200k", "rent"],
    ["school fees 100k", "school"],
    ["pharmacy 8000", "health"],
    ["phone credit 2000", "phone"],
  ])("%s -> %s", (sentence, category) => {
    expect(parse(sentence).category).toBe(category);
  });

  it("leaves the category empty when nothing matches", () => {
    expect(parse("5000 Ar").category).toBeUndefined();
    expect(parse("truc bizarre 5000").category).toBeUndefined();
    // "carte" alone must not make a category, only a pocket.
    expect(parse("5000 par carte").category).toBeUndefined();
  });

  it("does not match inside another word", () => {
    expect(parse("barbecue 5000").category).toBeUndefined();
    expect(parse("busy 5000").category).toBeUndefined();
  });
});

describe("voice expense: day", () => {
  it("reads today", () => {
    expect(day("taxi ce matin 3000")).toBe("2026-11-18");
    expect(day("taxi ce soir 3000")).toBe("2026-11-18");
    expect(day("taxi aujourd'hui")).toBe("2026-11-18");
    expect(day("taxi aujourd’hui")).toBe("2026-11-18");
    expect(day("taxi today")).toBe("2026-11-18");
    expect(day("taxi this morning")).toBe("2026-11-18");
  });

  it("reads yesterday and the day before", () => {
    expect(day("hier 12000 ariary au marché")).toBe("2026-11-17");
    expect(day("hier soir taxi 3000")).toBe("2026-11-17");
    expect(day("yesterday taxi 3000")).toBe("2026-11-17");
    expect(day("JIRAMA 45.000 avant-hier")).toBe("2026-11-16");
    expect(day("avant hier taxi")).toBe("2026-11-16");
    expect(day("the day before yesterday taxi")).toBe("2026-11-16");
  });

  it("reads a weekday as the most recent one in the past", () => {
    expect(day("taxi lundi")).toBe("2026-11-16");
    expect(day("taxi mardi")).toBe("2026-11-17");
    // Same weekday as today: a week ago, never today.
    expect(day("taxi mercredi")).toBe("2026-11-11");
    expect(day("taxi vendredi")).toBe("2026-11-13");
    expect(day("taxi dimanche dernier")).toBe("2026-11-15");
    expect(day("taxi on friday")).toBe("2026-11-13");
    expect(day("taxi last monday")).toBe("2026-11-16");
  });

  it("crosses a month", () => {
    expect(dayString(parseVoiceExpense("taxi hier", new Date(2026, 11, 1, 8)).at!)).toBe("2026-11-30");
  });

  it("leaves the day empty when none is said", () => {
    expect(parse("taxi 3000").at).toBeUndefined();
    expect(parse("hierarchie 3000").at).toBeUndefined();
  });
});

describe("voice expense: pocket", () => {
  it.each([
    ["hier 12000 ariary au marché en MVola", "mvola", "mobile"],
    ["taxi 3000 par M-Vola", "mvola", "mobile"],
    ["JIRAMA 45.000 payé par Orange Money avant-hier", "orange_money", "mobile"],
    ["taxi 2000 en Orange", "orange_money", "mobile"],
    ["riz 3000 par Airtel Money", "airtel_money", "mobile"],
    ["riz 3000 payé en espèces", "cash", "cash"],
    ["taxi 1000 cash", "cash", "cash"],
    ["loyer 300 000 par la banque", "bank", "card"],
    ["pharmacie 20000 par carte bancaire", "bank", "card"],
    ["pharmacie 20000 by bank card", "bank", "card"],
    ["lunch 8000 paid with MVola", "mvola", "mobile"],
  ])("%s", (sentence, wallet, payment) => {
    expect(parse(sentence)).toMatchObject({ wallet, payment });
  });

  it("does not take an operator for a pocket when it is the thing bought", () => {
    const result = parse("crédit Orange 2000");
    expect(result.wallet).toBeUndefined();
    expect(result.category).toBe("phone");
    expect(parse("crédit Airtel 1000").wallet).toBeUndefined();
  });

  it("does not take a top-up card for a bank card, nor a credit card for phone credit", () => {
    expect(parse("carte de recharge 5000").wallet).toBeUndefined();
    expect(parse("5000 par carte").wallet).toBeUndefined();
    const credit = parse("5000 by credit card");
    expect(credit.category).toBeUndefined();
    expect(credit.wallet).toBe("bank");
    expect(parse("credit telephone 2000").category).toBe("phone");
  });

  it("leaves the pocket empty when two are named", () => {
    const result = parse("5000 en MVola ou en espèces");
    expect(result.wallet).toBeUndefined();
    expect(result.payment).toBeUndefined();
  });

  it("leaves the pocket empty when none is named", () => {
    expect(parse("taxi 3000").wallet).toBeUndefined();
    expect(parse("taxi 3000").payment).toBeUndefined();
  });
});

describe("voice expense: note", () => {
  it("keeps the rest of the sentence", () => {
    expect(parse("5 000 Ar de taxi-be ce matin").note).toBe("taxi-be");
    expect(parse("hier 12000 ariary au marché en MVola").note).toBe("marché");
    expect(parse("loyer 150 000").note).toBe("loyer");
    expect(parse("JIRAMA 45.000 payé par Orange Money avant-hier").note).toBe("JIRAMA");
    expect(parse("5000 Ar pour le cadeau de Hery").note).toBe("cadeau de Hery");
  });

  it("keeps the whole sentence when nothing is recognised", () => {
    expect(parse("trucs bizarres").note).toBe("trucs bizarres");
  });

  it("is empty when everything was recognised", () => {
    expect(parse("5000 Ar ce matin").note).toBe("");
    expect(parse("").note).toBe("");
  });

  it("keeps the user's own capitals and accents", () => {
    expect(parse("Écolage de Miora 80 000 Ar").note).toBe("Écolage de Miora");
  });

  it("never goes beyond the form's 200 characters", () => {
    expect(parse(`taxi ${"a".repeat(400)}`).note.length).toBeLessThanOrEqual(200);
  });
});

describe("voice expense: whole sentences", () => {
  it("fills everything it can", () => {
    expect(parse("hier 12000 ariary au marché en MVola")).toMatchObject({ amountMga: 12000, category: "market", wallet: "mvola", payment: "mobile" });
    expect(parse("JIRAMA 45.000 payé par Orange Money avant-hier")).toMatchObject({ amountMga: 45000, category: "jirama", wallet: "orange_money" });
    expect(day("JIRAMA 45.000 payé par Orange Money avant-hier")).toBe("2026-11-16");
  });

  it("fills nothing from a sentence with nothing to read", () => {
    expect(parse("bonjour")).toEqual({ note: "bonjour" });
  });
});
