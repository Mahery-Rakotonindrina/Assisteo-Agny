import Link from "next/link";
import { FolderLock } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { paperKinds, type PaperKind } from "@/lib/ai/schema";
import { dayString, paperExpiry, paperKind } from "@/lib/papers";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import type { HistoryEntry } from "@/types/history";
import styles from "./Papers.module.scss";

/** Files a document in "Mes papiers" (or takes it out), and corrects its expiry date. */
export function PaperControls({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const kind = paperKind(entry);
  const expiry = paperExpiry(entry);

  const setKind = (value: string) => {
    haptics.tap();
    void historyStore.update(entry.id, { paper: (value || "none") as PaperKind | "none" });
  };

  return (
    <div className={styles.controls}>
      <p className={styles.status}>
        <FolderLock size={15} />
        {kind ? (
          <span>
            {t("papers.filed", { kind: t(`papers.kinds.${kind}`) })} <Link href="/papers">{t("papers.open")}</Link>
          </span>
        ) : (
          <span>{t("papers.notFiled")}</span>
        )}
      </p>
      <div className={styles.fields}>
        <label>
          <span>{t("papers.kind")}</span>
          <select value={kind ?? ""} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t("papers.notAPaper")}</option>
            {paperKinds.map((value) => (
              <option key={value} value={value}>
                {t(`papers.kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        {kind && (
          <label>
            <span>{t("papers.expiry")}</span>
            <input
              type="date"
              value={expiry !== null ? dayString(expiry) : ""}
              onChange={(event) => void historyStore.update(entry.id, { expiresOn: event.target.value || undefined })}
            />
          </label>
        )}
      </div>
    </div>
  );
}
