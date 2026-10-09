import { isMainSubject, type ScannedCode } from "@/lib/codes";
import { loadImage } from "@/lib/image";
import { isSavingData } from "./dataSaver";
import { isNative } from "./device";

// Reads QR codes and barcodes on a photo, on the phone itself: no AI, no
// scan spent. The reader (ZXing, ~1 MB of WebAssembly in public/vendor, see
// scripts/copy-wasm.mjs) only loads with the first photo.

export type CodeReading = { codes: ScannedCode[]; mainSubject: boolean };

const none: CodeReading = { codes: [], mainSubject: false };
const TIMEOUT_MS = 4000;
const MAX_EDGE = 1600;
const formats = ["QRCode", "DataMatrix", "Aztec", "PDF417", "EANUPC", "Code128", "Code39", "ITF"] as const;
const matrix = new Set(["QRCode", "DataMatrix", "Aztec", "PDF417", "MaxiCode"]);
const labels: Record<string, string> = {
  QRCode: "QR Code",
  MicroQRCode: "QR Code",
  DataMatrix: "Data Matrix",
  EAN13: "EAN-13",
  EAN8: "EAN-8",
  UPCA: "UPC-A",
  UPCE: "UPC-E",
  ISBN: "ISBN",
  Code128: "Code 128",
  Code39: "Code 39",
};

type Point = { x: number; y: number };

type ReaderModule = typeof import("zxing-wasm/reader");

/** Our copy of the WebAssembly (the library's default is a CDN, which the CSP blocks). */
function pointToLocalWasm(zxing: ReaderModule) {
  zxing.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/vendor/${path}` : prefix + path) },
  });
}

let reader: Promise<ReaderModule> | null = null;
function loadReader() {
  reader ??= import("zxing-wasm/reader")
    .then((zxing) => {
      pointToLocalWasm(zxing);
      return zxing;
    })
    .catch((error: unknown) => {
      // Offline on the web: try again with the next photo instead of giving up for good.
      reader = null;
      throw error;
    });
  return reader;
}

/** Shoelace formula over the code's four corners. */
function area(points: Point[]) {
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum) / 2;
}

async function read(src: string): Promise<CodeReading> {
  const image = await loadImage(src);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return none;
  context.drawImage(image, 0, 0, width, height);

  const zxing = await loadReader();
  let results: Awaited<ReturnType<ReaderModule["readBarcodes"]>>;
  try {
    results = await zxing.readBarcodes(context.getImageData(0, 0, width, height), { formats: [...formats], tryHarder: true, maxNumberOfSymbols: 6 });
  } catch (error) {
    // The WebAssembly couldn't load (no network): forget the failed attempt
    // (the purge also forgets where our copy is) so the next photo fetches it again.
    zxing.purgeZXingModule();
    pointToLocalWasm(zxing);
    throw error;
  }

  const codes: ScannedCode[] = [];
  let mainSubject = false;
  for (const result of results) {
    if (!result.isValid || !result.text || codes.some((code) => code.text === result.text)) continue;
    const code: ScannedCode = { kind: matrix.has(result.symbology) ? "qr" : "barcode", format: labels[result.format] ?? result.format, text: result.text };
    const { topLeft, topRight, bottomRight, bottomLeft } = result.position;
    if (isMainSubject(code, area([topLeft, topRight, bottomRight, bottomLeft]) / (width * height))) mainSubject = true;
    codes.push(code);
  }
  return { codes, mainSubject };
}

/**
 * Loads the reader's code ahead (small; the WebAssembly still waits for the
 * first photo): a photo taken offline can then still be read. On the web, a
 * module that failed to load offline stays failed until the page reloads.
 */
export function preloadCodeReader() {
  if (typeof navigator === "undefined" || (!isNative() && (!navigator.onLine || isSavingData()))) return;
  void loadReader().catch(() => undefined);
}

/** The codes on a photo, and whether one is what the photo is about. Never throws, never waits long. */
export async function readCodes(src: string): Promise<CodeReading> {
  // On the web with the data saver, the reader's download isn't worth it.
  if (!isNative() && isSavingData()) return none;
  try {
    return await Promise.race([read(src), new Promise<CodeReading>((resolve) => setTimeout(() => resolve(none), TIMEOUT_MS))]);
  } catch {
    return none;
  }
}
