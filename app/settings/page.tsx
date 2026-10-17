import Link from "next/link";
import { redirect } from "next/navigation";
import { CaretRight, CheckCircle, Files } from "@phosphor-icons/react/ssr";
import { getSupabaseServerClient } from "../../lib/supabase/server";
import { SignOutButton } from "../../components/auth/sign-out-button";
import { BottomNav } from "../../components/app/bottom-nav";

export default async function SettingsPage() {
  const client = await getSupabaseServerClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) redirect("/sign-in");
  const user = authData.user;
  const { count } = await client.from("documents").select("id", { count: "exact", head: true }).eq("document_type", "pdf");
  const initial = (user.email?.[0] ?? "T").toUpperCase();
  const name = (user.user_metadata?.full_name as string | undefined) ?? "Teacher";

  return (
    <>
      <header className="app-bar">
        <h1>Account</h1>
      </header>

      <main className="app-main">
        <section className="list-section" aria-labelledby="account-heading">
          <h2 id="account-heading">Signed in as</h2>
          <div className="list">
            <div className="list-item">
              <span className="avatar" aria-hidden="true">{initial}</span>
              <div className="list-item-body">
                <span className="list-item-title">{name}</span>
                <span className="list-item-meta">{user.email ?? "No email on this account"}</span>
              </div>
            </div>
            <div className="list-item">
              <div className="list-item-body">
                <span className="list-item-title">Connection</span>
                <span className="list-item-meta" style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  <CheckCircle size={16} weight="fill" aria-hidden="true" /> Connected and private to your account
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="list-section" aria-labelledby="library-heading" style={{ marginTop: "1.5rem" }}>
          <h2 id="library-heading">Library</h2>
          <div className="list">
            <Link className="list-item" href="/documents">
              <span className="icon-badge" aria-hidden="true"><Files size={22} /></span>
              <div className="list-item-body">
                <span className="list-item-title">Manage lessons</span>
                <span className="list-item-meta">{count ?? 0} {count === 1 ? "PDF" : "PDFs"} saved</span>
              </div>
              <CaretRight size={18} className="muted" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="list-section" aria-labelledby="session-heading" style={{ marginTop: "1.5rem" }}>
          <h2 id="session-heading">Session</h2>
          <div className="card" style={{ padding: "1rem" }}>
            <p className="list-item-meta" style={{ marginBottom: "0.9rem" }}>Signing out returns this device to the sign-in screen. Your lessons stay saved in your account.</p>
            <SignOutButton />
          </div>
        </section>
      </main>

      <BottomNav />
    </>
  );
}
