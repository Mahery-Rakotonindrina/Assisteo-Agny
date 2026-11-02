import { useState, type FormEvent } from "react";
import { Camera, Check, House, ImagePlus } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { homeCategories, homeRooms, type HomeCategory, type HomeItem, type HomeRoom } from "@/lib/inventory";
import { parseNumber } from "@/lib/money";
import { CaptureCancelledError, capturePhoto, type PhotoSource } from "@/services/camera";
import { haptics } from "@/services/device";
import { homeItemPhoto, homeItemStore, type HomeItemFields } from "@/services/homeItemStore";
import { requestNotificationPermission } from "@/services/notifications";
import styles from "./Inventory.module.scss";

/** Adds a thing of the home (no `item`) or edits one. */
export function ItemForm({ item, canRemind, onDone }: { item?: HomeItem; canRemind: boolean; onDone: (id?: string) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [thumbnail, setThumbnail] = useState(item?.thumbnail);
  const [room, setRoom] = useState<HomeRoom | "">(item?.room ?? "");
  const [category, setCategory] = useState<HomeCategory | "">(item?.category ?? "");
  const [boughtOn, setBoughtOn] = useState(item?.boughtOn ?? "");
  const [price, setPrice] = useState(item?.priceMga ? String(item.priceMga) : "");
  const [store, setStore] = useState(item?.store ?? "");
  const [warrantyUntil, setWarrantyUntil] = useState(item?.warrantyUntil ?? "");
  const [serial, setSerial] = useState(item?.serial ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false);

  const photo = async (source: PhotoSource) => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await homeItemPhoto(await capturePhoto(source));
      if (picked) setThumbnail(picked);
    } catch (error) {
      if (!(error instanceof CaptureCancelledError)) toast(t("inventory.photoFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    haptics.success();
    const fields: HomeItemFields = {
      name,
      thumbnail,
      room: room || undefined,
      category: category || undefined,
      boughtOn,
      priceMga: parseNumber(price) ?? undefined,
      store,
      warrantyUntil,
      serial,
      note,
    };
    // The warranty reminder needs the notifications: asked here, where the user expects it.
    if (canRemind && warrantyUntil && warrantyUntil !== item?.warrantyUntil) await requestNotificationPermission().catch(() => undefined);
    if (item) {
      await homeItemStore.edit(item.id, fields);
      onDone(item.id);
    } else {
      const created = await homeItemStore.create(fields, t("inventory.defaultName"));
      onDone(created.id);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} data-testid="inventory-form">
      <div className={styles.photoRow}>
        <span className={styles.thumb} data-large>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          {thumbnail ? <img src={thumbnail} alt="" /> : <House size={26} />}
        </span>
        <div className={styles.row}>
          <Button variant="secondary" icon={<Camera />} onClick={() => void photo("camera")} disabled={busy}>
            {t("inventory.takePhoto")}
          </Button>
          <Button variant="ghost" icon={<ImagePlus />} onClick={() => void photo("gallery")} disabled={busy}>
            {t("inventory.choosePhoto")}
          </Button>
        </div>
      </div>
      <div className={styles.fields}>
        <label className={styles.wide}>
          <span>{t("inventory.fields.name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("inventory.fields.namePlaceholder")} maxLength={60} autoFocus={!item} />
        </label>
        <label>
          <span>{t("inventory.fields.room")}</span>
          <select value={room} onChange={(event) => setRoom(event.target.value as HomeRoom | "")}>
            <option value="">—</option>
            {homeRooms.map((value) => (
              <option key={value} value={value}>
                {t(`inventory.rooms.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("inventory.fields.category")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as HomeCategory | "")}>
            <option value="">—</option>
            {homeCategories.map((value) => (
              <option key={value} value={value}>
                {t(`inventory.categories.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("inventory.fields.boughtOn")}</span>
          <input type="date" value={boughtOn} onChange={(event) => setBoughtOn(event.target.value)} />
        </label>
        <label>
          <span>{t("inventory.fields.price")}</span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" placeholder="450 000" />
        </label>
        <label>
          <span>{t("inventory.fields.store")}</span>
          <input value={store} onChange={(event) => setStore(event.target.value)} maxLength={80} />
        </label>
        <label>
          <span>{t("inventory.fields.warrantyUntil")}</span>
          <input type="date" value={warrantyUntil} onChange={(event) => setWarrantyUntil(event.target.value)} />
        </label>
        <label className={styles.wide}>
          <span>{t("inventory.fields.serial")}</span>
          <input value={serial} onChange={(event) => setSerial(event.target.value)} maxLength={40} autoCapitalize="characters" />
        </label>
        <label className={styles.wide}>
          <span>{t("inventory.fields.note")}</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        </label>
      </div>
      {warrantyUntil && <small className={styles.hint}>{canRemind ? t("inventory.reminderHint") : t("inventory.reminderOff")}</small>}
      <div className={styles.row}>
        <Button type="submit" icon={<Check />}>
          {item ? t("inventory.save") : t("inventory.create")}
        </Button>
        <Button variant="ghost" onClick={() => onDone(item?.id)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
