import { motion } from "motion/react";
import { useState } from "react";
import { AlertTriangle, MessageCircle, PackagePlus, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ExpenseSheet } from "@/components/Expenses/ExpenseSheet";
import { PlanLock } from "@/components/PlanLock";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Seo } from "@/components/Seo";
import { PaymentForm, ProductForm, SaleForm } from "@/components/Shop";
import styles from "@/components/Shop/Shop.module.scss";
import { useNow } from "@/hooks/useNow";
import { usePlan } from "@/hooks/usePlan";
import { useShop } from "@/hooks/useShop";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatTime } from "@/lib/format";
import { rise, stagger } from "@/lib/motion";
import { byKind, customerDebts, dayAndMonth, lowStock, reminderLink, saleRest, saleTotal, salesOfDay, totalOwed, type CustomerDebt, type ShopProduct } from "@/lib/shop";
import { shopStore } from "@/services/shopStore";

type Tab = "sales" | "stock" | "credit";
type Sheet = { kind: "sale" } | { kind: "product"; product?: ShopProduct } | { kind: "payment"; debt: CustomerDebt } | null;

/**
 * "Ma boutique" (Pro): the day's sales, the stock with its low alert, the
 * customers' credit with a WhatsApp reminder, and the totals of the day and
 * the month. Local first, synced with the account. No purchase price is kept:
 * nothing here shows a margin.
 */
export default function ShopPage() {
  const { t, locale } = useTranslation();
  const { plan, has, planFor } = usePlan();
  // Until the plan is read (cache or server), no lock: a subscriber would see it flash.
  const known = plan !== null;
  const now = useNow(60_000);
  const { records, isLoading } = useShop();
  const [tab, setTab] = useState<Tab>("sales");
  const [sheet, setSheet] = useState<Sheet>(null);
  // The sale whose removal waits for a confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  const money = (value: number) => formatAriary(value, locale);

  const { day, month } = dayAndMonth(records, now);
  const sales = salesOfDay(records, now);
  const products = byKind(records, "product").sort((a, b) => a.name.localeCompare(b.name));
  const low = lowStock(records);
  const debts = customerDebts(records);
  const customers = [...new Set(byKind(records, "sale").flatMap((sale) => (sale.customer ? [sale.customer] : [])))];
  const planName = t(`plans.names.${planFor("shop") ?? "pro"}`);

  const reminder = (debt: CustomerDebt) => reminderLink(debt.phone, t("shop.credit.message", { name: debt.name, amount: money(debt.owedMga) }));
  const close = () => setSheet(null);
  const sheetTitle = sheet?.kind === "sale" ? t("shop.sale.title") : sheet?.kind === "product" ? t(sheet.product ? "shop.product.editTitle" : "shop.product.addTitle") : sheet?.kind === "payment" ? t("shop.credit.title") : "";

  return (
    <>
      <Seo title={`${t("shop.title")} · ${t("meta.title")}`} noindex />
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("shop.title")}</h1>
          <p>{t("shop.subtitle")}</p>
        </motion.header>

        {!known ? null : !has("shop") ? (
          <motion.div variants={rise}>
            <PlanLock plan={planFor("shop")} text={t("shop.locked", { plan: planName })} />
          </motion.div>
        ) : (
          <>
            <motion.section variants={rise} className={styles.totals} aria-label={t("shop.totals.label")} data-testid="shop-totals">
              <div className={styles.total}>
                <small>{t("shop.totals.today")}</small>
                <strong data-testid="day-sold">{money(day.soldMga)}</strong>
                <span>{t("shop.totals.detail", { collected: money(day.collectedMga), credit: money(day.creditMga) })}</span>
              </div>
              <div className={styles.total}>
                <small>{t("shop.totals.month")}</small>
                <strong data-testid="month-sold">{money(month.soldMga)}</strong>
                <span>{t("shop.totals.detail", { collected: money(month.collectedMga), credit: money(month.creditMga) })}</span>
              </div>
              <div className={styles.total}>
                <small>{t("shop.totals.owed")}</small>
                <strong data-testid="total-owed">{money(totalOwed(debts))}</strong>
                <span>{t("shop.totals.owedBy", { count: debts.length })}</span>
              </div>
            </motion.section>

            {low.length > 0 && (
              <motion.div variants={rise} className={styles.alert} role="status" data-testid="low-stock">
                <strong>
                  <AlertTriangle size={16} aria-hidden /> {t("shop.stock.lowTitle", { count: low.length })}
                </strong>
                <span>{low.map((product) => `${product.name} (${product.stock})`).join(", ")}</span>
              </motion.div>
            )}

            <motion.div variants={rise}>
              <SegmentedControl
                ariaLabel={t("shop.title")}
                value={tab}
                onChange={setTab}
                options={[
                  { value: "sales", label: t("shop.tabs.sales") },
                  { value: "stock", label: t("shop.tabs.stock") },
                  { value: "credit", label: t("shop.tabs.credit") },
                ]}
              />
            </motion.div>

            {tab === "sales" && (
              <motion.section variants={rise} className={styles.group}>
                <div className={styles.row}>
                  <Button icon={<Plus />} onClick={() => setSheet({ kind: "sale" })} data-testid="sale-new">
                    {t("shop.sale.new")}
                  </Button>
                </div>
                {sales.length === 0 && !isLoading ? (
                  <EmptyState title={t("shop.sale.emptyTitle")} body={t("shop.sale.emptyBody")} />
                ) : (
                  <ul className={styles.list}>
                    {sales.map((sale) => (
                      <li key={sale.id} className={styles.item} data-testid="sale-line">
                        <div className={styles.line}>
                          <span>
                            <strong>{sale.name}</strong>
                            <small>
                              {t("shop.sale.line", { qty: sale.qty, price: money(sale.unitPriceMga), time: formatTime(sale.at, locale) })}
                              {saleRest(sale) > 0 && sale.customer ? ` · ${t("shop.sale.creditFor", { name: sale.customer, rest: money(saleRest(sale)) })}` : ""}
                            </small>
                          </span>
                          <strong>{money(saleTotal(sale))}</strong>
                        </div>
                        <div className={styles.row}>
                          {confirming === sale.id ? (
                            <>
                              <Button
                                variant="danger"
                                icon={<Trash2 />}
                                onClick={() => {
                                  setConfirming(null);
                                  void shopStore.remove(sale.id);
                                }}
                                data-testid="sale-delete-confirm"
                              >
                                {t("shop.sale.confirmDelete")}
                              </Button>
                              <Button variant="ghost" onClick={() => setConfirming(null)}>
                                {t("common.cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" icon={<Trash2 />} aria-label={t("shop.sale.deleteName", { name: sale.name })} onClick={() => setConfirming(sale.id)} data-testid="sale-delete">
                              {t("shop.sale.delete")}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.section>
            )}

            {tab === "stock" && (
              <motion.section variants={rise} className={styles.group}>
                <div className={styles.row}>
                  <Button icon={<PackagePlus />} onClick={() => setSheet({ kind: "product" })} data-testid="product-new">
                    {t("shop.product.add")}
                  </Button>
                </div>
                {products.length === 0 && !isLoading ? (
                  <EmptyState title={t("shop.stock.emptyTitle")} body={t("shop.stock.emptyBody")} />
                ) : (
                  <ul className={styles.list}>
                    {products.map((product) => (
                      <li key={product.id} className={styles.item} data-low={product.stock <= product.lowAt || undefined} data-testid="product-line">
                        <div className={styles.line}>
                          <span>
                            <strong>{product.name}</strong>
                            <small>{product.stock <= product.lowAt ? t("shop.stock.low", { qty: product.stock }) : t("shop.stock.inStock", { qty: product.stock })}</small>
                          </span>
                          {product.priceMga ? <strong>{money(product.priceMga)}</strong> : null}
                        </div>
                        <div className={styles.row}>
                          <Button variant="secondary" icon={<Pencil />} onClick={() => setSheet({ kind: "product", product })}>
                            {t("shop.product.edit")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.section>
            )}

            {tab === "credit" && (
              <motion.section variants={rise} className={styles.group}>
                {debts.length === 0 ? (
                  <EmptyState title={t("shop.credit.emptyTitle")} body={t("shop.credit.emptyBody")} />
                ) : (
                  <ul className={styles.list}>
                    {debts.map((debt) => (
                      <li key={debt.key} className={styles.item} data-testid="debt-line">
                        <div className={styles.line}>
                          <span>
                            <strong>{debt.name}</strong>
                          </span>
                          <strong data-testid="debt-amount">{money(debt.owedMga)}</strong>
                        </div>
                        <div className={styles.row}>
                          <Button variant="secondary" icon={<Wallet />} onClick={() => setSheet({ kind: "payment", debt })} data-testid="debt-pay">
                            {t("shop.credit.collect")}
                          </Button>
                          <Button variant="ghost" icon={<MessageCircle />} onClick={() => window.open(reminder(debt), "_blank", "noopener,noreferrer")} data-testid="debt-remind">
                            {t("shop.credit.remind")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.section>
            )}

            <ExpenseSheet open={sheet !== null} title={sheetTitle} onClose={close}>
              {sheet?.kind === "sale" && <SaleForm products={products} customers={customers} onDone={close} />}
              {sheet?.kind === "product" && <ProductForm key={sheet.product?.id ?? "new"} product={sheet.product} onDone={close} />}
              {sheet?.kind === "payment" && <PaymentForm debt={sheet.debt} onDone={close} />}
            </ExpenseSheet>
          </>
        )}
      </motion.div>
    </>
  );
}
