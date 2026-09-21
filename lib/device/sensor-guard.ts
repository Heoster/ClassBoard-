/**
 * lib/device/sensor-guard.ts
 *
 * Safely stubs out mobile-hardware APIs that are absent on EDLA smartboards.
 *
 * Problem
 * ───────
 * EDLA-certified interactive flat panels ship without cellular radios, GPS
 * chips, device cameras, or biometric sensors. Any code that calls these APIs
 * unconditionally will throw, hang, or show permission prompts that can never
 * be satisfied — breaking initialisation on smartboards.
 *
 * Solution
 * ────────
 * `guardedSensor()` wraps every sensor call with:
 *   1. A typeof / "in navigator" existence check (no API → immediate stub)
 *   2. A try/catch around the actual call (API present but device lacks HW)
 *   3. A configurable timeout so hung permission dialogs don't block the UI
 *
 * Usage
 * ─────
 *   import {
 *     getGeolocation,
 *     getCameraStream,
 *     getBiometricCredential,
 *     getNetworkType,
 *     getDeviceProfile,
 *   } from "@/lib/device/sensor-guard";
 *
 *   // Each function returns null / a safe default instead of throwing when
 *   // the hardware is absent — no try/catch needed at call-site.
 *   const position    = await getGeolocation();      // null on EDLA boards
 *   const stream      = await getCameraStream();     // null on EDLA boards
 *   const networkInfo = getNetworkType();            // "unknown" on EDLA
 *   const profile     = getDeviceProfile();          // full object, always safe
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceProfile {
  /** true on a device with ≥ 4 logical cores and ≥ 4 GB RAM */
  isHighEnd:          boolean;
  /** true on a device with ≤ 2 logical cores or < 2 GB RAM */
  isLowEnd:           boolean;
  /** Logical CPU count, or null if unavailable */
  cpuCores:           number | null;
  /** Reported device memory in GB (Chrome/Android only), or null */
  memoryGb:           number | null;
  /** Device pixel ratio */
  dpr:                number;
  /** Viewport width × height at the time of the call */
  viewportWidth:      number;
  viewportHeight:     number;
  /** true when viewport ≥ 1920 px wide (large-screen / 4K territory) */
  isLargeScreen:      boolean;
  /** true when dpr ≥ 2 (Retina / 4K native resolution) */
  isHighDpr:          boolean;
  /** Connection type string ("4g" | "3g" | "2g" | "slow-2g" | "wifi" | "unknown") */
  connectionType:     string;
  /** Effective connection type from NetworkInformation API, or "unknown" */
  effectiveType:      string;
  /** true when navigator.onLine */
  isOnline:           boolean;
  /** true if the device reports no pointer hardware (stylus-only boards) */
  hasPointer:         boolean;
  /** true if a coarse touch pointer is available (finger touch panel) */
  hasTouch:           boolean;
  /** true if a fine pointer is available (mouse or stylus) */
  hasFinePointer:     boolean;
  /** Whether GPS / geolocation API is present at all */
  hasGeolocation:     boolean;
  /** Whether MediaDevices camera API is present at all */
  hasCamera:          boolean;
  /** Whether Web Authentication (biometrics) API is present at all */
  hasBiometrics:      boolean;
}

export interface GeolocationResult {
  latitude:  number;
  longitude: number;
  accuracy:  number;
  timestamp: number;
}

// ─── Core guard wrapper ───────────────────────────────────────────────────────

/**
 * Runs `fn` and returns its result, or `fallback` if:
 *   • the API doesn't exist
 *   • the call throws / rejects
 *   • the call doesn't resolve within `timeoutMs`
 *
 * All sensor helpers below use this internally.
 */
export async function guardedSensor<T>(
  fn: () => Promise<T> | T,
  fallback: T,
  timeoutMs = 5_000,
): Promise<T> {
  try {
    const result = await Promise.race([
      Promise.resolve().then(fn),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("sensor-guard: timeout")), timeoutMs),
      ),
    ]);
    return result;
  } catch {
    return fallback;
  }
}

// ─── Geolocation ─────────────────────────────────────────────────────────────

/**
 * Request the device's GPS position.
 * Returns null on EDLA smartboards (no GPS chip), in iframe contexts where
 * the Permissions Policy blocks geolocation, or when the user denies.
 */
export async function getGeolocation(
  options: PositionOptions = { timeout: 4_000, maximumAge: 60_000 },
): Promise<GeolocationResult | null> {
  if (typeof navigator === "undefined") return null;
  if (!("geolocation" in navigator))    return null;

  return guardedSensor(
    () =>
      new Promise<GeolocationResult>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude:  pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy:  pos.coords.accuracy,
              timestamp: pos.timestamp,
            }),
          reject,
          options,
        );
      }),
    null,
    (options.timeout ?? 4_000) + 500,
  );
}

// ─── Camera ───────────────────────────────────────────────────────────────────

/**
 * Request a camera MediaStream.
 * Returns null on EDLA boards without a camera, or when the Permissions Policy
 * blocks the camera (e.g. inside a TWA with restrictive permissions).
 *
 * Always release the stream when done:
 *   stream?.getTracks().forEach(t => t.stop());
 */
export async function getCameraStream(
  constraints: MediaStreamConstraints = { video: true, audio: false },
): Promise<MediaStream | null> {
  if (typeof navigator === "undefined")              return null;
  if (!("mediaDevices" in navigator))                return null;
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return null;

  return guardedSensor(
    () => navigator.mediaDevices.getUserMedia(constraints),
    null,
  );
}

/**
 * Enumerate available media devices without requesting a stream.
 * Returns [] on EDLA boards without a camera — safe to call unconditionally.
 */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined")              return [];
  if (!("mediaDevices" in navigator))                return [];
  if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return [];

  return guardedSensor(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }, []);
}

// ─── Biometrics (Web Authentication) ─────────────────────────────────────────

/**
 * Check whether platform biometric authentication (fingerprint / face) is
 * available. Returns false on EDLA boards without biometric sensors.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined")    return false;
  if (!("PublicKeyCredential" in window)) return false;

  return guardedSensor(
    () => (PublicKeyCredential as typeof PublicKeyCredential & {
      isUserVerifyingPlatformAuthenticatorAvailable?(): Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable?.() ?? Promise.resolve(false),
    false,
  );
}

/**
 * Attempt a WebAuthn credential assertion (biometric sign-in).
 * Returns null if biometrics are unavailable rather than throwing.
 */
export async function getBiometricCredential(
  options: CredentialRequestOptions,
): Promise<Credential | null> {
  if (typeof navigator === "undefined")  return null;
  if (!("credentials" in navigator))     return null;
  if (!(await isBiometricAvailable()))   return null;

  return guardedSensor(
    () => navigator.credentials.get(options),
    null,
  );
}

// ─── Network information ──────────────────────────────────────────────────────

// Extend the NetworkInformation type with the non-standard fields Chrome exposes
interface NetworkInformation extends EventTarget {
  type?:           string;
  effectiveType?:  string;
  downlink?:       number;
  rtt?:            number;
  saveData?:       boolean;
}

/**
 * Return the current connection type string.
 * Falls back to "unknown" on browsers / devices without the NetworkInformation API
 * (Firefox, iOS Safari, EDLA boards running a stripped Android build).
 *
 * This is the synchronous web equivalent of React Native's NetInfo.fetch().
 */
export function getNetworkType(): string {
  if (typeof navigator === "undefined") return "unknown";
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!conn) return "unknown";
  return conn.effectiveType ?? conn.type ?? "unknown";
}

/**
 * Returns true when the device self-reports as data-saver mode.
 * Useful for skipping high-resolution PDF renders on metered connections.
 */
export function isSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return conn?.saveData === true;
}

// ─── Comprehensive device profile ────────────────────────────────────────────

/**
 * Return a full profile of the current device's capabilities.
 * Safe to call on SSR (returns a conservative default) and on any Android
 * device regardless of which sensors are present.
 *
 * This is the single call that viewer-client.tsx should use instead of
 * individual `navigator.hardwareConcurrency` / `navigator.deviceMemory` reads.
 */
export function getDeviceProfile(): DeviceProfile {
  // SSR / non-browser guard
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      isHighEnd: false, isLowEnd: false,
      cpuCores: null, memoryGb: null,
      dpr: 1, viewportWidth: 1920, viewportHeight: 1080,
      isLargeScreen: true, isHighDpr: false,
      connectionType: "unknown", effectiveType: "unknown",
      isOnline: true,
      hasPointer: true, hasTouch: false, hasFinePointer: true,
      hasGeolocation: false, hasCamera: false, hasBiometrics: false,
    };
  }

  const cpuCores = navigator.hardwareConcurrency ?? null;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const conn     = (navigator as Navigator & { connection?: NetworkInformation }).connection;

  const isLowEnd  = (cpuCores !== null && cpuCores <= 2) || (memoryGb !== null && memoryGb < 2);
  const isHighEnd = (cpuCores !== null && cpuCores >= 4) && (memoryGb === null || memoryGb >= 4);

  const dpr           = window.devicePixelRatio ?? 1;
  const viewportWidth  = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return {
    isHighEnd,
    isLowEnd,
    cpuCores,
    memoryGb,
    dpr,
    viewportWidth,
    viewportHeight,
    isLargeScreen:  viewportWidth  >= 1920,
    isHighDpr:      dpr            >= 2,
    connectionType: conn?.type          ?? "unknown",
    effectiveType:  conn?.effectiveType ?? "unknown",
    isOnline:       navigator.onLine,
    // Pointer capability detection — critical for stylus-only EDLA boards
    hasPointer:      window.matchMedia("(any-pointer: coarse), (any-pointer: fine)").matches,
    hasTouch:        window.matchMedia("(any-pointer: coarse)").matches,
    hasFinePointer:  window.matchMedia("(any-pointer: fine)").matches,
    // Sensor presence flags (no hardware access — just API detection)
    hasGeolocation:  "geolocation" in navigator,
    hasCamera:       "mediaDevices" in navigator &&
                     typeof (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia === "function",
    hasBiometrics:   "PublicKeyCredential" in window,
  };
}

// ─── Convenience: run sensor init only when hardware is present ───────────────

/**
 * Conditionally run `init` only when the hardware check passes.
 * Use this to wrap any third-party SDK that assumes sensor presence.
 *
 * @example
 * await whenAvailable(
 *   () => getDeviceProfile().hasCamera,
 *   () => initQrScanner(),
 * );
 */
export async function whenAvailable(
  check: () => boolean,
  init: () => Promise<void> | void,
): Promise<void> {
  try {
    if (check()) await init();
  } catch {
    // non-fatal — hardware unavailable
  }
}
