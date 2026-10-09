// Client-side image helpers: every photo is re-encoded through a canvas so the
// upload size is predictable and EXIF (GPS, device) metadata is stripped.

export type EncodedImage = {
  dataUrl: string;
  /** Raw base64 payload, without the data URL prefix. */
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read this image."));
    image.src = src;
  });
}

export async function encodeImage(src: string, maxEdge: number, quality: number): Promise<EncodedImage> {
  const image = await loadImage(src);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mediaType: "image/jpeg",
    width,
    height,
  };
}

export type CaptureOptions = {
  /** Data saver: about three times less data per photo, still legible. */
  light?: boolean;
  /** One page of several: a little smaller, so the pages fit in one request. */
  page?: boolean;
};

/** Long edge and JPEG quality of the photo sent to the AI. */
function uploadSize({ light, page }: CaptureOptions): [number, number] {
  if (light) return [1100, 0.72];
  // Claude downsizes anything over ~1568 px on the long edge anyway.
  return page ? [1400, 0.8] : [1568, 0.85];
}

/** The three sizes the app needs from one capture. */
export async function prepareCapture(src: string, options: CaptureOptions = {}) {
  const [maxEdge, quality] = uploadSize(options);
  const [upload, preview, thumbnail] = await Promise.all([
    encodeImage(src, maxEdge, quality),
    options.light ? encodeImage(src, 720, 0.7) : encodeImage(src, 960, 0.8),
    options.light ? encodeImage(src, 240, 0.66) : encodeImage(src, 320, 0.72),
  ]);
  return { upload, preview, thumbnail };
}

export type PreparedCapture = Awaited<ReturnType<typeof prepareCapture>>;
