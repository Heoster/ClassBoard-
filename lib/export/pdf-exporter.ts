import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import type { Annotation } from "../../types/annotation";

function color(hex: string) {
    if (!hex || hex === "none" || hex === "transparent") return undefined;
    const clean = hex.replace("#", "");
    const n = Number.parseInt(clean, 16);
    if (Number.isNaN(n)) return undefined;
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function getPngBytes(imageUrl: string): Promise<Uint8Array | null> {
    if (imageUrl.startsWith("data:image/png") || imageUrl.startsWith("data:image/jpeg") || imageUrl.startsWith("data:image/jpg")) {
        try {
            const base64Data = imageUrl.split(",")[1];
            if (base64Data) {
                const binary = atob(base64Data.trim().replace(/\s/g, ""));
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return bytes;
            }
        } catch {}
    }

    try {
        if (typeof window !== "undefined" && typeof document !== "undefined") {
            return await new Promise<Uint8Array | null>(resolve => {
                const img = new Image();
                if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
                    img.crossOrigin = "anonymous";
                }
                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = img.naturalWidth || 400;
                        canvas.height = img.naturalHeight || 300;
                        const ctx = canvas.getContext("2d");
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            const pngUrl = canvas.toDataURL("image/png");
                            const base64 = pngUrl.split(",")[1];
                            const binary = atob(base64.replace(/\s/g, ""));
                            const bytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                            resolve(bytes);
                            return;
                        }
                    } catch {}
                    resolve(null);
                };
                img.onerror = () => resolve(null);
                img.src = imageUrl;
            });
        }
    } catch {}

    try {
        const base64Data = imageUrl.includes(",") ? imageUrl.split(",")[1] : imageUrl;
        const binary = atob(base64Data.trim().replace(/\s/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}

export type ExportPage = { sourcePage?: number; background: string };
export interface DocumentExporter {
    export(pdf: ArrayBuffer | null, annotations: Annotation[], pages?: ExportPage[]): Promise<Blob>;
}

export const pdfExporter: DocumentExporter = {
    async export(pdf, annotations, pages) {
        const srcDoc = pdf ? await PDFDocument.load(pdf) : null;
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);

        const defaultWidth = srcDoc && srcDoc.getPageCount() > 0 ? srcDoc.getPage(0).getWidth() : 960;
        const defaultHeight = srcDoc && srcDoc.getPageCount() > 0 ? srcDoc.getPage(0).getHeight() : 540;

        const pageCount = pages && pages.length > 0 ? pages.length : Math.max(srcDoc?.getPageCount() ?? 0, ...annotations.map(a => a.pageNumber), 1);

        for (let i = 0; i < pageCount; i++) {
            const pageMeta = pages?.[i];
            if (pageMeta?.sourcePage && srcDoc && pageMeta.sourcePage >= 1 && pageMeta.sourcePage <= srcDoc.getPageCount()) {
                const [copiedPage] = await doc.copyPages(srcDoc, [pageMeta.sourcePage - 1]);
                doc.addPage(copiedPage);
            } else {
                const pg = doc.addPage([defaultWidth, defaultHeight]);
                const bgHex = pageMeta?.background || "#1e293b";
                const bgCol = color(bgHex);
                if (bgCol) {
                    pg.drawRectangle({
                        x: 0,
                        y: 0,
                        width: defaultWidth,
                        height: defaultHeight,
                        color: bgCol,
                    });
                }
            }
        }

        for (const annotation of annotations) {
            if (annotation.pageNumber < 1 || annotation.pageNumber > doc.getPageCount()) continue;
            const page = doc.getPage(annotation.pageNumber - 1);
            const { width, height } = page.getSize();
            const s = annotation.style;
            const x = annotation.x * width;
            const y = height - (annotation.y + annotation.height) * height;
            const w = annotation.width * width;
            const h = annotation.height * height;

            const strokeCol = color(s.color) ?? rgb(0, 0, 0);
            const fillCol = color(s.fill ?? "");
            const baseOptions = {
                color: fillCol,
                borderColor: strokeCol,
                borderWidth: s.strokeWidth,
                opacity: s.opacity,
            };

            if (["ink", "calligraphy", "highlighter"].includes(annotation.type)) {
                const points = annotation.points ?? [];
                for (let i = 1; i < points.length; i++) {
                    page.drawLine({
                        start: { x: points[i - 1].x * width, y: height - points[i - 1].y * height },
                        end: { x: points[i].x * width, y: height - points[i].y * height },
                        color: strokeCol,
                        thickness: s.strokeWidth,
                        opacity: annotation.type === "highlighter" ? Math.min(s.opacity, 0.45) : s.opacity,
                    });
                }
            } else if (annotation.type === "graph") {
                page.drawRectangle({
                    x,
                    y,
                    width: w,
                    height: h,
                    color: fillCol || rgb(0.98, 0.98, 0.99),
                    borderColor: strokeCol,
                    borderWidth: s.strokeWidth,
                    opacity: s.opacity,
                });
                const cx = x + w / 2;
                const cy = y + h / 2;
                // Draw grid axes
                page.drawLine({ start: { x, y: cy }, end: { x: x + w, y: cy }, color: strokeCol, thickness: s.strokeWidth * 1.2, opacity: s.opacity });
                page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y + h }, color: strokeCol, thickness: s.strokeWidth * 1.2, opacity: s.opacity });
            } else if (annotation.type === "image" && annotation.content) {
                try {
                    const pngBytes = await getPngBytes(annotation.content);
                    if (pngBytes) {
                        const embedded = await doc.embedPng(pngBytes);
                        page.drawImage(embedded, { x, y, width: w, height: h, opacity: s.opacity ?? 1 });
                    } else {
                        const isPng = annotation.content.includes("image/png");
                        const base64Data = annotation.content.split(",")[1] || annotation.content;
                        const binary = atob(base64Data.trim());
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
                        page.drawImage(embedded, { x, y, width: w, height: h, opacity: s.opacity ?? 1 });
                    }
                } catch (err) {
                    console.warn("Failed to embed image in PDF export:", err);
                    page.drawRectangle({ x, y, width: w, height: h, ...baseOptions });
                }
            } else if (annotation.type === "text" || annotation.type === "note") {
                page.drawText(annotation.content ?? "", {
                    x,
                    y: y + h - (s.fontSize ?? 16),
                    size: s.fontSize ?? 16,
                    font,
                    color: strokeCol,
                    opacity: s.opacity,
                    maxWidth: w || undefined,
                });
            } else if (annotation.type === "ellipse") {
                page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: Math.abs(w / 2), yScale: Math.abs(h / 2), ...baseOptions });
            } else if (annotation.type === "line" || annotation.type === "arrow") {
                const start = annotation.points?.[0] ?? { x: annotation.x, y: annotation.y };
                const end = annotation.points?.at(-1) ?? { x: annotation.x + annotation.width, y: annotation.y + annotation.height };
                page.drawLine({
                    start: { x: start.x * width, y: height - start.y * height },
                    end: { x: end.x * width, y: height - end.y * height },
                    color: strokeCol,
                    thickness: s.strokeWidth,
                    opacity: s.opacity,
                });
                if (annotation.type === "arrow") {
                    const ex = end.x * width,
                        ey = height - end.y * height;
                    const dx = ex - start.x * width,
                        dy = ey - (height - start.y * height);
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ux = dx / len,
                        uy = dy / len;
                    const hs = Math.max(8, s.strokeWidth * 3);
                    page.drawSvgPath(
                        `M ${ex} ${ey} L ${ex - ux * hs - uy * hs * 0.4} ${ey - uy * hs + ux * hs * 0.4} L ${ex - ux * hs + uy * hs * 0.4} ${ey - uy * hs - ux * hs * 0.4} Z`,
                        { color: strokeCol, opacity: s.opacity, borderWidth: 0 }
                    );
                }
            } else if (annotation.type === "triangle") {
                page.drawSvgPath(
                    `M ${x + w / 2} ${height - annotation.y * height} L ${x + w} ${height - (annotation.y + annotation.height) * height} L ${x} ${height - (annotation.y + annotation.height) * height} Z`,
                    { color: fillCol, borderColor: strokeCol, borderWidth: s.strokeWidth, opacity: s.opacity }
                );
            } else if (annotation.type === "diamond") {
                page.drawSvgPath(`M ${x + w / 2} ${height - annotation.y * height} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y} L ${x} ${y + h / 2} Z`, {
                    color: fillCol,
                    borderColor: strokeCol,
                    borderWidth: s.strokeWidth,
                    opacity: s.opacity,
                });
            } else if (annotation.type === "star") {
                const pts = Array.from({ length: 10 }, (_, i) => {
                    const r = i % 2 ? 0.42 : 1;
                    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
                    return { px: x + w / 2 + Math.cos(angle) * w * 0.5 * r, py: y + h / 2 + Math.sin(angle) * h * 0.5 * r };
                });
                page.drawSvgPath(
                    `M ${pts[0].px} ${pts[0].py} ${pts
                        .slice(1)
                        .map(p => `L ${p.px} ${p.py}`)
                        .join(" ")} Z`,
                    { color: fillCol, borderColor: strokeCol, borderWidth: s.strokeWidth, opacity: s.opacity }
                );
            } else if (annotation.type === "cloud") {
                page.drawEllipse({ x: x + w * 0.25, y: y + h * 0.7, xScale: w * 0.15, yScale: h * 0.18, ...baseOptions });
                page.drawEllipse({ x: x + w * 0.5, y: y + h * 0.82, xScale: w * 0.22, yScale: h * 0.18, ...baseOptions });
                page.drawEllipse({ x: x + w * 0.75, y: y + h * 0.7, xScale: w * 0.15, yScale: h * 0.18, ...baseOptions });
                page.drawRectangle({ x, y, width: w, height: h * 0.65, ...baseOptions });
            } else {
                page.drawRectangle({ x, y, width: w, height: h, ...baseOptions });
            }
        }

        const bytes = Uint8Array.from(await doc.save());
        return new Blob([bytes], { type: "application/pdf" });
    },
};
