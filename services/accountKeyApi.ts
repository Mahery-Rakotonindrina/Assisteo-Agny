import type { AccountAiKey } from "@/pages/api/account/ai-key";
import { authHeaders } from "./account";
import type { SavedKey } from "./aiKeyStore";
import { httpClient } from "./httpClient";

// The account copy of the user's own AI key, encrypted by the server.

export const accountKeyApi = {
  async get(): Promise<AccountAiKey | null> {
    const { key } = await httpClient.get<{ key: AccountAiKey | null }>("/api/account/ai-key", { headers: await authHeaders() });
    return key;
  },

  async put({ presetId, updatedAt, ...key }: SavedKey) {
    await httpClient.put<void>(
      "/api/account/ai-key",
      { key, presetId, updatedAt: updatedAt ?? Date.now() },
      { headers: await authHeaders() },
    );
  },

  async remove() {
    await httpClient.delete<void>("/api/account/ai-key", { headers: await authHeaders() });
  },
};
