import type { Locale } from "@/i18n.config";
import { overrideHeaders, type AskRequest, type AskResponse, type ChatMessage } from "@/lib/ai/schema";
import type { HistoryEntry } from "@/types/history";
import { httpClient } from "./httpClient";
import { usableAiKey } from "./plan";
import { installIdHeaders } from "./trial";

const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/**
 * Sends the conversation so far (ending with the new question) and returns the
 * answer. With a `task`, reads the text on the photos instead (copy, translate).
 */
export async function askAboutScan(
  entry: HistoryEntry,
  messages: ChatMessage[],
  locale: Locale,
  signal?: AbortSignal,
  read?: Pick<AskRequest, "task" | "target">,
) {
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
      image: base64(entry.preview),
      mediaType: "image/jpeg",
      // The other pages of a multi-page scan, when this device has them.
      ...(entry.pages?.length && { pages: entry.pages.map((page) => ({ image: base64(page), mediaType: "image/jpeg" as const })) }),
      analysis: entry.analysis,
      messages,
      locale,
      ...read,
    },
    { headers, signal },
  );
}
