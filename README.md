# Paperglass

Turn phone photos of invoices, receipts, and payment slips into clean,
scanner-style scans. Crop, straighten, brighten, and export as images or one
PDF — entirely in the browser.

**Live app:** <https://paperglass.pages.dev>  
**Source:** <https://github.com/mnourazdev/paperglass>

## Features

- **Automatic page detection** — finds the paper edges in a photo and
  perspective-corrects the page.
- **Manual corner adjustment** — drag any of the four corners when a page is
  partially hidden or the auto-crop needs help. Auto-detect, reset, and
  rotate controls are included.
- **Shadow and lighting cleanup** — evens out desk shadows, paper colour, and
  uneven light, then applies a scanner-style tone curve.
- **Four looks** — Clean, Ink (pure black and white), Colour, and Original
  (crop only, no cleanup). Brightness, contrast, and shadow cleanup are
  adjustable, with an option to apply one look to every page.
- **Remembers your look** — new imports start with the last enhance style you
  applied, while every page keeps its own settings.
- **Exports** —
  - one PDF containing all pages in order (A4 or Letter);
  - JPEG or PNG images, delivered as a ZIP when there is more than one page;
  - a single page directly from the editor.
- **Reorder and manage pages** — drag cards, move up/down, delete with undo.
- **Autosave** — the current session is stored in IndexedDB on the device.
- **Light and dark themes** — remembered in local storage.
- **English and Arabic** — switch language from the globe button in the top
  bar. Arabic flips the whole interface to right-to-left, and the choice is
  remembered on the device.
- **Installable on Android and iPhone** — add Paperglass to the home screen and
  use it full-screen, offline, with no app store or account.
- **Responsive layout** — three columns on desktop, an overlay enhance panel
  on tablets, and a bottom page strip on smaller screens.
- **Private by design** — processing, rendering, and PDF/ZIP creation all
  happen locally. No uploads, accounts, or external services.

## Run it

Requires Node.js 18 or newer (only for the small static server).

```bash
npm start
```

Open <http://localhost:4173>.

Any static file server works too, for example:

```bash
npx serve .
```

## Deploy

The live app is hosted on **Cloudflare Pages** as the `paperglass` project, and
the source lives at <https://github.com/mnourazdev/paperglass>.

To publish the current files:

```bash
npm run deploy
```

The script stages only the public assets in `.deploy/`, then uploads them with
Wrangler. You must be logged in to the Cloudflare account first
(`npx wrangler login`). `_headers` keeps `sw.js` uncached so service-worker
updates are picked up promptly.

## Install on your phone

Paperglass is a PWA, so the same build runs as an app on Android and iPhone.
Open <https://paperglass.pages.dev> on the phone — it is already served over
HTTPS, so no setup is needed.

1. **Android (Chrome):** open <https://paperglass.pages.dev> and tap
   **Install** when the app offers it, or use the menu → **Install app** /
   **Add to Home screen**.
2. **iPhone / iPad (Safari):** open the link in Safari, tap **Share** →
   **Add to Home Screen**.
3. Launch it from the home screen. It opens full-screen and, after the first
   visit, keeps working without a connection.

Photos are still processed on the device; installing uploads nothing. On iOS,
website data can be cleared after long periods of disuse, so export important
scans. To test a local build on a phone, serve this folder over HTTPS; plain
HTTP on a LAN address will not install or allow the live camera — the file
picker still works.

## Using it

1. Drop photos onto the page, choose files, or take a photo on a device with a
   camera. Multiple files can be imported at once.
2. Check the automatic crop. Use **Adjust edges** to drag corners, **Rotate**
   if the page is sideways, and **Enhance** to change the look.
3. Add more pages as needed, then reorder them in the page list.
4. Choose **Export** and pick PDF or images. Pages are exported in the order
   shown in the page list.
5. Use the globe button in the top bar to switch between English and Arabic.
   The interface becomes right-to-left in Arabic, and the preference is saved
   for next time.

Enhance settings are saved with each page and survive closing the browser. New
photos start with the last look you applied; use **Apply look to all** when you
want every page in the session to match.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `O` | Open the photo picker |
| `E` | Open export |
| `T` | Toggle light / dark theme |
| `←` / `→` | Previous / next page (reversed in Arabic) |
| `Esc` | Close a dialog, panel, or crop mode |

## Project structure

```text
index.html          UI markup, icons, dialogs
css/styles.css      Themes, layout, components, responsive rules
js/app.js           State, import flow, crop editor, persistence, exports, UI events
js/scanner.js       Decode/rotate, edge detection, perspective warp, enhancement
js/pdf.js           Dependency-free PDF writer (embedded JPEG pages)
js/zip.js           Dependency-free ZIP writer (store-only)
js/db.js            IndexedDB session persistence
js/i18n.js          English/Arabic strings, language persistence, RTL switching
manifest.webmanifest  Installed-app metadata
sw.js               Offline app-shell cache
_headers            Cloudflare Pages headers (service-worker caching)
robots.txt          Crawler policy for the public site
icons/              App icons (SVG source and PNG sizes)
scripts/deploy.mjs  Stages public files and deploys them to Cloudflare Pages
server.js           Minimal local static server
```

## Technical notes

- Everything is dependency-free ES modules and browser APIs. No build step.
- Pages are previewed at up to 1200 px and exported at up to 2600 px on the
  longest side.
- The PDF writer embeds JPEG page images with `DCTDecode`; PDF page
  orientation follows the scan orientation and the image is centred on the
  selected paper size.
- The ZIP writer stores already-compressed images without deflate, which keeps
  export fast and avoids a compression dependency.
- The original photo blob, crop corners, rotation, and enhancement settings
  are saved so a reload restores the editable session.
- Language is stored under `paperglass.lang` and the theme under
  `paperglass.theme`. On a first visit the browser language is used, falling
  back to English. A short inline script applies the saved language and
  direction before the stylesheet loads to avoid a flash of the wrong layout.
- The last enhance style is stored under `paperglass.look` and is used as the
  starting look for new imports. Each page's own mode and slider values remain
  part of the saved IndexedDB session.
- `sw.js` precaches the app shell for offline use. Navigations are
  network-first with a cached-shell fallback; scripts and styles are
  stale-while-revalidate, so updated files are picked up on the next load. Bump
  `CACHE_VERSION` when the precache list changes.
- The service worker and install prompt only run in a secure context (HTTPS or
  localhost), which is also required for the live camera.

## Browser support

Recent versions of Chrome, Edge, Firefox, and Safari that support Canvas,
`createImageBitmap`, IndexedDB, and ES modules. HEIC/HEIF photos may need to be
converted to JPEG first, depending on the browser.
