/**
 * lib/offline/use-offline-sync.ts
 *
 * React hook — wires the IndexedDB local-db + sync-queue into viewer-client.tsx.
 *
 * What this hook does
 * ───────────────────
 * • On mount: restores any cached annotations from IndexedDB so the viewer
 *   renders instantly, even before the Supabase round-trip completes.
 * • Every annotation commit: writes to IndexedDB first (synchronous UX), then
 *   schedules a debounced cloud upsert.  No delete-then-reinsert — safe against
 *   partial failures.
 * • Page-layout changes: persisted locally via the "pages" store and synced to
 *   cloud as a special __page_layout__ annotation (same format the old saveCloud
 *   used so existing data remains compatible).
 * • Online/offline transitions: exposed as reactive booleans for the UI.
 * • Cloud unavailable: separate flag shown as a warning banner in the UI.
 *
 * The Supabase cloud writer uses per-annotation UPSERT (not bulk delete+insert)
 * so a partial failure never loses existing data.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationType } from "../../types/annotation";
import {
  putAnnotation,
  putAnnotations,
  deleteAnnotation as idbDeleteAnnotation,
  getAnnotationsByDocument,
  getPagesByDocument,
  putPage,
  type LocalPage,
} from "./local-db";
import {
  initSyncManager,
  destroySyncManager,
  scheduleSync,
  flushQueue,
  isOnline,
  isCloudAvailable,
  type CloudWriter,
} from "./sync-queue";
import { getSupabaseBrowserClient } from "../supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of one viewer "page" — kept in sync with ViewerPage in viewer-client */
export interface ViewerPageRecord {
  id: string;
  sourcePage?: number;
  background: string;
  aspectRatio?: "16:9" | "4:3" | "portrait";
}

export interface UseOfflineSyncOptions {
  documentId: string | null | undefined;
  /** Called once with cached annotations when the documentId first becomes known. */
  onAnnotationsRestored?: (annotations: Annotation[]) => void;
  /** Called once with cached page layout when the documentId first becomes known. */
  onPagesRestored?: (pages: ViewerPageRecord[]) => void;
}

export interface OfflineSyncHandle {
  /** Write one annotation locally + schedule debounced cloud upsert. */
  saveAnnotation:       (ann: Annotation)                        => Promise<void>;
  /** Write many annotations atomically (undo/redo snapshots). */
  saveAnnotations:      (anns: Annotation[])                     => Promise<void>;
  /** Remove one annotation locally + schedule debounced cloud delete. */
  removeAnnotation:     (id: string, documentId: string)         => Promise<void>;
  /** Persist page layout locally + schedule debounced cloud sync. */
  savePageLayout:       (pages: ViewerPageRecord[], documentId: string) => Promise<void>;
  /** true when navigator.onLine */
  isOnline:             boolean;
  /** true when the last cloud write succeeded (false = show warning banner) */
  cloudAvailable:       boolean;
  /** Number of writes waiting to reach the cloud */
  pendingCount:         number;
  /** Force-flush the queue immediately (e.g. "Retry" button) */
  flushNow:             () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineSync({
  documentId,
  onAnnotationsRestored,
  onPagesRestored,
}: UseOfflineSyncOptions): OfflineSyncHandle {
  const [online,         setOnline]         = useState<boolean>(isOnline());
  const [cloudOk,        setCloudOk]        = useState<boolean>(isCloudAvailable());
  const [pendingCount,   setPendingCount]   = useState<number>(0);
  const restoredRef                         = useRef(false);

  // ── Cloud writer ─────────────────────────────────────────────────────────
  // useRef so the function is always the latest without being in dep arrays.
  const cloudWriterRef = useRef<CloudWriter | null>(null);

  // Build the writer once and keep it in the ref — rebuilt only when the
  // component re-mounts (which resets restoredRef anyway).
  useEffect(() => {
    cloudWriterRef.current = async (item) => {
      // Will throw "Supabase is not configured" if env vars are missing —
      // sync-queue catches that and marks the item failed + sets cloudAvailable=false.
      const supabase = getSupabaseBrowserClient();

      switch (item.operation) {
        case "upsert-annotation": {
          const ann = item.payload as Annotation;
          // Map Annotation fields to the DB row shape the schema expects
          const row = {
            id:             ann.id,
            document_id:    ann.documentId,
            page_number:    ann.pageNumber,
            schema_version: 1,
            annotation:     ann,
            updated_at:     ann.updatedAt,
          };
          const { error } = await supabase
            .from("annotations")
            .upsert(row, { onConflict: "id" });
          if (error) throw new Error(error.message);
          break;
        }

        case "delete-annotation": {
          const { id } = item.payload as { id: string };
          const { error } = await supabase
            .from("annotations")
            .delete()
            .eq("id", id);
          if (error) throw new Error(error.message);
          break;
        }

        // Page layout is stored as a special annotation row (type __page_layout__)
        // so it survives the migration to the new sync strategy.
        case "upsert-page": {
          const page   = item.payload as LocalPage;
          const docId  = item.documentId;
          // Load all pages for this document to build the full layout annotation
          const pages  = await getPagesByDocument(docId);
          const layout = buildLayoutAnnotation(pages, docId);
          const row = {
            id:             layout.id,
            document_id:    docId,
            page_number:    1,
            schema_version: 1,
            annotation:     layout,
            updated_at:     layout.updatedAt,
          };
          const { error } = await supabase
            .from("annotations")
            .upsert(row, { onConflict: "id" });
          if (error) throw new Error(error.message);
          // Touch the document's updated_at timestamp
          await supabase
            .from("documents")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", docId);
          // Suppress error — non-critical if document row doesn't exist offline
          break;
        }

        case "delete-page":
          // Page deletes are handled by the next upsert-page call which sends
          // the full updated layout; nothing to do here independently.
          break;

        default:
          break;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — writer must be stable

  // Stable wrapper so initSyncManager always gets the ref's current function
  const stableWriter = useCallback<CloudWriter>(
    (item) => cloudWriterRef.current!(item),
    [],
  );

  // ── Init sync manager once ───────────────────────────────────────────────
  useEffect(() => {
    initSyncManager({
      cloudWriter:          stableWriter,
      maxAttempts:          5,
      debounceMs:           1_500,
      pollIntervalMs:       30_000,
      onPendingCountChange: setPendingCount,
      onNetworkChange:      setOnline,
      onCloudStatusChange:  setCloudOk,
    });
    return () => destroySyncManager();
  }, [stableWriter]);

  // ── Restore local cache when documentId becomes available ────────────────
  useEffect(() => {
    if (!documentId || restoredRef.current) return;
    restoredRef.current = true;

    // Restore annotations
    getAnnotationsByDocument(documentId)
      .then((cached) => {
        if (cached.length > 0) onAnnotationsRestored?.(cached);
      })
      .catch(() => null);

    // Restore page layout
    getPagesByDocument(documentId)
      .then((localPages) => {
        if (localPages.length > 0) {
          const sorted = [...localPages].sort((a, b) => a.pageIndex - b.pageIndex);
          const records: ViewerPageRecord[] = sorted.map((p) => ({
            id:          p.id.split(":")[1] ?? p.id,
            sourcePage:  undefined, // sourcePage not stored in local page record
            background:  p.background,
            aspectRatio: p.aspectRatio,
          }));
          onPagesRestored?.(records);
        }
      })
      .catch(() => null);
  }, [documentId, onAnnotationsRestored, onPagesRestored]);

  // ── Public surface ────────────────────────────────────────────────────────

  const saveAnnotation = useCallback(
    async (ann: Annotation) => {
      await putAnnotation(ann);
      await scheduleSync(ann.documentId, "upsert-annotation", ann);
    },
    [],
  );

  const saveAnnotations = useCallback(
    async (anns: Annotation[]) => {
      if (anns.length === 0) return;
      await putAnnotations(anns);
      // Queue individually so each can be retried independently
      await Promise.all(
        anns.map((ann) => scheduleSync(ann.documentId, "upsert-annotation", ann)),
      );
    },
    [],
  );

  const removeAnnotation = useCallback(
    async (id: string, docId: string) => {
      await idbDeleteAnnotation(id);
      await scheduleSync(docId, "delete-annotation", { id });
    },
    [],
  );

  const savePageLayout = useCallback(
    async (pages: ViewerPageRecord[], docId: string) => {
      if (!docId) return;
      // Persist each page to the local "pages" store
      const now = new Date().toISOString();
      await Promise.all(
        pages.map((p, idx) =>
          putPage({
            id:          `${docId}:${idx}`,
            documentId:  docId,
            pageIndex:   idx,
            background:  p.background,
            aspectRatio: p.aspectRatio,
            updatedAt:   now,
          }),
        ),
      );
      // One cloud sync covers the whole layout (deduplicated to latest state)
      await scheduleSync(docId, "upsert-page", {
        id:          `${docId}:layout`,
        documentId:  docId,
        pageIndex:   0,
        background:  pages[0]?.background ?? "#1e293b",
        updatedAt:   now,
      } satisfies LocalPage);
    },
    [],
  );

  return {
    saveAnnotation,
    saveAnnotations,
    removeAnnotation,
    savePageLayout,
    isOnline:     online,
    cloudAvailable: cloudOk,
    pendingCount,
    flushNow:     flushQueue,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the special __page_layout__ annotation row that the cloud schema stores
 * as a regular annotation entry.  Kept for backward compatibility with data
 * already in the database.
 */
function buildLayoutAnnotation(pages: LocalPage[], documentId: string): Annotation {
  const rawUuid = documentId.replace(/-/g, "").padEnd(32, "0").slice(0, 32);
  const layoutId =
    `${rawUuid.slice(0, 8)}-${rawUuid.slice(8, 12)}-` +
    `${rawUuid.slice(12, 16)}-${rawUuid.slice(16, 20)}-` +
    `${rawUuid.slice(20, 32)}`;

  const viewerPages = [...pages]
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((p) => ({
      id:          p.id.split(":")[1] ?? p.id,
      background:  p.background,
      aspectRatio: p.aspectRatio,
    }));

  return {
    id:         layoutId,
    documentId,
    pageNumber: 1,
    type:       "__page_layout__" as AnnotationType,
    x: 0, y: 0, width: 0, height: 0, rotation: 0,
    style:      { color: "none", opacity: 0, strokeWidth: 0 },
    content:    JSON.stringify(viewerPages),
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
}
