import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "@/lib/monitoring";

describe("scrubEvent", () => {
  it("drops headers (user API keys, tokens), cookies, bodies (photos) and user details", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://assisteo-agny.vercel.app/api/analyze",
        headers: { "x-ai-key": "sk-secret", authorization: "Bearer token" },
        cookies: { session: "abc" },
        data: { image: "base64..." },
      },
      user: { id: "u1", email: "someone@example.com", ip_address: "1.2.3.4" },
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://assisteo-agny.vercel.app/api/analyze" });
    expect(event.user).toEqual({ id: "u1" });
  });
});
