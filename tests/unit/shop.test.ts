import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { customerDebts, dayAndMonth, lowStock, reminderLink, saleRest, saleTotal, totalOwed, type ShopRecord } from "@/lib/shop";
import { resetScreen } from "@/services/screenReset";
import { shopStore } from "@/services/shopStore";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

const NOW = new Date(2026, 10, 5, 15, 0).getTime();
const base = { createdAt: 1, updatedAt: 1 };
const sale = (id: string, fields: Partial<Extract<ShopRecord, { kind: "sale" }>>): ShopRecord => ({ ...base, kind: "sale", id, at: NOW, name: "Riz", qty: 1, unitPriceMga: 1000, paidMga: 1000, ...fields });
const payment = (id: string, customer: string, amountMga: number, at = NOW): ShopRecord => ({ ...base, kind: "payment", id, at, customer, amountMga });

describe("totals", () => {
  const records: ShopRecord[] = [
    sale("a", { qty: 2, unitPriceMga: 18000, paidMga: 36000 }),
    sale("b", { qty: 1, unitPriceMga: 10000, paidMga: 4000, customer: "Rado" }),
    sale("old", { at: new Date(2026, 10, 1, 9).getTime(), unitPriceMga: 5000, paidMga: 5000 }),
    sale("lastMonth", { at: new Date(2026, 9, 30, 9).getTime(), unitPriceMga: 9000, paidMga: 9000 }),
    payment("p", "Rado", 2000),
    { ...sale("gone", { unitPriceMga: 99999, paidMga: 99999 }), deletedAt: 5 },
  ];

  it("adds up the day: sold, cashed in (payments too) and left on credit", () => {
    const { day } = dayAndMonth(records, NOW);
    expect(day).toEqual({ sales: 2, soldMga: 46000, collectedMga: 36000 + 4000 + 2000, creditMga: 6000 });
  });

  it("adds up the month, nothing from last month", () => {
    const { month } = dayAndMonth(records, NOW);
    expect(month.sales).toBe(3);
    expect(month.soldMga).toBe(51000);
  });

  it("rounds a sale of a fraction of a unit to the ariary", () => {
    expect(saleTotal({ qty: 2.5, unitPriceMga: 1333 })).toBe(3333);
    expect(saleRest({ qty: 1, unitPriceMga: 1000, paidMga: 5000 })).toBe(0);
  });
});

describe("customers' credit", () => {
  it("says who owes what, less their payments, the most first", () => {
    const records: ShopRecord[] = [
      sale("1", { customer: "Rado", unitPriceMga: 10000, paidMga: 0, phone: "034 00 000 00" }),
      sale("2", { customer: "rado ", unitPriceMga: 5000, paidMga: 0 }),
      sale("3", { customer: "Soa", unitPriceMga: 20000, paidMga: 5000 }),
      sale("4", { customer: "Lalao", unitPriceMga: 3000, paidMga: 0 }),
      payment("p1", "RADO", 15000),
      payment("p2", "Lalao", 3000),
    ];
    const debts = customerDebts(records);
    expect(debts.map((debt) => [debt.name, debt.owedMga])).toEqual([["Soa", 15000]]);
    const more = customerDebts([...records, sale("5", { customer: "Rado", unitPriceMga: 1000, paidMga: 0 })]);
    expect(more.map((debt) => [debt.key, debt.owedMga])).toEqual([["soa", 15000], ["rado", 1000]]);
    expect(more.find((debt) => debt.key === "rado")?.phone).toBe("034 00 000 00");
    expect(totalOwed(more)).toBe(16000);
  });

  it("makes a WhatsApp link to the number when it is usable, else to the chat picker", () => {
    expect(reminderLink("034 12 345 67", "Bonjour")).toBe("https://wa.me/261341234567?text=Bonjour");
    expect(reminderLink(undefined, "a b")).toBe("https://wa.me/?text=a%20b");
  });
});

describe("the stock alert", () => {
  it("lists the products at or below their alert, the emptiest first", () => {
    const product = (id: string, name: string, stock: number, lowAt = 3): ShopRecord => ({ ...base, kind: "product", id, name, stock, lowAt });
    expect(lowStock([product("a", "Riz", 10), product("b", "Huile", 3), product("c", "Sucre", 0), product("d", "Sel", 6, 6)]).map((item) => item.name)).toEqual(["Sucre", "Huile", "Sel"]);
  });
});

describe("the shop store", () => {
  beforeEach(async () => shopStore.wipe());

  it("takes a sale off the stock, and puts it back when the sale is removed", async () => {
    const product = (await shopStore.saveProduct({ name: "Riz 5 kg", stock: 10, priceMga: 18000 }))!;
    const sold = (await shopStore.addSale({ productId: product.id, name: product.name, qty: 4, unitPriceMga: 18000 }))!;
    expect(sold.paidMga).toBe(72000);
    expect((await shopStore.list()).find((record) => record.id === product.id)).toMatchObject({ stock: 6 });
    await shopStore.remove(sold.id);
    expect((await shopStore.list()).find((record) => record.id === product.id)).toMatchObject({ stock: 10 });
    expect((await shopStore.list()).some((record) => record.kind === "sale")).toBe(false);
  });

  it("never goes below zero stock", async () => {
    const product = (await shopStore.saveProduct({ name: "Sel", stock: 1 }))!;
    await shopStore.addSale({ productId: product.id, name: "Sel", qty: 5, unitPriceMga: 500 });
    expect((await shopStore.list()).find((record) => record.id === product.id)).toMatchObject({ stock: 0 });
  });

  it("refuses a sale without a price, a quantity, or a customer for what is left to pay", async () => {
    expect(await shopStore.addSale({ name: "Riz", qty: 0, unitPriceMga: 1000 })).toBeNull();
    expect(await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 0 })).toBeNull();
    expect(await shopStore.addSale({ name: "", qty: 1, unitPriceMga: 1000 })).toBeNull();
    expect(await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 1000, paidMga: 200 })).toBeNull();
    expect(await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 1000, paidMga: 200, customer: "Rado" })).toMatchObject({ paidMga: 200, customer: "Rado" });
    expect(await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 1000, paidMga: 99999 })).toMatchObject({ paidMga: 1000 });
  });

  it("collects a payment, at most what is owed, and nothing from someone who owes nothing", async () => {
    await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 10000, paidMga: 0, customer: "Rado" });
    expect(await shopStore.addPayment("Soa", 1000)).toBeNull();
    const payment = (await shopStore.addPayment("rado", 99999))!;
    expect(payment.amountMga).toBe(10000);
    expect(customerDebts(await shopStore.list())).toEqual([]);
    expect(await shopStore.addPayment("Rado", 1)).toBeNull();
  });

  it("stores no purchase price or margin", async () => {
    await shopStore.saveProduct({ name: "Riz", stock: 3, priceMga: 1000 });
    await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 1000 });
    expect(JSON.stringify(await shopStore.list())).not.toMatch(/cost|margin|profit|purchase|buy/i);
  });

  it("is emptied by the screen reset", async () => {
    await shopStore.saveProduct({ name: "Riz", stock: 3 });
    await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 1000 });
    await resetScreen("shop");
    expect(await shopStore.list()).toEqual([]);
  });

  it("keeps tombstones for the sync when signed in", async () => {
    shopStore.setKeepTombstones(true);
    const sold = (await shopStore.addSale({ name: "Riz", qty: 1, unitPriceMga: 1000 }))!;
    await shopStore.remove(sold.id);
    shopStore.setKeepTombstones(false);
    expect(await shopStore.list()).toEqual([]);
    expect((await shopStore.raw()).find((record) => record.id === sold.id)?.deletedAt).toBeTruthy();
  });
});

describe("texts", () => {
  it("has the reminder and the sale line in both languages", () => {
    for (const dictionary of [fr, en]) {
      expect(dictionary.shop.credit.message).toContain("{name}");
      expect(dictionary.shop.credit.message).toContain("{amount}");
      expect(dictionary.shop.sale.line).toContain("{qty}");
    }
  });
});
