import { clear, createStore, del, get, set, values } from "idb-keyval";
import {
  allocatePayment,
  byKind,
  cleanMoney,
  cleanQty,
  customerDebts,
  customerKey,
  DEFAULT_LOW_STOCK,
  saleTotal,
  type ShopPayment,
  type ShopProduct,
  type ShopRecord,
  type ShopSale,
} from "@/lib/shop";
import { createId } from "./historyStore";
import { removeRecords } from "./storeRemoval";
import { forgetSyncCursor } from "./syncCursor";

// "Ma boutique": the products in stock, the sales and the customers' payments,
// one record each. Local-first like the garage; synced with the account
// (services/shopSync.ts, table "shop"). The logic lives in lib/shop.ts.

export type { ShopRecord } from "@/lib/shop";

let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore("assisteo-shop", "shop"));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Signed in, deletions are kept until synced so they reach the other devices.
let keepTombstones = false;

async function write(record: ShopRecord) {
  await set(record.id, { ...record, updatedAt: Date.now(), dirty: true }, db());
  notify();
}

const cleanText = (text: string | undefined, max: number) => text?.trim().slice(0, max) || undefined;

/** A stock quantity: 0 or more, up to 2 decimals. */
const cleanStock = (value: number | undefined) => (value === undefined ? null : value === 0 ? 0 : cleanQty(value));

export type ProductDraft = { id?: string; name: string; stock: number; lowAt?: number; priceMga?: number };
export type SaleDraft = { at?: number; productId?: string; name: string; qty: number; unitPriceMga: number; paidMga?: number; customer?: string; phone?: string };

async function liveProduct(id: string | undefined) {
  if (!id) return undefined;
  const product = await get<ShopProduct>(id, db());
  return product && !product.deletedAt ? product : undefined;
}

export const shopStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async list(): Promise<ShopRecord[]> {
    return (await values<ShopRecord>(db())).filter((record) => !record.deletedAt);
  },

  /** A product, new or changed; null when its name or numbers are unusable. */
  async saveProduct(draft: ProductDraft): Promise<ShopProduct | null> {
    const name = cleanText(draft.name, 60);
    const stock = cleanStock(draft.stock);
    const lowAt = draft.lowAt === undefined ? DEFAULT_LOW_STOCK : cleanStock(draft.lowAt);
    const priceMga = draft.priceMga === undefined ? undefined : cleanMoney(draft.priceMga);
    if (!name || stock === null || lowAt === null || priceMga === null) return null;
    const now = Date.now();
    const existing = await liveProduct(draft.id);
    const product: ShopProduct = { kind: "product", id: existing?.id ?? createId(), name, stock, lowAt, ...(priceMga ? { priceMga } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now };
    await write(product);
    return product;
  },

  /** Adds (or, negative, takes off) stock, never below 0. */
  async adjustStock(id: string, delta: number) {
    const product = await liveProduct(id);
    if (!product || !Number.isFinite(delta)) return;
    await write({ ...product, stock: Math.max(0, Math.round((product.stock + delta) * 100) / 100) });
  },

  /**
   * A sale. Refused (null) without a name, a quantity or a price, or when part
   * of it is left to pay without a customer to owe it. Takes the quantity off
   * the product's stock (never below 0).
   */
  async addSale(draft: SaleDraft): Promise<ShopSale | null> {
    const name = cleanText(draft.name, 60);
    const qty = cleanQty(draft.qty);
    const unitPriceMga = cleanMoney(draft.unitPriceMga);
    if (!name || qty === null || unitPriceMga === null || unitPriceMga === 0) return null;
    const total = saleTotal({ qty, unitPriceMga });
    const paid = draft.paidMga === undefined ? total : cleanMoney(draft.paidMga);
    if (paid === null) return null;
    const paidMga = Math.min(paid, total);
    const customer = cleanText(draft.customer, 60);
    if (paidMga < total && !customer) return null;
    const now = Date.now();
    const product = await liveProduct(draft.productId);
    const phone = cleanText(draft.phone, 30);
    const sale: ShopSale = {
      kind: "sale",
      id: createId(),
      at: draft.at ?? now,
      ...(product && { productId: product.id }),
      name,
      qty,
      unitPriceMga,
      paidMga,
      ...(customer && { customer }),
      ...(customer && phone && { phone }),
      createdAt: now,
      updatedAt: now,
    };
    // Only what the stock really had comes off it (and goes back if the sale is removed).
    const stockTaken = product ? Math.min(qty, product.stock) : 0;
    const recorded: ShopSale = product ? { ...sale, stockTaken } : sale;
    await write(recorded);
    if (product) await write({ ...product, stock: Math.round((product.stock - stockTaken) * 100) / 100 });
    return recorded;
  },

  /** A payment from a customer; at most what they owe. Null when they owe nothing. */
  async addPayment(customer: string, amountMga: number, at = Date.now()): Promise<ShopPayment | null> {
    const amount = cleanMoney(amountMga);
    const debt = customerDebts(await shopStore.list()).find((item) => item.key === customerKey(customer));
    if (!amount || !debt) return null;
    const now = Date.now();
    const paid = Math.min(amount, debt.owedMga);
    const payment: ShopPayment = { kind: "payment", id: createId(), at, customer: debt.name, amountMga: paid, applied: allocatePayment(await shopStore.list(), debt.name, paid), createdAt: now, updatedAt: now };
    await write(payment);
    return payment;
  },

  /**
   * Removes a sale (what it took off the stock goes back, and the payments
   * that only paid it go with it), a payment or a product.
   */
  async remove(id: string) {
    const current = await get<ShopRecord>(id, db());
    if (!current || current.deletedAt) return;
    if (current.kind === "sale") {
      await shopStore.adjustStock(current.productId ?? "", current.stockTaken ?? current.qty);
      for (const payment of byKind(await shopStore.list(), "payment")) {
        if (payment.applied?.length && payment.applied.every((part) => part.saleId === id)) await shopStore.remove(payment.id);
      }
    }
    if (keepTombstones) await write({ ...current, deletedAt: Date.now() });
    else {
      await del(id, db());
      notify();
    }
  },

  /** "Remettre à zéro": the whole book (synced like any removal). */
  async removeAll() {
    await removeRecords(db(), (await values<ShopRecord>(db())).filter((record) => !record.deletedAt), keepTombstones);
    notify();
  },

  // ---- For the sync engine -----------------------------------------------------

  setKeepTombstones(value: boolean) {
    keepTombstones = value;
  },
  raw: () => values<ShopRecord>(db()),
  rawGet: (id: string) => get<ShopRecord>(id, db()),
  async rawPut(record: ShopRecord) {
    await set(record.id, record, db());
  },
  async rawDelete(id: string) {
    await del(id, db());
  },
  notify,
  /** Signing out or deleting the account. */
  async wipe() {
    await clear(db());
    // The next sync reads everything again.
    forgetSyncCursor("shop");
    notify();
  },
};

/** Tests and the screen: the products, from a list of records. */
export const productsOf = (records: ShopRecord[]) => byKind(records, "product").sort((a, b) => a.name.localeCompare(b.name));
