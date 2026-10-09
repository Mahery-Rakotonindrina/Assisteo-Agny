import type { jsPDF } from "jspdf";

// Clean A4 PDFs built on the device (documents, history exports). jsPDF is
// loaded only when a PDF is made. Its built-in font covers Latin-1 (French,
// English, Malagasy): other characters are swapped for close ones or dropped.

const PAGE = { width: 210, height: 297 };
const MARGIN = 16;
const WIDTH = PAGE.width - 2 * MARGIN;
const BOTTOM = PAGE.height - MARGIN - 6;

/** Text the PDF's standard font can draw. */
export function pdfText(text: string) {
  return text
    .replace(/[‘’‚ʼ′]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, "...")
    .replace(/[‐-―−]/g, "-")
    .replace(/[    ]/g, " ")
    .replace(/[•●◦]/g, "-")
    .replace(/≈/g, "~")
    .replace(/[→➜]/g, "->")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/€/g, "EUR")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "");
}

/** A file name from a title: letters, digits and dashes. */
export function pdfFileName(title: string) {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "document"}.pdf`;
}

/** Writes from top to bottom, starting new pages as needed. */
export class PdfWriter {
  private y = MARGIN;

  private constructor(readonly doc: jsPDF) {}

  static async create() {
    const { jsPDF } = await import("jspdf");
    return new PdfWriter(new jsPDF({ unit: "mm", format: "a4", compress: true }));
  }

  /** Starts a new page (the first one exists already). */
  newPage() {
    if (this.y > MARGIN || this.doc.getNumberOfPages() > 1) this.doc.addPage();
    this.y = MARGIN;
  }

  private ensure(height: number) {
    if (this.y + height > BOTTOM) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  private lines(text: string, size: number, style: "normal" | "bold", color: number, gap: number, indent = 0) {
    this.doc.setFont("helvetica", style).setFontSize(size).setTextColor(color);
    const lineHeight = size * 0.42;
    for (const line of this.doc.splitTextToSize(pdfText(text), WIDTH - indent) as string[]) {
      this.ensure(lineHeight);
      this.doc.text(line, MARGIN + indent, this.y + lineHeight * 0.8);
      this.y += lineHeight;
    }
    this.y += gap;
  }

  title(text: string) {
    this.lines(text, 20, "bold", 20, 2);
  }

  /** The name of one item among several (history exports). */
  subtitle(text: string) {
    this.ensure(12);
    this.lines(text, 14, "bold", 20, 1);
  }

  caption(text: string) {
    this.lines(text, 9, "normal", 110, 5);
  }

  heading(text: string) {
    this.ensure(14);
    this.y += 2;
    this.lines(text.toUpperCase(), 9, "bold", 90, 1.5);
  }

  paragraph(text: string) {
    for (const block of text.split("\n")) this.lines(block || " ", 10.5, "normal", 30, 0.6);
    this.y += 2.5;
  }

  bullets(items: string[]) {
    for (const item of items) {
      this.ensure(5);
      this.doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(30);
      this.doc.text("-", MARGIN + 1, this.y + 3.5);
      this.lines(item, 10.5, "normal", 30, 0.8, 5);
    }
    this.y += 2;
  }

  /** Label/value rows, the label in grey. */
  pairs(rows: Array<{ label: string; value: string }>) {
    for (const row of rows) this.lines(`${row.label} : ${row.value}`, 10.5, "normal", 30, 0.8);
    this.y += 2;
  }

  /** A photo as large as fits, on a page of its own (a scanned page). */
  fullPageImage(dataUrl: string) {
    this.newPage();
    this.drawImage(dataUrl, WIDTH, BOTTOM - MARGIN);
    this.y = BOTTOM;
  }

  /** A photo in the flow, at most `maxHeight` mm high. */
  image(dataUrl: string, maxHeight: number) {
    const { height } = this.size(dataUrl, WIDTH, maxHeight);
    this.ensure(height + 3);
    this.drawImage(dataUrl, WIDTH, maxHeight, false);
    this.y += height + 3;
  }

  private size(dataUrl: string, maxWidth: number, maxHeight: number) {
    const props = this.doc.getImageProperties(dataUrl);
    const scale = Math.min(maxWidth / props.width, maxHeight / props.height);
    return { width: props.width * scale, height: props.height * scale };
  }

  private drawImage(dataUrl: string, maxWidth: number, maxHeight: number, centred = true) {
    const { width, height } = this.size(dataUrl, maxWidth, maxHeight);
    const x = centred ? MARGIN + (maxWidth - width) / 2 : MARGIN;
    this.doc.addImage(dataUrl, "JPEG", x, this.y, width, height, undefined, "FAST");
  }

  /** A thin line between two items. */
  rule() {
    this.ensure(6);
    this.doc.setDrawColor(220).setLineWidth(0.2).line(MARGIN, this.y + 2, PAGE.width - MARGIN, this.y + 2);
    this.y += 6;
  }

  /** Numbers the pages, adds the footer, and gives the file's bytes. */
  finish(footer: string) {
    const count = this.doc.getNumberOfPages();
    for (let page = 1; page <= count; page += 1) {
      this.doc.setPage(page);
      this.doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(140);
      this.doc.text(pdfText(footer), MARGIN, PAGE.height - 8);
      this.doc.text(`${page} / ${count}`, PAGE.width - MARGIN, PAGE.height - 8, { align: "right" });
    }
    return this.doc.output("arraybuffer");
  }
}
