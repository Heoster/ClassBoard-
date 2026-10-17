import Link from "next/link";
import { statSync } from "node:fs";
import path from "node:path";
import { CaretLeft, DeviceMobile, DownloadSimple } from "@phosphor-icons/react/ssr";

export const metadata = {
  title: "Download CODEEX Studio",
  description: "Download the CODEEX Studio Android app for the Maples Academy Smartboard Tool.",
};

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function apkSize() {
  try {
    return formatSize(statSync(path.join(process.cwd(), "public", "CODEEX-STUDIO.apk")).size);
  } catch {
    return "Android package";
  }
}

const steps = [
  "Tap Download APK on this page.",
  "Open the file from your notifications or Downloads folder.",
  "Tap Install. If Android asks, allow installs from this browser.",
  "Open CODEEX Studio and sign in with your Maples Academy account.",
];

export default function DownloadPage() {
  return (
    <main className="centered-shell" style={{ maxWidth: "520px" }}>
      <Link href="/" className="btn btn-ghost" style={{ justifySelf: "start", paddingLeft: "0.5rem" }}>
        <CaretLeft size={18} aria-hidden="true" /> Back
      </Link>

      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true"><DeviceMobile size={24} /></span>
        <div>
          <strong>CODEEX Studio</strong>
          <small>Android app</small>
        </div>
      </div>

      <div className="stack">
        <h1>Install on your Android device</h1>
        <p className="muted">The companion app for the Smartboard Tool. Open PDFs, annotate lessons, and present from a phone or tablet.</p>
      </div>

      <dl className="list" style={{ margin: 0 }}>
        <div className="list-item">
          <dt className="list-item-meta" style={{ width: "6rem" }}>File</dt>
          <dd className="mono" style={{ margin: 0 }}>CODEEX-STUDIO.apk</dd>
        </div>
        <div className="list-item">
          <dt className="list-item-meta" style={{ width: "6rem" }}>Size</dt>
          <dd style={{ margin: 0 }}>{apkSize()}</dd>
        </div>
        <div className="list-item">
          <dt className="list-item-meta" style={{ width: "6rem" }}>Platform</dt>
          <dd style={{ margin: 0 }}>Android phones and tablets</dd>
        </div>
      </dl>

      <a className="btn btn-primary btn-block" href="/CODEEX-STUDIO.apk" download="CODEEX-STUDIO.apk">
        <DownloadSimple size={20} aria-hidden="true" /> Download APK
      </a>

      <section className="stack" aria-labelledby="install-heading">
        <h2 id="install-heading" style={{ fontSize: "1rem" }}>How to install</h2>
        <ol className="step-list">
          {steps.map(step => <li key={step}>{step}</li>)}
        </ol>
        <p className="helper">
          If installation is blocked, open Android Settings, find Install unknown apps (under Apps or Security), and allow your browser or file manager.
        </p>
      </section>
    </main>
  );
}
