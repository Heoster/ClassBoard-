"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";

type DialogState =
  | { type: "idle" }
  | { type: "confirm" }
  | { type: "error"; message: string };

export function DeleteDocumentButton({
  documentId,
  filename,
  storagePath,
}: {
  documentId: string;
  filename: string;
  storagePath: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ type: "idle" });

  const handleDeleteConfirmed = async () => {
    setDialog({ type: "idle" });
    setDeleting(true);
    const client = getSupabaseBrowserClient();

    if (storagePath && storagePath !== "blank") {
      const { error: storageError } = await client.storage
        .from("documents")
        .remove([storagePath]);
      if (storageError) {
        setDeleting(false);
        setDialog({ type: "error", message: storageError.message });
        return;
      }
    }

    const { error: documentError } = await client
      .from("documents")
      .delete()
      .eq("id", documentId);
    if (documentError) {
      setDeleting(false);
      setDialog({ type: "error", message: documentError.message });
      return;
    }

    router.refresh();
  };

  return (
    <>
      <button
        className="document-delete"
        type="button"
        onClick={() => setDialog({ type: "confirm" })}
        disabled={deleting}
        aria-label={`Delete ${filename}`}
        title="Delete document"
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>

      {/* Accessible inline confirm dialog — replaces window.confirm which is
          blocked in PWA standalone mode */}
      {dialog.type === "confirm" && (
        <div
          className="confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-msg"
        >
          <div className="confirm-card">
            <p id="delete-confirm-msg">
              Delete <strong>{filename}</strong>? This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDialog({ type: "idle" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-confirm"
                onClick={() => void handleDeleteConfirmed()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accessible inline error dialog — replaces window.alert */}
      {dialog.type === "error" && (
        <div
          className="confirm-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-error-msg"
        >
          <div className="confirm-card">
            <p id="delete-error-msg">
              <strong>Error:</strong> {dialog.message}
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDialog({ type: "idle" })}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
