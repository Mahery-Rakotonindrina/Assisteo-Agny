import { useState, type FormEvent } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate, toDateInput } from "@/lib/format";
import { XLSX_TYPE } from "@/lib/excel";
import { annexProofs } from "@/lib/loanProof";
import type { Loan } from "@/lib/loans";
import { pdfFileName } from "@/lib/pdf";
import { haptics } from "@/services/device";
import { shareFile } from "@/services/fileShare";
import { loanProofStore } from "@/services/loanProofStore";
import { Sheet } from "./LoanSheet";
import styles from "./Loans.module.scss";
import { useAccountName } from "./useAccountName";

// The papers of "Prêts": the debt acknowledgment of one loan, and the exports
// (Excel, PDF) of every loan or of one person's. jsPDF and ExcelJS are only
// loaded when a file is made.

const timestamp = () => Date.now();

/** "Reconnaissance de dette (PDF)": the user's name (from the account) and the place, then the PDF. */
export function AckSheet({ open, onClose, loan }: { open: boolean; onClose: () => void; loan: Loan | null }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open && loan !== null} onClose={onClose} title={t("loans.ack.title")}>
      {loan && <AckFields key={loan.id} loan={loan} onClose={onClose} />}
    </Sheet>
  );
}

function AckFields({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const accountName = useAccountName();
  // Null until typed: the account's name shows, even when the account is read after the sheet opened.
  const [typed, setTyped] = useState<string | null>(null);
  const me = typed ?? accountName;
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  // The proofs' photos in annex, one page each (offered when there are some).
  const proofs = annexProofs(loan);
  const [withAnnex, setWithAnnex] = useState(true);

  const make = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    haptics.tap();
    setBusy(true);
    try {
      const { exportAcknowledgment } = await import("@/services/loanPdf");
      const images = withAnnex ? (await Promise.all(proofs.map((proof) => loanProofStore.image(proof)))).flatMap((image) => (image ? [image.preview] : [])) : [];
      const result = await exportAcknowledgment(loan, { me, place }, timestamp(), t, locale, images);
      if (result === "downloaded") toast(t("pdf.downloaded"));
      onClose();
    } catch {
      toast(t("pdf.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.sheetForm} onSubmit={(event) => void make(event)}>
      <p className={styles.hint}>{t("loans.ack.hint")}</p>
      <label className={styles.field}>
        <span>{t(`loans.ack.me.${loan.direction}`)}</span>
        <input value={me} onChange={(event) => setTyped(event.target.value)} maxLength={80} autoComplete="name" />
      </label>
      <label className={styles.field}>
        <span>{t("loans.ack.place")}</span>
        <input value={place} onChange={(event) => setPlace(event.target.value)} placeholder={t("loans.ack.placePlaceholder")} maxLength={60} />
      </label>
      {proofs.length > 0 && (
        <label className={styles.toggle}>
          <input type="checkbox" checked={withAnnex} onChange={(event) => setWithAnnex(event.target.checked)} />
          {proofs.length === 1 ? t("loans.ack.withProof") : t("loans.ack.withProofs", { count: proofs.length })}
        </label>
      )}
      <div className={styles.sheetActions}>
        <Button type="submit" block icon={<FileText />} disabled={busy}>
          {busy ? t("pdf.making") : t("loans.ack.make")}
        </Button>
      </div>
    </form>
  );
}

/** "Exporter (Excel, PDF)": every loan, or only one person's (`person`). */
export function ExportSheet({ open, onClose, loans, person }: { open: boolean; onClose: () => void; loans: Loan[]; person?: string }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (kind: "excel" | "pdf") => {
    if (busy || loans.length === 0) return;
    haptics.tap();
    setBusy(true);
    const now = timestamp();
    const title = person ? t("loans.export.titlePerson", { name: person }) : t("loans.export.title");
    const subtitle = t("loans.export.exportedOn", {
      date: formatDate(now, locale),
    });
    const file = `${t("loans.export.file")}-${person ? `${person}-` : ""}${toDateInput(now)}`;
    try {
      let result: Awaited<ReturnType<typeof shareFile>>;
      if (kind === "excel") {
        const { loansWorkbook } = await import("@/lib/loanExport");
        const bytes = await loansWorkbook(loans, now, t, { title, subtitle }, { account: Boolean(person) });
        // The same safe name as the PDF, as .xlsx.
        result = await shareFile(pdfFileName(file).replace(/\.pdf$/, ".xlsx"), bytes, XLSX_TYPE, title);
      } else {
        const { exportLoansPdf } = await import("@/services/loanPdf");
        result = await exportLoansPdf(loans, now, { title, subtitle, file }, t, locale, { account: Boolean(person) });
      }
      if (result === "downloaded") toast(t("loans.export.downloaded"));
      onClose();
    } catch {
      toast(t("loans.export.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={person ? t("loans.export.sheetTitlePerson", { name: person }) : t("loans.export.sheetTitle")}>
      <div className={styles.choices}>
        {busy && <p className={styles.hint}>{t("loans.export.working")}</p>}
        <Button block variant="secondary" icon={<FileSpreadsheet />} disabled={busy} onClick={() => void run("excel")}>
          {t("loans.export.excel")}
        </Button>
        <small>{t("loans.export.excelHint")}</small>
        <Button block variant="secondary" icon={<FileText />} disabled={busy} onClick={() => void run("pdf")}>
          {t("loans.export.pdf")}
        </Button>
        <small>{t("loans.export.pdfHint")}</small>
      </div>
    </Sheet>
  );
}
