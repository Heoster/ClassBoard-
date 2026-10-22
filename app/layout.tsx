import "./globals.css";
import "./viewer.css";
import "./viewer-overrides.css";
import "./viewer-enhancements.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "MAPLES ACADEMY SMARTBOARD TOOL",
    description: "Teach, present, annotate, and share from any device.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
