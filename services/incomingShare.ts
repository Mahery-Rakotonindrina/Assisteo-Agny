import { Capacitor } from "@capacitor/core";

// Photos shared to the app from WhatsApp, the gallery… (Android share sheet,
// @capgo/capacitor-share-target). The receiver keeps them here until the scan
// screen takes them.

let pending: string[] | null = null;
const listeners = new Set<() => void>();

export const incomingShare = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Image files received; their paths become URLs the WebView can load. */
  receive(files: Array<{ uri: string; mimeType: string }>) {
    const images = files.filter((file) => file.mimeType.startsWith("image/") && file.uri).map((file) => Capacitor.convertFileSrc(file.uri));
    if (images.length === 0) return false;
    pending = images;
    listeners.forEach((listener) => listener());
    return true;
  },

  peek: () => pending,

  /** The shared photos, once: the screen that takes them starts the scan. */
  take() {
    const images = pending;
    pending = null;
    return images;
  },
};
