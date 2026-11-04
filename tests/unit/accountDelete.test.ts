import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";

// A stand-in for the "scans" bucket: files at any level, listed one folder at a time like Supabase.
const bucket = vi.hoisted(() => ({ files: [] as string[], empty: [] as string[], removed: [] as string[][], deleted: [] as string[], claims: {} as { amr?: unknown } }));
const nowSeconds = () => Math.floor(Date.now() / 1000);
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: true,
  verifiedClaims: async () => ({ id: "u1", claims: bucket.claims }),
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        list: async (folder: string, { limit, offset }: { limit: number; offset: number }) => {
          // An empty folder lists as a folder holding nothing.
          const below = [...bucket.files, ...bucket.empty.map((path) => `${path}/`)].filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1)).filter(Boolean);
          // A file has an id; a folder (its first segment) has none.
          const names = [...new Set(below.map((rest) => (rest.includes("/") ? `${rest.split("/")[0]}/` : rest)))].sort();
          const items = names.map((name) => (name.endsWith("/") ? { id: null, name: name.slice(0, -1) } : { id: `id-${name}`, name }));
          return { data: items.slice(offset, offset + limit), error: null };
        },
        remove: async (paths: string[]) => {
          bucket.removed.push(paths);
          return { data: [], error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          bucket.deleted.push(id);
          return { error: null };
        },
      },
    },
  }),
}));

const { default: accountRoute, listUserFiles } = await import("@/pages/api/account");

const call = async (ip: string) => {
  const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; }, end() { return this; }, setHeader() {} };
  await accountRoute({ method: "DELETE", headers: {}, socket: { remoteAddress: ip } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
};

describe("deleting an account", () => {
  it("asks for a code typed just now: an older app, or a session left open, is refused and nothing is erased", async () => {
    bucket.deleted = [];
    bucket.removed = [];
    bucket.files = ["u1/scan-1/preview.jpg"];
    // Opened by a password, or an old token without "amr": no proof.
    for (const claims of [{}, { amr: [{ method: "password", timestamp: nowSeconds() }] }, { amr: [{ method: "otp", timestamp: nowSeconds() - 3600 }] }]) {
      bucket.claims = claims;
      const res = await call("10.3.0.2");
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ error: { code: "code_required" } });
    }
    expect(bucket.deleted).toEqual([]);
    expect(bucket.removed).toEqual([]);
  });

  it("lists every file under the user's folder, at any level", async () => {
    bucket.files = [
      "u1/stray.jpg",
      "u1/scan-1/preview.jpg",
      "u1/scan-1/thumbnail.jpg",
      "u1/loans/l1/p1.jpg",
      "u1/loans/l1/p1.thumb.jpg",
      "u1/loans/l2/p2.jpg",
      "u2/scan-9/preview.jpg",
    ];
    bucket.empty = ["u1/empty", "u1/loans/l3"];
    expect((await listUserFiles("u1")).sort()).toEqual(
      ["u1/stray.jpg", "u1/scan-1/preview.jpg", "u1/scan-1/thumbnail.jpg", "u1/loans/l1/p1.jpg", "u1/loans/l1/p1.thumb.jpg", "u1/loans/l2/p2.jpg"].sort(),
    );
  });

  it("removes the files by batches of 1000, then the user", async () => {
    bucket.files = Array.from({ length: 1200 }, (_, index) => `u1/loans/l${index % 3}/p${index}.jpg`).concat("u1/scan-1/preview.jpg");
    bucket.removed = [];
    bucket.claims = { amr: [{ method: "otp", timestamp: nowSeconds() - 30 }] };
    const res = await call("10.3.0.1");
    expect(res.statusCode).toBe(204);
    expect(bucket.removed.map((batch) => batch.length)).toEqual([1000, 201]);
    expect(bucket.removed.flat()).toContain("u1/scan-1/preview.jpg");
    expect(bucket.deleted).toEqual(["u1"]);
  });
});
