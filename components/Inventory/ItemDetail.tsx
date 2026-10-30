import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, FileText, House, Paperclip, Pencil, ScanLine, Trash2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useNow } from "@/hooks/useNow";
import { useTranslation } from "@/hooks/useTranslation";
import { formatAriary, formatDate } from "@/lib/format";
import { isHomePaper, MAX_PAPERS, warrantyStatus, type HomeItem } from "@/lib/inventory";
import { parseDay } from "@/lib/papers";
import { haptics } from "@/services/device";
import { homeItemStore } from "@/services/homeItemStore";
import type { HistoryEntry } from "@/types/history";
import { ItemForm } from "./ItemForm";
import { WarrantyPill } from "./WarrantyPill";
import styles from "./Inventory.module.scss";

/** One thing of the home: what is known of it, its warranty, its papers; edit or remove it. */
export function ItemDetail({ item, readOnly, canRemind, onBack }: { item: HomeItem; readOnly: boolean; canRemind: boolean; onBack: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const now = useNow(60_000);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const status = warrantyStatus(item, now);

  if (editing) return <ItemForm item={item} canRemind={canRemind} onDone={() => setEditing(false)} />;

  const day = (value: string | undefined) => {
    const time = parseDay(value);
    return time === null ? null : formatDate(time, locale);
  };
  const facts = [
    item.room && { label: t("inventory.fields.room"), value: t(`inventory.rooms.${item.room}`) },
    item.category && { label: t("inventory.fields.category"), value: t(`inventory.categories.${item.category}`) },
    day(item.boughtOn) && { label: t("inventory.fields.boughtOn"), value: day(item.boughtOn)! },
    item.priceMga && { label: t("inventory.fields.price"), value: formatAriary(item.priceMga, locale) },
    item.store && { label: t("inventory.fields.store"), value: item.store },
    day(item.warrantyUntil) && { label: t("inventory.fields.warrantyUntil"), value: day(item.warrantyUntil)! },
    item.serial && { label: t("inventory.fields.serial"), value: item.serial },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  const remove = async () => {
    haptics.tap();
    await homeItemStore.remove(item.id);
    toast(t("inventory.removed"));
    onBack();
  };

  return (
    <div className={styles.detail} data-testid="inventory-detail">
      <button type="button" className={styles.back} onClick={onBack}>
        <ChevronLeft size={16} /> {t("inventory.back")}
      </button>
      <div className={styles.detailHead}>
        <span className={styles.thumb} data-large>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <House size={26} />}
        </span>
        <span className={styles.text}>
          <h2>{item.name}</h2>
          {status && <WarrantyPill status={status} />}
        </span>
      </div>

      {facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {status === "active" && !readOnly && <small className={styles.hint}>{canRemind ? t("inventory.reminderHint") : t("inventory.reminderOff")}</small>}
      {item.note && <p className={styles.note}>{item.note}</p>}

      <Papers item={item} readOnly={readOnly} />

      {!readOnly && (
        <div className={styles.row}>
          <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
            {t("inventory.edit")}
          </Button>
          {confirm ? (
            <Button variant="danger" icon={<Trash2 />} onClick={() => void remove()}>
              {t("inventory.confirmRemove")}
            </Button>
          ) : (
            <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirm(true)}>
              {t("inventory.remove")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The papers of a thing (invoice, till receipt, warranty card), and "Lier un papier" among the scans. */
function Papers({ item, readOnly }: { item: HomeItem; readOnly: boolean }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { entries } = useHistory();
  const [picking, setPicking] = useState(false);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  // The invoices and receipts first; any other document can be linked too.
  const choices = entries.filter((entry) => !item.scanIds.includes(entry.id) && entry.analysis.category === "document");
  const sorted = [...choices.filter((entry) => isHomePaper(entry.analysis)), ...choices.filter((entry) => !isHomePaper(entry.analysis))].slice(0, 30);

  const link = async (entry: HistoryEntry) => {
    haptics.tap();
    const done = await homeItemStore.linkPaper(item.id, entry);
    toast(done ? t("inventory.papers.linked") : t("inventory.papers.full", { max: MAX_PAPERS }), done ? undefined : "error");
    setPicking(false);
  };

  if (readOnly && item.scanIds.length === 0) return null;

  return (
    <section className={styles.section}>
      <h3>{t("inventory.papers.title")}</h3>
      {item.scanIds.length === 0 && <p className={styles.hint}>{t("inventory.papers.none")}</p>}
      {item.scanIds.length > 0 && (
        <ul className={styles.papers} data-testid="inventory-papers">
          {item.scanIds.map((scanId) => {
            const entry = byId.get(scanId);
            return (
              <li key={scanId} className={styles.paper}>
                <Link href={{ pathname: "/result", query: { id: scanId } }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                  {entry?.thumbnail ? <img src={entry.thumbnail} alt="" /> : <span className={styles.paperIcon}><FileText size={18} /></span>}
                  <span>
                    {entry ? entry.analysis.title : t("inventory.papers.gone")}
                    {entry && <small>{formatDate(entry.createdAt, locale)}</small>}
                  </span>
                </Link>
                {!readOnly && (
                  <button type="button" aria-label={t("inventory.papers.unlink")} onClick={() => void homeItemStore.unlinkPaper(item.id, scanId)}>
                    <X size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && item.scanIds.length < MAX_PAPERS && (
        <div className={styles.row}>
          <Button variant="ghost" icon={<Paperclip />} onClick={() => setPicking((open) => !open)}>
            {t("inventory.papers.add")}
          </Button>
          <Button variant="ghost" href="/?mode=document" icon={<ScanLine />}>
            {t("inventory.papers.scan")}
          </Button>
        </div>
      )}
      {picking &&
        (sorted.length === 0 ? (
          <p className={styles.hint}>{t("inventory.papers.noScans")}</p>
        ) : (
          <ul className={styles.picker} data-testid="inventory-paper-picker">
            {sorted.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => void link(entry)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                  {entry.thumbnail && <img src={entry.thumbnail} alt="" />}
                  <span className={styles.text}>
                    <strong>{entry.analysis.title}</strong>
                    <small>{formatDate(entry.createdAt, locale)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
