import Link from "next/link"

export const metadata = {
  title: "Download – CODEEX STUDIO",
  description: "Download the CODEEX STUDIO Android app (APK) for the Maples Academy Smartboard Tool.",
}

export default function DownloadPage() {
  return (
    <main className="download-page">
      <header className="download-header">
        <Link className="brand" href="/">
          <span className="brand-mark">M</span>
          <span>
            MAPLES ACADEMY
            <br />
            <small>SMARTBOARD TOOL</small>
          </span>
        </Link>
      </header>

      <section className="download-hero">
        <div className="download-card">
          <span className="download-badge">ANDROID APP</span>
          <h1>CODEEX STUDIO</h1>
          <p className="download-desc">
            The official Android companion app for the Maples Academy Smartboard Tool.
            Upload PDFs, annotate lessons, and present from your phone or tablet.
          </p>

          <div className="download-meta">
            <div className="meta-item">
              <span className="meta-label">File</span>
              <span className="meta-value">CODEEX-STUDIO.apk</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Size</span>
              <span className="meta-value">6.4 MB</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Platform</span>
              <span className="meta-value">Android</span>
            </div>
          </div>

          <a
            className="primary download-btn"
            href="/CODEEX-STUDIO.apk"
            download="CODEEX-STUDIO.apk"
          >
            ↓ Download APK
          </a>

          <p className="download-note">
            You may need to enable <strong>Install from unknown sources</strong> in your Android
            settings before installing. Go to{" "}
            <em>Settings → Security → Install unknown apps</em> and allow your browser or file manager.
          </p>
        </div>

        <aside className="download-aside">
          <p className="eyebrow">HOW TO INSTALL</p>
          <ol className="install-steps">
            <li>Tap <strong>Download APK</strong> above</li>
            <li>Open the downloaded file from your notifications or Downloads folder</li>
            <li>Tap <strong>Install</strong> when prompted — allow unknown sources if asked</li>
            <li>Open <strong>CODEEX STUDIO</strong> and sign in with your Maples Academy account</li>
          </ol>
          <Link className="secondary" href="/">
            ← Back to home
          </Link>
        </aside>
      </section>
    </main>
  )
}
