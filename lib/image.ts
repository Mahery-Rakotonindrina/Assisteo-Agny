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

function loadImage(src: string): Promise<HTMLImageElement> {
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

/** The three sizes the app needs from one capture. */
export async function prepareCapture(src: string) {
  const [upload, preview, thumbnail] = await Promise.all([
    // Claude downsizes anything over ~1568 px on the long edge anyway.
    encodeImage(src, 1568, 0.85),
    encodeImage(src, 960, 0.8),
    encodeImage(src, 320, 0.72),
  ]);
  return { upload, preview, thumbnail };
}
