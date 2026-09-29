/** Longest side the reference is downscaled to before any pixel processing. */
export const PROCESS_MAX = 1200;

const LINE_RGB: [number, number, number] = [255, 230, 0];

/**
 * Draws a yellow outline of `img` into `out`. Grayscale, 3x3 blur, Sobel,
 * then keep pixels above roughly the 90th percentile of gradient magnitude.
 */
export function drawEdges(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }, out: HTMLCanvasElement): void {
  const scale = Math.min(1, PROCESS_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(3, Math.round(img.naturalWidth * scale));
  const h = Math.max(3, Math.round(img.naturalHeight * scale));

  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h);
  const px = src.data;
  const n = w * h;

  // Grayscale (Rec. 601 luma).
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  }

  // Separable [1 2 1]/4 blur, clamping at the borders.
  const tmp = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = gray[row + (x > 0 ? x - 1 : x)];
      const r = gray[row + (x < w - 1 ? x + 1 : x)];
      tmp[row + x] = (l + 2 * gray[row + x] + r) * 0.25;
    }
  }
  const blur = gray; // reuse buffer
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      blur[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x]) * 0.25;
    }
  }

  // Sobel magnitude (borders left at 0).
  const mag = tmp; // reuse buffer
  mag.fill(0);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = blur[i - w - 1], b = blur[i - w], c = blur[i - w + 1];
      const d = blur[i - 1], f = blur[i + 1];
      const g = blur[i + w - 1], hh = blur[i + w], k = blur[i + w + 1];
      const gx = c + 2 * f + k - a - 2 * d - g;
      const gy = g + 2 * hh + k - a - 2 * b - c;
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }

  // 90th percentile via histogram.
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  const toBin = max > 0 ? (BINS - 1) / max : 0;
  for (let i = 0; i < n; i++) hist[(mag[i] * toBin) | 0]++;
  const target = n * 0.9;
  let acc = 0;
  let bin = 0;
  for (; bin < BINS; bin++) {
    acc += hist[bin];
    if (acc >= target) break;
  }
  // Minimum threshold so noise in flat images doesn't show up as lines.
  const threshold = max > 0 ? Math.max(bin / toBin, 8) : Infinity;

  const outData = ctx.createImageData(w, h);
  const o = outData.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (mag[i] >= threshold) {
      o[j] = LINE_RGB[0];
      o[j + 1] = LINE_RGB[1];
      o[j + 2] = LINE_RGB[2];
      o[j + 3] = 255;
    }
  }
  ctx.putImageData(outData, 0, 0);
}
