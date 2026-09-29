import './style.css';
import { Camera, CameraError } from './camera';
import { Overlay, attachGestures } from './overlay';
import { drawEdges } from './edges';
import { grabFrame, renderComparison, canvasToBlob, canvasToBlobSync } from './capture';
import { saveFile, download, type SaveResult } from './share';
import { $, timestamp, toast, prefersReducedMotion, sleepFrame, isIOS, isAndroid, isStandalone } from './util';
import { initInstall } from './install';

// Elements
const setupEl = $('setup');
const fileInput = $<HTMLInputElement>('file');
const picker = $('picker');
const preview = $<HTMLImageElement>('preview');
const pickerEmpty = $('picker-empty');
const pickerChange = $('picker-change');
const setupError = $('setup-error');
const openCameraBtn = $<HTMLButtonElement>('open-camera');

const viewerEl = $('viewer');
const stageWrap = $('stage-wrap');
const stage = $('stage');
const video = $<HTMLVideoElement>('video');
const still = $<HTMLCanvasElement>('still');
const overlayEl = $('overlay');
const overlayPhoto = $<HTMLImageElement>('overlay-photo');
const overlayLines = $<HTMLCanvasElement>('overlay-lines');
const flash = $('flash');
const hint = $('hint');

const camMessage = $('cam-message');
const camMessageTitle = $('cam-message-title');
const camMessageBody = $('cam-message-body');
const camRetry = $<HTMLButtonElement>('cam-retry');

const lensWrap = $('lens-wrap');
const lensSelect = $<HTMLSelectElement>('lens');
const modePhotoBtn = $<HTMLButtonElement>('mode-photo');
const modeLinesBtn = $<HTMLButtonElement>('mode-lines');
const mirrorBtn = $<HTMLButtonElement>('mirror');
const peekBtn = $<HTMLButtonElement>('peek');
const opacityInput = $<HTMLInputElement>('opacity');
const opacityVal = $<HTMLOutputElement>('opacity-val');
const zoomRow = $('zoom-row');
const zoomInput = $<HTMLInputElement>('zoom');
const zoomVal = $<HTMLOutputElement>('zoom-val');

const liveControls = $('live-controls');
const reviewControls = $('review-controls');
const shutterBtn = $<HTMLButtonElement>('shutter');
const retakeBtn = $<HTMLButtonElement>('retake');
const savePhotoBtn = $<HTMLButtonElement>('save-photo');
const saveCompareBtn = $<HTMLButtonElement>('save-compare');

// State
const camera = new Camera(video);
const overlay = new Overlay(overlayEl);

let refUrl: string | null = null;
let refImg: HTMLImageElement | null = null;
let refAspect = 1;
/** URL currently loaded into the overlay; a new image resets the alignment. */
let overlayUrl: string | null = null;
let edgesFor: string | null = null;
let mode: 'photo' | 'lines' = 'photo';

let viewerOpen = false;
let captured = false;
let captureStamp = '';
let photoFile: File | null = null;
let photoPromise: Promise<File> | null = null;
let starting = false;
let lastAutoRestart = 0;

const HINT_KEY = 'ghostframe.hintSeen';

// Setup screen
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadReference(file);
});

picker.addEventListener('dragover', (e) => {
  e.preventDefault();
  picker.classList.add('dragover');
});
picker.addEventListener('dragleave', () => picker.classList.remove('dragover'));
picker.addEventListener('drop', (e) => {
  e.preventDefault();
  picker.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadReference(file);
});

async function loadReference(file: File): Promise<void> {
  setupError.hidden = true;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  try {
    // Wait for load/error rather than img.decode(): decode() can stay pending while
    // the page is hidden, which happens when a mobile file picker takes over the screen.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
  } catch {
    URL.revokeObjectURL(url);
    const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    setupError.textContent = heic
      ? "This browser can't open HEIC files. Try picking the photo from your Photos library, or convert it to JPEG."
      : "Couldn't open that file. Try a JPEG, PNG or WebP.";
    setupError.hidden = false;
    return;
  }

  if (refUrl && refUrl !== overlayUrl) URL.revokeObjectURL(refUrl);
  refUrl = url;
  refImg = img;
  refAspect = img.naturalWidth / img.naturalHeight;

  preview.src = url;
  preview.hidden = false;
  pickerEmpty.hidden = true;
  pickerChange.hidden = false;
  picker.classList.add('has-image');
  openCameraBtn.disabled = false;
}

openCameraBtn.addEventListener('click', () => void openViewer());

// Viewer lifecycle
async function openViewer(): Promise<void> {
  if (!refUrl || !refImg) return;

  if (overlayUrl !== refUrl) {
    if (overlayUrl) URL.revokeObjectURL(overlayUrl);
    overlayUrl = refUrl;
    overlayPhoto.src = refUrl;
    overlay.setImage(refAspect);
    mirrorBtn.setAttribute('aria-pressed', 'false');
    setOpacity(40);
    setMode('photo');
  }

  setupEl.hidden = true;
  viewerEl.hidden = false;
  viewerOpen = true;
  setCaptured(false);
  stageWrap.focus({ preventScroll: true });
  showHintIfNew();
  await startCamera();
}

function closeViewer(): void {
  viewerOpen = false;
  camera.stop();
  setCaptured(false);
  still.width = still.height = 0;
  viewerEl.hidden = true;
  setupEl.hidden = false;
  openCameraBtn.focus();
}

$('back').addEventListener('click', closeViewer);
$('cam-back').addEventListener('click', closeViewer);
camRetry.addEventListener('click', () => void startCamera());

async function startCamera(deviceId?: string): Promise<void> {
  if (starting) return;
  starting = true;
  camMessage.hidden = true;
  try {
    await camera.start(deviceId);
    if (!viewerOpen) {
      camera.stop();
      return;
    }
    await refreshLenses();
    refreshZoom();
    layoutStage();
  } catch (err) {
    showCameraError(err);
  } finally {
    starting = false;
  }
}

camera.onEnded = () => {
  // iOS ends the track when the app is backgrounded; visibilitychange handles that.
  if (!viewerOpen || captured || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (now - lastAutoRestart > 3000) {
    lastAutoRestart = now;
    void startCamera();
  } else {
    showMessage('Camera stopped', [p('The camera stopped. Another app might have taken it.')], 'Resume camera');
  }
};

function resumeIfNeeded(): void {
  if (!viewerOpen || captured || document.visibilityState !== 'visible') return;
  if (!camera.isLive) void startCamera();
  else if (video.paused) void video.play().catch(() => {});
}
document.addEventListener('visibilitychange', resumeIfNeeded);
window.addEventListener('pageshow', resumeIfNeeded);

// Errors
function p(text: string): HTMLParagraphElement {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
}
function ol(items: string[]): HTMLOListElement {
  const el = document.createElement('ol');
  for (const t of items) {
    const li = document.createElement('li');
    li.textContent = t;
    el.append(li);
  }
  return el;
}

function showMessage(title: string, body: Node[], retryLabel: string | null = 'Try again'): void {
  camMessageTitle.textContent = title;
  camMessageBody.replaceChildren(...body);
  camRetry.hidden = !retryLabel;
  if (retryLabel) camRetry.textContent = retryLabel;
  camMessage.hidden = false;
  (retryLabel ? camRetry : $('cam-back')).focus();
}

function showCameraError(err: unknown): void {
  const kind = err instanceof CameraError ? err.kind : 'unknown';
  switch (kind) {
    case 'denied': {
      const steps = isIOS
        ? isStandalone()
          ? ['Open Settings > Apps > Safari > Camera.', 'Set it to Ask or Allow.', 'Come back and tap Try again.']
          : ['Tap the aA button in the address bar, then Website Settings.', 'Set Camera to Allow.', "If that's not there, go to Settings > Apps > Safari > Camera.", 'Tap Try again.']
        : isAndroid
          ? ['Tap the icon left of the address bar, then Permissions.', 'Set Camera to Allow.', 'Tap Try again, or reload the page.']
          : ['Click the camera icon in the address bar.', 'Allow camera access for this site.', 'Click Try again. You might need to reload.'];
      showMessage('Camera access is blocked', [p('Ghostframe needs camera access to work.'), ol(steps)]);
      break;
    }
    case 'notfound':
      showMessage('No camera found', [p("Couldn't find a camera on this device.")]);
      break;
    case 'busy':
      showMessage('Camera unavailable', [p('Another app or tab might be using the camera. Close it and try again.')]);
      break;
    case 'insecure':
      showMessage('Secure connection required', [p('The camera only works over HTTPS. Open the https:// version of this page.')], null);
      break;
    case 'unsupported':
      showMessage('Camera not supported', [p("This browser doesn't support the camera. Try Safari on iPhone or Chrome on Android.")], null);
      break;
    default:
      showMessage("Couldn't start the camera", [p((err as Error)?.message || 'Something went wrong.')]);
  }
}

// Layout
/** Letterboxes the stage to the exact aspect ratio of the source (no cropping). */
function layoutStage(): void {
  const srcW = captured ? still.width : video.videoWidth;
  const srcH = captured ? still.height : video.videoHeight;
  const box = stageWrap.getBoundingClientRect();
  if (!srcW || !srcH || !box.width || !box.height) return;
  const W = Math.floor(Math.min(box.width, (box.height * srcW) / srcH));
  const H = Math.floor((W * srcH) / srcW);
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  overlay.setStage(W, H);
}

new ResizeObserver(layoutStage).observe(stageWrap);
video.addEventListener('loadedmetadata', layoutStage);
video.addEventListener('resize', layoutStage); // fires when the device rotates

// Gestures & hint
attachGestures(stageWrap, overlay, {
  toStage(x, y) {
    const r = stage.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  },
  onGesture: dismissHint,
});

// Stop Safari's page-level pinch zoom while in the viewfinder.
document.addEventListener('gesturestart', (e) => viewerOpen && e.preventDefault());

stageWrap.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 40 : 8;
  const { W, H } = overlay.stageSize;
  switch (e.key) {
    case 'ArrowLeft': overlay.pan(-step, 0); break;
    case 'ArrowRight': overlay.pan(step, 0); break;
    case 'ArrowUp': overlay.pan(0, -step); break;
    case 'ArrowDown': overlay.pan(0, step); break;
    case '+': case '=': overlay.zoomAt(1.05, W / 2, H / 2); break;
    case '-': case '_': overlay.zoomAt(1 / 1.05, W / 2, H / 2); break;
    case '0': overlay.reset(); break;
    default: return;
  }
  e.preventDefault();
  dismissHint();
});

function showHintIfNew(): void {
  let seen = false;
  try {
    seen = localStorage.getItem(HINT_KEY) === '1';
  } catch {
    /* storage unavailable */
  }
  hint.hidden = seen;
  hint.classList.remove('fade');
}

function dismissHint(): void {
  if (hint.hidden || hint.classList.contains('fade')) return;
  hint.classList.add('fade');
  setTimeout(() => (hint.hidden = true), prefersReducedMotion() ? 0 : 650);
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

// Overlay controls
function setOpacity(pct: number): void {
  opacityInput.value = String(pct);
  opacityVal.textContent = `${pct}%`;
  overlayEl.style.opacity = String(pct / 100);
}
opacityInput.addEventListener('input', () => setOpacity(Number(opacityInput.value)));

function setMode(next: 'photo' | 'lines'): void {
  mode = next;
  modePhotoBtn.setAttribute('aria-checked', String(next === 'photo'));
  modeLinesBtn.setAttribute('aria-checked', String(next === 'lines'));
  overlayPhoto.hidden = next !== 'photo';
  overlayLines.hidden = next !== 'lines';
}

async function switchToLines(): Promise<void> {
  if (!refImg || !refUrl || mode === 'lines') return;
  if (edgesFor !== refUrl) {
    modeLinesBtn.setAttribute('aria-busy', 'true');
    await sleepFrame(); // let the button state paint before the synchronous work
    drawEdges(refImg, overlayLines);
    edgesFor = refUrl;
    modeLinesBtn.removeAttribute('aria-busy');
  }
  setMode('lines');
  if (Number(opacityInput.value) < 85) setOpacity(85);
}

modePhotoBtn.addEventListener('click', () => setMode('photo'));
modeLinesBtn.addEventListener('click', () => void switchToLines());
// Arrow keys within the radio group.
for (const btn of [modePhotoBtn, modeLinesBtn]) {
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const target = btn === modePhotoBtn ? modeLinesBtn : modePhotoBtn;
    target.focus();
    target.click();
  });
}

mirrorBtn.addEventListener('click', () => {
  overlay.mirrored = !overlay.mirrored;
  mirrorBtn.setAttribute('aria-pressed', String(overlay.mirrored));
  overlay.render();
});

// Press-and-hold to hide the overlay.
function peek(on: boolean): void {
  overlayEl.classList.toggle('peek', on);
  peekBtn.classList.toggle('held', on);
}
peekBtn.addEventListener('pointerdown', (e) => {
  peekBtn.setPointerCapture?.(e.pointerId);
  peek(true);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  peekBtn.addEventListener(ev, () => peek(false));
}
peekBtn.addEventListener('contextmenu', (e) => e.preventDefault());
peekBtn.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    peek(true);
  }
});
peekBtn.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.key === 'Enter') peek(false);
});
peekBtn.addEventListener('blur', () => peek(false));

// Camera controls
async function refreshLenses(): Promise<void> {
  const lenses = await camera.lenses().catch(() => []);
  lensSelect.replaceChildren(
    ...lenses.map((l) => {
      const o = document.createElement('option');
      o.value = l.deviceId;
      o.textContent = l.label;
      return o;
    }),
  );
  const current = camera.deviceId;
  if (current && lenses.some((l) => l.deviceId === current)) lensSelect.value = current;
  lensWrap.hidden = lenses.length < 2;
}

lensSelect.addEventListener('change', () => void startCamera(lensSelect.value));
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (viewerOpen && camera.isLive) void refreshLenses();
});

function refreshZoom(): void {
  const caps = camera.zoomCaps();
  zoomRow.hidden = !caps;
  if (!caps) return;
  zoomInput.min = String(caps.min);
  zoomInput.max = String(caps.max);
  zoomInput.step = String(caps.step || 0.1);
  zoomInput.value = String(camera.zoom);
  zoomVal.textContent = `${camera.zoom.toFixed(1)}×`;
}

let zoomFrame = 0;
zoomInput.addEventListener('input', () => {
  const value = Number(zoomInput.value);
  zoomVal.textContent = `${value.toFixed(1)}×`;
  cancelAnimationFrame(zoomFrame);
  zoomFrame = requestAnimationFrame(() => void camera.setZoom(value).catch(() => {}));
});

// Capture & review
function setCaptured(on: boolean): void {
  captured = on;
  video.hidden = on;
  still.hidden = !on;
  liveControls.hidden = on;
  reviewControls.hidden = !on;
  lensSelect.disabled = on;
  zoomInput.disabled = on;
}

function capture(): void {
  if (captured || !camera.isLive) {
    if (!captured) toast("Camera isn't ready yet");
    return;
  }
  if (!grabFrame(video, still, camera.isFront)) {
    toast("Camera isn't ready yet");
    return;
  }
  const hadFocus = document.activeElement === shutterBtn;
  captureStamp = timestamp();
  video.pause();
  setCaptured(true);
  layoutStage();

  if (!prefersReducedMotion()) {
    flash.classList.remove('go');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('go');
  }
  if (hadFocus) savePhotoBtn.focus();

  // Encode in the background so "Save photo" can share immediately on tap.
  photoFile = null;
  const stamp = captureStamp;
  photoPromise = canvasToBlob(still, 0.95).then((blob) => {
    const file = new File([blob], `ghostframe-${stamp}.jpg`, { type: 'image/jpeg' });
    if (stamp === captureStamp) photoFile = file;
    return file;
  });
  void autoSave(stamp);
}

// Save every shot right away. iPhone can only save to Photos through the share
// sheet, so open that. Everywhere else just download the file.
async function autoSave(stamp: string): Promise<void> {
  let file: File;
  try {
    file = await photoPromise!;
  } catch {
    toast("Couldn't save the photo");
    return;
  }
  if (stamp !== captureStamp || !captured) return;
  if (isIOS) {
    reportSave(await saveFile(file), savePhoto);
  } else {
    download(file);
    reportSave('downloaded', savePhoto);
  }
}

function retake(): void {
  const hadFocus = reviewControls.contains(document.activeElement);
  setCaptured(false);
  still.width = still.height = 0;
  photoFile = null;
  photoPromise = null;
  if (camera.isLive) void video.play().catch(() => {});
  else void startCamera();
  layoutStage();
  if (hadFocus) shutterBtn.focus();
}

function reportSave(result: SaveResult, retry: () => void): void {
  if (result === 'downloaded') toast('Saved to your downloads');
  else if (result === 'needs-gesture') toast('Your image is ready', { label: 'Save', run: retry });
}

async function savePhoto(): Promise<void> {
  if (!captured) return;
  if (photoFile) {
    reportSave(await saveFile(photoFile), savePhoto);
    return;
  }
  if (!photoPromise) return;
  savePhotoBtn.setAttribute('aria-busy', 'true');
  try {
    const file = await photoPromise;
    reportSave(await saveFile(file), savePhoto);
  } catch {
    toast("Couldn't save the photo");
  } finally {
    savePhotoBtn.removeAttribute('aria-busy');
  }
}

async function saveComparison(): Promise<void> {
  if (!captured || !refImg) return;
  let file: File;
  try {
    const canvas = renderComparison({
      photo: still,
      reference: refImg,
      aspect: refAspect,
      transform: { ...overlay.t },
      mirrored: overlay.mirrored,
    });
    const blob = canvasToBlobSync(canvas, 0.92);
    canvas.width = canvas.height = 0; // release memory promptly (iOS)
    file = new File([blob], `ghostframe-compare-${captureStamp}.jpg`, { type: 'image/jpeg' });
  } catch {
    toast("Couldn't make the comparison");
    return;
  }
  const trySave = async (): Promise<void> => reportSave(await saveFile(file), () => void trySave());
  await trySave();
}

shutterBtn.addEventListener('click', capture);
retakeBtn.addEventListener('click', retake);
savePhotoBtn.addEventListener('click', () => void savePhoto());
saveCompareBtn.addEventListener('click', () => void saveComparison());

// Desktop shortcuts: Space = shutter, hold H = hide overlay.
document.addEventListener('keydown', (e) => {
  if (!viewerOpen || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const active = document.activeElement;
  const neutral = !active || active === document.body || active === stageWrap;
  if (e.code === 'Space' && neutral && !captured && camMessage.hidden) {
    e.preventDefault();
    capture();
  } else if ((e.key === 'h' || e.key === 'H') && !(active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) {
    peek(true);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'h' || e.key === 'H') peek(false);
});

// PWA
initInstall();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
