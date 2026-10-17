"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="status-page">
          <h1>Something went wrong</h1>
          <p>The app could not finish that action. Your original document has not been changed.</p>
          <button className="btn btn-primary" type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
