import { describe, expect, it, vi } from "vitest";
import { storageRefusal } from "@/lib/storageQuota";
import { storageQuota } from "@/services/storageQuota";

describe("the storage's refusal of a photo", () => {
  it("is 'full' when the quota policy answers (403, row-level security)", () => {
    expect(storageRefusal({ message: "new row violates row-level security policy", statusCode: "403" })).toBe("full");
    expect(storageRefusal({ message: 'new row violates row-level security policy for table "objects"' })).toBe("full");
  });

  it("is 'too_large' for a file over the bucket's limit", () => {
    expect(storageRefusal({ message: "The object exceeded the maximum allowed size", statusCode: "413" })).toBe("too_large");
    expect(storageRefusal({ message: "Payload too large" })).toBe("too_large");
  });

  it("is nothing for a network or session failure: the sync fails and tries again", () => {
    expect(storageRefusal(new TypeError("Failed to fetch"))).toBeNull();
    expect(storageRefusal({ message: "Internal error", status: 500 })).toBeNull();
    // A bare 403 (an expired session, say) is not "full".
    expect(storageRefusal({ message: "Unauthorized", status: 403 })).toBeNull();
    expect(storageRefusal(null)).toBeNull();
    expect(storageRefusal("403")).toBeNull();
  });
});

describe("the 'photos full' notice", () => {
  it("lights up on a refusal only, tells its listeners, and clears when an upload goes through", () => {
    storageQuota.reset();
    const listener = vi.fn();
    const stop = storageQuota.subscribe(listener);
    expect(storageQuota.refused(new TypeError("Failed to fetch"))).toBe(false);
    expect(storageQuota.isFull()).toBe(false);
    expect(storageQuota.refused({ message: "new row violates row-level security policy", statusCode: "403" })).toBe(true);
    expect(storageQuota.isFull()).toBe(true);
    // Again: no new notice.
    storageQuota.refused({ message: "new row violates row-level security policy", statusCode: "403" });
    expect(listener).toHaveBeenCalledTimes(1);
    storageQuota.accepted();
    expect(storageQuota.isFull()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});
