export interface Lens {
  deviceId: string;
  label: string;
}

export type CameraErrorKind = 'unsupported' | 'insecure' | 'denied' | 'notfound' | 'busy' | 'unknown';

export class CameraError extends Error {
  constructor(public kind: CameraErrorKind, message: string) {
    super(message);
  }
}

const IDEAL = { width: { ideal: 4032 }, height: { ideal: 3024 } };

type ZoomCaps = { min: number; max: number; step?: number };

/** Owns the MediaStream for the viewfinder <video>. */
export class Camera {
  stream: MediaStream | null = null;
  /** deviceId the user explicitly picked, or null for "default rear camera". */
  private requestedId: string | null = null;
  onEnded: (() => void) | null = null;

  constructor(private video: HTMLVideoElement) {}

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  get isLive(): boolean {
    return this.track?.readyState === 'live';
  }

  get deviceId(): string | undefined {
    return this.track?.getSettings().deviceId;
  }

  /** True for selfie/user-facing cameras, whose preview and capture are mirrored. */
  get isFront(): boolean {
    const t = this.track;
    if (!t) return false;
    const facing = t.getSettings().facingMode;
    if (facing) return facing === 'user';
    return /front|facetime|user/i.test(t.label);
  }

  static support(): CameraError | null {
    if (!window.isSecureContext) {
      return new CameraError('insecure', 'Camera access needs a secure (HTTPS) connection.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return new CameraError('unsupported', 'This browser does not support camera access.');
    }
    return null;
  }

  async start(deviceId: string | null = this.requestedId): Promise<void> {
    const unsupported = Camera.support();
    if (unsupported) throw unsupported;

    this.stop();
    this.requestedId = deviceId;

    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, ...IDEAL }
      : { facingMode: { ideal: 'environment' }, ...IDEAL };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        // Retry with the loosest request before giving up.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (err2) {
          throw mapError(err2);
        }
      } else {
        throw mapError(err);
      }
    }

    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => this.onEnded?.());

    this.video.srcObject = stream;
    this.video.classList.toggle('mirrored', this.isFront);
    await waitForMetadata(this.video);
    await this.video.play().catch(() => {
      /* autoplay with muted+playsinline normally succeeds; ignore spurious aborts */
    });
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Video inputs, rear cameras first, with human-friendly labels. Call after permission is granted. */
  async lenses(): Promise<Lens[]> {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const rank = (label: string) => (/back|rear|environment/i.test(label) ? 0 : /front|user|facetime/i.test(label) ? 2 : 1);
    const sorted = devices
      .map((d, i) => ({ d, i }))
      .sort((a, b) => rank(a.d.label) - rank(b.d.label) || a.i - b.i);

    const seen = new Map<string, number>();
    return sorted.map(({ d }, i) => {
      let label = cleanLabel(d.label, i);
      const count = (seen.get(label) ?? 0) + 1;
      seen.set(label, count);
      if (count > 1) label = `${label} ${count}`;
      return { deviceId: d.deviceId, label };
    });
  }

  zoomCaps(): ZoomCaps | null {
    const t = this.track;
    if (!t || typeof t.getCapabilities !== 'function') return null;
    const caps = t.getCapabilities() as MediaTrackCapabilities & { zoom?: ZoomCaps };
    if (!caps.zoom || !(caps.zoom.max > caps.zoom.min)) return null;
    return caps.zoom;
  }

  get zoom(): number {
    return ((this.track?.getSettings() as MediaTrackSettings & { zoom?: number }) ?? {}).zoom ?? 1;
  }

  async setZoom(value: number): Promise<void> {
    const t = this.track;
    if (!t) return;
    await t.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
  }
}

/** "Back Ultra Wide Camera" → "Ultra Wide", "camera2 1, facing back" → "Back 2", etc. */
export function cleanLabel(label: string, index: number): string {
  if (!label) return `Camera ${index + 1}`;
  const l = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();

  const apple = l.match(/^(back|front)\s*(.*?)\s*camera$/i);
  if (apple) {
    const kind = apple[2].trim();
    if (apple[1].toLowerCase() === 'front') return kind ? `Front ${kind}` : 'Front';
    return kind || 'Wide';
  }
  const android = l.match(/camera\s*\d*\s*(\d+),\s*facing\s+(back|front)/i);
  if (android) {
    const side = android[2].toLowerCase() === 'back' ? 'Back' : 'Front';
    return `${side} ${Number(android[1]) + 1}`;
  }
  return l;
}

function mapError(err: unknown): CameraError {
  const e = err as DOMException;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was denied.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('notfound', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('busy', 'The camera is in use by another app, or could not be started.');
    default:
      return new CameraError('unknown', e?.message || 'The camera could not be started.');
  }
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done);
    setTimeout(done, 4000);
  });
}
