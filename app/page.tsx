import Link from "next/link";
import { redirect } from "next/navigation";
import { CaretRight, FilePdf, FolderSimple, Plus, Presentation, UploadSimple } from "@phosphor-icons/react/ssr";
import { getSupabaseServerClient } from "../lib/supabase/server";
import { BottomNav } from "../components/app/bottom-nav";

// Dashboard is now served at "/" (codeex-studio.vercel.app)
// This is the primary app home — requires login via middleware.

export default async function HomePage() {
  const client = await getSupabaseServerClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) redirect("/sign-in");
  const user = authData.user;

  const [{ data: documents }, { count: annotationCount }] = await Promise.all([
    client.from("documents").select("id,filename,document_type,storage_path,page_count,updated_at").eq("document_type", "pdf").order("updated_at", { ascending: false }).limit(50),
    client.from("annotations").select("id", { count: "exact", head: true }),
  ]);

  const library = documents ?? [];
  const pdfCount = library.filter(d => d.storage_path !== "blank").length;
  const pageCount = library.reduce((total, d) => total + (d.page_count ?? 0), 0);
  const recent = library.slice(0, 5);
  const name = (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there";
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <>
      <header className="app-bar">
        <h1>Home</h1>
        <Link className="btn btn-secondary" href="/upload" style={{ minHeight: "44px", padding: "0 0.875rem" }}>
          <UploadSimple size={18} aria-hidden="true" /> Import
        </Link>
      </header>

      <main className="app-main">
        <div className="page-head">
          <p className="eyebrow">{today}</p>
          <h1>Welcome back, {name}</h1>
        </div>

        <div className="quick-grid">
          <Link className="action-tile" href="/viewer">
            <span className="icon-badge"><Presentation size={22} aria-hidden="true" /></span>
            <strong>Open the board</strong>
            <span>Annotate or present a lesson</span>
          </Link>
          <Link className="action-tile" href="/upload">
            <span className="icon-badge"><Plus size={22} aria-hidden="true" /></span>
            <strong>Add a PDF</strong>
            <span>Save a lesson to your library</span>
          </Link>
        </div>

        <div className="section-head" style={{ marginTop: "1.5rem" }}>
          <h2>Your library</h2>
        </div>
        <div className="stat-strip" role="list" aria-label="Library totals">
          <div className="stat" role="listitem"><span className="stat-value">{pdfCount}</span><span className="stat-label">PDFs</span></div>
          <div className="stat" role="listitem"><span className="stat-value">{pageCount}</span><span className="stat-label">Pages</span></div>
          <div className="stat" role="listitem"><span className="stat-value">{annotationCount ?? 0}</span><span className="stat-label">Annotations</span></div>
        </div>

        <div className="section-head">
          <h2>Recent</h2>
          {library.length > 0 && <Link className="btn btn-ghost" href="/documents">See all</Link>}
        </div>

        {recent.length > 0 ? (
          <ul className="list">
            {recent.map(doc => (
              <li key={doc.id}>
                <Link className="list-item" href={`/viewer?doc=${doc.id}`}>
                  <span className="doc-thumb" aria-hidden="true">{doc.storage_path === "blank" ? "SLIDE" : "PDF"}</span>
                  <span className="list-item-body">
                    <span className="list-item-title">{doc.filename}</span>
                    <span className="list-item-meta">
                      {doc.storage_path === "blank" ? "Blank presentation" : doc.page_count ? `${doc.page_count} pages` : "PDF document"} · {new Date(doc.updated_at).toLocaleDateString("en-GB")}
                    </span>
                  </span>
                  <CaretRight size={18} className="muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="icon-badge" aria-hidden="true"><FolderSimple size={22} /></span>
            <h2>No lessons yet</h2>
            <p>Add a PDF to your library, or open a blank 16:9 board to start writing.</p>
            <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              <Link className="btn btn-primary" href="/upload"><FilePdf size={18} aria-hidden="true" /> Add a PDF</Link>
              <Link className="btn btn-secondary" href="/viewer">Blank board</Link>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </>
  );
}
