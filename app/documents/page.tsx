import Link from "next/link";
import { FilePdf, Plus } from "@phosphor-icons/react/ssr";
import { getSupabaseServerClient } from "../../lib/supabase/server";
import { DeleteDocumentButton } from "../../components/documents/delete-document-button";
import { BottomNav } from "../../components/app/bottom-nav";

export default async function DocumentsPage() {
  const client = await getSupabaseServerClient();
  const { data: documents, error } = await client.from("documents").select("id,filename,page_count,updated_at,created_at,storage_path").eq("document_type", "pdf").order("updated_at", { ascending: false });
  const count = documents?.length ?? 0;

  return (
    <>
      <header className="app-bar">
        <h1>Library</h1>
        <Link className="btn btn-primary" href="/upload" style={{ minHeight: "44px", padding: "0 0.875rem" }}>
          <Plus size={18} aria-hidden="true" /> Add
        </Link>
      </header>

      <main className="app-main">
        <div className="page-head">
          <p className="muted">{count} {count === 1 ? "lesson" : "lessons"} saved to your account</p>
        </div>

        {error ? (
          <div className="notice is-error" role="alert">
            <strong>Could not load your library.</strong>
            <span>{error.message}</span>
          </div>
        ) : count > 0 ? (
          <ul className="list">
            {documents!.map(document => (
              <li key={document.id} className="doc-row">
                <Link href={`/viewer?doc=${document.id}`} className="doc-link">
                  <span className="doc-thumb" aria-hidden="true">{document.storage_path === "blank" ? "SLIDE" : "PDF"}</span>
                  <span className="list-item-body">
                    <span className="list-item-title">{document.filename}</span>
                    <span className="list-item-meta">
                      {document.storage_path === "blank" ? "Blank presentation" : document.page_count ? `${document.page_count} pages` : "PDF document"} · Updated {new Date(document.updated_at).toLocaleDateString("en-GB")}
                    </span>
                  </span>
                </Link>
                <DeleteDocumentButton documentId={document.id} filename={document.filename} storagePath={document.storage_path} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="icon-badge" aria-hidden="true"><FilePdf size={22} /></span>
            <h2>Your library is empty</h2>
            <p>Add a PDF to save it to your account. It will be available on every device you sign in on.</p>
            <Link className="btn btn-primary" href="/upload"><Plus size={18} aria-hidden="true" /> Add a PDF</Link>
          </div>
        )}
      </main>

      <BottomNav />
    </>
  );
}
