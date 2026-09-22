import Link from "next/link";
export default function Home() {
    return (
        <main className="landing">
            <section>
                <p className="eyebrow">MAPLES ACADEMY</p>
                <h1>
                    SMARTBOARD
                    <br />
                    TOOL
                </h1>
                <p className="lede">Teach, present, annotate, and share from any device.</p>
                <div className="actions">
                    <Link className="primary" href="/sign-in?next=/viewer">
                        Open a PDF
                    </Link>
                    <Link className="secondary" href="/documents">
                        Explore documents
                    </Link>
                    <Link className="secondary" href="/sign-in">
                        Sign in
                    </Link>
                    <Link className="secondary" href="/download">
                        ↓ Android App
                    </Link>
                </div>
            </section>
            <aside>
                <span>PDF CLASSROOM LIBRARY</span>
                <strong>One calm space for every lesson.</strong>
                <p>Keep the original document untouched. Your writing lives in a secure, versioned annotation layer.</p>
            </aside>
        </main>
    );
}

