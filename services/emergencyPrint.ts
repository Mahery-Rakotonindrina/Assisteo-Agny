import type { jsPDF } from "jspdf";
import { clampLines, pictureFileName, stackRows, wrapText, type Measure, type PrintableCard } from "@/lib/emergencyPrint";
import { pdfFileName, pdfText, PdfWriter } from "@/lib/pdf";
import { shareFile } from "./fileShare";

// "Imprimer la carte" and "Fond d'écran" (fiche d'urgence): the card drawn on
// the device, offline — a wallet card (85.6 × 54 mm, front and back side by
// side with cut marks and a fold) on an A4 PDF, or a phone-sized picture with
// the top left free for the lock screen's clock. Shared like any file.

type Translate = (key: string, params?: Record<string, string | number>) => string;

// The card's colours: the red of a first-aid cross on white paper.
const RED: [number, number, number] = [200, 16, 46];
const RED_SOFT: [number, number, number] = [251, 233, 236];
const INK = 30;
const GREY = 105;

/** Credit-card size (ISO/IEC 7810 ID-1), in mm. */
export const CARD = { width: 85.6, height: 54 };
const PAD = 3.5;
const BAND = 9;
/** A font size in points, as a line height in mm. */
const lineMm = (size: number) => size * 0.3528 * 1.18;

function pdfFont(doc: jsPDF, size: number, style: "normal" | "bold", color: number | [number, number, number]): Measure {
  doc.setFont("helvetica", style).setFontSize(size);
  if (typeof color === "number") doc.setTextColor(color);
  else doc.setTextColor(...color);
  return (text) => doc.getTextWidth(pdfText(text));
}

/** Lines whose top is at `y` (jsPDF draws on the baseline). */
function pdfLines(doc: jsPDF, lines: string[], x: number, y: number, size: number) {
  const height = lineMm(size);
  lines.forEach((line, index) => doc.text(pdfText(line), x, y + index * height + size * 0.3528 * 0.85));
  return lines.length * height;
}

/** Label/value rows in a box of the card. */
function pdfRows(doc: jsPDF, rows: PrintableCard["rows"], x: number, y: number, width: number, height: number) {
  const label = 6.5;
  const value = 8;
  const measure = pdfFont(doc, value, "normal", INK);
  const stacked = stackRows(rows, { width, height, labelHeight: lineMm(label), lineHeight: lineMm(value), gap: 1.4 }, measure);
  let top = y;
  for (const row of stacked) {
    pdfFont(doc, label, "bold", GREY);
    top += pdfLines(doc, clampLines(wrapText(row.label, width, (text) => doc.getTextWidth(pdfText(text))), 1, width, (text) => doc.getTextWidth(pdfText(text))), x, top, label);
    pdfFont(doc, value, "normal", INK);
    top += pdfLines(doc, row.lines, x, top, value) + 1.4;
  }
}

function front(doc: jsPDF, card: PrintableCard, x: number, y: number, t: Translate) {
  // The title on a red band: what this card is, at a glance.
  doc.setFillColor(...RED).rect(x, y, CARD.width, BAND, "F");
  const titleWidth = CARD.width - 2 * PAD;
  const measure = pdfFont(doc, 9, "bold", 255);
  pdfLines(doc, clampLines(wrapText(card.title, titleWidth, measure), 1, titleWidth, measure), x + PAD, y + (BAND - lineMm(9)) / 2, 9);

  const top = y + BAND + PAD;
  const height = CARD.height - BAND - 2 * PAD;
  let left = x + PAD;
  if (card.blood) {
    // The blood group, large, in its own block: the first thing looked for.
    const width = 24;
    doc.setFillColor(...RED_SOFT).roundedRect(left, top, width, height, 1.6, 1.6, "F");
    const labelMeasure = pdfFont(doc, 6, "bold", GREY);
    const label = clampLines(wrapText(card.bloodLabel, width - 3, labelMeasure), 2, width - 3, labelMeasure);
    const labelHeight = pdfLines(doc, label, left + 1.5, top + 1.5, 6);
    const short = card.blood.length <= 3;
    const size = short ? 26 : 8;
    const valueMeasure = pdfFont(doc, size, "bold", RED);
    const value = clampLines(wrapText(card.blood, width - 3, valueMeasure), 3, width - 3, valueMeasure);
    const valueTop = top + labelHeight + (height - labelHeight - value.length * lineMm(size)) / 2;
    value.forEach((line, index) => doc.text(pdfText(line), left + width / 2, valueTop + index * lineMm(size) + size * 0.3528 * 0.85, { align: "center" }));
    left += width + 3;
  }
  const width = x + CARD.width - PAD - left;
  if (card.rows.length) pdfRows(doc, card.rows, left, top, width, height);
  else if (card.contact) {
    const measure = pdfFont(doc, 7.5, "normal", GREY);
    pdfLines(doc, wrapText(t("health.emergency.print.seeBack"), width, measure), left, top, 7.5);
  }
}

function back(doc: jsPDF, card: PrintableCard, x: number, y: number) {
  const width = CARD.width - 2 * PAD;
  let top = y + PAD;
  const bottom = y + CARD.height - PAD - (card.updated ? lineMm(6) + 1 : 0);
  if (card.contact) {
    let measure = pdfFont(doc, 7, "bold", RED);
    top += pdfLines(doc, clampLines(wrapText(card.contact.label, width, measure), 1, width, measure), x + PAD, top, 7) + 0.6;
    if (card.contact.who) {
      measure = pdfFont(doc, 9.5, "bold", INK);
      top += pdfLines(doc, clampLines(wrapText(card.contact.who, width, measure), 2, width, measure), x + PAD, top, 9.5);
    }
    if (card.contact.phone) {
      // The number in large type, smaller only if it would not fit on one line.
      let size = 17;
      measure = pdfFont(doc, size, "bold", INK);
      while (size > 10 && measure(card.contact.phone) > width) measure = pdfFont(doc, (size -= 1), "bold", INK);
      top += pdfLines(doc, clampLines(wrapText(card.contact.phone, width, measure), 1, width, measure), x + PAD, top + 0.4, size) + 0.4;
    }
    top += 2;
    if (card.note) doc.setDrawColor(225).setLineWidth(0.2).line(x + PAD, top - 1, x + CARD.width - PAD, top - 1);
  }
  if (card.note && bottom - top > 4) pdfRows(doc, [card.note], x + PAD, top, width, bottom - top);
  if (card.updated) {
    const measure = pdfFont(doc, 6, "normal", GREY);
    pdfLines(doc, clampLines(wrapText(card.updated, width, measure), 1, width, measure), x + PAD, y + CARD.height - PAD - lineMm(6), 6);
  }
}

/** Short marks outside each corner, where to cut. */
function cutMarks(doc: jsPDF, x: number, y: number, width: number, height: number) {
  const gap = 1;
  const length = 2.4;
  doc.setDrawColor(60).setLineWidth(0.2).setLineDashPattern([], 0);
  for (const cx of [x, x + width])
    for (const cy of [y, y + height]) {
      const dx = cx === x ? -1 : 1;
      const dy = cy === y ? -1 : 1;
      doc.line(cx + dx * gap, cy, cx + dx * (gap + length), cy);
      doc.line(cx, cy + dy * gap, cx, cy + dy * (gap + length));
    }
}

/** The PDF: an A4 page with the card to cut out and fold, then the bytes shared. */
export async function exportEmergencyCardPdf(card: PrintableCard, t: Translate) {
  const pdf = await PdfWriter.create();
  pdf.title(card.title);
  pdf.paragraph(t("health.emergency.print.howTo"));
  pdf.space(4);
  const total = CARD.width * 2;
  // Room below for "Plier ici", then some air before the text under it.
  pdf.block(CARD.height + 18, (doc, left, y, room) => {
    const x = left + (room - total) / 2;
    const top = y + 5;
    // A faint outline helps scissors that miss the marks.
    doc.setDrawColor(215).setLineWidth(0.15).rect(x, top, total, CARD.height);
    front(doc, card, x, top, t);
    back(doc, card, x + CARD.width, top);
    cutMarks(doc, x, top, total, CARD.height);
    // The fold, dashed, with a tick above and below the card.
    doc.setDrawColor(150).setLineWidth(0.2).setLineDashPattern([1.2, 1], 0);
    doc.line(x + CARD.width, top - 3.4, x + CARD.width, top + CARD.height + 3.4);
    doc.setLineDashPattern([], 0);
    const measure = pdfFont(doc, 6.5, "normal", GREY);
    const fold = t("health.emergency.print.fold");
    doc.text(pdfText(fold), x + CARD.width - measure(fold) / 2, top + CARD.height + 6.2);
  });
  pdf.caption(card.name ? t("health.emergency.print.keepOf", { name: card.name }) : t("health.emergency.print.keep"));
  const bytes = pdf.finish(t("pdf.footer"));
  return shareFile(pdfFileName(card.title), bytes, "application/pdf", card.title);
}

// The lock-screen picture, in pixels.
export const PICTURE = { width: 1080, height: 2400 };
/** Kept free at the top for the clock and the date. */
const CLOCK_ROOM = 880;
/** Kept free at the bottom for the lock screen's shortcuts. */
const PICTURE_BOTTOM = 2200;
const FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const WINE = "#3b0a14";
const RED_CSS = "rgb(200, 16, 46)";
const RED_SOFT_CSS = "rgb(251, 233, 236)";
const INK_CSS = "#1f2328";
const GREY_CSS = "#5f6670";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
  ctx.fill();
}

/** The picture's bytes (PNG): a white panel low on a dark wine background, the clock left room above. */
export async function drawEmergencyPicture(card: PrintableCard): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = PICTURE.width;
  canvas.height = PICTURE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  const font = (size: number, weight = 400, color = INK_CSS): Measure => {
    ctx.font = `${weight} ${size}px ${FAMILY}`;
    ctx.fillStyle = color;
    return (text) => ctx.measureText(text).width;
  };
  const text = (lines: string[], x: number, y: number, lineHeight: number) => lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  ctx.textBaseline = "top";

  const pad = 64;
  const panelX = 72;
  const panelWidth = PICTURE.width - 2 * panelX;
  const inner = panelWidth - 2 * pad;

  // Measured first, so the panel sits as low as it can.
  let measure = font(48, 800);
  const title = clampLines(wrapText(card.title, inner, measure), 2, inner, measure);
  const titleHeight = title.length * 58;
  const bloodWidth = card.blood ? 300 : 0;
  const contactWidth = card.blood ? inner - bloodWidth - 44 : inner;
  measure = font(42, 700);
  const who = card.contact?.who ? clampLines(wrapText(card.contact.who, contactWidth, measure), 2, contactWidth, measure) : [];
  let phoneSize = 76;
  measure = font(phoneSize, 800);
  while (card.contact?.phone && phoneSize > 44 && measure(card.contact.phone) > contactWidth) measure = font((phoneSize -= 2), 800);
  const phone = card.contact?.phone ? clampLines(wrapText(card.contact.phone, contactWidth, measure), 2, contactWidth, measure) : [];
  const contactHeight = card.contact ? 46 + who.length * 54 + (phone.length ? 12 + phone.length * phoneSize * 1.15 : 0) : 0;
  const headHeight = Math.max(card.blood ? 290 : 0, contactHeight);
  const footerHeight = card.updated ? 64 : 0;
  const rows = [...card.rows, ...(card.note ? [card.note] : [])];
  const rowsRoom = PICTURE_BOTTOM - CLOCK_ROOM - 2 * pad - titleHeight - 40 - headHeight - (headHeight ? 44 : 0) - footerHeight;
  const stacked = stackRows(rows, { width: inner, height: rowsRoom, labelHeight: 44, lineHeight: 56, gap: 30 }, font(44));
  const rowsHeight = stacked.reduce((sum, row) => sum + 44 + row.lines.length * 56 + 30, 0) - (stacked.length ? 30 : 0);
  const content = titleHeight + 40 + headHeight + (headHeight && stacked.length ? 44 : 0) + rowsHeight + footerHeight;
  const panelTop = Math.max(CLOCK_ROOM, PICTURE_BOTTOM - content - 2 * pad);

  ctx.fillStyle = WINE;
  ctx.fillRect(0, 0, PICTURE.width, PICTURE.height);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, panelX, panelTop, panelWidth, PICTURE_BOTTOM - panelTop, 48);
  // The red edge on the left: the card's mark, as on the screen.
  ctx.fillStyle = RED_CSS;
  roundRect(ctx, panelX, panelTop, 18, PICTURE_BOTTOM - panelTop, 9);

  const x = panelX + pad;
  let y = panelTop + pad;
  font(48, 800, RED_CSS);
  text(title, x, y, 58);
  y += titleHeight + 40;

  if (card.blood) {
    ctx.fillStyle = RED_SOFT_CSS;
    roundRect(ctx, x, y, bloodWidth, headHeight, 32);
    measure = font(30, 700, GREY_CSS);
    const label = clampLines(wrapText(card.bloodLabel, bloodWidth - 56, measure), 2, bloodWidth - 56, measure);
    text(label, x + 28, y + 26, 38);
    const short = card.blood.length <= 3;
    const size = short ? 150 : 44;
    measure = font(size, 800, RED_CSS);
    const value = clampLines(wrapText(card.blood, bloodWidth - 56, measure), 3, bloodWidth - 56, measure);
    const labelBottom = y + 26 + label.length * 38;
    const valueTop = labelBottom + (y + headHeight - labelBottom - value.length * size * 1.1) / 2;
    ctx.textAlign = "center";
    text(value, x + bloodWidth / 2, valueTop, size * 1.1);
    ctx.textAlign = "left";
  }
  if (card.contact) {
    const cx = card.blood ? x + bloodWidth + 44 : x;
    let cy = y + 6;
    measure = font(32, 700, RED_CSS);
    text(clampLines(wrapText(card.contact.label, contactWidth, measure), 1, contactWidth, measure), cx, cy, 40);
    cy += 46;
    font(42, 700, INK_CSS);
    text(who, cx, cy, 54);
    cy += who.length * 54 + 12;
    font(phoneSize, 800, INK_CSS);
    text(phone, cx, cy, phoneSize * 1.15);
  }
  y += headHeight + (headHeight && stacked.length ? 44 : 0);

  for (const row of stacked) {
    font(32, 700, GREY_CSS);
    ctx.fillText(row.label, x, y);
    font(44, 400, INK_CSS);
    text(row.lines, x, y + 44, 56);
    y += 44 + row.lines.length * 56 + 30;
  }
  if (card.updated) {
    measure = font(30, 400, GREY_CSS);
    text(clampLines(wrapText(card.updated, inner, measure), 1, inner, measure), x, PICTURE_BOTTOM - pad - 34, 38);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("no picture");
  return blob.arrayBuffer();
}

/** The picture, shared or saved like the PDF. */
export async function exportEmergencyPicture(card: PrintableCard) {
  const bytes = await drawEmergencyPicture(card);
  return shareFile(pictureFileName(pdfFileName(card.title)), bytes, "image/png", card.title);
}
