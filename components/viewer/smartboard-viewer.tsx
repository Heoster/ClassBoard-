"use client";
import dynamic from "next/dynamic";
const Viewer = dynamic(() => import("./viewer-client").then(m => m.ViewerClient), { ssr: false });
export function SmartboardViewer() {
    return <Viewer />;
}
