"use client";

import type { Annotation } from "../../types/annotation";

export type TransformHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "body";

export function TransformBoundingBox({
    annotation,
    onStartTransform,
}: {
    annotation: Annotation;
    onStartTransform: (event: React.PointerEvent, handle: TransformHandle, annotation: Annotation) => void;
}) {
    const x = annotation.x * 1000;
    const y = annotation.y * 1000;
    const width = annotation.width * 1000;
    const height = annotation.height * 1000;
    const rot = annotation.rotation ?? 0;

    let bx = x;
    let by = y;
    let bw = width;
    let bh = height;

    if (annotation.points && annotation.points.length > 0) {
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const p of annotation.points) {
            if (p.x * 1000 < minX) minX = p.x * 1000;
            if (p.y * 1000 < minY) minY = p.y * 1000;
            if (p.x * 1000 > maxX) maxX = p.x * 1000;
            if (p.y * 1000 > maxY) maxY = p.y * 1000;
        }
        bx = minX;
        by = minY;
        bw = Math.max(20, maxX - minX);
        bh = Math.max(20, maxY - minY);
    }

    const cx = bx + bw / 2;
    const cy = by + bh / 2;

    const handles: Array<{ handle: TransformHandle; hx: number; hy: number; cursor: string }> = [
        { handle: "nw", hx: bx, hy: by, cursor: "handle-nw" },
        { handle: "ne", hx: bx + bw, hy: by, cursor: "handle-ne" },
        { handle: "se", hx: bx + bw, hy: by + bh, cursor: "handle-se" },
        { handle: "sw", hx: bx, hy: by + bh, cursor: "handle-sw" },
        { handle: "n", hx: bx + bw / 2, hy: by, cursor: "handle-n" },
        { handle: "s", hx: bx + bw / 2, hy: by + bh, cursor: "handle-s" },
        { handle: "w", hx: bx, hy: by + bh / 2, cursor: "handle-w" },
        { handle: "e", hx: bx + bw, hy: by + bh / 2, cursor: "handle-e" },
    ];

    return (
        <g transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
            <rect x={bx} y={by} width={bw} height={bh} className="transform-box" />
            <line x1={cx} y1={by} x2={cx} y2={by - 24} className="transform-line" />
            <circle cx={cx} cy={by - 24} r={6} className="transform-handle handle-rotate" onPointerDown={e => onStartTransform(e, "rotate", annotation)} />
            {handles.map(h => (
                <circle
                    key={h.handle}
                    cx={h.hx}
                    cy={h.hy}
                    r={5.5}
                    className={`transform-handle ${h.cursor}`}
                    onPointerDown={e => onStartTransform(e, h.handle, annotation)}
                />
            ))}
        </g>
    );
}
