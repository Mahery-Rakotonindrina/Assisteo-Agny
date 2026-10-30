import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect, it, vi } from "vitest";

// A stand-in for the "scans" bucket: files at any level, listed one folder at a time like Supabase.
const bucket = vi.hoisted(() => ({ files: [] as string[], empty: [] as string[], removed: [] as string[][], deleted: [] as string[] }));
vi.mock("@/lib/server/redis", () => ({ redis: null }));
vi.mock("@/lib/server/supabaseAdmin", () => ({
  accountsEnabled: true,
  verifyUser: async () => "u1",
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

describe("deleting an account", () => {
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
    const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() { return this; }, end() { return this; }, setHeader() {} };
    const req = { method: "DELETE", headers: {}, socket: { remoteAddress: "10.3.0.1" } } as unknown as NextApiRequest;
    await accountRoute(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(204);
    expect(bucket.removed.map((batch) => batch.length)).toEqual([1000, 201]);
    expect(bucket.removed.flat()).toContain("u1/scan-1/preview.jpg");
    expect(bucket.deleted).toEqual(["u1"]);
  });
});
