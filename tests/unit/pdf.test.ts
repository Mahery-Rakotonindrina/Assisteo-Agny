import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pdfFileName, pdfText, PdfWriter } from "@/lib/pdf";

const photo = `data:image/jpeg;base64,${readFileSync(join(__dirname, "../e2e/fixtures/apple.jpg")).toString("base64")}`;

describe("pdf", () => {
  it("keeps French text and swaps what the built-in font can't draw", () => {
    expect(pdfText("Échéance : 15 octobre — 84,20 € « payé »")).toBe("Échéance : 15 octobre - 84,20 EUR « payé »");
    expect(pdfText("12 000 Ar · cœur… ≈ 3 → ok 🍳 申通")).toBe("12 000 Ar · coeur... ~ 3 -> ok  ");
  });

  it("names the file after the title", () => {
    expect(pdfFileName("Facture JIRAMA / octobre 2026")).toBe("Facture-JIRAMA-octobre-2026.pdf");
    expect(pdfFileName("申通")).toBe("document.pdf");
  });

  it("writes photos and text into a PDF file", async () => {
    const pdf = await PdfWriter.create();
    pdf.fullPageImage(photo);
    pdf.newPage();
    pdf.title("Attestation d'assurance");
    pdf.subtitle("Mes scans");
    pdf.heading("Points clés");
    pdf.bullets(Array.from({ length: 80 }, (_, index) => `Point ${index + 1}`));
    pdf.image(photo, 40);
    const bytes = pdf.finish("Assisteo Agny");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    // The photo page, then the text running over more than one page.
    expect(pdf.doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });
});
