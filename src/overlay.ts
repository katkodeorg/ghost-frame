/**
 * Overlay position and size, in units of the stage width, so it holds up
 * across rotation, resizing and lens changes.
 * x, y: offset of the overlay centre from the stage centre
 * w: overlay width (height follows the image aspect)
 */
export interface Transform {
  x: number;
  y: number;
  w: number;
}

const MIN_W = 0.05;
const MAX_W = 20;

export class Overlay {
  t: Transform = { x: 0, y: 0, w: 1 };
  mirrored = false;
  /** Reference aspect ratio (width / height). */
  aspect = 1;
  private W = 0;
  private H = 0;
  private fitted = false;

  constructor(private el: HTMLElement) {}

  setImage(aspect: number): void {
    this.aspect = aspect;
    this.fitted = false;
    this.mirrored = false;
  }

  /** Updates the stage size in CSS px; fits the overlay the first time a size is known. */
  setStage(W: number, H: number): void {
    this.W = W;
    this.H = H;
    if (!this.fitted && W > 0 && H > 0) this.reset();
    else this.render();
  }

  get stageSize(): { W: number; H: number } {
    return { W: this.W, H: this.H };
  }

  /** "Contain" fit inside the current stage. */
  reset(): void {
    if (!this.W || !this.H) return;
    const fitW = Math.min(this.W, this.H * this.aspect);
    this.t = { x: 0, y: 0, w: fitW / this.W };
    this.fitted = true;
    this.render();
  }

  /** Moves by (dx, dy) CSS px. */
  pan(dx: number, dy: number): void {
    if (!this.W) return;
    this.t.x += dx / this.W;
    this.t.y += dy / this.W;
    this.render();
  }

  /** Scales by `f` around point (px, py), given in stage CSS px. */
  zoomAt(f: number, px: number, py: number): void {
    if (!this.W || !Number.isFinite(f) || f <= 0) return;
    const w = Math.min(MAX_W, Math.max(MIN_W, this.t.w * f));
    const k = w / this.t.w;
    const cx = this.W / 2 + this.t.x * this.W;
    const cy = this.H / 2 + this.t.y * this.W;
    const ncx = px + (cx - px) * k;
    const ncy = py + (cy - py) * k;
    this.t = { w, x: (ncx - this.W / 2) / this.W, y: (ncy - this.H / 2) / this.W };
    this.render();
  }

  render(): void {
    const { W, H } = this;
    if (!W || !H) return;
    const ow = this.t.w * W;
    const oh = ow / this.aspect;
    const left = W / 2 + this.t.x * W - ow / 2;
    const top = H / 2 + this.t.y * W - oh / 2;
    const s = this.el.style;
    s.width = `${ow}px`;
    s.height = `${oh}px`;
    s.transform = `translate(${left}px, ${top}px)${this.mirrored ? ' scaleX(-1)' : ''}`;
  }
}

/**
 * Draws `img` into a context of size (pw × ph) exactly as the overlay appears
 * on a stage with the same aspect ratio.
 */
export function drawWithTransform(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  aspect: number,
  t: Transform,
  mirrored: boolean,
  pw: number,
  ph: number,
): void {
  const ow = t.w * pw;
  const oh = ow / aspect;
  const cx = pw / 2 + t.x * pw;
  const cy = ph / 2 + t.y * pw;
  ctx.save();
  ctx.translate(cx, cy);
  if (mirrored) ctx.scale(-1, 1);
  ctx.drawImage(img, -ow / 2, -oh / 2, ow, oh);
  ctx.restore();
}

interface GestureCallbacks {
  /** Converts client coordinates to stage-local CSS px. */
  toStage(clientX: number, clientY: number): { x: number; y: number };
  onGesture(): void;
}

/**
 * One-finger drag, two-finger pinch around the midpoint, double-tap reset and
 * wheel zoom. Attach to an element with `touch-action: none`.
 */
export function attachGestures(target: HTMLElement, overlay: Overlay, cb: GestureCallbacks): void {
  const pts = new Map<number, { x: number; y: number }>();
  let tap: { t: number; x: number; y: number; moved: boolean } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;

  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
    target.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap = pts.size === 1 ? { t: performance.now(), x: e.clientX, y: e.clientY, moved: false } : null;
  });

  target.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;

    if (pts.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
      if (dx || dy) {
        overlay.pan(dx, dy);
        if (!tap || tap.moved) cb.onGesture();
      }
      return;
    }

    // Two (or more) pointers: use the first two.
    const [a0, b0] = [...pts.values()];
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a1, b1] = [...pts.values()];
    const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
    const m0 = cb.toStage((a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
    const m1 = cb.toStage((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
    if (d0 > 0 && d1 > 0) overlay.zoomAt(d1 / d0, m0.x, m0.y);
    overlay.pan(m1.x - m0.x, m1.y - m0.y);
    cb.onGesture();
  });

  const end = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    if (e.type !== 'pointerup' || !tap || pts.size > 0) {
      if (pts.size > 0) tap = null;
      return;
    }
    const now = performance.now();
    const quick = !tap.moved && now - tap.t < 300;
    if (quick) {
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        overlay.reset();
        cb.onGesture();
        lastTap = null;
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    } else {
      lastTap = null;
    }
    tap = null;
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('lostpointercapture', end);

  target.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      const f = Math.exp(-e.deltaY * unit * speed);
      const p = cb.toStage(e.clientX, e.clientY);
      overlay.zoomAt(f, p.x, p.y);
      cb.onGesture();
    },
    { passive: false },
  );
}
