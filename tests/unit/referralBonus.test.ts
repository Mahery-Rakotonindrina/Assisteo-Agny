import { beforeEach, describe, expect, it, vi } from "vitest";
import { inviteCodeFrom } from "@/lib/offers";
import { referralCodeFor } from "@/lib/offers";
import { defaultReferralConfig, REWARDS_PER_IP, ReferralConfigSchema } from "@/lib/referralBonus";
import fr from "@/locales/fr.json";
import en from "@/locales/en.json";

vi.mock("@/lib/server/redis", () => ({ redis: null }));

const { setParent } = await import("@/lib/server/offerStore");
const store = await import("@/lib/server/referralBonus");

const referrer = "marie@example.mg";
let counter = 0;
/** A friend who entered the referrer's code, with its own e-mail. */
async function friend(parent = referrer) {
  counter += 1;
  const email = `ami${counter}@example.mg`;
  await setParent(email, parent);
  await store.addReferralChild(parent, email);
  return email;
}
const scan = (email: string, installId: string | null, ip: string) => store.rewardFirstScan({ email, installId, ip });

beforeEach(async () => {
  store.resetReferralBonus();
  await store.setReferralConfig(defaultReferralConfig);
});

describe("the referral bonus", () => {
  it("gives both the scans at the friend's first scan, once", async () => {
    const email = await friend();
    await store.noteDevice(referrer, "install-referrer-0001", "10.0.0.1");
    expect(await scan(email, "install-friend-00001", "10.0.0.2")).toBe("rewarded");
    expect(await store.bonusScansLeft(email)).toBe(5);
    expect(await store.bonusScansLeft(referrer)).toBe(5);
    expect(await scan(email, "install-friend-00001", "10.0.0.2")).toBe("already");
    expect(await store.bonusScansLeft(email)).toBe(5);
    expect(await store.referralSummary(referrer)).toMatchObject({ invited: 1, rewarded: 1, scansWon: 5, scansLeft: 5, scansEach: 5 });
  });

  it("gives nothing to someone nobody invited, or when it is switched off", async () => {
    expect(await scan("seul@example.mg", "install-alone-000001", "10.0.0.3")).toBe("no_referrer");
    await store.setReferralConfig({ scans: 0, capPerMonth: 10 });
    expect(await scan(await friend(), "install-off-0000001", "10.0.0.4")).toBe("off");
    expect(await store.bonusScansLeft(referrer)).toBe(0);
  });

  it("refuses a friend who is the referrer's install or address", async () => {
    await store.noteDevice(referrer, "install-referrer-0001", "10.0.1.1");
    expect(await scan(await friend(), "install-referrer-0001", "10.0.1.9")).toBe("self");
    expect(await scan(await friend(), "install-other-0000001", "10.0.1.1")).toBe("self");
    expect(await store.bonusScansLeft(referrer)).toBe(0);
  });

  it("rewards an install once, whoever the account", async () => {
    expect(await scan(await friend(), "install-shared-00001", "10.0.2.1")).toBe("rewarded");
    expect(await scan(await friend(), "install-shared-00001", "10.0.2.2")).toBe("install");
  });

  it("allows a few rewards per address, not more", async () => {
    for (let index = 0; index < REWARDS_PER_IP; index += 1) expect(await scan(await friend(), `install-nat-${index}-000000`, "10.0.3.1")).toBe("rewarded");
    expect(await scan(await friend(), "install-nat-9-0000000", "10.0.3.1")).toBe("ip");
  });

  it("caps the referrer's month, the friend still winning", async () => {
    await store.setReferralConfig({ scans: 5, capPerMonth: 1 });
    const first = await friend();
    const second = await friend();
    expect(await scan(first, "install-cap-1-000000", "10.0.4.1")).toBe("rewarded");
    expect(await scan(second, "install-cap-2-000000", "10.0.4.2")).toBe("rewarded");
    expect(await store.bonusScansLeft(second)).toBe(5);
    expect(await store.bonusScansLeft(referrer)).toBe(5);
  });

  it("spends the won scans one by one, and gives one back", async () => {
    const email = await friend();
    await scan(email, "install-spend-000001", "10.0.5.1");
    for (let index = 0; index < 5; index += 1) expect(await store.takeBonusScan(email)).toBe(true);
    expect(await store.takeBonusScan(email)).toBe(false);
    expect(await store.bonusScansLeft(email)).toBe(0);
    await store.returnBonusScan(email);
    expect(await store.bonusScansLeft(email)).toBe(1);
  });
});

describe("the invitation link", () => {
  it("takes a code made like ours, in any case", () => {
    const code = referralCodeFor("0b1f9c52-4a7e-4f0a-9a57-2f5d9f3b1c11");
    expect(inviteCodeFrom(code)).toBe(code);
    expect(inviteCodeFrom(" " + code.toLowerCase() + " ")).toBe(code);
    expect(inviteCodeFrom([code, "x"])).toBe(code);
  });

  it("trusts nothing else from the address", () => {
    for (const bad of [undefined, null, 42, "", "ABC", "ABCDEFGH", "ABCDEF0", "ABCDEFI", "<script>", "NOEL-2026", "A".repeat(500)]) expect(inviteCodeFrom(bad)).toBeNull();
  });
});

describe("settings and texts", () => {
  it("bounds the settings", () => {
    expect(ReferralConfigSchema.safeParse({ scans: 5, capPerMonth: 10 }).success).toBe(true);
    expect(ReferralConfigSchema.safeParse({ scans: -1, capPerMonth: 10 }).success).toBe(false);
    expect(ReferralConfigSchema.safeParse({ scans: 5, capPerMonth: 1.5 }).success).toBe(false);
  });

  it("has the texts in both languages with the same placeholders", () => {
    for (const dictionary of [fr, en]) {
      expect(dictionary.referralBonus.message).toContain("{scans}");
      expect(dictionary.referralBonus.message).toContain("{code}");
      expect(dictionary.referralBonus.body).toContain("{scans}");
      expect(dictionary.referralBonus.friends).toContain("{invited}");
      expect(dictionary.referralBonus.won).toContain("{left}");
    }
  });
});
