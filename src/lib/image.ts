// Client-side image preparation, run before a photo is ever uploaded.
//
// Three reasons this is not optional:
//   • a modern phone camera produces 3–8 MB per shot, and Vercel refuses a
//     request body much past 4.5 MB;
//   • vision models are billed by image tokens, and a 4000 px plate of pasta
//     costs several times a 1024 px one while estimating no better;
//   • iOS shoots HEIC, which most models will not decode. Re-encoding through
//     a canvas produces JPEG whatever went in.

const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.72;

export type PrepareOptions = {
  /** Longest side, in pixels. */
  maxEdge?: number;
  /**
   * Total pixel budget. A food photo only needs its long edge capped, but a
   * screenshot of notes is text: capping a tall scrolling capture at 1024 px
   * would shrink the writing past legible, so it is budgeted by area instead.
   */
  maxPixels?: number;
  quality?: number;
};

export async function preparePhoto(file: File, options: PrepareOptions = {}): Promise<Blob> {
  const { maxEdge = MAX_EDGE, maxPixels = Infinity, quality = JPEG_QUALITY } = options;
  const bitmap = await loadImage(file);

  const scale = Math.min(
    1,
    maxEdge / Math.max(bitmap.width, bitmap.height),
    Math.sqrt(maxPixels / (bitmap.width * bitmap.height)),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that photo.');
  // JPEG has no transparency: a PNG screenshot with a see-through background
  // would otherwise encode as black, and black text on it as nothing at all.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Could not process that photo.');
  return blob;
}

/**
 * Decoded through an <img>, not createImageBitmap: browsers apply the EXIF
 * orientation tag to an HTMLImageElement automatically, so a photo taken
 * sideways reaches the model the way up the user saw it.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image this browser can open.'));
    };
    img.src = url;
  });
}
