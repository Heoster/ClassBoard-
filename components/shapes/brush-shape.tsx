"use client";

import type { ShapeComponentProps } from "./types";

function pointsToSmoothPath(rawPoints: { x: number; y: number }[]): string {
    if (!rawPoints || rawPoints.length === 0) return "";
    if (rawPoints.length === 1) {
        const p = rawPoints[0];
        return `M ${p.x * 1000} ${p.y * 1000} L ${(p.x + 0.0005) * 1000} ${(p.y + 0.0005) * 1000}`;
    }
    if (rawPoints.length === 2) {
        return `M ${rawPoints[0].x * 1000} ${rawPoints[0].y * 1000} L ${rawPoints[1].x * 1000} ${rawPoints[1].y * 1000}`;
    }

    const p0 = rawPoints[0];
    const p1 = rawPoints[1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;

    let d = `M ${p0.x * 1000} ${p0.y * 1000} L ${midX * 1000} ${midY * 1000}`;

    for (let i = 1; i < rawPoints.length - 1; i++) {
        const curr = rawPoints[i];
        const next = rawPoints[i + 1];
        const nextMidX = (curr.x + next.x) / 2;
        const nextMidY = (curr.y + next.y) / 2;
        d += ` Q ${curr.x * 1000} ${curr.y * 1000}, ${nextMidX * 1000} ${nextMidY * 1000}`;
    }

    const lastPt = rawPoints[rawPoints.length - 1];
    d += ` L ${lastPt.x * 1000} ${lastPt.y * 1000}`;
    return d;
}

export function BrushShape({ annotation, selected, onPointerDown }: ShapeComponentProps) {
    const rot = annotation.rotation ?? 0;
    const cx = (annotation.x + annotation.width / 2) * 1000;
    const cy = (annotation.y + annotation.height / 2) * 1000;

    const points = annotation.points ?? [];
    const pathData = pointsToSmoothPath(points);

    const color = annotation.style.color || "#2563eb";
    const strokeWidth = annotation.style.strokeWidth ?? 3;
    const opacity = annotation.style.opacity ?? 1;

    const commonProps = {
        className: selected ? "annotation selected" : "annotation",
        onPointerDown: (e: React.PointerEvent) => onPointerDown(e, annotation),
        transform: rot ? `rotate(${rot} ${cx} ${cy})` : undefined,
    };

    switch (annotation.type) {
        case "highlighter":
            return (
                <path
                    d={pathData}
                    stroke={color}
                    strokeWidth={Math.max(strokeWidth, 16)}
                    fill="none"
                    opacity={Math.min(opacity, 0.45)}
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                    style={{ mixBlendMode: "multiply" }}
                    {...commonProps}
                />
            );

        case "calligraphy":
            return (
                <path
                    d={pathData}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    fill="none"
                    opacity={opacity}
                    strokeLinecap="square"
                    strokeLinejoin="bevel"
                    {...commonProps}
                />
            );

        case "ink":
        default:
            return (
                <path
                    d={pathData}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    fill="none"
                    opacity={opacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    {...commonProps}
                />
            );
    }
}
