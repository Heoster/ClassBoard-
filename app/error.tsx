"use client";
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html>
            <body>
                <main className="empty">
                    <h1>Something went wrong</h1>
                    <p>The smartboard could not complete that action. Your original document has not been changed.</p>
                    <button className="primary" onClick={reset}>
                        Try again
                    </button>
                </main>
            </body>
        </html>
    );
}
