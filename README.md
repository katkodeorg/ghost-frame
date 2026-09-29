# Ghostframe

A small web app for recreating photos. You pick a reference image and it shows up as a see-through layer over your camera, so you can line up your shot before taking it.

Live at https://katkodeorg.github.io/ghost-frame/

It's a static site. Images are read on the device and aren't sent anywhere.

## Features

- Opacity slider for the overlay, plus a Lines mode that traces the reference in yellow
- Drag to move, pinch to resize, double-tap to reset. On desktop, scroll to zoom
- Mirror the reference, or hold the eye button (or H) to hide it for a moment
- Lens picker (Ultra Wide, Wide, Telephoto on iPhone) and a zoom slider where the browser supports it
- Shutter button or Space. The photo doesn't include the overlay
- Photos save as soon as you take them. On Android and desktop they download. On iPhone the share sheet opens, tap Save Image to put it in Photos
- After taking a shot you can still move the overlay and save a side by side comparison
- Install button on the start screen to add it to your Home Screen. Works offline once installed

## Development

Needs Node 18 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # builds into docs/
npm run preview    # serves the build, with the service worker
npm run icons      # regenerates the icons in public/icons
```

The service worker only runs in the production build, so dev never serves stale files.

### Testing on a phone

Browsers only allow the camera over HTTPS (localhost is the exception), so to test on a phone you need an HTTPS URL. Two ways to get one:

1. `npm run dev:https`, then open the Network URL it prints on your phone (same Wi-Fi). The certificate is self-signed so you'll see a warning. On iPhone tap Show Details, then visit this website. On Android tap Advanced, then Proceed.
2. Run `npm run dev`, then in another terminal `npx cloudflared tunnel --url http://localhost:5173` (or `ngrok http 5173`) and open the https URL it gives you. No certificate warning this way.

## Deploying

The build goes into `docs/`, which is committed, and GitHub Pages serves it from there.

```bash
npm run build
git add -A
git commit -m "Build"
git push
```

Pages is set to deploy from the `main` branch, `/docs` folder (Settings > Pages). The site updates about a minute after a push. Remember to run the build before pushing, since `docs/` isn't rebuilt automatically.

The build uses relative paths, so it works under any subfolder. `docs/` can also be deployed to Netlify or Vercel as is.

## Code

```
index.html              markup for the setup screen and viewfinder
src/main.ts             UI and app flow
src/camera.ts           camera stream, lens list, zoom
src/overlay.ts          overlay position and gestures
src/edges.ts            edge detection for Lines mode
src/capture.ts          capture and the comparison image
src/share.ts            share sheet, with download fallback
src/install.ts          install button
src/style.css           styles
scripts/sw-template.js  service worker template
scripts/make-icons.mjs  icon generator
public/                 manifest, icons, favicon
docs/                   build output served by GitHub Pages
```

## Limitations

These come from what browsers allow, not from the app.

- The web only gets a video stream, not the iPhone camera's processing. No Night mode, Smart HDR, ProRAW, Live Photos, portrait mode, flash or tap to focus.
- Resolution is whatever the browser gives. The app asks for 4032x3024 but iPhones usually give 1920x1440 or so, and some Android phones give less.
- A capture is a frame from the video, so it can look softer than a normal photo, especially in low light.
- Android usually only lists one or two back cameras, with names like "Back 1". Desktop has no lens choice.
- Zoom only shows up where the browser supports it (Chrome on Android, recent Safari).
- When installed on an iPhone, it may ask for camera permission again each time you open it.
- HEIC files only open in browsers that support them. Picking from the iPhone Photos library converts to JPEG automatically, so that usually isn't a problem.
