import { describe, expect, it } from "vitest";
import { withLegacyDefaults } from "@/scripts/lib/backup.mjs";

describe("restoring a backup made before migration 0019", () => {
  const seat = { id: "s1", owner_id: "o", owner_email: "a@example.com", member_email: "b@example.com", created_at: "2026-10-01T00:00:00.000Z" };

  it("brings a family seat back accepted, as the migration made it, never as a waiting invitation", () => {
    expect(withLegacyDefaults("family_seats", seat)).toEqual({ ...seat, accepted_at: seat.created_at });
  });

  it("keeps what a newer backup says, an invitation included", () => {
    expect(withLegacyDefaults("family_seats", { ...seat, accepted_at: null })).toHaveProperty("accepted_at", null);
    expect(withLegacyDefaults("family_seats", { ...seat, accepted_at: "2026-10-02T00:00:00.000Z" })).toHaveProperty("accepted_at", "2026-10-02T00:00:00.000Z");
  });

  it("leaves every other table as it is", () => {
    const loan = { user_id: "u", id: "l" };
    expect(withLegacyDefaults("loans", loan)).toBe(loan);
  });
});
