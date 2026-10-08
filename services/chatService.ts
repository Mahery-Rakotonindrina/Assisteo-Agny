import type { Locale } from "@/i18n.config";
import { overrideHeaders, type AskResponse, type ChatMessage } from "@/lib/ai/schema";
import type { HistoryEntry } from "@/types/history";
import { httpClient } from "./httpClient";
import { usableAiKey } from "./plan";
import { installIdHeaders } from "./trial";

/** Sends the conversation so far (ending with the new question) and returns the answer. */
export async function askAboutScan(entry: HistoryEntry, messages: ChatMessage[], locale: Locale, signal?: AbortSignal) {
  const override = await usableAiKey();
  // The account goes along even with an own key: the server checks the plan allows one.
  const headers: Record<string, string> = {
    ...(await installIdHeaders()),
    ...(override && {
      [overrideHeaders.provider]: override.provider,
      [overrideHeaders.apiKey]: override.apiKey,
      [overrideHeaders.model]: override.model,
      ...(override.provider === "openai" && { [overrideHeaders.baseUrl]: override.baseUrl }),
    }),
  };

  return httpClient.post<AskResponse>(
    "/api/ask",
    {
      // The stored preview (960 px JPEG) is enough for the model to look again.
      image: entry.preview.slice(entry.preview.indexOf(",") + 1),
      mediaType: "image/jpeg",
      analysis: entry.analysis,
      messages,
      locale,
    },
    { headers, signal },
  );
}
