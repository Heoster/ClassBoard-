"use client";
import { useState } from "react";

import { importDocument } from "../../lib/importers";
export function MobileUpload({ sessionId }: { sessionId: string }) {
    const [message, setMessage] = useState("Choose a PDF lesson to send securely.");
    return (
        <main className="mobile-upload">
            <h1>Send to Smartboard</h1>
            <p>{message}</p>
            <label className="primary">
                Upload PDF
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
            <p className="retention-warning">
                <strong>Temporary upload warning:</strong> this upload session and any temporary session data are automatically deleted after 24 hours. Saved
                PDFs remain in your library.
            </p>
            <small>No credentials are placed in the QR link.</small>
        </main>
    );
}
