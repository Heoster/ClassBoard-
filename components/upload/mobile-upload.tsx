"use client";
import { useState } from "react";
import { importDocument } from "../../lib/importers";

export function MobileUpload({ sessionId }: { sessionId: string }) {
  const [message, setMessage] = useState("Choose a PDF lesson to send securely.");
  return (
    <main className="centered-shell" style={{ maxWidth: "520px" }}>
      <div className="stack">
        <h1>Send to Smartboard</h1>
        <p className="muted">{message}</p>
      </div>
      <label className="btn btn-primary btn-block" style={{ cursor: "pointer" }}>
        Choose PDF
        <input
          hidden
          type="file"
          accept=".pdf,application/pdf"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            setMessage("Preparing upload…");
            try {
              await importDocument(file);
              setMessage(`Ready to send ${file.name}. Connect Supabase to deliver it to session ${sessionId}.`);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Upload failed.");
            }
          }}
        />
      </label>
      <p className="notice" role="note">
        <strong>Temporary upload.</strong> This upload session and its temporary data are deleted after 24 hours. Saved PDFs stay in your library.
      </p>
      <p className="helper">No credentials are placed in the QR link.</p>
    </main>
  );
}
