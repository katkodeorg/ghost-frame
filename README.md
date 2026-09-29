# Ghostframe

Recreate any photo. Pick a reference image (an anime scene, an influencer's shot, an old family photo) and Ghostframe floats it as a semi‑transparent “ghost” over your live rear camera so you can line up the shot before you take it.

- **Private by design:** a static site with no backend, accounts or analytics. Images are read locally and never uploaded.
- **Installable PWA:** add it to your home screen. The app shell works offline.
- Works on iPhone Safari (primary), Android Chrome and desktop browsers.

## Features

| | |
|---|---|
| **Overlay** | Opacity slider (default 40%), **Photo** / **Lines** modes (yellow edge tracing), mirror toggle, press‑and‑hold to hide (or hold **H**) |
| **Alignment** | Drag to move, pinch to resize around your fingers, double‑tap to reset, mouse wheel / trackpad pinch to zoom. Keyboard: arrows move, `+`/`-` resize, `0` resets |
| **Camera** | Rear camera at the highest resolution the browser offers (ideal 4032×3024), letterboxed so what you see is exactly what's captured. Lens picker (Ultra Wide / Wide / Telephoto on iPhone) and zoom slider where supported |
| **Capture** | Shutter button or **Space**. The saved photo never includes the overlay |
| **Install** | An **Install** button on the start screen. Chrome/Edge (Android and desktop) shows the native install prompt. On iPhone/iPad, where no install API exists, it opens step‑by‑step *Add to Home Screen* instructions, and warns when you're in an Instagram/TikTok in‑app browser that must open Safari first. Hidden once installed |
| **Review** | Keep adjusting the overlay, then **Save photo** or **Save comparison** (reference with your exact alignment next to your shot). On phones, saving opens the share sheet, so on iPhone choose **Save Image** to put it in Photos |

## Local development

Requires Node 18+.

```bash
npm install
npm run dev          # http://localhost:5173 (camera works on localhost)
npm run build        # type-check + production build into docs/
npm run preview      # serve the production build (service worker enabled)
npm run icons        # regenerate public/icons/*.png
```

The service worker only registers in production builds, so `npm run dev` never serves stale cached files.

## Testing on a real phone over HTTPS

Browsers only allow camera access in a secure context. `localhost` counts as secure, but your laptop's LAN IP does not, so a phone needs HTTPS. Pick one of these options:

**Option A: self‑signed HTTPS on your LAN (quickest)**

```bash
npm run dev:https    # https://<your-lan-ip>:5173 (the address is printed in the terminal)
```

Open the printed `Network` URL on your phone (same Wi‑Fi). You'll get a certificate warning:
- **iPhone Safari:** tap *Show Details* → *visit this website* → *Visit Website*.
- **Android Chrome:** tap *Advanced* → *Proceed*.

**Option B: a trusted HTTPS tunnel (no warnings)**

```bash
npm run dev
# in another terminal, either:
npx cloudflared tunnel --url http://localhost:5173
# or: ngrok http 5173
```

Open the `https://…trycloudflare.com` (or ngrok) URL on your phone. Those hosts are already allowed in `vite.config.ts`.

**Option C: mkcert** (trusted local certificates) works too if you install its root CA on the phone.

## Deploying to GitHub Pages

The production build goes into **`docs/`**, which is committed to the repo, and Pages serves it straight from the branch.

1. Build and commit:
   ```bash
   npm run build
   git add -A && git commit -m "Build" && git push
   ```
2. On GitHub, go to **Settings → Pages → Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/docs** → Save
3. After a minute the site is live at `https://<owner>.github.io/<repo>/`
   (for this repo: `https://katkodeorg.github.io/ghost-frame/`). Pages serves it over HTTPS, so the camera works.

Notes:
- The build uses a relative base (`./`), so it works at any sub‑path with no configuration.
- `docs/.nojekyll` stops Jekyll from processing the output.
- Rebuild (`npm run build`) before every push that changes `src/`. `docs/` is not rebuilt automatically.
- The service worker uses network‑first for pages, so a new deploy shows up on the next online load. Asset filenames are content‑hashed.

The same `docs/` folder also deploys as‑is to Netlify or Vercel (set the publish directory to `docs`, build command `npm run build`).

## Project layout

```
index.html              App shell (setup screen + viewfinder)
src/main.ts             UI wiring, lifecycle, capture/review flow
src/camera.ts           getUserMedia, lens list + label cleanup, zoom
src/overlay.ts          Normalised overlay transform + gestures
src/edges.ts            Grayscale → blur → Sobel → 90th‑percentile edges
src/capture.ts          Frame grab, comparison rendering, JPEG encode
src/share.ts            Web Share with download fallback
src/install.ts          Install button (beforeinstallprompt / iOS instructions)
src/style.css           Styles (safe areas, landscape layout, reduced motion)
scripts/sw-template.js  Service worker; the precache list is injected at build
scripts/make-icons.mjs  Dependency‑free PNG icon generator
public/                 Manifest, icons, favicon, .nojekyll
docs/                   Production build (GitHub Pages)
```

## Known browser limitations

- **No native camera pipeline.** Web pages get a video stream, not the iPhone Camera app's processing, so there's no Night mode, Smart HDR / Deep Fusion, Photographic Styles, ProRAW, Live Photos, portrait depth, flash or tap‑to‑focus.
- **Resolution depends on the browser.** 4032×3024 is requested, but browsers often deliver less (commonly 1920×1440 or 3840×2160 on iPhone, and lower on some Android devices). Photos are saved at whatever resolution the stream provides.
- **Frame, not photo.** Capture grabs a video frame, which can be softer and noisier than a native shutter photo, especially in low light.
- **Lens switching:** iPhone Safari exposes ultra‑wide and telephoto as separate cameras. Android usually exposes only one or two rear cameras, often with generic labels (“Back 1”, “Back 2”). Desktop has no lens choice.
- **Zoom** only appears where the browser supports the `zoom` constraint (Chrome on Android, recent Safari on iOS).
- **Home‑screen app on iOS** may ask for camera permission again each launch. Switching away from the app stops the camera, and Ghostframe restarts it when you return.
- **Saving on iPhone** goes through the share sheet (*Save Image*). Very old iOS versions without file sharing fall back to a download that opens a preview.
- **HEIC references** open in Safari and in browsers with HEIC support. When picking from the iPhone Photos library, iOS converts to JPEG automatically. Other browsers may reject raw `.heic` files.
