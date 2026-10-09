import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyzeRequestSchema, AskRequestSchema, imagesOf, MAX_PAGES } from "@/lib/ai/schema";
import { askSystemPrompt, ASK_SYSTEM_PROMPT, buildUserPrompt, firstAskText, READ_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { isMainSubject, parseCode } from "@/lib/codes";
import { hasFeature } from "@/lib/plans";
import { isSavingData } from "@/services/dataSaver";

describe("QR code contents", () => {
  it("opens web links only", () => {
    expect(parseCode("https://www.example.mg/facture?id=4")).toEqual({ type: "url", url: "https://www.example.mg/facture?id=4", host: "example.mg" });
    expect(parseCode("www.example.com")).toMatchObject({ type: "url", url: "https://www.example.com/" });
    expect(parseCode("javascript:alert(1)")).toEqual({ type: "text", text: "javascript:alert(1)" });
    expect(parseCode("intent://scan#Intent;end")).toMatchObject({ type: "text" });
  });

  it("reads Wi-Fi networks, with escaped characters", () => {
    expect(parseCode("WIFI:T:WPA;S:Maison\\;Rakoto;P:mot\\:de\\\\passe;;")).toEqual({ type: "wifi", ssid: "Maison;Rakoto", password: "mot:de\\passe", security: "WPA" });
    expect(parseCode("WIFI:S:Cafe;T:nopass;;")).toEqual({ type: "wifi", ssid: "Cafe", password: null, security: null });
  });

  it("reads phones, texts, mails, contacts and places", () => {
    expect(parseCode("tel:+261340000000")).toEqual({ type: "phone", number: "+261340000000" });
    expect(parseCode("SMSTO:+261340000000:Bonjour : ça va ?")).toEqual({ type: "sms", number: "+261340000000", body: "Bonjour : ça va ?" });
    expect(parseCode("mailto:contact@example.mg?subject=Hi")).toEqual({ type: "email", address: "contact@example.mg" });
    expect(parseCode("MECARD:N:Rakoto,Jean;TEL:0340000000;EMAIL:jean@example.mg;;")).toEqual({
      type: "contact",
      name: "Rakoto Jean",
      phone: "0340000000",
      email: "jean@example.mg",
    });
    expect(parseCode("BEGIN:VCARD\nVERSION:3.0\nFN:Hery Rabe\nTEL;TYPE=CELL:+261320000000\nEND:VCARD")).toEqual({
      type: "contact",
      name: "Hery Rabe",
      phone: "+261320000000",
      email: null,
    });
    expect(parseCode("geo:-18.8792,47.5079")).toEqual({ type: "geo", lat: -18.8792, lng: 47.5079 });
    expect(parseCode("  Merci pour votre achat  ")).toEqual({ type: "text", text: "Merci pour votre achat" });
  });

  it("shows a QR code right away only when it is the photo's subject", () => {
    const qr = { kind: "qr", format: "QR Code", text: "https://example.mg" } as const;
    expect(isMainSubject(qr, 0.2)).toBe(true);
    expect(isMainSubject(qr, 0.01)).toBe(false);
    expect(isMainSubject({ kind: "barcode", format: "EAN-13", text: "5901234123457" }, 0.4)).toBe(false);
  });
});

describe("multi-page scans", () => {
  const page = { image: "aGVsbG8=", mediaType: "image/jpeg" as const };

  it("are a Premium feature", () => {
    expect(hasFeature("free", "multiPage")).toBe(false);
    expect(hasFeature("lite", "multiPage")).toBe(false);
    expect(hasFeature("premium", "multiPage")).toBe(true);
    expect(hasFeature("pro", "multiPage")).toBe(true);
    expect(hasFeature("unlimited", "multiPage")).toBe(true);
  });

  it("send at most MAX_PAGES photos, in order", () => {
    const base = { ...page, mode: "document", locale: "fr" } as const;
    expect(AnalyzeRequestSchema.safeParse({ ...base, pages: Array(MAX_PAGES - 1).fill(page) }).success).toBe(true);
    expect(AnalyzeRequestSchema.safeParse({ ...base, pages: Array(MAX_PAGES).fill(page) }).success).toBe(false);
    const second = { image: "c2Vjb25k", mediaType: "image/png" as const };
    expect(imagesOf({ ...page, pages: [second] })).toEqual([page, second]);
    expect(imagesOf(page)).toEqual([page]);
  });

  it("tell the AI the photos are the pages of one document", () => {
    expect(buildUserPrompt("document", "fr")).not.toContain("pages");
    expect(buildUserPrompt("document", "fr", 3)).toContain("3 photos: the pages of one document");
  });
});

describe("reading the text", () => {
  const context = { analysis: {} as never, locale: "fr" as const };

  it("uses its own instructions to transcribe or translate", () => {
    expect(askSystemPrompt(undefined)).toBe(ASK_SYSTEM_PROMPT);
    expect(askSystemPrompt("chat")).toBe(ASK_SYSTEM_PROMPT);
    expect(askSystemPrompt("transcribe")).toBe(READ_SYSTEM_PROMPT);
    expect(firstAskText({ ...context, task: "transcribe" }, "x")).toBe("Transcribe all the text on this photo, as written, in its original language.");
    expect(firstAskText({ ...context, task: "translate", target: "mg", pages: [{ image: "a", mediaType: "image/jpeg" }] }, "x")).toContain(
      "these 2 pages (in order) into Malagasy",
    );
    expect(firstAskText({ ...context, task: "chat" }, "Combien ?")).toMatch(/Question: Combien \?$/);
  });

  it("accepts only the known tasks and languages", () => {
    const ask = { image: "aGVsbG8=", mediaType: "image/jpeg", analysis: {}, messages: [{ role: "user", content: "transcribe" }], locale: "fr" };
    expect(AskRequestSchema.safeParse({ ...ask, task: "translate", target: "zh" }).success).toBe(true);
    expect(AskRequestSchema.safeParse({ ...ask, task: "translate", target: "de" }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ...ask, task: "summarize" }).success).toBe(false);
  });
});

describe("data saver", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the connection in auto, and the user's choice otherwise", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "3g", saveData: false } });
    expect(isSavingData("auto")).toBe(true);
    expect(isSavingData("off")).toBe(false);
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: true } });
    expect(isSavingData("auto")).toBe(true);
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: false } });
    expect(isSavingData("auto")).toBe(false);
    expect(isSavingData("on")).toBe(true);
    // iPhones report nothing: auto stays off.
    vi.stubGlobal("navigator", {});
    expect(isSavingData("auto")).toBe(false);
  });
});
