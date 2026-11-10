import { describe, expect, it } from "vitest";
import { APP_AUTH_CALLBACK, callbackFrom, googleEnabled, parseAuthCallback, safeReturnPath, usedCodes, withUsedCode, withoutUsedCode } from "@/lib/googleSignIn";

describe("Continuer avec Google", () => {
  it("is shown only when Supabase says Google is on", () => {
    expect(googleEnabled({ external: { google: true, email: true } })).toBe(true);
    expect(googleEnabled({ external: { google: false, email: true } })).toBe(false);
    expect(googleEnabled({ external: {} })).toBe(false);
    expect(googleEnabled({ msg: "Invalid API key" })).toBe(false);
    expect(googleEnabled(null)).toBe(false);
    expect(googleEnabled({ external: { google: "true" } })).toBe(false);
  });

  it("reads the app's return link: the code, or the error; other links are not its", () => {
    expect(parseAuthCallback(`${APP_AUTH_CALLBACK}?code=abc-123`)).toEqual({ code: "abc-123" });
    expect(parseAuthCallback(`${APP_AUTH_CALLBACK}/?code=abc`)).toEqual({ code: "abc" });
    expect(parseAuthCallback(`${APP_AUTH_CALLBACK}#error=access_denied&error_description=Cancelled+by+user`)).toEqual({ error: "Cancelled by user" });
    expect(parseAuthCallback(`${APP_AUTH_CALLBACK}?error=server_error`)).toEqual({ error: "server_error" });
    expect(parseAuthCallback(APP_AUTH_CALLBACK)).toBeNull();
    expect(parseAuthCallback(`${APP_AUTH_CALLBACK}-evil?code=x`)).toBeNull();
    expect(parseAuthCallback("https://assisteo.example/pret#t=x")).toBeNull();
    expect(callbackFrom(new URLSearchParams("code=zz"))).toEqual({ code: "zz" });
  });

  it("goes back only to a page of this site", () => {
    expect(safeReturnPath("/parcels?open=1")).toBe("/parcels?open=1");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath("/auth-callback?code=x")).toBe("/");
    expect(safeReturnPath(null)).toBe("/");
  });

  it("keeps the last codes exchanged, so a replayed link is spotted", () => {
    expect(usedCodes(null)).toEqual([]);
    expect(usedCodes("not json")).toEqual([]);
    expect(usedCodes('{"a":1}')).toEqual([]);
    let raw: string | null = null;
    for (const code of ["a", "b", "c", "d", "e", "f"]) raw = withUsedCode(raw, code);
    expect(usedCodes(raw)).toEqual(["b", "c", "d", "e", "f"]);
    expect(usedCodes(withUsedCode(raw, "c"))).toEqual(["b", "d", "e", "f", "c"]);
    // A code whose exchange the network cut can be tried again.
    expect(usedCodes(withoutUsedCode(raw, "e"))).toEqual(["b", "c", "d", "f"]);
  });
});
