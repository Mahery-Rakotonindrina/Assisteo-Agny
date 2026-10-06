import { Camera, type CameraPermissionState } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { getNotificationPermission, requestNotificationPermission } from "./notifications";

// One API over the device permissions the app uses. "unsupported" means the
// platform has nothing to ask for (e.g. browsers prompt on their own).

export type PermissionKind = "camera" | "notifications";
export type PermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

function fromCamera(state: CameraPermissionState): PermissionStatus {
  if (state === "granted" || state === "limited") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

/** Camera and photo library are asked together: both serve "analyse a photo". */
async function cameraStatus(): Promise<PermissionStatus> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  const { camera, photos } = await Camera.checkPermissions();
  const states = [fromCamera(camera), fromCamera(photos)];
  if (states.includes("denied")) return "denied";
  if (states.includes("prompt")) return "prompt";
  return "granted";
}

async function requestCamera(): Promise<PermissionStatus> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  await Camera.requestPermissions({ permissions: ["camera", "photos"] });
  return cameraStatus();
}

export function getPermission(kind: PermissionKind): Promise<PermissionStatus> {
  return kind === "camera" ? cameraStatus() : getNotificationPermission();
}

export function requestPermission(kind: PermissionKind): Promise<PermissionStatus> {
  return kind === "camera" ? requestCamera() : requestNotificationPermission();
}

/**
 * Called right before opening the camera or the gallery: asks first if the
 * user hasn't decided yet. Returns false when access is denied.
 */
export async function ensureCameraAccess(): Promise<boolean> {
  const status = await cameraStatus().catch(() => "unsupported" as const);
  if (status === "granted" || status === "unsupported") return true;
  if (status === "denied") return false;
  return (await requestCamera()) !== "denied";
}
