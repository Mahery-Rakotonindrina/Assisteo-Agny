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

export const isNative = () => Capacitor.isNativePlatform();
