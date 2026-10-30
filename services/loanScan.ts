import type { LoanReading, LoanScanResponse } from "@/lib/ai/schema";
import { prepareCapture } from "@/lib/image";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";

// "Prêts": a photo of a debt acknowledgment, read by the AI (/api/loans/scan)
// to fill in the loan form (lib/loanScan.ts). The photo is sized like a scan;
// the server reads it and forgets it.

export async function readAcknowledgment(src: string, locale: "fr" | "en"): Promise<{ reading: LoanReading; demo: boolean }> {
  const { upload } = await prepareCapture(src);
  const response = await httpClient.post<LoanScanResponse>("/api/loans/scan", { image: upload.base64, mediaType: upload.mediaType, locale }, { headers: await authHeaders() });
  return { reading: response.reading, demo: response.demo };
}
