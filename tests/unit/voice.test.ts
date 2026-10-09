import { describe, expect, it } from "vitest";
import { speakableText } from "@/services/voice";

describe("voice", () => {
  it("reads an answer as plain sentences", () => {
    expect(speakableText("**Au frigo** : 2 jours.\n\n- Couvre le bol\n- Garde la sauce à part")).toBe("Au frigo : 2 jours.\nCouvre le bol\nGarde la sauce à part");
  });
});
