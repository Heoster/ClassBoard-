import Link from "next/link";
import { CaretLeft, DownloadSimple, DeviceMobile } from "@phosphor-icons/react/ssr";
import { SignInPanel } from "../../components/auth/sign-in-panel";

export default function SignInPage() {
  return (
    <main className="centered-shell" style={{ maxWidth: "440px" }}>
      <div className="stack" style={{ gap: "0.25rem" }}>
        <h1>Sign in</h1>
        <p className="muted">Sign in to access your dashboard, library and board. App requires login.</p>
      </div>
      <SignInPanel />

      {/* Download App — available without login */}
      <div className="card" style={{ padding: "1rem", marginTop: "1.25rem", display: "grid", gap: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span className="icon-badge" aria-hidden="true"><DeviceMobile size={22} /></span>
          <div style={{ display: "grid" }}>
            <strong style={{ fontSize: "0.95rem" }}>Get the Android app</strong>
            <span className="muted" style={{ fontSize: "0.85rem" }}>Install on your phone or tablet — no login required</span>
          </div>
        </div>
        <Link href="/download" className="btn btn-secondary btn-block">
          <DownloadSimple size={18} aria-hidden="true" /> Download APK
        </Link>
        <a href="/CODEEX-STUDIO.apk" download="CODEEX-STUDIO.apk" className="btn btn-ghost btn-block" style={{ minHeight: "44px" }}>
          Direct APK link
        </a>
      </div>
    </main>
  );
}
