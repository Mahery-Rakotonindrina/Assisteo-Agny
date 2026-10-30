import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowLeftRight, Check, ChevronRight, Plus, Scale, Star, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useTranslation } from "@/hooks/useTranslation";
import { arrivalKey, walletTypes, type ExpenseRecord, type Wallet, type WalletType } from "@/lib/expenses";
import { formatAriary, formatDate } from "@/lib/format";
import { parseNumber } from "@/lib/money";
import { activeWallets, commonWalletTypes, correctionFor, pendingMoves, walletColors, type Movement, type PocketMove, type WalletBook } from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { dayOf, parseAmount, today } from "./ExpenseForm";
import { ExpenseSheet } from "./ExpenseSheet";
import { WalletChips, walletIcons, useWalletTypeName } from "./WalletChips";
import styles from "./Expenses.module.scss";

type Sheet = "setup" | "pockets" | "transfer" | "add" | "correct";

/** How many movements a pocket shows. */
const RECENT = 6;

/** A whole number of ariary typed in (0 included), or none. */
const parseBalance = (value: string) => {
  if (value.trim() === "") return 0;
  const number = parseNumber(value);
  return number !== null && number >= 0 ? Math.round(number) : undefined;
};

/**
 * "Dans tes poches": under "Il te reste", what each pocket (cash, MVola, the
 * bank…) holds, and the sheets to set them up, move money between them and
 * correct a balance. The first time, a line asks where the money is.
 */
export function Pockets({ book, records, now }: { book: WalletBook; records: ExpenseRecord[]; now: number }) {
  const { t, locale } = useTranslation();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [correcting, setCorrecting] = useState<Wallet | null>(null);
  const money = (value: number) => formatAriary(value, locale);
  const { wallets } = book.context;
  const active = activeWallets(wallets);
  const pending = wallets.length > 0 ? pendingMoves(book, now) : [];
  const close = () => setSheet(null);
  const titles: Record<Sheet, string> = {
    setup: t("expenses.pockets.setupTitle"),
    pockets: t("expenses.pockets.title"),
    transfer: t("expenses.pockets.transfer"),
    add: t("expenses.pockets.add"),
    correct: t("expenses.pockets.correct"),
  };

  return (
    <>
      {wallets.length === 0 ? (
        <button type="button" className={styles.pocketsLine} onClick={() => setSheet("setup")}>
          <WalletIcon size={18} aria-hidden />
          <span>{t("expenses.pockets.ask")}</span>
          <ChevronRight size={18} aria-hidden />
        </button>
      ) : (
        <button type="button" className={styles.pocketsLine} onClick={() => setSheet("pockets")} aria-label={t("expenses.pockets.open")}>
          <WalletIcon size={18} aria-hidden />
          <span className={styles.pocketsText}>
            <span>
              {t("expenses.pockets.inPockets")} <strong data-testid="pockets-total">{money(book.total)}</strong>
            </span>
            <small data-testid="pockets">
              {active.map((wallet) => `${wallet.name} ${money(book.balances.get(wallet.id) ?? 0)}`).join(" · ")}
            </small>
            {pending.length > 0 && (
              <span className={styles.badge} data-tone="warning">
                {t("expenses.pockets.pendingCount", { count: pending.length })}
              </span>
            )}
          </span>
          <ChevronRight size={18} aria-hidden />
        </button>
      )}

      <ExpenseSheet open={sheet !== null} title={sheet ? titles[sheet] : ""} onClose={close}>
        {sheet === "setup" && <SetupForm onDone={close} />}
        {sheet === "pockets" && (
          <PocketList
            book={book}
            records={records}
            pending={pending}
            onTransfer={() => setSheet("transfer")}
            onAdd={() => setSheet("add")}
            onCorrect={(wallet) => {
              setCorrecting(wallet);
              setSheet("correct");
            }}
          />
        )}
        {sheet === "transfer" && <TransferForm wallets={active} primary={book.context.primary?.id} onDone={() => setSheet("pockets")} />}
        {sheet === "add" && <AddForm onDone={() => setSheet("pockets")} />}
        {sheet === "correct" && correcting && <CorrectForm wallet={correcting} balance={book.balances.get(correcting.id) ?? 0} onDone={() => setSheet("pockets")} />}
      </ExpenseSheet>
    </>
  );
}

/** The first time: the usual pockets to tick, with what each holds today; cash is the default one. */
function SetupForm({ onDone }: { onDone: () => void }) {
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
        <Button variant="ghost" onClick={onDone}>
          {t("expenses.cancel")}
        </Button>
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

type ListProps = { book: WalletBook; records: ExpenseRecord[]; pending: PocketMove[]; onTransfer: () => void; onAdd: () => void; onCorrect: (wallet: Wallet) => void };

/** "Mes poches": each pocket with its balance and latest movements; the moves to finish; transfer, add, correct, archive. */
function PocketList({ book, records, pending, onTransfer, onAdd, onCorrect }: ListProps) {
  const { t, locale } = useTranslation();
  const { categoryName } = useExpenseLabels(records);
  const [opened, setOpened] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const money = (value: number) => formatAriary(value, locale);
  const signed = (value: number) => `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;
  const { wallets, primary, byId } = book.context;
  const active = activeWallets(wallets);
  const archived = wallets.filter((wallet) => wallet.archived);

  const describe = (movement: Movement) => {
    if (movement.type === "correction") return t("expenses.pockets.correction");
    if (movement.loan) return t(`expenses.pockets.loan.${movement.loan.type}`, { name: movement.label ?? "" });
    if (movement.type === "saved" || movement.type === "unsaved" || movement.type === "pot") return [t(`expenses.savings.movement.${movement.type}`), movement.label].filter(Boolean).join(" · ");
    if (movement.type === "move_in" || movement.type === "move_out") return [t("expenses.pockets.move"), movement.label].filter(Boolean).join(" · ");
    if (movement.origin === "fees") return t("expenses.feesLabel");
    if (movement.type === "income") return movement.label || t("expenses.pockets.income");
    return movement.label || categoryName(movement.category ?? "other");
  };

  const walletRow = (wallet: Wallet) => {
    const open = opened === wallet.id;
    const balance = book.balances.get(wallet.id) ?? 0;
    const Icon = walletIcons[wallet.type];
    const movements = book.movements.get(wallet.id) ?? [];
    return (
      <li key={wallet.id} className={styles.entry}>
        <button type="button" className={styles.entryMain} aria-expanded={open} onClick={() => setOpened(open ? null : wallet.id)}>
          <Icon size={20} aria-hidden style={{ color: walletColors[wallet.type] }} />
          <span className={styles.entryText}>
            <strong>{wallet.name}</strong>
            <small>
              {wallet.id === primary?.id && <span className={styles.badge}>{t("expenses.pockets.default")}</span>}
              {t("expenses.pockets.since", { amount: money(wallet.startMga), date: formatDate(wallet.startAt, locale) })}
            </small>
          </span>
          <span className={styles.amount} data-testid="wallet-balance" data-wallet={wallet.name} data-tone={balance < 0 ? "bad" : undefined}>
            {money(balance)}
          </span>
        </button>
        {open && (
          <div className={styles.actions}>
            {movements.length === 0 ? (
              <p className={styles.hint}>{t("expenses.pockets.noMovement")}</p>
            ) : (
              <ul className={styles.movements}>
                {movements.slice(0, RECENT).map((movement) => (
                  <li key={`${movement.key}:${movement.type}`}>
                    <span>
                      {movement.loan ? (
                        // A loan's move opens that person's page in "Prêts".
                        <Link href={{ pathname: "/loans", query: { ...(movement.loan.direction === "borrowed" && { dir: "borrowed" }), person: movement.loan.personKey } }} data-testid="pocket-loan">
                          {describe(movement)}
                        </Link>
                      ) : (
                        describe(movement)
                      )}
                      <small>
                        {formatDate(movement.at, locale)}
                        {movement.pending && ` · ${t("expenses.pockets.toChoose")}`}
                      </small>
                    </span>
                    <strong data-tone={movement.amountMga < 0 ? "out" : "in"}>{signed(movement.amountMga)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {!wallet.archived && (
              <Button variant="ghost" icon={<Scale />} onClick={() => onCorrect(wallet)}>
                {t("expenses.pockets.correct")}
              </Button>
            )}
            {!wallet.archived && wallet.id !== primary?.id && (
              <Button variant="ghost" icon={<Star />} onClick={() => void expenseStore.setPrimaryWallet(wallet.id)}>
                {t("expenses.pockets.makeDefault")}
              </Button>
            )}
            <Button variant="ghost" icon={wallet.archived ? <ArchiveRestore /> : <Archive />} onClick={() => void expenseStore.setWalletArchived(wallet.id, !wallet.archived)}>
              {t(wallet.archived ? "expenses.pockets.unarchive" : "expenses.pockets.archive")}
            </Button>
            {!wallet.archived && <p className={styles.hint}>{t("expenses.pockets.archiveHint")}</p>}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className={styles.form}>
      <p className={styles.pocketsTotal}>
        {t("expenses.pockets.inPockets")} <strong>{money(book.total)}</strong>
      </p>
      {/* Nothing looks lost: what was set aside left the pockets. */}
      {book.saved > 0 && (
        <p className={styles.hint} data-testid="pockets-saved">
          {t("expenses.savings.inPockets", { amount: money(book.saved) })}
        </p>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="pockets-pending" className={styles.pending}>
          <h3 id="pockets-pending" className={styles.subTitle}>
            {t("expenses.pockets.pendingTitle")}
          </h3>
          <p className={styles.hint}>{t("expenses.pockets.pendingHint")}</p>
          {pending.map((move) => (
            <div key={move.key} className={styles.pendingMove}>
              <strong>
                {t("expenses.pockets.pendingMove", { amount: money(move.amountMga), date: formatDate(move.at, locale) })}
                {move.label && ` · ${move.label}`}
              </strong>
              {!move.from && <WalletChips label={t("expenses.pockets.fromWhich")} wallets={active} value="" onChange={(id) => void expenseStore.setWalletPick(move.key, id)} />}
              {move.from && (
                <small className={styles.hint}>{t("expenses.pockets.fromName", { name: byId.get(move.from)?.name ?? "" })}</small>
              )}
              {!move.to && (
                <WalletChips
                  label={t("expenses.pockets.toWhich")}
                  wallets={active.filter((wallet) => wallet.id !== move.from)}
                  value=""
                  onChange={(id) => void expenseStore.setWalletPick(arrivalKey(move.key), id)}
                />
              )}
            </div>
          ))}
        </section>
      )}

      <ul className={styles.entries}>{active.map(walletRow)}</ul>

      <div className={styles.row}>
        {active.length > 1 && (
          <Button icon={<ArrowLeftRight />} onClick={onTransfer}>
            {t("expenses.pockets.transfer")}
          </Button>
        )}
        <Button variant="secondary" icon={<Plus />} onClick={onAdd}>
          {t("expenses.pockets.add")}
        </Button>
      </div>

      {archived.length > 0 && (
        <>
          <button type="button" className={styles.linkButton} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {t("expenses.pockets.archived", { count: archived.length })}
          </button>
          {showArchived && <ul className={styles.entries}>{archived.map(walletRow)}</ul>}
        </>
      )}
    </div>
  );
}

/** Money moved by hand from one pocket to another, with its fees (an expense, from the first pocket). */
function TransferForm({ wallets, primary, onDone }: { wallets: Wallet[]; primary?: string; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [from, setFrom] = useState(primary && wallets.some((wallet) => wallet.id === primary) ? primary : (wallets[0]?.id ?? ""));
  const [to, setTo] = useState(() => wallets.find((wallet) => wallet.id !== from)?.id ?? "");
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
function AddForm({ onDone }: { onDone: () => void }) {
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
          <WalletChips
            label={t("expenses.pockets.type")}
            wallets={walletTypes.map((item) => ({ id: item, kind: "wallet", name: typeName(item), type: item, startMga: 0, startAt: 0, createdAt: 0, updatedAt: 0 }))}
            value={type}
            onChange={(id) => setType(id as WalletType)}
          />
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
function CorrectForm({ wallet, balance, onDone }: { wallet: Wallet; balance: number; onDone: () => void }) {
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
