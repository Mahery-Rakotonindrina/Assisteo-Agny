import { Camera, CameraDirection, EncodingType } from "@capacitor/camera";

export type PhotoSource = "camera" | "gallery";

export class CaptureCancelledError extends Error {}

/**
 * Opens the native camera / photo picker (or their web fallbacks) and returns
 * a URL the WebView can load into an <img> or canvas.
 */
export async function capturePhoto(source: PhotoSource): Promise<string> {
  try {
    if (source === "camera") {
      const result = await Camera.takePhoto({
        quality: 90,
        targetWidth: 2048,
        targetHeight: 2048,
        correctOrientation: true,
        encodingType: EncodingType.JPEG,
        cameraDirection: CameraDirection.Rear,
        saveToGallery: false,
        webUseInput: preferFileInput(),
      });
      return resolveSrc(result.webPath, result.thumbnail);
    }

    const { results } = await Camera.chooseFromGallery({ limit: 1, quality: 90 });
    const [first] = results;
    if (!first) throw new CaptureCancelledError();
    return resolveSrc(first.webPath, first.thumbnail);
  } catch (error) {
    if (error instanceof CaptureCancelledError || isCancellation(error)) {
      throw new CaptureCancelledError();
    }
    throw error;
  }
}

/** Several photos from the gallery at once (the pages of a document). */
export async function choosePhotos(limit: number): Promise<string[]> {
  try {
    const { results } = await Camera.chooseFromGallery({ allowMultipleSelection: true, limit, quality: 90 });
    const sources = results.map((result) => resolveSrc(result.webPath, result.thumbnail)).slice(0, limit);
    if (sources.length === 0) throw new CaptureCancelledError();
    return sources;
  } catch (error) {
    if (error instanceof CaptureCancelledError || isCancellation(error)) throw new CaptureCancelledError();
    throw error;
  }
}

// In a browser, the in-page camera modal needs getUserMedia (HTTPS only) and is
// clunky on phones; a capture file input opens the phone's own camera app instead.
function preferFileInput() {
  if (typeof window === "undefined") return false;
  return !window.isSecureContext || window.matchMedia("(pointer: coarse)").matches;
}

function resolveSrc(webPath?: string, thumbnail?: string) {
  if (webPath) return webPath;
  if (thumbnail) return thumbnail.startsWith("data:") ? thumbnail : `data:image/jpeg;base64,${thumbnail}`;
  throw new Error("The camera returned no image.");
}

function isCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}
