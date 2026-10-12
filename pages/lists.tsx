import Head from "next/head";
import { useRouter } from "next/router";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Check, ChevronDown, ClipboardList, ListChecks, Pencil, Plus, RotateCcw, ScanLine, Share2, ShoppingBasket, Trash2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useLists } from "@/hooks/useLists";
import { useTranslation } from "@/hooks/useTranslation";
import { listKinds } from "@/lib/ai/schema";
import { formatAriary } from "@/lib/format";
import { parseNumber } from "@/lib/money";
import { easeOut, rise, stagger } from "@/lib/motion";
import { haptics, shareText } from "@/services/device";
import { compareLists, listProgress, listStore, listTotals, type ListKind, type SavedList } from "@/services/listStore";
import styles from "@/styles/Lists.module.scss";

const kindIcons = { shopping: ShoppingBasket, todo: ListChecks, other: ClipboardList } satisfies Record<ListKind, unknown>;

/** A price typed in a field ("2 500", "2500 Ar"); undefined when empty. */
const parsePrice = (value: FormDataEntryValue | string | null) => parseNumber(String(value ?? "")) ?? undefined;

/** "Mes listes": shopping lists, to-do lists… to tick, read from a photo or written here. */
export default function ListsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { lists, isLoading } = useLists();
  const { entries, isLoading: historyLoading } = useHistory();
  const [creating, setCreating] = useState(false);
  // A list opened from a scan ("?open=…").
  const opened = typeof router.query.open === "string" ? router.query.open : null;
  const sorted = [...lists].sort(compareLists);
  const ongoing = lists.filter((list) => {
    const { done, total } = listProgress(list);
    return total === 0 || done < total;
  }).length;
  const hasScan = (id: string) => historyLoading || entries.some((entry) => entry.id === id);

  return (
    <>
      <Head>
        <title>{`${t("lists.title")} · ${t("meta.title")}`}</title>
      </Head>
      <motion.div className={styles.page} variants={stagger} initial="hidden" animate="show">
        <motion.header variants={rise} className={styles.header}>
          <h1>{t("lists.title")}</h1>
          {lists.length > 0 && <p>{t("lists.summary", { ongoing, done: lists.length - ongoing })}</p>}
        </motion.header>

        {!isLoading && lists.length === 0 && !creating ? (
          <motion.div variants={rise}>
            <EmptyState
              title={t("lists.emptyTitle")}
              body={t("lists.emptyBody")}
              action={
                <div className={styles.emptyActions}>
                  <Button href="/" icon={<ScanLine />}>
                    {t("lists.scan")}
                  </Button>
                  <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
                    {t("lists.new")}
                  </Button>
                </div>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.div variants={rise}>
              {creating ? (
                <NewList onDone={() => setCreating(false)} />
              ) : (
                <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
                  {t("lists.new")}
                </Button>
              )}
            </motion.div>
            <motion.div variants={rise} className={styles.lists}>
              {sorted.map((list) => (
                <ListCard key={list.id} list={list} initiallyOpen={list.id === opened} hasScan={hasScan} />
              ))}
            </motion.div>
          </>
        )}
      </motion.div>
    </>
  );
}

function NewList({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ListKind>("shopping");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    haptics.success();
    await listStore.create(title, kind);
    onDone();
  };

  return (
    <form className={styles.newList} onSubmit={(event) => void create(event)}>
      <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("lists.newPlaceholder")} aria-label={t("lists.newTitle")} maxLength={200} />
      <div className={styles.kinds} role="group" aria-label={t("lists.kind")}>
        {listKinds.map((value) => {
          const Icon = kindIcons[value];
          return (
            <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
              <Icon size={14} /> {t(`lists.kinds.${value}`)}
            </button>
          );
        })}
      </div>
      <div className={styles.row}>
        <Button type="submit" size="md" icon={<Check />} disabled={!title.trim()}>
          {t("lists.create")}
        </Button>
        <Button variant="ghost" size="md" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function ListCard({ list, initiallyOpen, hasScan }: { list: SavedList; initiallyOpen: boolean; hasScan: (id: string) => boolean }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  // Opened from a scan once the address is read (it isn't on the first render).
  const [openChoice, setOpen] = useState<boolean | null>(null);
  const open = openChoice ?? initiallyOpen;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const { done, total } = listProgress(list);
  // Shopping lists have prices: what everything costs, and what is already bought.
  const shopping = list.kind === "shopping";
  const totals = listTotals(list);
  const finished = total > 0 && done === total;
  const KindIcon = kindIcons[list.kind];

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    haptics.tap();
    await listStore.addItem(list.id, text, quantity, shopping ? parsePrice(price) : undefined);
    setText("");
    setQuantity("");
    setPrice("");
  };

  const share = async () => {
    const lines = list.items.map(
      (item) =>
        `${item.done ? "☑" : "☐"} ${item.text}${item.quantity ? ` — ${item.quantity}` : ""}${shopping && item.priceMga ? ` — ${formatAriary(item.priceMga, locale)}` : ""}`,
    );
    if (shopping && totals.estimated > 0) lines.push("", t("lists.shareTotal", { total: formatAriary(totals.estimated, locale) }));
    const outcome = await shareText(list.title, lines.join("\n"));
    if (outcome === "copied") toast(t("lists.copied"));
  };

  return (
    <article className={styles.card} data-finished={finished ? "" : undefined}>
      <button type="button" className={styles.summary} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          {list.thumbnail ? <img src={list.thumbnail} alt="" /> : <KindIcon size={20} />}
        </span>
        <span className={styles.text}>
          <strong>{list.title}</strong>
          <small>
            {t(`lists.kinds.${list.kind}`)} · {finished ? t("lists.allDone") : t("lists.progress", { done, total })}
            {shopping && totals.estimated > 0 && <> · {formatAriary(totals.estimated, locale)}</>}
          </small>
        </span>
        <ChevronDown size={18} className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>
      <div className={styles.progress} aria-hidden>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.more}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: easeOut }}
          >
            <div className={styles.moreInner}>
              {renaming && (
                <form
                  className={styles.rename}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get("title");
                    void listStore.rename(list.id, String(value ?? ""));
                    setRenaming(false);
                  }}
                >
                  <input name="title" defaultValue={list.title} autoFocus aria-label={t("lists.rename")} maxLength={200} />
                  <Button type="submit" size="md" icon={<Check />}>
                    {t("lists.save")}
                  </Button>
                </form>
              )}

              {list.items.length === 0 ? (
                <p className={styles.noItems}>{t("lists.noItems")}</p>
              ) : (
                <ul className={styles.items}>
                  {list.items.map((item) => (
                    <li key={item.id} data-done={item.done ? "" : undefined}>
                      <button
                        type="button"
                        className={styles.check}
                        role="checkbox"
                        aria-checked={item.done}
                        aria-label={item.text}
                        onClick={() => {
                          haptics.tap();
                          void listStore.toggle(list.id, item.id);
                        }}
                      >
                        {item.done && <Check size={14} strokeWidth={3} />}
                      </button>
                      {editingId === item.id ? (
                        <form
                          className={styles.editItem}
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            void listStore.editItem(list.id, item.id, {
                              text: String(data.get("text") ?? ""),
                              quantity: String(data.get("quantity") ?? ""),
                              priceMga: shopping ? parsePrice(data.get("price")) : item.priceMga,
                            });
                            setEditingId(null);
                          }}
                        >
                          <input name="text" defaultValue={item.text} autoFocus aria-label={t("lists.itemText")} maxLength={200} />
                          <input name="quantity" defaultValue={item.quantity ?? ""} placeholder={t("lists.quantity")} aria-label={t("lists.quantity")} className={styles.qty} />
                          {shopping && (
                            <input
                              name="price"
                              defaultValue={item.priceMga ?? ""}
                              inputMode="numeric"
                              placeholder={t("lists.price")}
                              aria-label={t("lists.price")}
                              className={styles.qty}
                            />
                          )}
                          <button type="submit" className={styles.iconButton} aria-label={t("lists.save")}>
                            <Check size={16} />
                          </button>
                        </form>
                      ) : (
                        <button type="button" className={styles.itemText} onClick={() => setEditingId(item.id)} aria-label={t("lists.editItem", { item: item.text })}>
                          <span>{item.text}</span>
                          {item.quantity && <small>{item.quantity}</small>}
                          {shopping && item.priceMga && <small className={styles.price}>{formatAriary(item.priceMga, locale)}</small>}
                        </button>
                      )}
                      <button type="button" className={styles.iconButton} onClick={() => void listStore.removeItem(list.id, item.id)} aria-label={t("lists.removeItem", { item: item.text })}>
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {shopping && totals.estimated > 0 && (
                <div className={styles.totals}>
                  <span>
                    {t("lists.estimated")}
                    <strong>{formatAriary(totals.estimated, locale)}</strong>
                  </span>
                  <span>
                    {t("lists.spent")}
                    <strong>{formatAriary(totals.spent, locale)}</strong>
                  </span>
                  {totals.unpriced > 0 && <small>{t("lists.unpriced", { count: totals.unpriced })}</small>}
                </div>
              )}

              <form className={shopping ? `${styles.addItem} ${styles.addItemPriced}` : styles.addItem} onSubmit={(event) => void add(event)}>
                <input value={text} onChange={(event) => setText(event.target.value)} placeholder={t("lists.addItem")} aria-label={t("lists.addItem")} maxLength={200} />
                <input value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={t("lists.quantity")} aria-label={t("lists.quantity")} className={styles.qty} />
                {shopping && (
                  <input
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    inputMode="numeric"
                    placeholder={t("lists.price")}
                    aria-label={t("lists.price")}
                    className={styles.qty}
                  />
                )}
                <button type="submit" className={styles.addButton} aria-label={t("lists.addItemButton")} disabled={!text.trim()}>
                  <Plus size={18} />
                </button>
              </form>

              <div className={styles.actions}>
                <Button variant="secondary" size="md" icon={<Share2 />} onClick={() => void share()} disabled={list.items.length === 0}>
                  {t("lists.share")}
                </Button>
                <Button variant="secondary" size="md" icon={<Pencil />} onClick={() => setRenaming((value) => !value)}>
                  {t("lists.rename")}
                </Button>
                {done > 0 && (
                  <>
                    <Button variant="secondary" size="md" icon={<RotateCcw />} onClick={() => void listStore.uncheckAll(list.id)}>
                      {t("lists.uncheckAll")}
                    </Button>
                    <Button variant="secondary" size="md" icon={<Check />} onClick={() => void listStore.clearDone(list.id)}>
                      {t("lists.clearDone")}
                    </Button>
                  </>
                )}
                {list.scanId && hasScan(list.scanId) && (
                  <Button variant="secondary" size="md" icon={<ScanLine />} href={`/result?id=${list.scanId}`}>
                    {t("lists.openScan")}
                  </Button>
                )}
                <Button
                  variant={confirmRemove ? "danger" : "ghost"}
                  size="md"
                  icon={<Trash2 />}
                  onClick={() => {
                    if (!confirmRemove) {
                      setConfirmRemove(true);
                      return;
                    }
                    haptics.press();
                    void listStore.remove(list.id);
                    toast(t("lists.removed"));
                  }}
                >
                  {confirmRemove ? t("lists.confirmRemove") : t("lists.remove")}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
