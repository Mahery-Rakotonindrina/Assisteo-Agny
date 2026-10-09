import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Share } from "@capacitor/share";

// Thin wrappers so screens never deal with platform checks or plugin errors.

let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
}

export const haptics = {
  tap() {
    if (hapticsEnabled) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
  },
  press() {
    if (hapticsEnabled) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => undefined);
  },
  success() {
    if (hapticsEnabled) void Haptics.notification({ type: NotificationType.Success }).catch(() => undefined);
  },
  error() {
    if (hapticsEnabled) void Haptics.notification({ type: NotificationType.Error }).catch(() => undefined);
  },
};

export type ShareOutcome = "shared" | "copied" | "cancelled" | "unavailable";

export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  try {
    const { value: canShare } = await Share.canShare();
    if (canShare) {
      await Share.share({ title, text, dialogTitle: title });
      return "shared";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/cancel|abort/i.test(message)) return "cancelled";
  }

  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(`${title}\n\n${text}`);
    return "copied";
  }
  return "unavailable";
}

/** Puts text on the clipboard; false when the WebView refuses. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: the selection-based copy still works.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

/** Opens a web link, or a tel:, mailto:, sms: link, outside the app. */
export function openExternal(href: string) {
  window.open(href, "_blank", "noopener");
}

export const isNative = () => Capacitor.isNativePlatform();
