import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ADMIN_LOG_MAX, logAdminAction, readAdminLog } from "@/lib/server/adminLog";
import { inPaymentPeriod, payments, paymentsByMethod, paymentsByMonth, paymentsWorkbook } from "@/lib/paymentExport";
import type { Subscription } from "@/lib/plans";
import fr from "@/locales/fr.json";

// Reads "admin.export.columns.date" from the French texts.
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr);
  return typeof text === "string" ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? "")) : key;
};

const row = (id: string, patch: Partial<Subscription>): Subscription => ({
  id,
  email: `${id}@example.com`,
  plan: "lite",
  startsAt: "2026-10-01T08:00:00.000Z",
  endsAt: "2026-11-01T08:00:00.000Z",
  amountMga: 5000,
  paymentMethod: "mvola",
  paymentRef: null,
  note: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  ...patch,
});

const rows = [
  // Ends at midnight on 1 November: 31 October is its last day.
  row("a", { endsAt: new Date(2026, 10, 1).toISOString() }),
  row("b", { plan: "premium", amountMga: 15000, paymentMethod: "orange", createdAt: "2026-10-12T09:00:00.000Z", paymentRef: "OM-77" }),
  row("c", { amountMga: 5000, createdAt: "2026-09-20T09:00:00.000Z", paymentMethod: null }),
  // Offered: not a payment.
  row("d", { plan: "unlimited", amountMga: null, endsAt: null, createdAt: "2026-10-05T09:00:00.000Z" }),
  row("e", { amountMga: 0, createdAt: "2026-10-06T09:00:00.000Z" }),
];

describe("accounting export", () => {
  it("keeps only the records with money in, oldest first", () => {
    expect(payments(rows).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("adds up per month and plan, and per payment method", () => {
    expect(paymentsByMonth(rows)).toEqual([
      { month: "2026-09", count: 1, byPlan: { lite: 5000 }, totalMga: 5000 },
      { month: "2026-10", count: 2, byPlan: { lite: 5000, premium: 15000 }, totalMga: 20000 },
    ]);
    expect(paymentsByMethod(rows)).toEqual([
      { method: "orange", count: 1, totalMga: 15000 },
      { method: "mvola", count: 1, totalMga: 5000 },
      { method: null, count: 1, totalMga: 5000 },
    ]);
  });

  it("picks a period by the day the payment was recorded", () => {
    const now = new Date(2026, 9, 15, 12).getTime();
    expect(rows.filter((item) => inPaymentPeriod(item, "month", now)).map((item) => item.id)).toEqual(["a", "b", "d", "e"]);
    expect(rows.filter((item) => inPaymentPeriod(item, "lastMonth", now)).map((item) => item.id)).toEqual(["c"]);
    expect(rows.filter((item) => inPaymentPeriod(item, "year", now))).toHaveLength(5);
  });

  it("writes the payments, the months and the methods, with totals", async () => {
    const bytes = await paymentsWorkbook(rows, t, { title: "Paiements · 2026", subtitle: "Exporté le 15 oct. 2026" });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);

    const sheet = book.getWorksheet("Paiements")!;
    expect(sheet.getCell("A1").value).toBe("Paiements · 2026");
    expect(sheet.getRow(4).values).toContain("Moyen de paiement");
    expect(sheet.getCell("B7").value).toBe("b@example.com");
    expect(sheet.getCell("C7").value).toBe("Premium");
    expect(sheet.getCell("F7").value).toBe(15000);
    expect(sheet.getCell("F7").numFmt).toBe('#,##0" Ar"');
    expect(sheet.getCell("G7").value).toBe("Orange Money");
    expect(sheet.getCell("H7").value).toBe("OM-77");
    // The last day included: 31 October for an end on 1 November.
    expect((sheet.getCell("E6").value as Date).toISOString().slice(0, 10)).toBe("2026-10-31");
    expect((sheet.getCell("F8").value as { result: number }).result).toBe(25000);

    const months = book.getWorksheet("Par mois")!;
    expect(months.getCell("A6").value).toBe("2026-10");
    expect((months.getCell("E7").value as { result: number }).result).toBe(25000);

    const methods = book.getWorksheet("Par moyen")!;
    expect(methods.getCell("A5").value).toBe("Orange Money");
    expect(methods.getCell("A7").value).toBe("Non précisé");
  });
});

describe("admin action log", () => {
  it("keeps who did what, newest first, and only the latest ones", async () => {
    await logAdminAction("owner", "login");
    await logAdminAction("admin@example.com", "subscription_add", "rado@example.com · lite");
    const [latest, before] = await readAdminLog();
    expect(latest).toMatchObject({ actor: "admin@example.com", action: "subscription_add", detail: "rado@example.com · lite" });
    expect(before).toMatchObject({ actor: "owner", action: "login" });
    for (let index = 0; index < ADMIN_LOG_MAX + 5; index += 1) await logAdminAction("owner", "plans_save");
    expect(await readAdminLog()).toHaveLength(ADMIN_LOG_MAX);
  });
});
