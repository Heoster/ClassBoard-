import Link from "next/link";
import { CaretLeft, Files } from "@phosphor-icons/react/ssr";
import { DocumentUpload } from "../../components/upload/document-upload";

export default function UploadPage() {
  return (
    <main className="centered-shell" style={{ maxWidth: "560px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <Link href="/" className="btn btn-ghost" style={{ paddingLeft: "0.5rem" }}>
          <CaretLeft size={18} aria-hidden="true" /> Home
        </Link>
        <Link href="/documents" className="btn btn-ghost">
          <Files size={18} aria-hidden="true" /> Library
        </Link>
      </div>
      <div className="stack">
        <h1>Add a PDF</h1>
        <p className="muted">Save a lesson to your account and open it on the board from any signed-in device.</p>
      </div>
      <DocumentUpload />
      <p className="helper">PDF files up to 50 MB. Your file is stored privately in your classroom workspace.</p>
    </main>
  );
}
