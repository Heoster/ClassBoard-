import "./documents.css";

import Link from "next/link";

import { DeleteDocumentButton } from "../../components/documents/delete-document-button";
import { getSupabaseServerClient } from "../../lib/supabase/server";

export default async function DocumentsPage() {
    const client = await getSupabaseServerClient();
    const { data: documents, error } = await client
        .from("documents")
        .select("id,filename,page_count,updated_at,created_at,storage_path")
        .eq("document_type", "pdf")
        .order("updated_at", { ascending: false });

    return (
        <main className="documents-page">
            <header className="documents-header">
                <Link className="brand" href="/dashboard">
                    <span className="brand-mark">M</span>
                    <span>
                        MAPLES ACADEMY
                        <br />
                        <small>SMARTBOARD TOOL</small>
                    </span>
                </Link>
                <div className="documents-actions">
                    <Link className="secondary" href="/dashboard">
                        Dashboard
                    </Link>
                    <Link className="primary" href="/upload">
                        + Open PDF
                    </Link>
                </div>
            </header>
            <section className="documents-content">
                <div className="documents-intro">
                    <div>
                        <p className="eyebrow">CLOUD LIBRARY</p>
                        <h1>All documents</h1>
                        <p>Every PDF in your classroom workspace, available on any signed-in device.</p>
                    </div>
                    <span className="document-count">{documents?.length ?? 0} PDFs</span>
                </div>
                {error ? (
                    <div className="documents-empty">
                        <h2>Unable to load documents</h2>
                        <p>{error.message}</p>
                    </div>
                ) : documents?.length ? (
                    <div className="documents-grid">
                        {documents.map(document => (
                            <article className="document-card" key={document.id}>
                                <Link href={`/viewer?doc=${document.id}`}>
                                    <div className="document-preview">
                                        <span>{document.storage_path === "blank" ? "SLIDE" : "PDF"}</span>
                                        <strong>▤</strong>
                                    </div>
                                    <div className="document-card-body">
                                        <h2>{document.filename}</h2>
                                        <p>
                                            {document.storage_path === "blank"
                                                ? "Blank Presentation"
                                                : document.page_count
                                                  ? `${document.page_count} pages`
                                                  : "PDF document"}{" "}
                                            · Updated {new Date(document.updated_at).toLocaleDateString()}
                                        </p>
                                        <span>Open document →</span>
                                    </div>
                                </Link>
                                <DeleteDocumentButton documentId={document.id} filename={document.filename} storagePath={document.storage_path} />
                            </article>
                        ))}
                    </div>
                ) : (
                    <div className="documents-empty">
                        <span className="empty-icon">＋</span>
                        <h2>Your library is empty</h2>
                        <p>Open a PDF to save it securely to your classroom cloud.</p>
                        <Link className="primary" href="/upload">
                            Open a PDF
                        </Link>
                    </div>
                )}
            </section>
        </main>
    );
}
