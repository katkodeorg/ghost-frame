import { drawWithTransform, type Transform } from './overlay';

/** Longest side of each panel in the comparison image. */
const PANEL_MAX = 2000;

/** Grabs the current video frame at native resolution. The overlay is never drawn. */
export function grabFrame(video: HTMLVideoElement, into: HTMLCanvasElement, mirror: boolean): boolean {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return false;
  into.width = w;
  into.height = h;
  const ctx = into.getContext('2d')!;
  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  return true;
}

export interface CompareInput {
  photo: HTMLCanvasElement;
  reference: HTMLImageElement;
  aspect: number;
  transform: Transform;
  mirrored: boolean;
}

/**
 * Reference (with the user's exact alignment, black outside it) next to the
 * photo: stacked for landscape shots, side by side for portrait.
 */
export function renderComparison({ photo, reference, aspect, transform, mirrored }: CompareInput): HTMLCanvasElement {
  const s = Math.min(1, PANEL_MAX / Math.max(photo.width, photo.height));
  const pw = Math.round(photo.width * s);
  const ph = Math.round(photo.height * s);
  const landscape = pw > ph;

  const out = document.createElement('canvas');
  out.width = landscape ? pw : pw * 2;
  out.height = landscape ? ph * 2 : ph;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);

  // Reference panel, clipped to its own rectangle.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pw, ph);
  ctx.clip();
  drawWithTransform(ctx, reference, aspect, transform, mirrored, pw, ph);
  ctx.restore();

  // Photo panel.
  ctx.drawImage(photo, landscape ? 0 : pw, landscape ? ph : 0, pw, ph);
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality),
  );
}

/**
 * Synchronous JPEG encode. Used for the comparison so that navigator.share()
 * is still called inside the tap's user activation (Safari is strict here).
 */
export function canvasToBlobSync(canvas: HTMLCanvasElement, quality = 0.92): Blob {
  const url = canvas.toDataURL('image/jpeg', quality);
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}
