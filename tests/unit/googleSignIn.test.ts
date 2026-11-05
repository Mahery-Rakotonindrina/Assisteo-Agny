import { describe, expect, it } from "vitest";
import { APP_AUTH_CALLBACK, callbackFrom, googleEnabled, parseAuthCallback, safeReturnPath } from "@/lib/googleSignIn";

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
});
