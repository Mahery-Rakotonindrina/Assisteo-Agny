import { describe, expect, it } from "vitest";
import { codeFrom } from "@/lib/signInCode";

// The sign-in code in what people paste: the e-mail's subject or notification,
// a sentence around it, the code with spaces, or digits typed one by one.

describe("codeFrom", () => {
  it("keeps the digits typed", () => {
    expect(codeFrom("1234")).toBe("1234");
    expect(codeFrom("12345678")).toBe("12345678");
  });

  it("finds the code in the subject or a sentence copied with it", () => {
    expect(codeFrom("Ton code Assisteo Agny : 12345678")).toBe("12345678");
    expect(codeFrom("Ton code de connexion\n\n12345678\n\nCopie ce code, puis touche « Coller le code ». Il expire dans une heure.")).toBe("12345678");
    expect(codeFrom("  87654321 ")).toBe("87654321");
  });

  it("joins a code split by spaces or dashes", () => {
    expect(codeFrom("1234 5678")).toBe("12345678");
    expect(codeFrom("123-456")).toBe("123456");
  });

  it("prefers a whole code to other numbers around it", () => {
    expect(codeFrom("12Ton code : 12345678")).toBe("12345678");
    expect(codeFrom("Code 654321, valable 1 heure")).toBe("654321");
  });

  it("never gives more than 10 digits, nor anything without digits", () => {
    expect(codeFrom("123456789012345")).toBe("1234567890");
    expect(codeFrom("Ton code Assisteo Agny")).toBe("");
  });
});
