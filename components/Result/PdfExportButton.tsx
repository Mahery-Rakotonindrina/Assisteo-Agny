import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanBadge } from "@/components/PlanBadge";
import { useToast } from "@/components/Toast";
import { usePlan } from "@/hooks/usePlan";
import { useTranslation } from "@/hooks/useTranslation";
import { planFor } from "@/lib/plans";
import { haptics } from "@/services/device";
import { exportDocumentPdf } from "@/services/documentPdf";
import type { HistoryEntry } from "@/types/history";

/** "Export as PDF" for a document (Lite and up); otherwise the plan that has it. */
export function PdfExportButton({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { has } = usePlan();
  const [busy, setBusy] = useState(false);

  if (!has("pdfExport")) {
    return (
      <Button variant="secondary" icon={<FileDown />} href="/plans" block>
        {t("pdf.export")} <PlanBadge plan={planFor("pdfExport")} />
      </Button>
    );
  }

  const run = async () => {
    haptics.tap();
    setBusy(true);
    try {
      if ((await exportDocumentPdf(entry, t, locale)) === "downloaded") toast(t("pdf.downloaded"));
    } catch {
      toast(t("pdf.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="secondary" icon={<FileDown />} onClick={() => void run()} disabled={busy} block>
      {busy ? t("pdf.making") : t("pdf.export")}
    </Button>
  );
}
