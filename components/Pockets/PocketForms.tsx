import { useState, type FormEvent } from "react";
import { ArrowUpDown, Check, Plus } from "lucide-react";
import { Button } from "@/components/Button";
import { dayOf, parseAmount, today } from "@/components/Expenses/ExpenseForm";
import styles from "@/components/Expenses/Expenses.module.scss";
import { WalletChips, walletIcons, useWalletTypeName } from "@/components/Expenses/WalletChips";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { walletTypes, type Wallet, type WalletType } from "@/lib/expenses";
import { formatAriary } from "@/lib/format";
import { parseNumber } from "@/lib/money";
import { dayString } from "@/lib/papers";
import { commonWalletTypes, correctionFor, walletColors } from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import own from "./Pockets.module.scss";

// The forms of "Mes poches", each in its window over the screen: the first
// pockets, one more, a move between two, a corrected balance, a pocket edited.

/** A move started from a pocket's sheet: that pocket on one side. */
export type TransferPreset = { from?: string; to?: string };

/** A whole number of ariary typed in (0 included), or none. */
const parseBalance = (value: string) => {
  if (value.trim() === "") return 0;
  const number = parseNumber(value);
  return number !== null && number >= 0 ? Math.round(number) : undefined;
};

/** The first time: the usual pockets to tick, with what each holds today; cash is the default one. */
export function SetupForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const typeName = useWalletTypeName();
  const toast = useToast();
  const [ticked, setTicked] = useState<Record<string, boolean>>({ cash: true });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const chosen = commonWalletTypes.filter((type) => ticked[type]);
  const valid = chosen.length > 0 && chosen.every((type) => parseBalance(amounts[type] ?? "") !== undefined);
  // Cash when ticked, else the first one ticked.
  const defaultType = chosen.includes("cash") ? "cash" : chosen[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    haptics.success();
    const startAt = Date.now();
    const primary = chosen.includes("cash") ? "cash" : chosen[0];
    for (const type of chosen) await expenseStore.saveWallet({ name: typeName(type), type, startMga: parseBalance(amounts[type] ?? "") ?? 0, startAt, primary: type === primary });
    toast(t("expenses.pockets.saved"));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.pockets.setupTitle")}>
      <p className={styles.hint}>{t("expenses.pockets.setupHint")}</p>
      <ul className={styles.setupList}>
        {commonWalletTypes.map((type) => {
          const Icon = walletIcons[type];
          return (
            <li key={type} style={{ "--tone": walletColors[type] } as React.CSSProperties}>
              <label className={styles.setupTick}>
                <input type="checkbox" checked={Boolean(ticked[type])} onChange={(event) => setTicked({ ...ticked, [type]: event.target.checked })} />
                <Icon size={18} aria-hidden />
                <span>{typeName(type)}</span>
              </label>
              {ticked[type] && (
                <label className={styles.setupAmount}>
                  <span>{t("expenses.pockets.howMuch")}</span>
                  <input
                    value={amounts[type] ?? ""}
                    onChange={(event) => setAmounts({ ...amounts, [type]: event.target.value })}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label={t("expenses.pockets.howMuchOf", { name: typeName(type) })}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {defaultType && <DefaultHint type={defaultType} />}
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={!valid}>
          {t("expenses.save")}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t("expenses.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Which pocket will be the default one: the one really ticked. */
function DefaultHint({ type }: { type: WalletType }) {
  const { t } = useTranslation();
  const typeName = useWalletTypeName();
  return <p className={styles.hint}>{t("expenses.pockets.defaultHint", { name: typeName(type) })}</p>;
}

/** A pocket's name, type and starting balance (with its day): the whole statement follows; not a correction. */
export function EditForm({ wallet, onDone }: { wallet: Wallet; onDone: () => void }) {
  const { t } = useTranslation();
  const typeName = useWalletTypeName();
  const toast = useToast();
  const [type, setType] = useState<WalletType>(wallet.type);
  const [name, setName] = useState(wallet.name);
  const [amount, setAmount] = useState(String(wallet.startMga));
  const [day, setDay] = useState(() => dayString(wallet.startAt));
  const [todayValue] = useState(today);
  const start = parseBalance(amount);
  const valid = start !== undefined && day !== "" && day <= todayValue;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || start === undefined) return;
    haptics.success();
    // The same day keeps its time: the lines of that day already counted stay counted.
    const startAt = day === dayString(wallet.startAt) ? wallet.startAt : dayOf(day);
    await expenseStore.saveWallet({ ...wallet, name: name.trim() || typeName(type), type, startMga: start, startAt });
    toast(t("expenses.pockets.edited"));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.pockets.editTitle")}>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.pockets.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={typeName(type)} />
        </label>
        <div className={styles.wide}>
          <WalletChips label={t("expenses.pockets.type")} wallets={typeChoices(typeName)} value={type} onChange={(id) => setType(id as WalletType)} />
          <p className={styles.hint}>{t("expenses.pockets.typeHint")}</p>
        </div>
        <label>
          <span>{t("expenses.pockets.startAmount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="0" />
        </label>
        <label>
          <span>{t("expenses.pockets.startDay")}</span>
          <input type="date" value={day} max={todayValue} onChange={(event) => setDay(event.target.value)} required />
        </label>
      </div>
      <p className={styles.hint}>{t("expenses.pockets.startHint")}</p>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={!valid}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Every pocket type, as chips. */
const typeChoices = (typeName: (type: WalletType) => string): Wallet[] =>
  walletTypes.map((item) => ({ id: item, kind: "wallet", name: typeName(item), type: item, startMga: 0, startAt: 0, createdAt: 0, updatedAt: 0 }));

/**
 * Money moved by hand from one pocket to another, with its fees (an expense,
 * from the first pocket). From a pocket's sheet, that pocket is "De"; ⇅ swaps
 * both sides.
 */
export function TransferForm({ wallets, primary, preset = {}, onDone }: { wallets: Wallet[]; primary?: string; preset?: TransferPreset; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const shown = (id: string | undefined) => (id && wallets.some((wallet) => wallet.id === id) ? id : undefined);
  // From a pocket's sheet: that pocket on its side, the default one (or the first other) on the other.
  const [from, setFrom] = useState(() => shown(preset.from) ?? wallets.find((wallet) => wallet.id !== preset.to && wallet.id === primary)?.id ?? wallets.find((wallet) => wallet.id !== preset.to)?.id ?? "");
  const [to, setTo] = useState(() => shown(preset.to) ?? wallets.find((wallet) => wallet.id !== from && wallet.id === primary)?.id ?? wallets.find((wallet) => wallet.id !== from)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState("");
  const [day, setDay] = useState(today);
  const [todayValue] = useState(today);
  const [note, setNote] = useState("");
  const value = parseAmount(amount);
  const feesValue = fees.trim() === "" ? 0 : parseAmount(fees);
  const valid = value !== undefined && feesValue !== undefined && from !== "" && to !== "" && from !== to;

  const pickFrom = (id: string) => {
    setFrom(id);
    if (id === to) setTo(wallets.find((wallet) => wallet.id !== id)?.id ?? "");
  };

  const swap = () => {
    haptics.tap();
    setFrom(to);
    setTo(from);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || value === undefined) return;
    haptics.success();
    await expenseStore.saveTransfer({ from, to, at: dayOf(day), amountMga: value, feesMga: feesValue || undefined, note });
    toast(t("expenses.pockets.transferred", { amount: formatAriary(Math.round(value), locale) }));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.pockets.transfer")}>
      <p className={styles.hint}>{t("expenses.pockets.transferHint")}</p>
      <div className={styles.fields}>
        <div className={styles.wide}>
          <WalletChips label={t("expenses.pockets.from")} wallets={wallets} value={from} onChange={pickFrom} />
        </div>
        <div className={`${styles.wide} ${own.swapRow}`}>
          <button type="button" className={own.swap} onClick={swap} disabled={from === "" || to === ""} data-testid="transfer-swap">
            <ArrowUpDown size={18} aria-hidden />
            {t("expenses.pockets.swap")}
          </button>
        </div>
        <div className={styles.wide}>
          <WalletChips label={t("expenses.pockets.to")} wallets={wallets.filter((wallet) => wallet.id !== from)} value={to} onChange={setTo} />
        </div>
        <label>
          <span>{t("expenses.form.amount")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className={styles.amountInput} required autoFocus />
        </label>
        <label>
          <span>{t("expenses.pockets.fees")}</span>
          <input value={fees} onChange={(event) => setFees(event.target.value)} inputMode="numeric" placeholder="0" />
        </label>
        <label>
          <span>
            {t("expenses.form.date")}
            {day === todayValue && ` (${t("expenses.form.today")})`}
          </span>
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
        </label>
        <label>
          <span>{t("expenses.form.note")}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={!valid}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** One more pocket: its type, name and what it holds today. */
export function AddForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const typeName = useWalletTypeName();
  const [type, setType] = useState<WalletType>("cash");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const start = parseBalance(amount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (start === undefined) return;
    haptics.success();
    await expenseStore.saveWallet({ name: name.trim() || typeName(type), type, startMga: start, startAt: Date.now() });
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.pockets.add")}>
      <div className={styles.fields}>
        <div className={styles.wide}>
          <WalletChips label={t("expenses.pockets.type")} wallets={typeChoices(typeName)} value={type} onChange={(id) => setType(id as WalletType)} />
        </div>
        <label>
          <span>{t("expenses.pockets.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={typeName(type)} />
        </label>
        <label>
          <span>{t("expenses.pockets.howMuch")}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="0" />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={start === undefined}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** "Ton solde MVola est en vrai de…": the difference is written as a correction, today. */
export function CorrectForm({ wallet, balance, onDone }: { wallet: Wallet; balance: number; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState(String(Math.max(0, balance)));
  const actual = parseBalance(amount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (actual === undefined) return;
    const difference = correctionFor(balance, actual);
    if (difference !== 0) {
      haptics.success();
      await expenseStore.correctWallet(wallet.id, difference);
      toast(t("expenses.pockets.corrected", { amount: `${difference > 0 ? "+" : "−"}${formatAriary(Math.abs(difference), locale)}` }));
    }
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-label={t("expenses.pockets.correct")}>
      {/* A forgotten expense, noted as one, puts the balance right by itself (a correction would count it twice). */}
      <div className={own.forgot}>
        <p>{t("expenses.pockets.forgotHint")}</p>
        <Button variant="secondary" icon={<Plus />} href={`/expenses?add=expense&wallet=${encodeURIComponent(wallet.id)}`}>
          {t("expenses.add")}
        </Button>
      </div>
      <p className={styles.hint}>{t("expenses.pockets.correctHint", { amount: formatAriary(balance, locale) })}</p>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("expenses.pockets.really", { name: wallet.name })}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" className={styles.amountInput} autoFocus />
        </label>
      </div>
      <div className={styles.row}>
        <Button type="submit" icon={<Check />} disabled={actual === undefined}>
          {t("expenses.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
      </div>
    </form>
  );
}
