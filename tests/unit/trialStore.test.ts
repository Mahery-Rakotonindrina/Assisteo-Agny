import { describe, expect, it } from "vitest";
import {
  getPlanUsage,
  getTrialUsage,
  releasePlanDeep,
  releasePlanScan,
  releaseTrialScan,
  reservePlanAsk,
  reservePlanDeep,
  reservePlanScan,
  reserveTrialScan,
} from "@/lib/server/trialStore";

// No Redis in unit tests: the in-memory store, default limit of 7 scans.
const id = (prefix: string) => `${prefix}${Math.random().toString(16).slice(2)}0000000000000000`.slice(0, 24);
const ip = () => `10.0.0.${Math.floor(Math.random() * 250)}`;

describe("free trial per account", () => {
  it("carries scans made before signing in, and follows the account to a new device", async () => {
    const phone = id("a");
    const user = id("u");
    for (let i = 0; i < 3; i++) expect(await reserveTrialScan({ installId: phone }, ip())).not.toBeNull();

    // Signs in on the same phone: the account catches up with the 3 earlier scans.
    expect(await reserveTrialScan({ installId: phone, userId: user }, ip())).toEqual({ used: 4, limit: 7 });

    // New device, same account: no fresh trial.
    const laptop = id("b");
    expect(await getTrialUsage({ installId: laptop, userId: user })).toEqual({ used: 4, limit: 7 });
    for (let i = 0; i < 3; i++) expect(await reserveTrialScan({ installId: laptop, userId: user }, ip())).not.toBeNull();
    expect(await reserveTrialScan({ installId: laptop, userId: user }, ip())).toBeNull();
    expect(await getTrialUsage({ installId: laptop, userId: user })).toEqual({ used: 7, limit: 7 });
  });

  it("gives a failed analysis back to both the device and the account", async () => {
    const subject = { installId: id("c"), userId: id("v") };
    const address = ip();
    expect(await reserveTrialScan(subject, address)).toEqual({ used: 1, limit: 7 });
    await releaseTrialScan(subject, address);
    expect(await getTrialUsage(subject)).toEqual({ used: 0, limit: 7 });
  });
});

describe("subscribers' allowances", () => {
  it("counts scans per month and questions per day against the plan, 0 meaning no limit", async () => {
    const user = id("s");
    expect(await reservePlanScan(user, 2)).toEqual({ used: 1, limit: 2 });
    expect(await reservePlanScan(user, 2)).toEqual({ used: 2, limit: 2 });
    expect(await reservePlanScan(user, 2)).toBeNull();
    await releasePlanScan(user);
    expect(await getPlanUsage(user)).toEqual({ scans: 1, questionsToday: 0, deep: 0 });
    expect(await reservePlanDeep(user, 1)).toEqual({ used: 1, limit: 1 });
    expect(await reservePlanDeep(user, 1)).toBeNull();
    await releasePlanDeep(user);
    expect((await getPlanUsage(user)).deep).toBe(0);

    const family = id("f");
    for (let i = 0; i < 50; i++) expect(await reservePlanScan(family, 0)).not.toBeNull();
    expect(await reservePlanAsk(family, 1)).toEqual({ used: 1, limit: 1 });
    expect(await reservePlanAsk(family, 1)).toBeNull();
    expect(await getPlanUsage(family)).toEqual({ scans: 50, questionsToday: 1, deep: 0 });
  });
});
