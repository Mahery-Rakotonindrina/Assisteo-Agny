import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { Locale } from "@/i18n.config";
import type { ObjectAdResponse, ObjectCondition } from "@/lib/ai/schema";
import type { HistoryEntry } from "@/types/history";
import { shareText, type ShareOutcome } from "./device";
import { httpClient } from "./httpClient";
import { installIdHeaders } from "./trial";

const PLACE_KEY = "objectAd.place";
const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** The town the seller gave last time, kept on this device. */
export const adPlace = {
  get(): string {
    try {
      return localStorage.getItem(PLACE_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(place: string) {
    try {
      if (place.trim()) localStorage.setItem(PLACE_KEY, place.trim());
      else localStorage.removeItem(PLACE_KEY);
    } catch {
      // Private mode: just not remembered.
    }
  },
};

/** Asks the server's AI for the scan's classified ad (one of the day's questions). */
export async function writeAd(entry: HistoryEntry, options: { condition: ObjectCondition; place: string; malagasy: boolean; locale: Locale }, signal?: AbortSignal) {
  return httpClient.post<ObjectAdResponse>(
    "/api/objects/ad",
    {
      // The stored preview (960 px JPEG) is enough for the model to look again.
      image: base64(entry.preview),
      mediaType: "image/jpeg",
      analysis: entry.analysis,
      condition: options.condition,
      ...(options.place.trim() && { place: options.place.trim().slice(0, 60) }),
      locale: options.locale,
      ...(options.malagasy && { malagasy: true }),
    },
    { headers: await installIdHeaders(), signal },
  );
}

/** A JPEG data URL as bytes, decoded here: on the web, the CSP keeps fetch() off data: URLs. */
function jpegBytes(dataUrl: string) {
  const binary = atob(base64(dataUrl));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The ad to the share sheet, with the photo when the phone takes files along
 * (WhatsApp, Facebook…); the text alone otherwise, or copied as a last resort.
 */
export async function shareAd(title: string, text: string, photo: string): Promise<ShareOutcome> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({ path: "annonce.jpg", data: base64(photo), directory: Directory.Cache });
      await Share.share({ title, text, files: [uri], dialogTitle: title });
      return "shared";
    }
    const file = new File([jpegBytes(photo)], "annonce.jpg", { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file], text })) {
      await navigator.share({ files: [file], title, text });
      return "shared";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if ((error instanceof DOMException && error.name === "AbortError") || /cancel|abort/i.test(message)) return "cancelled";
    // The photo could not go along: the text alone.
  }
  return shareText(title, text);
}
