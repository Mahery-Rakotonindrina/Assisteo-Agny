import { useEffect, useState } from "react";
import { Camera, FileImage, History, ImageOff, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useHistory } from "@/hooks/useHistory";
import { useTranslation } from "@/hooks/useTranslation";
import { formatDate } from "@/lib/format";
import { canAddProof, loanProofs, MAX_PROOFS } from "@/lib/loanProof";
import type { Loan, LoanProof } from "@/lib/loans";
import { CaptureCancelledError, capturePhoto, type PhotoSource } from "@/services/camera";
import { haptics } from "@/services/device";
import { historyStore } from "@/services/historyStore";
import { loanProofStore } from "@/services/loanProofStore";
import { loanStore } from "@/services/loanStore";
import { Sheet } from "./LoanSheet";
import styles from "./Loans.module.scss";

// "Prêts": the proofs of a loan (a photo of the debt acknowledgment, the
// screenshot of a MVola transfer, a scan of the history), up to 5. The images
// are read from the device (services/loanProofStore.ts).

type Image = { preview: string; thumbnail: string };

/** A proof's image: undefined while read, null when gone (a scan removed from the history). */
function useProofImage(proof: LoanProof) {
  const [image, setImage] = useState<Image | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      loanProofStore.image(proof).then((found) => {
        if (!cancelled) setImage(found);
      });
    void load();
    const stopProofs = loanProofStore.subscribe(() => void load());
    const stopHistory = historyStore.subscribe(() => void load());
    return () => {
      cancelled = true;
      stopProofs();
      stopHistory();
    };
  }, [proof]);
  return image;
}

/** The proofs on a loan's card: thumbnails, and "Ajouter une preuve". */
export function LoanProofs({ loan, readOnly }: { loan: Loan; readOnly: boolean }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const proofs = loanProofs(loan);
  const viewed = proofs.find((proof) => proof.id === viewing) ?? null;
  if (readOnly && proofs.length === 0) return null;

  return (
    <div className={styles.proofs}>
      {proofs.length > 0 && (
        <ul className={styles.proofList} aria-label={t("loans.proofs.title")} data-testid="loan-proofs">
          {proofs.map((proof, index) => (
            <li key={proof.id}>
              <ProofThumb proof={proof} label={t("loans.proofs.open", { number: index + 1 })} onOpen={() => setViewing(proof.id)} />
            </li>
          ))}
        </ul>
      )}
      {!readOnly &&
        (canAddProof(loan) ? (
          <Button variant="ghost" icon={<Paperclip />} onClick={() => setAdding(true)}>
            {t("loans.proofs.add")}
          </Button>
        ) : (
          <small>{t("loans.proofs.full", { max: MAX_PROOFS })}</small>
        ))}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t("loans.proofs.add")}>
        {adding && <AddProof loan={loan} onClose={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={viewed !== null} onClose={() => setViewing(null)} title={t("loans.proofs.viewTitle")}>
        {viewed && <ProofView key={viewed.id} loan={loan} proof={viewed} readOnly={readOnly} onClose={() => setViewing(null)} />}
      </Sheet>
    </div>
  );
}

function ProofThumb({ proof, label, onOpen }: { proof: LoanProof; label: string; onOpen: () => void }) {
  const image = useProofImage(proof);
  return (
    <button type="button" className={styles.proofThumb} onClick={onOpen} aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the device */}
      {image ? <img src={image.thumbnail} alt="" /> : image === null ? <ImageOff size={18} /> : null}
    </button>
  );
}

function ProofView({ loan, proof, readOnly, onClose }: { loan: Loan; proof: LoanProof; readOnly: boolean; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const image = useProofImage(proof);
  const [confirm, setConfirm] = useState(false);

  const remove = async () => {
    haptics.tap();
    await loanStore.removeProof(loan.id, proof.id);
    toast(t("loans.proofs.removed"));
    onClose();
  };

  return (
    <div className={styles.sheetForm}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the device */}
      {image ? <img className={styles.proofImage} src={image.preview} alt={t("loans.proofs.viewTitle")} /> : image === null && <p className={styles.hint}>{t("loans.proofs.gone")}</p>}
      <small className={styles.hint}>
        {t(proof.kind === "scan" ? "loans.proofs.fromScan" : "loans.proofs.addedOn", { date: formatDate(proof.addedAt, locale) })}
      </small>
      {!readOnly && (
        <div className={styles.sheetActions}>
          {confirm ? (
            <Button variant="danger" block icon={<Trash2 />} onClick={() => void remove()}>
              {t("loans.proofs.confirmRemove")}
            </Button>
          ) : (
            <Button variant="ghost" block icon={<Trash2 />} onClick={() => setConfirm(true)}>
              {t("loans.proofs.remove")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Prendre une photo", "Choisir une image", or "Depuis mes scans". */
function AddProof({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [fromScans, setFromScans] = useState(false);
  const [busy, setBusy] = useState(false);

  const added = (proof: LoanProof | null) => {
    if (!proof) {
      toast(t("loans.proofs.full", { max: MAX_PROOFS }), "error");
      return;
    }
    haptics.success();
    toast(t("loans.proofs.added"));
    onClose();
  };

  const photo = async (source: PhotoSource) => {
    if (busy) return;
    setBusy(true);
    try {
      const src = await capturePhoto(source);
      added(await loanStore.addPhotoProof(loan.id, src));
    } catch (error) {
      if (!(error instanceof CaptureCancelledError)) toast(t("loans.proofs.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (fromScans) return <ScanChoice loan={loan} onPick={async (scanId) => added(await loanStore.addScanProof(loan.id, scanId))} />;

  return (
    <div className={styles.choices}>
      <p className={styles.hint}>{t("loans.proofs.hint")}</p>
      <Button block variant="secondary" icon={<Camera />} disabled={busy} onClick={() => void photo("camera")}>
        {t("loans.proofs.camera")}
      </Button>
      <Button block variant="secondary" icon={<FileImage />} disabled={busy} onClick={() => void photo("gallery")}>
        {t("loans.proofs.gallery")}
      </Button>
      <Button block variant="secondary" icon={<History />} disabled={busy} onClick={() => setFromScans(true)}>
        {t("loans.proofs.fromScans")}
      </Button>
    </div>
  );
}

/** The scans of the history, newest first (those attached already left out). */
function ScanChoice({ loan, onPick }: { loan: Loan; onPick: (scanId: string) => Promise<void> }) {
  const { t, locale } = useTranslation();
  const { entries, isLoading } = useHistory();
  const attached = new Set(loanProofs(loan).flatMap((proof) => (proof.scanId ? [proof.scanId] : [])));
  const shown = entries.filter((entry) => !attached.has(entry.id)).slice(0, 40);
  if (isLoading) return null;
  if (shown.length === 0) return <p className={styles.hint}>{t("loans.proofs.noScans")}</p>;
  return (
    <ul className={styles.scanChoices} aria-label={t("loans.proofs.fromScans")}>
      {shown.map((entry) => (
        <li key={entry.id}>
          <button type="button" className={styles.scanChoice} onClick={() => void onPick(entry.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the device */}
            <img src={entry.thumbnail} alt="" />
            <span>
              <strong>{entry.analysis.title}</strong>
              <small>{formatDate(entry.createdAt, locale)}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
