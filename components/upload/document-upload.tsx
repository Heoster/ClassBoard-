"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FilePdf, UploadSimple } from "@phosphor-icons/react";
import { importDocument } from "../../lib/importers";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { createId } from "../../lib/id";

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
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Sign in before uploading a document.");
      const path = `${user.id}/${createId()}-${imported.name}`;
      const { error: uploadError } = await client.storage.from("documents").upload(path, new Blob([imported.data], { type: imported.mimeType }), { contentType: imported.mimeType });
      if (uploadError) throw uploadError;
      const { data: record, error: documentError } = await client.from("documents").insert({ owner_id: user.id, filename: imported.name, document_type: imported.sourceType, storage_path: path }).select("id").single();
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

  const uploading = status === "uploading";
  const classes = ["dropzone", dragging ? "is-dragging" : "", status === "error" ? "has-error" : ""].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      onDragEnter={event => { event.preventDefault(); dragCounter.current += 1; setDragging(true); }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { event.preventDefault(); dragCounter.current -= 1; if (dragCounter.current === 0) setDragging(false); }}
      onDrop={drop}
    >
      <span className="icon-badge" aria-hidden="true">
        {uploading ? <FilePdf size={22} /> : <UploadSimple size={22} />}
      </span>
      <h2 style={{ fontSize: "1.0625rem" }}>{uploading ? "Uploading your lesson" : "Choose a PDF"}</h2>
      <p>{uploading ? message : "Pick a file from this device. You can also drop one here on a computer."}</p>
      {!uploading && (
        <button className="btn btn-primary" type="button" onClick={() => input.current?.click()}>
          Choose PDF
        </button>
      )}
      {status === "error" && <p className="notice is-error" role="alert" style={{ textAlign: "left" }}>{message}</p>}
      <input ref={input} hidden type="file" accept=".pdf,application/pdf" onChange={choose} disabled={uploading} />
    </div>
  );
}
