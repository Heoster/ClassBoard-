import Link from "next/link";
import { Presentation, PenNib, CloudArrowUp, DeviceTablet, DownloadSimple } from "@phosphor-icons/react/ssr";

const highlights = [
  { icon: PenNib, title: "Write with a stylus", text: "Ink, shapes and text on any page. A resting palm will not draw or move the slide." },
  { icon: Presentation, title: "Present full screen", text: "Hide the tools and move between pages with one hand." },
  { icon: CloudArrowUp, title: "Sync your library", text: "Sign in to keep PDFs and annotations available on every device." },
];

export default function Home() {
  return (
    <main className="centered-shell" style={{ maxWidth: "520px" }}>
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true"><DeviceTablet size={24} /></span>
        <div>
          <strong>CODEEX Studio</strong>
          <small>Maples Academy Smartboard</small>
        </div>
      </div>

      <div className="stack">
        <h1>Teach from the board in your hand</h1>
        <p className="muted">Open a lesson, annotate it, and present it. Built for tablets and phones.</p>
      </div>

      <div className="stack" style={{ gap: "0.6rem" }}>
        <Link className="btn btn-primary btn-block" href="/viewer">Open the board</Link>
        <Link className="btn btn-secondary btn-block" href="/sign-in?next=/dashboard">Sign in to sync</Link>
      </div>

      <ul className="list" aria-label="What you can do">
        {highlights.map(({ icon: Glyph, title, text }) => (
          <li key={title} className="list-item">
            <span className="icon-badge" aria-hidden="true"><Glyph size={22} /></span>
            <div className="list-item-body">
              <span className="list-item-title">{title}</span>
              <span className="list-item-meta" style={{ whiteSpace: "normal" }}>{text}</span>
            </div>
          </li>
        ))}
      </ul>

      <p className="link-row">
        <Link href="/download" style={{ color: "var(--accent-text)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <DownloadSimple size={18} aria-hidden="true" /> Get the Android app
        </Link>
      </p>
    </main>
  );
}
