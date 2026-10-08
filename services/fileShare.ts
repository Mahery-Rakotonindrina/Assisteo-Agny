import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/** A file's bytes as base64, for the native file system. */
function toBase64(bytes: ArrayBuffer) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Hands a file to the user: the share sheet in the app and on phones (to
 * save it, or send it by e-mail or WhatsApp), a download on computers. In
 * the Android and iOS apps the file is written to the app's cache first,
 * which the share sheet may read (android/app/src/main/res/xml/file_paths.xml).
 */
export async function shareFile(name: string, bytes: ArrayBuffer, mimeType: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    try {
      await Share.share({ title, files: [uri], dialogTitle: title });
      return "shared";
    } catch {
      return "cancelled";
    }
  }

  const file = new File([bytes], name, { type: mimeType });
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
