"use client";

import type { ShapeComponentProps } from "./types";

export function ConnectorShape({ annotation, selected, onPointerDown }: ShapeComponentProps) {
    const points = annotation.points ?? [];
    const start = points[0] ?? { x: annotation.x, y: annotation.y };
    const end = points.at(-1) ?? { x: annotation.x + annotation.width, y: annotation.y + annotation.height };
    const rot = annotation.rotation ?? 0;
    const cx = ((start.x + end.x) / 2) * 1000;
    const cy = ((start.y + end.y) / 2) * 1000;

    const color = annotation.style.color || "#2563eb";
    const strokeWidth = annotation.style.strokeWidth ?? 3;
    const opacity = annotation.style.opacity ?? 1;

    const commonProps = {
        className: selected ? "annotation selected" : "annotation",
        onPointerDown: (e: React.PointerEvent) => onPointerDown(e, annotation),
        transform: rot ? `rotate(${rot} ${cx} ${cy})` : undefined,
        stroke: color,
        strokeWidth,
        opacity,
        strokeLinecap: "round" as const,
    };

    const isArrow = annotation.type === "arrow";

    return (
        <line
            x1={start.x * 1000}
            y1={start.y * 1000}
            x2={end.x * 1000}
            y2={end.y * 1000}
            markerEnd={isArrow ? "url(#arrowhead)" : undefined}
            {...commonProps}
        />
    );
}
