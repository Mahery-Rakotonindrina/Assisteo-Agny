import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Pencil,
  Plus,
  Scale,
  Star,
  Trash2,
  Wallet as WalletIcon,
} from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useExpenseLabels } from "@/hooks/useExpenseLabels";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useTranslation } from "@/hooks/useTranslation";
import { arrivalKey, monthStart, walletTypes, type ExpenseRecord, type Wallet, type WalletType } from "@/lib/expenses";
import { formatAriary, formatDate, formatMonthYear } from "@/lib/format";
import type { Loan } from "@/lib/loans";
import { parseNumber } from "@/lib/money";
import { dayString } from "@/lib/papers";
import {
  activeWallets,
  commonWalletTypes,
  correctionFor,
  movedOrder,
  pendingMoves,
  pocketStatement,
  walletColors,
  walletInUse,
  type Movement,
  type PocketMove,
  type StatementLine,
  type WalletBook,
} from "@/lib/wallets";
import { haptics } from "@/services/device";
import { expenseStore } from "@/services/expenseStore";
import { dayOf, parseAmount, today } from "./ExpenseForm";
import { ExpenseSheet } from "./ExpenseSheet";
import { WalletChips, walletIcons, useWalletTypeName } from "./WalletChips";
import styles from "./Expenses.module.scss";

type Sheet = "setup" | "pockets" | "transfer" | "add" | "correct" | "edit";

/** A move started from a pocket's sheet: that pocket on one side. */
type TransferPreset = { from?: string; to?: string };

/** A whole number of ariary typed in (0 included), or none. */
const parseBalance = (value: string) => {
  if (value.trim() === "") return 0;
  const number = parseNumber(value);
  return number !== null && number >= 0 ? Math.round(number) : undefined;
};

type Props = {
  book: WalletBook;
  records: ExpenseRecord[];
  /** Every loan, the feature on or not: a pocket a loan names is never removed. */
  loans: Loan[];
  now: number;
  /** A statement's expense or income, shown in its month (the sheet closes). */
  onOpen?: (movement: Movement) => void;
};

/**
 * "Dans tes poches": under "Il te reste", what each pocket (cash, MVola, the
 * bank…) holds, and the sheets to set them up, move money between them and
 * correct a balance. The first time, a line asks where the money is. Each
 * pocket has its sheet: its statement, its settings and its actions; on a
 * computer, the list on the left and the sheet on the right.
 */
export function Pockets({ book, records, loans, now, onOpen }: Props) {
  const { t, locale } = useTranslation();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [preset, setPreset] = useState<TransferPreset>({});
  const money = (value: number) => formatAriary(value, locale);
  const { wallets, byId } = book.context;
  const active = activeWallets(wallets);
  const pending = wallets.length > 0 ? pendingMoves(book, now) : [];
  // A pocket removed (here or on another device) leaves its sheet.
  const selected = chosen ? byId.get(chosen) : undefined;
  const close = () => setSheet(null);
  const back = () => setSheet("pockets");
  const titles: Record<Sheet, string> = {
    setup: t("expenses.pockets.setupTitle"),
    pockets: t("expenses.pockets.title"),
    transfer: t("expenses.pockets.transfer"),
    add: t("expenses.pockets.add"),
    correct: t("expenses.pockets.correct"),
    edit: t("expenses.pockets.editTitle"),
  };
  const open = (movement: Movement) => {
    close();
    onOpen?.(movement);
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
        <button
          type="button"
          className={styles.pocketsLine}
          onClick={() => {
            setChosen(null);
            setSheet("pockets");
          }}
          aria-label={t("expenses.pockets.open")}
        >
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

      <ExpenseSheet open={sheet !== null} title={sheet ? titles[sheet] : ""} onClose={close} wide={sheet === "pockets"}>
        {sheet === "setup" && <SetupForm onDone={close} />}
        {sheet === "pockets" && (
          <PocketsPanel
            book={book}
            records={records}
            loans={loans}
            pending={pending}
            selected={selected}
            onSelect={setChosen}
            onOpen={open}
            onTransfer={(next) => {
              setPreset(next);
              setSheet("transfer");
            }}
            onAdd={() => setSheet("add")}
            onCorrect={() => setSheet("correct")}
            onEdit={() => setSheet("edit")}
          />
        )}
        {sheet === "transfer" && <TransferForm wallets={active} primary={book.context.primary?.id} preset={preset} onDone={back} />}
        {sheet === "add" && <AddForm onDone={back} />}
        {sheet === "correct" && selected && <CorrectForm wallet={selected} balance={book.balances.get(selected.id) ?? 0} onDone={back} />}
        {sheet === "edit" && selected && <EditForm wallet={selected} onDone={back} />}
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

type PanelProps = {
  book: WalletBook;
  records: ExpenseRecord[];
  loans: Loan[];
  pending: PocketMove[];
  selected?: Wallet;
  onSelect: (id: string | null) => void;
  onOpen: (movement: Movement) => void;
  onTransfer: (preset: TransferPreset) => void;
  onAdd: () => void;
  onCorrect: () => void;
  onEdit: () => void;
};

/** "Mes poches": on a phone, the list, then a pocket's sheet in its place; on a computer, both side by side (the first pocket shown at first). */
function PocketsPanel(props: PanelProps) {
  const desktop = useIsDesktop();
  const { book, selected, onSelect } = props;
  if (!desktop)
    return selected ? <PocketDetail {...props} wallet={selected} onBack={() => onSelect(null)} /> : <PocketList {...props} />;
  const shown = selected ?? activeWallets(book.context.wallets)[0];
  return (
    <div className={styles.pocketsSplit}>
      <PocketList {...props} selected={shown} />
      {shown && <PocketDetail {...props} wallet={shown} />}
    </div>
  );
}

/** Each pocket with its balance (a tap opens its sheet); the moves to finish; transfer, add; the archived ones. */
function PocketList({ book, pending, selected, onSelect, onTransfer, onAdd }: PanelProps) {
  const { t, locale } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const money = (value: number) => formatAriary(value, locale);
  const { wallets, primary, byId } = book.context;
  const active = activeWallets(wallets);
  const archived = wallets.filter((wallet) => wallet.archived);

  const walletRow = (wallet: Wallet) => {
    const balance = book.balances.get(wallet.id) ?? 0;
    const Icon = walletIcons[wallet.type] ?? WalletIcon;
    return (
      <li key={wallet.id} className={styles.entry} data-current={wallet.id === selected?.id || undefined}>
        <button type="button" className={styles.entryMain} onClick={() => onSelect(wallet.id)}>
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
          <ChevronRight size={18} aria-hidden />
        </button>
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
          <Button icon={<ArrowLeftRight />} onClick={() => onTransfer({})}>
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

/**
 * A pocket's sheet: what it holds, its statement (the latest first, by
 * month, the balance after each line; a line opens its expense, income or
 * loan) and everything to do with it: edit, correct, move money, default,
 * order, archive, and remove when nothing uses it.
 */
function PocketDetail({ book, records, loans, wallet, onBack, onSelect, onOpen, onTransfer, onCorrect, onEdit }: PanelProps & { wallet: Wallet; onBack?: () => void }) {
  const { t, locale } = useTranslation();
  const typeName = useWalletTypeName();
  const toast = useToast();
  const { categoryName } = useExpenseLabels(records);
  const [asking, setAsking] = useState(false);
  const money = (value: number) => formatAriary(value, locale);
  const signed = (value: number) => `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;
  const { wallets, primary } = book.context;
  const active = activeWallets(wallets);
  const balance = book.balances.get(wallet.id) ?? 0;
  const months = pocketStatement(book, wallet.id);
  const used = walletInUse(records, loans, book, wallet.id);
  const Icon = walletIcons[wallet.type] ?? WalletIcon;
  const up = wallet.archived ? null : movedOrder(wallets, wallet.id, -1);
  const down = wallet.archived ? null : movedOrder(wallets, wallet.id, 1);

  const describe = (movement: Movement) => {
    if (movement.type === "correction") return t("expenses.pockets.correction");
    if (movement.loan) return t(`expenses.pockets.loan.${movement.loan.type}`, { name: movement.label ?? "" });
    if (movement.type === "saved" || movement.type === "unsaved" || movement.type === "pot") return [t(`expenses.savings.movement.${movement.type}`), movement.label].filter(Boolean).join(" · ");
    if (movement.type === "move_in" || movement.type === "move_out") return [t("expenses.pockets.move"), movement.label].filter(Boolean).join(" · ");
    if (movement.origin === "fees") return t("expenses.feesLabel");
    if (movement.type === "income") return movement.label || t("expenses.pockets.income");
    return movement.label || categoryName(movement.category ?? "other");
  };

  // What a line opens: a loan's person in "Prêts", a scan's result, else the expense or income in its month.
  const title = (line: StatementLine) => {
    const text = describe(line);
    if (line.loan)
      return (
        <Link href={{ pathname: "/loans", query: { ...(line.loan.direction === "borrowed" && { dir: "borrowed" }), person: line.loan.personKey } }} data-testid="pocket-loan">
          {text}
        </Link>
      );
    if (line.type === "expense" || line.type === "income")
      return (
        <button type="button" className={styles.statementOpen} onClick={() => onOpen(line)} data-testid="pocket-open">
          {text}
        </button>
      );
    if (line.href) return <Link href={line.href}>{text}</Link>;
    return text;
  };

  const reorder = async (ids: string[] | null) => {
    if (!ids) return;
    haptics.tap();
    await expenseStore.setWalletOrder(ids);
  };

  const remove = async () => {
    haptics.success();
    await expenseStore.remove(wallet.id);
    toast(t("expenses.pockets.removed"));
    onSelect(null);
  };

  return (
    <div className={styles.form} data-testid="pocket-detail">
      {onBack && (
        <button type="button" className={`${styles.linkButton} ${styles.backLink}`} onClick={onBack}>
          <ArrowLeft size={16} aria-hidden /> {t("expenses.pockets.back")}
        </button>
      )}
      <div className={styles.pocketHead}>
        <Icon size={24} aria-hidden style={{ color: walletColors[wallet.type] }} />
        <span className={styles.entryText}>
          <strong data-testid="pocket-name">{wallet.name}</strong>
          <small>
            {wallet.id === primary?.id && <span className={styles.badge}>{t("expenses.pockets.default")}</span>}
            {typeName(wallet.type)}
          </small>
        </span>
        <span className={styles.pocketBalance}>
          <small>{t("expenses.pockets.balanceNow")}</small>
          <strong data-testid="pocket-balance" data-tone={balance < 0 ? "bad" : undefined}>
            {money(balance)}
          </strong>
        </span>
      </div>

      <div className={styles.actions} data-flush>
        <Button variant="secondary" icon={<Pencil />} onClick={onEdit}>
          {t("expenses.pockets.edit")}
        </Button>
        {!wallet.archived && (
          <Button variant="ghost" icon={<Scale />} onClick={onCorrect}>
            {t("expenses.pockets.correct")}
          </Button>
        )}
        {!wallet.archived && active.length > 1 && (
          <>
            <Button variant="ghost" icon={<ArrowUpFromLine />} onClick={() => onTransfer({ from: wallet.id })}>
              {t("expenses.pockets.transferFrom")}
            </Button>
            <Button variant="ghost" icon={<ArrowDownToLine />} onClick={() => onTransfer({ to: wallet.id })}>
              {t("expenses.pockets.transferTo")}
            </Button>
          </>
        )}
        {!wallet.archived && wallet.id !== primary?.id && (
          <Button variant="ghost" icon={<Star />} onClick={() => void expenseStore.setPrimaryWallet(wallet.id)}>
            {t("expenses.pockets.makeDefault")}
          </Button>
        )}
      </div>

      <section aria-label={t("expenses.pockets.statement")} className={styles.statement}>
        <h3 className={styles.subTitle}>{t("expenses.pockets.statement")}</h3>
        {months.length === 0 && <p className={styles.hint}>{t("expenses.pockets.noMovement")}</p>}
        {months.map(({ month, lines }) => (
          <div key={month}>
            <h4 className={styles.statementMonth}>{formatMonthYear(monthStart(month), locale)}</h4>
            <ul className={styles.movements}>
              {lines.map((line) => (
                <li key={`${line.key}:${line.type}`} data-testid="pocket-line">
                  <span>
                    {title(line)}
                    <small>
                      {formatDate(line.at, locale)}
                      {line.pending && ` · ${t("expenses.pockets.toChoose")}`}
                    </small>
                  </span>
                  <span className={styles.statementAmount}>
                    <strong data-tone={line.amountMga < 0 ? "out" : "in"}>{signed(line.amountMga)}</strong>
                    <small data-testid="pocket-line-balance">{t("expenses.pockets.balanceAfter", { amount: money(line.balanceMga) })}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className={styles.hint} data-testid="pocket-start">
          {t("expenses.pockets.startLine")} : {t("expenses.pockets.since", { amount: money(wallet.startMga), date: formatDate(wallet.startAt, locale) })}
        </p>
      </section>

      {(up || down) && (
        <div className={styles.actions} data-flush>
          <Button variant="ghost" icon={<ArrowUp />} disabled={!up} onClick={() => void reorder(up)}>
            {t("expenses.pockets.moveUp")}
          </Button>
          <Button variant="ghost" icon={<ArrowDown />} disabled={!down} onClick={() => void reorder(down)}>
            {t("expenses.pockets.moveDown")}
          </Button>
          <p className={styles.hint}>{t("expenses.pockets.orderHint")}</p>
        </div>
      )}

      <div className={styles.actions} data-flush>
        <Button variant="ghost" icon={wallet.archived ? <ArchiveRestore /> : <Archive />} onClick={() => void expenseStore.setWalletArchived(wallet.id, !wallet.archived)}>
          {t(wallet.archived ? "expenses.pockets.unarchive" : "expenses.pockets.archive")}
        </Button>
        {!used && !asking && (
          <Button variant="ghost" icon={<Trash2 />} onClick={() => setAsking(true)}>
            {t("expenses.pockets.remove")}
          </Button>
        )}
      </div>
      {used ? (
        <p className={styles.hint} data-testid="pocket-in-use">
          {t("expenses.pockets.inUse")}
        </p>
      ) : (
        !wallet.archived && <p className={styles.hint}>{t("expenses.pockets.archiveHint")}</p>
      )}
      {!used && asking && (
        <div className={styles.actions} data-flush>
          <p className={styles.hint}>{t("expenses.pockets.removeAsk", { name: wallet.name })}</p>
          <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
            {t("expenses.pockets.removeConfirm")}
          </Button>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            {t("expenses.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A pocket's name, type and starting balance (with its day): the whole statement follows; not a correction. */
function EditForm({ wallet, onDone }: { wallet: Wallet; onDone: () => void }) {
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


/** Money moved by hand from one pocket to another, with its fees (an expense, from the first pocket). */
function TransferForm({ wallets, primary, preset = {}, onDone }: { wallets: Wallet[]; primary?: string; preset?: TransferPreset; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const shown = (id: string | undefined) => (id && wallets.some((wallet) => wallet.id === id) ? id : undefined);
  // From a pocket's sheet: that pocket on its side, the default one (or the first other) on the other.
  const [from, setFrom] = useState(() => shown(preset.from) ?? wallets.find((wallet) => wallet.id !== preset.to && wallet.id === primary)?.id ?? wallets.find((wallet) => wallet.id !== preset.to)?.id ?? "");
  const [to, setTo] = useState(() => shown(preset.to) ?? wallets.find((wallet) => wallet.id !== from)?.id ?? "");
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
            wallets={typeChoices(typeName)}
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
