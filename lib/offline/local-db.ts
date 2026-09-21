/**
 * lib/offline/local-db.ts
 *
 * Zero-dependency IndexedDB wrapper for offline-first annotation storage.
 *
 * Why IndexedDB over localStorage?
 *   • localStorage is synchronous — blocks the main thread on large payloads.
 *   • IndexedDB is async, supports transactions, and stores structured objects
 *     without serialisation overhead (no JSON.stringify on every keystroke).
 *   • Quota: typically 60 %+ of available disk on Android Chrome vs ~5 MB for
 *     localStorage — critical for classrooms with large multi-page PDFs.
 *
 * Schema
 *   DB name : "maples-smartboard"
 *   Version : 1
 *
 *   Object store: "annotations"
 *     keyPath   : "id"          (Annotation.id — unique per annotation)
 *     indexes   : documentId    (for fast per-document queries)
 *                 updatedAt     (for sync watermark queries)
 *
 *   Object store: "pages"
 *     keyPath   : "id"          ("<documentId>:<pageIndex>")
 *     indexes   : documentId
 *
 *   Object store: "sync-queue"
 *     keyPath   : "queueId"     (auto-increment)
 *     indexes   : documentId, status
 *
 * All public functions are async and safe to call before the DB is open —
 * they await `getDb()` internally and queue up naturally via the Promise chain.
 */

import type { Annotation } from "../../types/annotation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocalPage {
  /** "<documentId>:<pageIndex>" */
  id: string;
  documentId: string;
  pageIndex: number;
  background: string;
  aspectRatio?: "16:9" | "4:3" | "portrait";
  updatedAt: string;
}

export type SyncStatus = "pending" | "syncing" | "synced" | "failed";

export interface SyncQueueItem {
  /** Auto-incremented by IndexedDB */
  queueId?: number;
  documentId: string;
  operation: "upsert-annotation" | "delete-annotation" | "upsert-page" | "delete-page";
  payload: Annotation | LocalPage | { id: string };
  status: SyncStatus;
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
}

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

const DB_NAME    = "maples-smartboard";
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

function getDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // ── annotations store ──────────────────────────────────────────────────
      if (!db.objectStoreNames.contains("annotations")) {
        const ann = db.createObjectStore("annotations", { keyPath: "id" });
        ann.createIndex("documentId", "documentId", { unique: false });
        ann.createIndex("updatedAt",  "updatedAt",  { unique: false });
      }

      // ── pages store ────────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains("pages")) {
        const pages = db.createObjectStore("pages", { keyPath: "id" });
        pages.createIndex("documentId", "documentId", { unique: false });
      }

      // ── sync-queue store ───────────────────────────────────────────────────
      if (!db.objectStoreNames.contains("sync-queue")) {
        const q = db.createObjectStore("sync-queue", {
          keyPath: "queueId",
          autoIncrement: true,
        });
        q.createIndex("documentId", "documentId", { unique: false });
        q.createIndex("status",     "status",     { unique: false });
      }
    };

    request.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;

      // Gracefully handle version change from another tab
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };

      resolve(_db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by an open tab."));
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function txStore(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

function wrapTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error("Transaction aborted"));
  });
}

// ─── Annotations ─────────────────────────────────────────────────────────────

/** Persist a single annotation (insert or update). */
export async function putAnnotation(annotation: Annotation): Promise<void> {
  const db    = await getDb();
  const store = txStore(db, "annotations", "readwrite");
  await wrap(store.put(annotation));
}

/** Persist multiple annotations atomically in a single transaction. */
export async function putAnnotations(annotations: Annotation[]): Promise<void> {
  if (annotations.length === 0) return;
  const db  = await getDb();
  const tx  = db.transaction("annotations", "readwrite");
  const store = tx.objectStore("annotations");
  for (const ann of annotations) store.put(ann);
  await wrapTx(tx);
}

/** Return all annotations for a document, ordered by updatedAt ascending. */
export async function getAnnotationsByDocument(documentId: string): Promise<Annotation[]> {
  const db    = await getDb();
  const store = txStore(db, "annotations", "readonly");
  const index = store.index("documentId");
  const all   = await wrap<Annotation[]>(index.getAll(documentId) as IDBRequest<Annotation[]>);
  return all.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** Delete a single annotation by id. */
export async function deleteAnnotation(id: string): Promise<void> {
  const db    = await getDb();
  const store = txStore(db, "annotations", "readwrite");
  await wrap(store.delete(id));
}

/** Delete all annotations belonging to a document. */
export async function deleteAnnotationsByDocument(documentId: string): Promise<void> {
  const db    = await getDb();
  const tx    = db.transaction("annotations", "readwrite");
  const index = tx.objectStore("annotations").index("documentId");
  const keys  = await wrap<IDBValidKey[]>(index.getAllKeys(documentId) as IDBRequest<IDBValidKey[]>);
  for (const key of keys) tx.objectStore("annotations").delete(key);
  await wrapTx(tx);
}

// ─── Pages ────────────────────────────────────────────────────────────────────

/** Persist a page record. */
export async function putPage(page: LocalPage): Promise<void> {
  const db    = await getDb();
  const store = txStore(db, "pages", "readwrite");
  await wrap(store.put(page));
}

/** Return all pages for a document. */
export async function getPagesByDocument(documentId: string): Promise<LocalPage[]> {
  const db    = await getDb();
  const store = txStore(db, "pages", "readonly");
  const index = store.index("documentId");
  return wrap<LocalPage[]>(index.getAll(documentId) as IDBRequest<LocalPage[]>);
}

/** Delete all pages belonging to a document. */
export async function deletePagesByDocument(documentId: string): Promise<void> {
  const db    = await getDb();
  const tx    = db.transaction("pages", "readwrite");
  const index = tx.objectStore("pages").index("documentId");
  const keys  = await wrap<IDBValidKey[]>(index.getAllKeys(documentId) as IDBRequest<IDBValidKey[]>);
  for (const key of keys) tx.objectStore("pages").delete(key);
  await wrapTx(tx);
}

// ─── Sync queue ───────────────────────────────────────────────────────────────

/** Enqueue a pending cloud-sync operation. */
export async function enqueue(item: Omit<SyncQueueItem, "queueId">): Promise<number> {
  const db    = await getDb();
  const store = txStore(db, "sync-queue", "readwrite");
  return wrap<number>(store.add(item) as IDBRequest<number>);
}

/** Return all items with status "pending" (oldest first). */
export async function getPendingItems(): Promise<SyncQueueItem[]> {
  const db    = await getDb();
  const store = txStore(db, "sync-queue", "readonly");
  const index = store.index("status");
  return wrap<SyncQueueItem[]>(index.getAll("pending") as IDBRequest<SyncQueueItem[]>);
}

/** Update the status (and optionally lastAttemptAt) of a queued item. */
export async function updateQueueItem(
  queueId: number,
  patch: Partial<Pick<SyncQueueItem, "status" | "attempts" | "lastAttemptAt">>,
): Promise<void> {
  const db    = await getDb();
  const tx    = db.transaction("sync-queue", "readwrite");
  const store = tx.objectStore("sync-queue");
  const item  = await wrap<SyncQueueItem>(store.get(queueId) as IDBRequest<SyncQueueItem>);
  if (!item) return;
  store.put({ ...item, ...patch });
  await wrapTx(tx);
}

/** Remove a successfully synced item from the queue. */
export async function dequeue(queueId: number): Promise<void> {
  const db    = await getDb();
  const store = txStore(db, "sync-queue", "readwrite");
  await wrap(store.delete(queueId));
}

/** Count pending items — useful for showing an offline indicator. */
export async function pendingCount(): Promise<number> {
  const db    = await getDb();
  const store = txStore(db, "sync-queue", "readonly");
  const index = store.index("status");
  return wrap<number>(index.count("pending") as IDBRequest<number>);
}

// ─── Housekeeping ─────────────────────────────────────────────────────────────

/**
 * Remove all synced queue items older than `maxAgeMs` (default 7 days).
 * Call this on app start to keep the queue from growing unboundedly.
 */
export async function pruneQueue(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const db    = await getDb();
  const tx    = db.transaction("sync-queue", "readwrite");
  const store = tx.objectStore("sync-queue");
  const index = store.index("status");
  const synced = await wrap<SyncQueueItem[]>(
    index.getAll("synced") as IDBRequest<SyncQueueItem[]>,
  );
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  for (const item of synced) {
    if (item.queueId !== undefined && item.createdAt < cutoff) {
      store.delete(item.queueId);
    }
  }
  await wrapTx(tx);
}
