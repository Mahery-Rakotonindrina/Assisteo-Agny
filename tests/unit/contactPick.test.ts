import { describe, expect, it } from "vitest";
import { contactPerson, contactPhone, contactPickerKind, pickedContact } from "@/lib/contactPick";
import { whatsappNumber } from "@/lib/loans";

describe("contactPhone", () => {
  it("writes a Malagasy number as 03x xx xxx xx, however it was saved", () => {
    expect(contactPhone("+261 34 12 345 67")).toBe("034 12 345 67");
    expect(contactPhone("+261341234567")).toBe("034 12 345 67");
    expect(contactPhone("00261 32 11 222 33")).toBe("032 11 222 33");
    expect(contactPhone("261341234567")).toBe("034 12 345 67");
    expect(contactPhone("0341234567")).toBe("034 12 345 67");
    expect(contactPhone("034 12 345 67")).toBe("034 12 345 67");
    expect(contactPhone("034-12-345-67")).toBe("034 12 345 67");
    expect(contactPhone("38 12 345 67")).toBe("038 12 345 67");
  });

  it("keeps a foreign number as written, and the reminder still reads it", () => {
    expect(contactPhone("+33 6 12 34 56 78")).toBe("+33 6 12 34 56 78");
    expect(whatsappNumber(contactPhone("+33 6 12 34 56 78"))).toBe("33612345678");
    expect(whatsappNumber(contactPhone("+261 34 12 345 67"))).toBe("261341234567");
  });

  it("gives nothing for an empty number", () => {
    expect(contactPhone(undefined)).toBeUndefined();
    expect(contactPhone("")).toBeUndefined();
    expect(contactPhone("   ")).toBeUndefined();
    expect(contactPhone("-")).toBeUndefined();
  });
});

describe("contactPerson", () => {
  const known = ["Rakoto", "Rasoa Hery"];

  it("reuses the person already known by that name", () => {
    expect(contactPerson(known, " rakoto ")).toBe("Rakoto");
    expect(contactPerson(known, "Rasoa  héry")).toBe("Rasoa Hery");
  });

  it("keeps a new name as the contact has it", () => {
    expect(contactPerson(known, " Jean   Paul ")).toBe("Jean Paul");
    expect(contactPerson([], "Rakoto")).toBe("Rakoto");
  });
});

describe("pickedContact", () => {
  it("reads the plugin's answer and the web API's lists", () => {
    expect(pickedContact({ name: "Rakoto", phone: "+261341234567" })).toEqual({ name: "Rakoto", phone: "034 12 345 67" });
    expect(pickedContact({ name: ["", "Rasoa"], tel: ["0331234567", "0341234567"] })).toEqual({ name: "Rasoa", phone: "033 12 345 67" });
    expect(pickedContact({ name: "Rakoto" })).toEqual({ name: "Rakoto" });
  });

  it("is null when the picker was cancelled", () => {
    expect(pickedContact({})).toBeNull();
    expect(pickedContact(undefined)).toBeNull();
    expect(pickedContact({ name: [], tel: [] })).toBeNull();
  });
});

describe("contactPickerKind", () => {
  it("prefers the app's plugin, then the browser's picker, else hides the button", () => {
    expect(contactPickerKind({ plugin: true, webApi: true })).toBe("native");
    expect(contactPickerKind({ plugin: false, webApi: true })).toBe("web");
    expect(contactPickerKind({ plugin: false, webApi: false })).toBeNull();
  });
});
