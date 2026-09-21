import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "../../lib/supabase/server";
import { DeleteDocumentButton } from "../../components/documents/delete-document-button";
import { SignOutButton } from "../../components/auth/sign-out-button";
import "../documents/documents.css";
import "./settings.css";

export default async function SettingsPage() {
  const client = await getSupabaseServerClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) redirect("/sign-in");
  const user = authData.user;
  const { data: documents } = await client.from("documents").select("id,filename,storage_path").eq("document_type", "pdf").order("updated_at", { ascending: false });
  return <main className="settings-page">
    <header className="documents-header"><Link className="brand" href="/dashboard"><span className="brand-mark">M</span><span>MAPLES ACADEMY<br /><small>SMARTBOARD TOOL</small></span></Link><div className="documents-actions"><Link className="secondary" href="/dashboard">Dashboard</Link><Link className="primary" href="/documents">Documents</Link></div></header>
    <section className="settings-content"><p className="eyebrow">ACCOUNT</p><h1>Settings</h1><p className="settings-lede">Manage your classroom account and workspace preferences.</p><section className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">SIGNED-IN ACCOUNT</p><h2>Account details</h2></div><span className="account-avatar">{(user?.email?.[0] ?? "T").toUpperCase()}</span></div><dl><div><dt>Email</dt><dd>{user?.email ?? "No email available"}</dd></div><div><dt>Documents</dt><dd>{documents?.length ?? 0} PDFs in your library</dd></div><div><dt>Session</dt><dd className="connected">Connected and protected</dd></div></dl></section><section className="settings-card"><div><p className="eyebrow">WORKSPACE</p><h2>Maples Academy Smartboard</h2><p className="settings-muted">Your documents and annotations are private to your account and sync across signed-in devices.</p></div><Link className="text-link" href="/documents">Open PDF library →</Link></section><section className="settings-card"><div><p className="eyebrow">PDF LIBRARY</p><h2>Manage documents</h2></div>{documents?.length ? <div className="settings-document-list">{documents.map(document => <div className="settings-document-row" key={document.id}><span>{document.filename}</span><DeleteDocumentButton documentId={document.id} filename={document.filename} storagePath={document.storage_path} /></div>)}</div> : <p className="settings-muted">No PDFs saved yet.</p>}</section><section className="settings-card"><p className="eyebrow">SESSION</p><h2>Sign out</h2><p className="settings-muted">End this browser session and return to the secure sign-in page.</p><SignOutButton /></section></section>
  </main>;
}
