# PSX Terminal — Android (Capacitor)

The same React app runs on Android via **Capacitor**. The entire UI and analysis
engine are reused unchanged; only the data/persistence/notification bridge is
swapped for a mobile one.

## How it works

- **`src/platform/psxCore.js`** — platform-agnostic PSX fetch+parse (token +
  cheerio parsing), with the network call injected. Mirrors `electron/psxService.js`.
- **`src/platform/capacitorPsx.js`** — mobile bridge: network via **CapacitorHttp**
  (native layer → **bypasses CORS**, the reason a plain WebView can't work),
  persistence via **Preferences**, alerts via **LocalNotifications**. Exposes the
  exact `window.psx.*` API the Electron preload does.
- **`src/platform/installBridge.js`** — imported first in `main.jsx`; if
  `window.psx` is absent (i.e. not Electron) it installs `capacitorPsx`. So
  `MarketContext` and every component run identically on both platforms.
- **`capacitor.config.json`** — appId `com.psxterminal.app`, webDir `dist`.
- **`android/`** — the native Android Studio project (committed).

Permissions in `android/app/src/main/AndroidManifest.xml`: INTERNET,
POST_NOTIFICATIONS (Android 13+), VIBRATE.

Mobile UI: the sidebar becomes a slide-in **drawer** (☰ hamburger) and all
multi-column grids collapse to one column under the `@media (max-width: 768px)`
block in `src/index.css`.

## Build the APK

After any web change, resync first: `npm run mobile:sync` (builds `dist/` and
copies it into `android/`).

### Path A — Android Studio (local, one-time setup)
1. Install **Android Studio** (free) — includes the Android SDK + JDK.
2. `npm run mobile:open` (runs `cap open android`) → opens the project.
3. In Android Studio: **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)**.
4. APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Share it.
   (Or from a terminal with the SDK installed: `npm run mobile:apk`.)

### Path B — Cloud build (no local install)
`.github/workflows/android.yml` builds the APK on GitHub's servers.
1. Push this repo to GitHub (`git init`, commit, push). The `android/` folder
   must be committed (it is, except build outputs — see `.gitignore`).
2. GitHub → **Actions** tab → **Build Android APK** → **Run workflow**.
3. When it finishes, download **PSX-Terminal-APK** from the run's **Artifacts**.

## Known limits (honest)

- **Debug APK** is fine to share/install (enable "Install unknown apps" on the
  phone). A Play-Store release would need a signed release build + a keystore.
- **Background alerts**: live radar + holding alerts fire reliably while the app
  is **open**. Android kills background JS, so when the app is closed/backgrounded
  there is no real-time polling. True always-on alerts need a small push server
  (poll PSX server-side → FCM push) — a separate, larger phase.
- The data layer depends on the same PSX `X-Req-Id` token (see CLAUDE.md §3).
