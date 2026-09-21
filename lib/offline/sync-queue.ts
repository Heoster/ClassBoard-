/**
 * lib/offline/sync-queue.ts
 *
 * Offline-first cloud-sync manager.
 *
 * Key design decisions
 * ────────────────────
 * 1. LOCAL FIRST — every write hits IndexedDB synchronously (from the caller's
 *    perspective) before any cloud attempt.  The app works 100% offline.
 *
 * 2. DEBOUNCED FLUSH — after a write is enqueued, we wait DEBOUNCE_MS (1 500 ms)
 *    before pushing to the cloud.  Rapid strokes / transforms collapse into a
 *    single network round-trip instead of one per pointer-up event.
 *
 * 3. SAFE UPSERT — the cloud writer does per-annotation upsert, never a
 *    delete-then-reinsert.  No data loss if the network drops between the two ops.
 *
 * 4. CLOUD AVAILABILITY TRACKING — if Supabase is unreachable (missing env vars,
 *    network error, or auth error) `_cloudAvailable` flips to false and the UI
 *    shows a warning banner.  It recovers automatically on the next successful write.
 *
 * 5. DEDUPLICATION — before enqueuing an upsert we remove any earlier pending
 *    upsert for the same annotation ID so the queue never grows unboundedly for
 *    a single frequently-updated annotation.
 */

import {
  enqueue,
  getPendingItems,
  updateQueueItem,
  dequeue,
  pruneQueue,
  type SyncQueueItem,
} from "./local-db";
import type { Annotation } from "../../types/annotation";
import type { LocalPage } from "./local-db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CloudOperation = SyncQueueItem["operation"];

/** Supplied by the caller. Must throw on failure so the queue can retry. */
export type CloudWriter = (item: SyncQueueItem) => Promise<void>;

export interface SyncManagerOptions {
  cloudWriter: CloudWriter;
  /** Max retry attempts before an item is marked "failed". Default: 5 */
  maxAttempts?: number;
  /**
   * Milliseconds to wait after the last `scheduleSync` call before pushing to
   * the cloud.  Collapses rapid annotation commits into one network round-trip.
   * Default: 1 500 ms
   */
  debounceMs?: number;
  /** Periodic poll interval so stale pending items are retried.  Default: 30 000 ms */
  pollIntervalMs?: number;
  /** Notified whenever the pending-item count changes. */
  onPendingCountChange?: (count: number) => void;
  /** Notified on network online/offline transitions. */
  onNetworkChange?: (online: boolean) => void;
  /**
   * Notified when cloud reachability changes.
   * false = Supabase unreachable / not configured — show warning banner.
   * true  = last write succeeded.
   */
  onCloudStatusChange?: (available: boolean) => void;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const MAX_ATTEMPTS_DEFAULT  = 5;
const DEBOUNCE_MS_DEFAULT   = 1_500;
const POLL_INTERVAL_DEFAULT = 30_000;
const BACKOFF_BASE_MS       = 1_000;

let _writer:               CloudWriter | null   = null;
let _maxAttempts:          number               = MAX_ATTEMPTS_DEFAULT;
let _debounceMs:           number               = DEBOUNCE_MS_DEFAULT;
let _pollTimer:            ReturnType<typeof setInterval>  | null = null;
let _debounceTimer:        ReturnType<typeof setTimeout>   | null = null;
let _onCountChange:        ((n: number)      => void) | null = null;
let _onNetworkChange:      ((online: boolean) => void) | null = null;
let _onCloudStatusChange:  ((ok: boolean)    => void) | null = null;
let _flushing              = false;
let _initialised           = false;
let _cloudAvailable        = true;  // optimistic default; set false on first failure

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Boot the sync manager.  Idempotent — safe to call on every mount.
 * Must be called from a browser context (guarded against SSR).
 */
export function initSyncManager(options: SyncManagerOptions): void {
  if (typeof window === "undefined") return;
  if (_initialised) {
    // Update callbacks in case the component re-mounted with new functions
    _onCountChange       = options.onPendingCountChange ?? null;
    _onNetworkChange     = options.onNetworkChange      ?? null;
    _onCloudStatusChange = options.onCloudStatusChange  ?? null;
    _writer              = options.cloudWriter;
    return;
  }

  _writer              = options.cloudWriter;
  _maxAttempts         = options.maxAttempts   ?? MAX_ATTEMPTS_DEFAULT;
  _debounceMs          = options.debounceMs    ?? DEBOUNCE_MS_DEFAULT;
  _onCountChange       = options.onPendingCountChange ?? null;
  _onNetworkChange     = options.onNetworkChange      ?? null;
  _onCloudStatusChange = options.onCloudStatusChange  ?? null;

  window.addEventListener("online",  handleOnline,  { passive: true });
  window.addEventListener("offline", handleOffline, { passive: true });

  const interval = options.pollIntervalMs ?? POLL_INTERVAL_DEFAULT;
  _pollTimer = setInterval(() => {
    if (navigator.onLine) scheduleFlush();
  }, interval);

  registerBackgroundSync();
  pruneQueue().catch(() => null);

  // Probe cloud availability on init
  if (navigator.onLine) scheduleFlush();

  _initialised = true;
}

/** Tear down listeners and timers. */
export function destroySyncManager(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("online",  handleOnline);
  window.removeEventListener("offline", handleOffline);
  if (_pollTimer    !== null) clearInterval(_pollTimer);
  if (_debounceTimer !== null) clearTimeout(_debounceTimer);
  _pollTimer     = null;
  _debounceTimer = null;
  _initialised   = false;
  _flushing      = false;
}

/**
 * Enqueue a local write and arm the debounce timer.
 * The item is in IndexedDB before this promise resolves — safe to return to the UI.
 *
 * For upsert-annotation operations we deduplicate: any earlier pending upsert
 * for the same annotation id is removed so the queue only carries the latest state.
 */
export async function scheduleSync(
  documentId: string,
  operation:  CloudOperation,
  payload:    Annotation | LocalPage | { id: string },
): Promise<void> {
  // Deduplicate: for upserts, drop any earlier pending entry for this annotation
  if (operation === "upsert-annotation" && "id" in payload) {
    await deduplicatePending(documentId, operation, (payload as { id: string }).id);
  }

  await enqueue({
    documentId,
    operation,
    payload,
    status:    "pending",
    attempts:  0,
    createdAt: new Date().toISOString(),
  });

  void notifyCount();

  // Arm debounce — reset the timer on every new write so bursts collapse
  if (navigator.onLine) {
    armDebounce();
  }
}

/**
 * Immediately flush all pending items.
 * Call this on "Retry" buttons or when the app becomes visible after a long idle.
 */
export async function flushQueue(): Promise<void> {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  return doFlush();
}

/** Current cloud reachability status. */
export function isCloudAvailable(): boolean {
  return _cloudAvailable;
}

/** Current network status. */
export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

// ─── Internal: debounce ───────────────────────────────────────────────────────

function armDebounce(): void {
  if (_debounceTimer !== null) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    void doFlush();
  }, _debounceMs);
}

function scheduleFlush(): void {
  // If a debounce is already armed let it fire naturally; otherwise flush now
  if (_debounceTimer === null) void doFlush();
}

// ─── Internal: flush loop ─────────────────────────────────────────────────────

async function doFlush(): Promise<void> {
  if (!_writer)         return;
  if (_flushing)        return;
  if (!navigator.onLine) return;

  _flushing = true;

  try {
    const pending = await getPendingItems();
    if (pending.length === 0) return;

    for (const item of pending) {
      if (!navigator.onLine) break;

      const queueId = item.queueId!;

      await updateQueueItem(queueId, {
        status:        "syncing",
        lastAttemptAt: new Date().toISOString(),
      });

      try {
        await _writer(item);
        await dequeue(queueId);
        // Mark cloud as available after a successful write
        setCloudAvailable(true);
      } catch (err) {
        const attempts = item.attempts + 1;
        const isConfigError = err instanceof Error &&
          (err.message.includes("not configured") || err.message.includes("auth"));
        const isFinal = attempts >= _maxAttempts || isConfigError;

        if (isFinal) {
          await updateQueueItem(queueId, {
            status:   "failed",
            attempts,
            lastAttemptAt: new Date().toISOString(),
          });
          // Supabase not configured or permanently unreachable
          setCloudAvailable(false);
        } else {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
          await updateQueueItem(queueId, {
            status:   "pending",
            attempts,
            lastAttemptAt: new Date().toISOString(),
          });
          setTimeout(() => { if (navigator.onLine) void doFlush(); }, backoffMs);
          // Transient network error — cloud may still be available; don't flip flag yet
        }
      }
    }
  } finally {
    _flushing = false;
    void notifyCount();
  }
}

// ─── Internal: deduplication ─────────────────────────────────────────────────

/**
 * Remove all earlier "pending" queue entries that are upserts for the same
 * annotation id. Keeps only the freshest state in the queue.
 */
async function deduplicatePending(
  documentId: string,
  operation:  CloudOperation,
  annotationId: string,
): Promise<void> {
  try {
    const pending = await getPendingItems();
    for (const item of pending) {
      if (
        item.documentId === documentId &&
        item.operation  === operation  &&
        item.queueId    !== undefined  &&
        "id" in item.payload           &&
        (item.payload as { id: string }).id === annotationId
      ) {
        await dequeue(item.queueId);
      }
    }
  } catch {
    // Non-fatal — a duplicate entry just wastes one extra round-trip
  }
}

// ─── Internal: cloud availability ────────────────────────────────────────────

function setCloudAvailable(available: boolean): void {
  if (_cloudAvailable === available) return;
  _cloudAvailable = available;
  _onCloudStatusChange?.(available);
}

// ─── Internal: network events ────────────────────────────────────────────────

function handleOnline(): void {
  _onNetworkChange?.(true);
  // Small delay lets the network stack fully establish before hitting Supabase
  setTimeout(() => void doFlush(), 800);
}

function handleOffline(): void {
  _onNetworkChange?.(false);
}

// ─── Internal: helpers ────────────────────────────────────────────────────────

async function notifyCount(): Promise<void> {
  if (!_onCountChange) return;
  try {
    const { pendingCount } = await import("./local-db");
    _onCountChange(await pendingCount());
  } catch { /* non-critical */ }
}

function registerBackgroundSync(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      const s = (reg as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      }).sync;
      return s?.register("sync-annotations");
    })
    .catch(() => null);
}
