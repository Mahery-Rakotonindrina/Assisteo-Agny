import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { beforeEach, describe, expect, it } from "vitest";
import { shareTokenFromAddress, shareUrl } from "@/lib/loanShare";
import { scrubBreadcrumb, scrubEvent, stripQuery } from "@/lib/monitoring";
import { normalizeTrialEmail } from "@/lib/offers";
import { emailConfirmed, forgetConfirmations } from "@/lib/server/emailConfirmed";
import { ipPrefix } from "@/lib/server/ip";
import { getTrialConfig, releaseAskIp, releaseTrialAiCall, releaseTrialStart, reserveAskIp, reserveTrialAiCall, reserveTrialStart, setTrialConfig } from "@/lib/server/trialStore";

const id = () => Math.random().toString(16).slice(2).padEnd(24, "0").slice(0, 24);

describe("trial e-mail", () => {
  it("is one person whatever the +tag, the case or the Gmail dots", () => {
    expect(normalizeTrialEmail("Moi+1@gmail.com")).toBe("moi@gmail.com");
    expect(normalizeTrialEmail("m.o.i+x+y@Gmail.com")).toBe("moi@gmail.com");
    expect(normalizeTrialEmail("m.oi@googlemail.com")).toBe("moi@gmail.com");
  });

  it("keeps the dots of the other providers, and drops their +tag", () => {
    expect(normalizeTrialEmail("rakoto.jean+promo@yahoo.fr")).toBe("rakoto.jean@yahoo.fr");
    expect(normalizeTrialEmail("a@b.mg")).toBe("a@b.mg");
  });
});

describe("IP prefix for the limits", () => {
  it("leaves IPv4 alone and keeps the /64 of an IPv6 address", () => {
    expect(ipPrefix("203.0.113.7")).toBe("203.0.113.7");
    expect(ipPrefix("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(ipPrefix("2001:DB8:abcd:12:ffff:ffff:ffff:ffff")).toBe(ipPrefix("2001:db8:abcd:0012:0:0:0:1"));
    expect(ipPrefix("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipPrefix("2001:db8::1")).toBe(ipPrefix("2001:db8::ffff"));
    expect(ipPrefix("::1")).toBe("0:0:0:0::/64");
    expect(ipPrefix("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("gives the IPv4 of a mapped address, and leaves what it can't read", () => {
    expect(ipPrefix("::ffff:198.51.100.2")).toBe("198.51.100.2");
    expect(ipPrefix("unknown")).toBe("unknown");
    expect(ipPrefix("1:2:3")).toBe("1:2:3");
  });
});

describe("Premium trial limits", () => {
  // First: the day's counter is shared by the tests below.
  it("stops at the day's global cap and gives a start back", async () => {
    const config = await getTrialConfig();
    await setTrialConfig({ ...config, trialStartsPerIp: 100, trialStartsPerDay: 2 });
    const subject = (n: number) => ({ installId: id(), ip: `192.0.2.${n}` });
    const a = subject(1);
    expect(await reserveTrialStart(a)).toBeNull();
    expect(await reserveTrialStart(subject(2))).toBeNull();
    expect(await reserveTrialStart(subject(3))).toBe("day");
    await releaseTrialStart(a);
    expect(await reserveTrialStart(subject(4))).toBeNull();
    await setTrialConfig(config);
  });

  it("allows one trial per install, and a few per IP", async () => {
    const phone = id();
    const ip = "198.51.100.10";
    expect(await reserveTrialStart({ installId: phone, ip })).toBeNull();
    expect(await reserveTrialStart({ installId: phone, ip: "198.51.100.11" })).toBe("install");
    // A refused try leaves nothing booked: the same IP still has its other places.
    expect(await reserveTrialStart({ installId: id(), ip })).toBeNull();
    expect(await reserveTrialStart({ installId: id(), ip })).toBeNull();
    expect(await reserveTrialStart({ installId: id(), ip })).toBe("ip");
  });

  it("counts an IPv6 /64 as one address, and an older app (no install id) by IP", async () => {
    const config = await getTrialConfig();
    await setTrialConfig({ ...config, trialStartsPerIp: 1, trialStartsPerDay: 1000 });
    expect(await reserveTrialStart({ installId: null, ip: ipPrefix("2001:db8:77:1::1") })).toBeNull();
    expect(await reserveTrialStart({ installId: id(), ip: ipPrefix("2001:db8:77:1:aaaa::2") })).toBe("ip");
    await setTrialConfig(config);
  });

  it("caps the AI calls of the trials apart", async () => {
    const config = await getTrialConfig();
    await setTrialConfig({ ...config, trialAiPerDay: 2 });
    expect(await reserveTrialAiCall()).toBe(true);
    expect(await reserveTrialAiCall()).toBe(true);
    expect(await reserveTrialAiCall()).toBe(false);
    await releaseTrialAiCall();
    expect(await reserveTrialAiCall()).toBe(true);
    await setTrialConfig(config);
  });
});

describe("questions per IP", () => {
  it("stops an IP that changes install ids, and gives a question back", async () => {
    const config = await getTrialConfig();
    await setTrialConfig({ ...config, askLimit: 1 });
    const previous = process.env.ASK_IP_FACTOR;
    process.env.ASK_IP_FACTOR = "2";
    const ip = "203.0.113.99";
    expect(await reserveAskIp(ip)).not.toBeNull();
    expect(await reserveAskIp(ip)).not.toBeNull();
    expect(await reserveAskIp(ip)).toBeNull();
    await releaseAskIp(ip);
    expect(await reserveAskIp(ip)).not.toBeNull();
    if (previous === undefined) delete process.env.ASK_IP_FACTOR;
    else process.env.ASK_IP_FACTOR = previous;
    await setTrialConfig(config);
  });
});

describe("e-mail confirmation", () => {
  beforeEach(() => forgetConfirmations());

  it("trusts an e-mail only once Supabase confirmed it, and asks again later", async () => {
    let calls = 0;
    let confirmed = false;
    const lookup = async () => {
      calls += 1;
      return confirmed;
    };
    expect(await emailConfirmed("u1", lookup, 0)).toBe(false);
    expect(await emailConfirmed("u1", lookup, 10_000)).toBe(false);
    expect(calls).toBe(1);
    confirmed = true;
    expect(await emailConfirmed("u1", lookup, 40_000)).toBe(true);
    expect(await emailConfirmed("u1", lookup, 50_000)).toBe(true);
    expect(calls).toBe(2);
  });

  it("does not trust an e-mail when the lookup fails, except one confirmed a moment ago", async () => {
    const failing = async () => {
      throw new Error("Auth is down");
    };
    expect(await emailConfirmed("u2", failing, 0)).toBe(false);
    expect(await emailConfirmed("u3", async () => true, 0)).toBe(true);
    expect(await emailConfirmed("u3", failing, 11 * 60_000)).toBe(true);
  });
});

describe("what Sentry gets", () => {
  it("strips the query and the fragment of an address", () => {
    expect(stripQuery("https://agny.app/api/loans/share?t=abcdefghijklmnopqrstuv")).toBe("https://agny.app/api/loans/share");
    expect(stripQuery("https://agny.app/pret#t=abcdefghijklmnopqrstuv")).toBe("https://agny.app/pret");
    expect(stripQuery("/pret?t=abc&x=1")).toBe("/pret");
    expect(stripQuery("/plans")).toBe("/plans");
  });

  it("cleans the request, its query string, the breadcrumbs and the transaction", () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: "https://agny.app/pret?t=secret", query_string: "t=secret", headers: { a: "b" } },
      transaction: "/pret?t=secret",
      breadcrumbs: [
        { category: "navigation", data: { from: "/a?email=x@y.mg", to: "/pret?t=secret" } },
        { category: "fetch", data: { url: "/api/loans/share?t=secret", method: "GET" } },
        { category: "console", message: "GET /api/x?t=secret failed" },
      ],
    } as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("x@y.mg");
    expect(event.request?.url).toBe("https://agny.app/pret");
    expect(event.breadcrumbs?.[1].data).toEqual({ url: "/api/loans/share", method: "GET" });
  });

  it("cleans one breadcrumb the same way (beforeBreadcrumb)", () => {
    const breadcrumb = scrubBreadcrumb({ category: "xhr", data: { url: "https://agny.app/api/plan?install=1" } } as Breadcrumb);
    expect(breadcrumb.data?.url).toBe("https://agny.app/api/plan");
  });
});

describe("loan link", () => {
  const token = "abcdefghijklmnopqrstuv";

  it("puts the token in the fragment now, and still reads the old ?t= links", () => {
    expect(shareUrl("https://agny.app/", token)).toBe(`https://agny.app/pret#t=${token}`);
    expect(shareTokenFromAddress("", `#t=${token}`)).toBe(token);
    expect(shareTokenFromAddress(`?t=${token}`, "")).toBe(token);
    expect(shareTokenFromAddress(`?utm=1&t=${token}`, "")).toBe(token);
  });

  it("asks nothing for a link cut short or without a token", () => {
    expect(shareTokenFromAddress("", "")).toBeNull();
    expect(shareTokenFromAddress("", "#t=abc")).toBeNull();
    expect(shareTokenFromAddress("?t=abc", "")).toBeNull();
  });
});
