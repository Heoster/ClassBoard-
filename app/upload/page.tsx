import "./upload.css";

import Link from "next/link";

import { DocumentUpload } from "../../components/upload/document-upload";

export default function UploadPage() {
    return (
        <main className="upload-page">
            <header className="upload-header">
                <Link className="brand" href="/dashboard">
                    <span className="brand-mark">M</span>
                    <span>
                        MAPLES ACADEMY
                        <br />
                        <small>SMARTBOARD TOOL</small>
                    </span>
                </Link>
                <Link className="secondary" href="/documents">
                    Document library
                </Link>
            </header>
            <section className="upload-content">
                <div className="upload-intro">
                    <p className="eyebrow">CLOUD LIBRARY</p>
                    <h1>Bring a lesson to the board.</h1>
                    <p>Upload a PDF and start teaching from any signed-in device.</p>
                </div>
                <DocumentUpload />
                <p className="upload-note">PDF files up to 50 MB are supported. Your document is stored securely in your classroom workspace.</p>
            </section>
        </main>
    );
}
