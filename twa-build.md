# Building a Native Android APK from the Smartboard PWA

This guide covers three paths to get a signed `.apk` or `.aab` installable on Android
smartboards, tablets, and TVs:

| Path | Best for | Requires |
|---|---|---|
| [A — PWABuilder (zero code)](#path-a--pwabuilder-online-zero-code) | Quick install, no Android Studio | Deployed HTTPS URL |
| [B — Bubblewrap CLI](#path-b--bubblewrap-cli-full-control) | CI/CD, custom signing, full control | Node 18+, Java 17, Android SDK |
| [C — Manual TWA in Android Studio](#path-c--manual-twa-in-android-studio) | White-label branding, Play Store | Android Studio Hedgehog+ |

---

## Prerequisites common to all paths

### 1. Deploy the app to HTTPS

The PWA must be served from a **public HTTPS URL** before building the APK.
The service worker and Web App Manifest will not work on `http://` or `localhost`.

**Recommended free hosts:**

```bash
# Vercel (recommended — zero config for Next.js)
npx vercel --prod

# Or Railway
railway up
```

Note the deployed URL — you will need it in every path below.
Example: `https://smartboard.maples.academy`

### 2. Verify the PWA passes all install criteria

Open Chrome on Android (or Chrome DevTools Lighthouse) and confirm:

- ✅ `manifest.json` is linked and valid — check **Application → Manifest** in DevTools
- ✅ Service worker is registered — check **Application → Service Workers**
- ✅ App is served over HTTPS
- ✅ Icons include a 512×512 maskable icon
- ✅ `start_url` is reachable

```bash
# Run Lighthouse from the command line
npx lighthouse https://your-deployed-url/viewer \
  --only-categories=pwa \
  --output=json \
  --output-path=pwa-report.json
```

All PWA checks should pass before building the APK.

---

## Path A — PWABuilder Online (zero code)

The fastest path. Produces a signed APK in ~2 minutes with no local tools.

### Steps

1. Go to **[pwabuilder.com](https://www.pwabuilder.com/)**

2. Enter your deployed HTTPS URL and click **Start**.
   PWABuilder will fetch your `manifest.json` and score your PWA.

3. Click **Package for stores → Android → Generate Package**.

4. Fill in the package options:
   | Field | Value |
   |---|---|
   | Package ID | `academy.maples.smartboard` |
   | App name | `Maples Academy Smartboard` |
   | Launch URL | `https://your-url/viewer` |
   | Display mode | `standalone` |
   | Orientation | `landscape` |
   | Theme colour | `#2563eb` |
   | Background colour | `#0f172a` |

5. Click **Download Package**. You receive a zip containing:
   - `app-release-signed.apk` — install directly on any Android device
   - `app-release-bundle.aab` — for Google Play Store submission

6. **Install directly on a smartboard or tablet:**
   ```bash
   # Enable "Install unknown apps" in Android Settings → Security
   adb install app-release-signed.apk
   # or copy the APK to the device and open it via Files app
   ```

> **Note on signing:** PWABuilder generates a debug-signed APK. For Play Store
> submission you must provide your own keystore (see Path B for keystore creation).

---

## Path B — Bubblewrap CLI (full control)

Bubblewrap is Google's official tool for generating Trusted Web Activity (TWA) Android
projects from a Web App Manifest. It produces a production-grade `.aab` suitable for
the Play Store and a `.apk` for sideloading.

### 1. Install prerequisites

```bash
# Node 18 or newer
node -v   # must be ≥ 18

# Java 17 (required by Android build tools)
# Windows — download from https://adoptium.net/
# macOS
brew install openjdk@17

# Android SDK command-line tools
# Download from https://developer.android.com/studio#command-line-tools-only
# Extract to ~/Android/Sdk/cmdline-tools/latest/

# Set environment variables (add to ~/.bashrc or ~/.zshrc)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools

# Accept SDK licences
yes | sdkmanager --licenses

# Install Bubblewrap globally
npm install -g @bubblewrap/cli
```

### 2. Initialise the TWA project

```bash
mkdir smartboard-apk && cd smartboard-apk

bubblewrap init \
  --manifest https://your-deployed-url/manifest.json
```

Bubblewrap reads the manifest and asks interactive questions.
Recommended answers:

```
Domain:               your-deployed-url.example.com
Application ID:       academy.maples.smartboard
Launcher name:        Maples Smartboard
Display mode:         standalone
Orientation:          landscape
Theme colour:         #2563eb
Background colour:    #0f172a
Start URL:            /viewer
Signing key path:     ./smartboard-release.keystore
Key alias:            smartboard
```

### 3. Generate a release signing keystore (first time only)

```bash
keytool -genkey -v \
  -keystore smartboard-release.keystore \
  -alias smartboard \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -dname "CN=Maples Academy, OU=Engineering, O=Maples Academy, L=City, S=State, C=US"
```

> **Keep `smartboard-release.keystore` and its passwords safe.**
> You cannot update a Play Store app without the same keystore.
> Back it up outside the repository (never commit it to git).

### 4. Build the APK and AAB

```bash
# Build debug APK (quick, for local testing on smartboards)
bubblewrap build --skipPwaValidation

# The output is in ./app/build/outputs/apk/release/app-release-signed.apk
# and             ./app/build/outputs/bundle/release/app-release.aab
```

### 5. Install on Android device / smartboard

```bash
# Via ADB (USB cable or ADB over Wi-Fi)
adb devices                          # confirm device is listed
adb install -r app-release-signed.apk

# Or transfer the APK over the network
adb connect 192.168.1.XXX:5555       # ADB Wi-Fi (Android 11+, no USB needed)
adb install -r app-release-signed.apk
```

### 6. Verify Digital Asset Links (required for TWA — removes address bar)

Chrome will only run the app in full TWA mode (no address bar) if a
`/.well-known/assetlinks.json` file is served from your domain.

Generate the file with:
```bash
bubblewrap fingerprint list
# Copy the SHA-256 fingerprint shown
```

Create `public/.well-known/assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "academy.maples.smartboard",
    "sha256_cert_fingerprints": [
      "AA:BB:CC:DD:EE:FF:..."
    ]
  }
}]
```

Then add a Next.js redirect to serve the file with the correct MIME type.
In `next.config.mjs` the headers block already has a catch-all — the static file
in `public/` is served automatically by Next.js.

After deploying, verify with:
```bash
# Should return 200 and valid JSON
curl https://your-deployed-url/.well-known/assetlinks.json
```

---

## Path C — Manual TWA in Android Studio

Use this path when you need custom branding, a splash screen, or Play Store listing assets.

### 1. Create a new Android project

1. Open **Android Studio → New Project → No Activity**
2. Package name: `academy.maples.smartboard`
3. Min SDK: **API 23 (Android 6.0)** — covers 99%+ of classroom devices
4. Target SDK: latest stable

### 2. Add the TWA dependency

In `app/build.gradle`:
```groovy
dependencies {
    implementation "com.google.androidbrowserhelper:androidbrowserhelper:2.5.0"
}
```

### 3. Configure the TWA Activity

In `AndroidManifest.xml`:
```xml
<activity
    android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
    android:label="Maples Smartboard"
    android:exported="true"
    android:screenOrientation="landscape"
    android:theme="@style/Theme.Smartboard.Launcher">

    <meta-data
        android:name="android.support.customtabs.trusted.DEFAULT_URL"
        android:value="https://your-deployed-url/viewer" />

    <meta-data
        android:name="android.support.customtabs.trusted.STATUS_BAR_COLOR"
        android:resource="@color/colorPrimary" />

    <meta-data
        android:name="android.support.customtabs.trusted.FALLBACK_STRATEGY"
        android:value="customtabs" />

    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>

    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https"
              android:host="your-deployed-url-domain.example.com" />
    </intent-filter>
</activity>
```

In `res/values/colors.xml`:
```xml
<color name="colorPrimary">#2563eb</color>
<color name="colorBackground">#0f172a</color>
```

### 4. Build and sign the APK

```
Build → Generate Signed Bundle / APK
→ APK → Create new keystore → Fill details → Next → Release → Finish
```

The signed APK is in `app/release/app-release.apk`.

---

## Installing on Android Smartboards without Google Play

Most school-grade Android smartboards (ViewSonic, Promethean, BenQ, Hikvision) run
Android without Google Play Services or with restricted permissions. Use these methods:

### Method 1 — ADB sideload (recommended for IT teams)

```bash
# Enable Developer Options: Settings → About → tap Build Number 7 times
# Enable USB Debugging: Settings → Developer Options → USB Debugging

adb install -r smartboard.apk
```

### Method 2 — ADB over Wi-Fi (no USB cable needed, Android 11+)

```bash
# On the device: Settings → Developer Options → Wireless debugging → Pair with code
adb pair 192.168.1.XXX:XXXXX   # enter the pairing code shown on device
adb connect 192.168.1.XXX:5555
adb install -r smartboard.apk
```

### Method 3 — File Manager install

1. Copy `smartboard.apk` to a USB drive or network share
2. On the smartboard: open the built-in **Files** app
3. Navigate to the APK and tap it
4. Accept the "Install unknown apps" permission prompt
5. The app installs and appears in the launcher

### Method 4 — MDM deployment (enterprise)

For fleets of 10+ smartboards use your MDM (Mobile Device Management) solution:
- **Google Workspace for Education** — push via Google Play private channel
- **Microsoft Intune** — deploy as a line-of-business app
- **Jamf** — package the APK as a managed app

---

## Performance notes for classroom Android hardware

| Device class | Typical specs | App behaviour |
|---|---|---|
| Budget smartboard (≤2 GB RAM, ≤4 cores) | Octacore A53, 2 GB | `isLowEnd=true` — 1280px PDF, rAF-gated input |
| Mid-range tablet (4 GB RAM, 6–8 cores) | Snapdragon 680 | `isLowEnd=false` — full quality |
| High-end IFP (8 GB RAM, 8 cores) | Snapdragon 888 / Kirin 9000 | `isLowEnd=false` — 4K quality |

The app auto-detects device class via `navigator.hardwareConcurrency` and
`navigator.deviceMemory` at startup — no manual configuration needed.

---

## Troubleshooting

**"App keeps showing address bar"**
The Digital Asset Links file is missing or has the wrong SHA-256 fingerprint.
Re-run `bubblewrap fingerprint list`, update `assetlinks.json`, and redeploy.

**"App crashes on launch"**
Minimum WebView version required is **Android WebView 85+**.
Update via: `Settings → Apps → Android System WebView → Update`.
Most classroom Android devices on Android 9+ have a recent enough WebView.

**"PDF pages are blurry"**
The device's `devicePixelRatio` may be 1. The app renders at minimum 1280px on
low-end devices which should still look sharp on 1080p classroom displays.
If the display is 4K and budget mode is incorrectly triggered, check that the
device reports `navigator.hardwareConcurrency > 2` in the browser console.

**"Drawing lags heavily"**
The rAF throttle is active. Verify `navigator.hardwareConcurrency` in the console.
If the device has 4+ cores but is still slow, it may be thermal-throttling.
Ensure the smartboard is not in "Eco" power mode.

**"Service worker not updating"**
The app checks for SW updates every 30 minutes on always-on devices. To force an
update: open Chrome DevTools → Application → Service Workers → Update.
Or increment `CACHE_VERSION` in `public/sw.js` and redeploy.

---

## Android hardware configuration for EDLA / 4K smartboards

These settings apply to the Android wrapper project generated by Bubblewrap or
manually created in Android Studio (Path B / C above).

### Lock orientation to landscape

In `app/src/main/AndroidManifest.xml`, inside the `<activity>` block for
`LauncherActivity` (or your custom TWA activity):

```xml
<activity
    android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
    android:exported="true"
    android:screenOrientation="landscape"
    android:configChanges="orientation|screenSize|screenLayout|keyboardHidden"
    android:theme="@style/Theme.Smartboard.Launcher">
    <!-- ... intent-filter blocks stay the same ... -->
</activity>
```

`android:configChanges` prevents the WebView from reloading when the system
rotates or resizes — critical for always-on smartboards that switch resolutions.

### Enable hardware acceleration

Hardware acceleration is **on by default** in Android 3.0+ for the entire
application. Confirm it is present on the `<application>` tag and has NOT been
disabled on the activity:

```xml
<application
    android:hardwareAccelerated="true"
    android:largeHeap="true"
    ...>

    <activity
        android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
        android:hardwareAccelerated="true"
        android:screenOrientation="landscape"
        ...>
    </activity>
</application>
```

`android:largeHeap="true"` gives the WebView extra heap — useful when rendering
4K PDF pages or large annotation SVGs on EDLA devices.

### Disable font scaling in the WebView host

The app-level CSS (`globals.css`) already sets `-webkit-text-size-adjust: none`
and `text-size-adjust: none`, which prevents Android's system font-scale setting
from distorting the layout inside the WebView. No Java/Kotlin code change is
needed for TWA because Chrome's WebView honours these CSS properties.

If you are building a custom WebView host (not a TWA), apply this in your
`WebViewClient` subclass:

```kotlin
webView.settings.textZoom = 100   // override system font scale — always 100%
```

### Recommended AndroidManifest.xml meta-data for EDLA devices

```xml
<!-- Tell the launcher this is a full-screen immersive experience -->
<meta-data
    android:name="android.support.customtabs.trusted.DISPLAY_MODE"
    android:value="immersive" />

<!-- Declare the app is optimised for large screens (Google Play filtering) -->
<meta-data
    android:name="android.max_aspect"
    android:value="2.4" />
```

Add `<uses-feature android:name="android.hardware.touchscreen.multitouch"
android:required="false" />` to allow the app to run on non-touch EDLA displays
that use a stylus controller instead of a capacitive touch panel.

```xml
<uses-feature android:name="android.hardware.touchscreen" android:required="false" />
<uses-feature android:name="android.hardware.touchscreen.multitouch" android:required="false" />
<!-- Declare that cellular, camera, GPS, and biometrics are NOT required -->
<uses-feature android:name="android.hardware.telephony" android:required="false" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
<uses-feature android:name="android.hardware.location.gps" android:required="false" />
<uses-feature android:name="android.hardware.sensor.fingerprint" android:required="false" />
<uses-feature android:name="android.hardware.sensor.accelerometer" android:required="false" />
<uses-feature android:name="android.hardware.sensor.gyroscope" android:required="false" />
```

These `android:required="false"` declarations ensure the APK can be installed on
EDLA-certified smartboards that ship without cellular radios, cameras, GPS chips,
or biometric sensors.
