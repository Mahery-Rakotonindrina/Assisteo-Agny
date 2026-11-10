import { describe, expect, it } from "vitest";
import fr from "@/locales/fr.json";
import { whatsappLink } from "@/lib/loans";
import { clientPhone, parcelStatusMessage, phoneToSave } from "@/lib/parcelMessage";

// The real French texts, to read the message as the client will.
const t = (key: string, params: Record<string, string | number> = {}) => {
  const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr);
  if (typeof text !== "string") throw new Error(`missing ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
};

const parcel = (patch: Record<string, unknown> = {}) => ({
  title: "Robe rouge",
  client: "Rado",
  info: { status: "in_transit" as const, trackingNumber: "YT2412345678" },
  priceMga: 61_000,
  fees: [{ id: "f", label: "Fret", amountMga: 9_000 }],
  salePriceMga: 130_000,
  paidMga: 100_000,
  updatedAt: 1,
  ...patch,
});

describe("the status sent to a client", () => {
  it("says the parcel, where it is, its tracking number and what is left to pay", () => {
    expect(parcelStatusMessage(parcel(), t, "fr")).toMatch(
      /^Bonjour Rado,\nColis « Robe rouge » : En transit\.\nN° de suivi : YT2412345678\nReste à payer : 30\s000 Ar$/,
    );
  });

  it("never tells what the parcel cost: price, fees or profit", () => {
    const message = parcelStatusMessage(parcel(), t, "fr");
    expect(message).not.toMatch(/61\D000|9\D000|70\D000|Fret|Bénéfice|Prix/);
  });

  it("says when it was received, a carrier's « delivered » as the forwarder's, and when all is paid", () => {
    expect(parcelStatusMessage(parcel({ receivedAt: new Date(2026, 10, 3).getTime(), paidMga: 130_000 }), t, "fr")).toMatch(/Reçu le 3 nov\. 2026\.\nN° de suivi : YT2412345678\nTout est payé, merci !$/);
    expect(parcelStatusMessage(parcel({ info: { status: "delivered", trackingNumber: null } }), t, "fr")).toContain("livré chez le transitaire, pas encore arrivé ici");
    // Without a sale price, nothing about money.
    expect(parcelStatusMessage(parcel({ salePriceMga: undefined, client: " " }), t, "fr")).toBe("Bonjour,\nColis « Robe rouge » : En transit.\nN° de suivi : YT2412345678");
  });

  it("finds the client's number on the parcel, else on their latest other parcel", () => {
    const others = [
      { client: "rado ", clientPhone: "034 11 111 11", updatedAt: 1 },
      { client: "Rado", clientPhone: "034 22 222 22", updatedAt: 2 },
      { client: "Voahangy", clientPhone: "033 33 333 33", updatedAt: 3 },
    ];
    expect(clientPhone({ client: "Rado", clientPhone: " 032 00 000 00 ", updatedAt: 0 }, others)).toBe("032 00 000 00");
    expect(clientPhone({ client: "RADO", updatedAt: 0 }, others)).toBe("034 22 222 22");
    expect(clientPhone({ client: "Hery", updatedAt: 0 }, others)).toBeUndefined();
    expect(clientPhone({ updatedAt: 0 }, others)).toBeUndefined();
    expect(whatsappLink("034 22 222 22", "Bonjour Rado,\nColis")).toBe("https://wa.me/261342222222?text=Bonjour%20Rado%2C%0AColis");
  });
});

describe("the client's number saved from the edit sheet", () => {
  const base = { phone: "034 22 222 22", client: "Rado", originalClient: "Rado", valid: true };

  it("not touched: the parcel keeps its own, nothing goes to the client's other parcels", () => {
    expect(phoneToSave({ ...base, touched: false })).toEqual({ own: undefined, propagate: false });
  });

  it("another client: never the previous client's number, never given to the new client's parcels", () => {
    expect(phoneToSave({ ...base, touched: false, client: "Rabe" })).toEqual({ own: "", propagate: false });
    expect(phoneToSave({ ...base, touched: true, client: "Rabe" })).toEqual({ own: "034 22 222 22", propagate: false });
  });

  it("corrected by hand for the same client: theirs, on their other parcels too; unless it can't be used", () => {
    expect(phoneToSave({ ...base, touched: true, client: " rado " })).toEqual({ own: "034 22 222 22", propagate: true });
    expect(phoneToSave({ ...base, touched: true, phone: "06 12 34 56 78", valid: false })).toEqual({ own: "06 12 34 56 78", propagate: false });
    expect(phoneToSave({ ...base, touched: true, phone: " " })).toEqual({ own: "", propagate: false });
  });
});
