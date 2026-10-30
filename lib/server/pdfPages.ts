// How many pages a statement's PDF has, without a PDF library: each page is a
// "/Type /Page" object. PDFs that pack their objects in compressed streams
// hide them; their size gives an estimate then (about 150 KB a page).

const PAGE_OBJECT = /\/Type\s*\/Page(?![A-Za-z])/g;
const BYTES_PER_PAGE = 150 * 1024;

/** The pages of a PDF sent in base64 (at least 1). */
export function pdfPageCount(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  const found = bytes.toString("latin1").match(PAGE_OBJECT)?.length ?? 0;
  return found > 0 ? found : Math.max(1, Math.ceil(bytes.length / BYTES_PER_PAGE));
}

/** The first bytes of every PDF file. */
export const isPdf = (base64: string) => Buffer.from(base64.slice(0, 8), "base64").toString("latin1").startsWith("%PDF");
