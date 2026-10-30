import { MAX_STATEMENT_PAGES, StatementSchema, type PageImage, type StatementResponse } from "@/lib/ai/schema";
import { encodeImage } from "@/lib/image";
import { dayString } from "@/lib/papers";
import { ApiError } from "@/types/api";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";

// "Mes dépenses": a statement's screenshots or PDF, sent once to be read. Nothing
// is kept: not in the scans' history, not on the server. Only the operations
// the user imports stay (lib/statement.ts).

/** The PDF itself goes to the AI: at most 3 MB, so the request fits. */
export const MAX_STATEMENT_PDF_BYTES = 3 * 1024 * 1024;

export type StatementPick = { error: "tooMany" | "pdfAlone" | "pdfTooBig" | "unsupported" } | { images: File[] } | { pdf: File };

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** The files picked: up to 10 screenshots, or one PDF on its own. */
export function pickStatementFiles(files: File[]): StatementPick {
  const pdfs = files.filter(isPdf);
  if (pdfs.length > 0) {
    if (files.length > 1) return { error: "pdfAlone" };
    return pdfs[0].size > MAX_STATEMENT_PDF_BYTES ? { error: "pdfTooBig" } : { pdf: pdfs[0] };
  }
  if (files.some((file) => !file.type.startsWith("image/"))) return { error: "unsupported" };
  if (files.length > MAX_STATEMENT_PAGES) return { error: "tooMany" };
  return files.length > 0 ? { images: files } : { error: "unsupported" };
}

function base64Of(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read this file."));
    reader.readAsDataURL(file);
  });
}

/** A screenshot, tall and full of small figures: a long edge of 1800 px stays legible and light. */
async function page(file: File): Promise<PageImage> {
  const src = URL.createObjectURL(file);
  try {
    const encoded = await encodeImage(src, 1800, 0.72);
    return { image: encoded.base64, mediaType: encoded.mediaType };
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Sends the statement to be read; the answer is checked against the contract. */
export async function readStatementFiles(pick: { images: File[] } | { pdf: File }, locale: "fr" | "en"): Promise<StatementResponse> {
  // The user's day: the histories say "Aujourd'hui" and "Hier".
  const today = dayString(Date.now());
  const body = "pdf" in pick ? { locale, today, pdf: await base64Of(pick.pdf) } : { locale, today, pages: await Promise.all(pick.images.map(page)) };
  const response = await httpClient.post<StatementResponse>("/api/expenses/statement", body, { headers: await authHeaders() });
  const statement = StatementSchema.safeParse(response.statement);
  if (!statement.success) throw new ApiError("Unusable statement", 502);
  return { ...response, statement: statement.data };
}
