"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash } from "@phosphor-icons/react";
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
        className="btn-icon is-danger"
        type="button"
        onClick={() => setDialog({ type: "confirm" })}
        disabled={deleting}
        aria-label={`Delete ${filename}`}
        title="Delete"
      >
        <Trash size={20} aria-hidden="true" />
      </button>

      {/* Inline confirm dialog. window.confirm is unreliable in installed TWA/PWA shells. */}
      {dialog.type === "confirm" && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-msg">
            <h2 id="delete-confirm-title" style={{ fontSize: "1.125rem" }}>Delete this lesson?</h2>
            <p id="delete-confirm-msg" className="muted">
              <strong style={{ color: "var(--text)" }}>{filename}</strong> will be removed from your library on every device. This cannot be undone.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDialog({ type: "idle" })}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void handleDeleteConfirmed()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline error dialog. window.alert is unreliable in installed TWA/PWA shells. */}
      {dialog.type === "error" && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-error-title" aria-describedby="delete-error-msg">
            <h2 id="delete-error-title" style={{ fontSize: "1.125rem" }}>Could not delete</h2>
            <p id="delete-error-msg" className="muted">{dialog.message}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ type: "idle" })}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
