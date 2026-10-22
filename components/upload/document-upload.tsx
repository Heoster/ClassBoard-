"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";

import { createId } from "../../lib/id";
import { importDocument } from "../../lib/importers";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";

export function DocumentUpload() {
    const input = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const dragCounter = useRef(0);
    const [dragging, setDragging] = useState(false);
    const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
    const [message, setMessage] = useState("");

    const upload = async (file: File) => {
        setStatus("uploading");
        setMessage("Preparing your PDF…");
        try {
            const imported = await importDocument(file);
            const client = getSupabaseBrowserClient();
            const {
                data: { user },
            } = await client.auth.getUser();
            if (!user) throw new Error("Sign in before uploading a document.");
            const path = `${user.id}/${createId()}-${imported.name}`;
            const { error: uploadError } = await client.storage
                .from("documents")
                .upload(path, new Blob([imported.data], { type: imported.mimeType }), { contentType: imported.mimeType });
            if (uploadError) throw uploadError;
            const { data: record, error: documentError } = await client
                .from("documents")
                .insert({ owner_id: user.id, filename: imported.name, document_type: imported.sourceType, storage_path: path })
                .select("id")
                .single();
            if (documentError || !record) throw documentError ?? new Error("Could not create the cloud document.");
            router.replace(`/viewer?doc=${record.id}`);
        } catch (error) {
            setStatus("error");
            setMessage(error instanceof Error ? error.message : "Upload failed. Please try again.");
        }
    };

    const choose = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) void upload(file);
        event.target.value = "";
    };

    const drop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragCounter.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void upload(file);
    };

    return (
        <div
            className={`document-upload ${dragging ? "is-dragging" : ""} ${status === "error" ? "has-error" : ""}`}
            onDragEnter={event => {
                event.preventDefault();
                dragCounter.current += 1;
                setDragging(true);
            }}
            onDragOver={event => event.preventDefault()}
            onDragLeave={event => {
                event.preventDefault();
                dragCounter.current -= 1;
                if (dragCounter.current === 0) setDragging(false);
            }}
            onDrop={drop}
        >
            <div className="upload-symbol" aria-hidden="true">
                ↑
            </div>
            <h2>{status === "uploading" ? "Uploading your lesson" : "Drop a PDF here"}</h2>
            <p>{status === "uploading" ? message : "or choose a file from your computer"}</p>
            {status !== "uploading" && (
                <button className="primary" type="button" onClick={() => input.current?.click()}>
                    Choose PDF
                </button>
            )}
            {status === "error" && (
                <p className="upload-error" role="alert">
                    {message}
                </p>
            )}
            <input ref={input} hidden type="file" accept=".pdf,application/pdf" onChange={choose} disabled={status === "uploading"} />
        </div>
    );
}
