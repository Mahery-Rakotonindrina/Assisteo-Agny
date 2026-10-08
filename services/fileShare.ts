import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Hands a text file to the user: the share sheet in the app and on phones
 * (to save it, or send it by e-mail or WhatsApp), a download on computers.
 */
export async function shareTextFile(name: string, content: string, mimeType: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: name, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title, files: [uri], dialogTitle: title });
      return "shared";
    } catch {
      return "cancelled";
    }
  }

  const file = new File([content], name, { type: mimeType });
  const touch = window.matchMedia?.("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Sharing refused (no app for this file): download it instead.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
