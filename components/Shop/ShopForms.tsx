import { useState, type FormEvent } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary } from "@/lib/format";
import { cleanQty, saleTotal, type CustomerDebt, type ShopProduct } from "@/lib/shop";
import { haptics } from "@/services/device";
import { shopStore } from "@/services/shopStore";
import styles from "./Shop.module.scss";

const toNumber = (text: string) => (text.trim() === "" ? NaN : Number(text.replace(",", ".")));

/** A sale: the product (from the stock or typed), quantity, price, and paid or on credit for a customer. */
export function SaleForm({ products, customers, onDone }: { products: ShopProduct[]; customers: string[]; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [mode, setMode] = useState<"paid" | "credit">("paid");
  const [paid, setPaid] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");

  const product = products.find((item) => item.id === productId);
  const quantity = cleanQty(toNumber(qty));
  const unit = toNumber(price);
  const total = quantity !== null && Number.isFinite(unit) ? saleTotal({ qty: quantity, unitPriceMga: unit }) : 0;

  const pick = (id: string) => {
    setProductId(id);
    const chosen = products.find((item) => item.id === id);
    if (chosen?.priceMga) setPrice(String(chosen.priceMga));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const paidMga = mode === "paid" ? total : Number.isFinite(toNumber(paid)) ? toNumber(paid) : 0;
    const sale = await shopStore.addSale({ productId: product?.id, name: product?.name ?? name, qty: toNumber(qty), unitPriceMga: unit, paidMga, customer, phone });
    if (!sale) {
      toast(t(mode === "credit" && !customer.trim() ? "shop.sale.needCustomer" : "shop.sale.invalid"), "error");
      return;
    }
    haptics.success();
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} data-testid="sale-form">
      <div className={styles.fields}>
        {products.length > 0 && (
          <label className={styles.wide}>
            {t("shop.sale.product")}
            <select value={productId} onChange={(event) => pick(event.target.value)} data-testid="sale-product">
              <option value="">{t("shop.sale.otherProduct")}</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.stock})
                </option>
              ))}
            </select>
          </label>
        )}
        {!product && (
          <label className={styles.wide}>
            {t("shop.sale.name")}
            <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required data-testid="sale-name" />
          </label>
        )}
        <label>
          {t("shop.sale.qty")}
          <input type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(event) => setQty(event.target.value)} required data-testid="sale-qty" />
        </label>
        <label>
          {t("shop.sale.price")}
          <input type="number" inputMode="numeric" min={0} value={price} onChange={(event) => setPrice(event.target.value)} required data-testid="sale-price" />
        </label>
        <label className={styles.wide}>
          {t("shop.sale.payment")}
          <select value={mode} onChange={(event) => setMode(event.target.value as "paid" | "credit")} data-testid="sale-mode">
            <option value="paid">{t("shop.sale.paid")}</option>
            <option value="credit">{t("shop.sale.credit")}</option>
          </select>
        </label>
        {mode === "credit" && (
          <>
            <label>
              {t("shop.sale.paidNow")}
              <input type="number" inputMode="numeric" min={0} value={paid} onChange={(event) => setPaid(event.target.value)} placeholder="0" data-testid="sale-paid" />
            </label>
            <label>
              {t("shop.sale.customer")}
              <input list="shop-customers" value={customer} maxLength={60} onChange={(event) => setCustomer(event.target.value)} required data-testid="sale-customer" />
              <datalist id="shop-customers">
                {customers.map((known) => (
                  <option key={known} value={known} />
                ))}
              </datalist>
            </label>
            <label className={styles.wide}>
              {t("shop.sale.phone")}
              <input type="tel" inputMode="tel" value={phone} maxLength={30} onChange={(event) => setPhone(event.target.value)} />
            </label>
          </>
        )}
      </div>
      <p className={styles.sum} data-testid="sale-total">
        {t("shop.sale.total", { amount: formatAriary(total, locale) })}
      </p>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} data-testid="sale-save">
          {t("shop.sale.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** A product of the stock: its name, quantity in stock, the quantity at which the alert shows, and its usual price. */
export function ProductForm({ product, onDone }: { product?: ShopProduct; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? "");
  const [stock, setStock] = useState(String(product?.stock ?? ""));
  const [lowAt, setLowAt] = useState(String(product?.lowAt ?? 3));
  const [price, setPrice] = useState(product?.priceMga ? String(product.priceMga) : "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await shopStore.saveProduct({ id: product?.id, name, stock: toNumber(stock), lowAt: toNumber(lowAt), priceMga: price.trim() === "" ? undefined : toNumber(price) });
    if (!saved) {
      toast(t("shop.product.invalid"), "error");
      return;
    }
    haptics.success();
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} data-testid="product-form">
      <div className={styles.fields}>
        <label className={styles.wide}>
          {t("shop.product.name")}
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required data-testid="product-name" />
        </label>
        <label>
          {t("shop.product.stock")}
          <input type="number" inputMode="decimal" min={0} step="any" value={stock} onChange={(event) => setStock(event.target.value)} required data-testid="product-stock" />
        </label>
        <label>
          {t("shop.product.lowAt")}
          <input type="number" inputMode="decimal" min={0} step="any" value={lowAt} onChange={(event) => setLowAt(event.target.value)} required data-testid="product-low" />
        </label>
        <label className={styles.wide}>
          {t("shop.product.price")}
          <input type="number" inputMode="numeric" min={0} value={price} onChange={(event) => setPrice(event.target.value)} data-testid="product-price" />
        </label>
      </div>
      <small className={styles.hint}>{t("shop.product.lowHint")}</small>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} data-testid="product-save">
          {t("shop.product.save")}
        </Button>
        {product && (
          <Button
            variant="danger"
            icon={<Trash2 />}
            onClick={() => {
              void shopStore.remove(product.id).then(onDone);
            }}
          >
            {t("shop.product.delete")}
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** A payment received from a customer who owes: the amount owed is offered, never exceeded. */
export function PaymentForm({ debt, onDone }: { debt: CustomerDebt; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState(String(debt.owedMga));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payment = await shopStore.addPayment(debt.name, toNumber(amount));
    if (!payment) {
      toast(t("shop.credit.invalid"), "error");
      return;
    }
    haptics.success();
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} data-testid="payment-form">
      <p>{t("shop.credit.owes", { name: debt.name, amount: formatAriary(debt.owedMga, locale) })}</p>
      <div className={styles.fields}>
        <label className={styles.wide}>
          {t("shop.credit.received")}
          <input type="number" inputMode="numeric" min={1} max={debt.owedMga} value={amount} onChange={(event) => setAmount(event.target.value)} required data-testid="payment-amount" />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} data-testid="payment-save">
          {t("shop.credit.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
