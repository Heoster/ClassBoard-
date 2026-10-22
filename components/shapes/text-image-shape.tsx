"use client";

import type { ShapeComponentProps } from "./types";

export function TextImageShape({ annotation, selected, onPointerDown }: ShapeComponentProps) {
    const x = annotation.x * 1000;
    const y = annotation.y * 1000;
    const width = annotation.width * 1000;
    const height = annotation.height * 1000;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rot = annotation.rotation ?? 0;

    const color = annotation.style.color || "#2563eb";
    const fontSize = (annotation.style.fontSize ?? 32) * 1.25;
    const fontFamily = annotation.style.fontFamily ?? "Inter, system-ui, sans-serif";
    const opacity = annotation.style.opacity ?? 1;

    if (annotation.type === "image" && annotation.content) {
        return (
            <image
                href={annotation.content}
                x={x}
                y={y}
                width={width}
                height={height}
                preserveAspectRatio="none"
                opacity={opacity}
                className={selected ? "annotation selected" : "annotation"}
                onPointerDown={(e: React.PointerEvent) => onPointerDown(e, annotation)}
                transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
            />
        );
    }

    const rawContent = annotation.content || "Text";
    const lines = rawContent.split("\n");
    const lineGap = fontSize * 1.15;

    return (
        <g
            className={selected ? "annotation selected" : "annotation"}
            onPointerDown={(e: React.PointerEvent) => onPointerDown(e, annotation)}
            transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
            opacity={opacity}
        >
            <rect
                x={x}
                y={y}
                width={Math.max(width, 60)}
                height={Math.max(height, fontSize * 1.3)}
                fill="none"
                stroke={selected ? "#2563eb" : "transparent"}
                strokeWidth={1}
                strokeDasharray="3 3"
            />
            <text x={x + 4} y={y + fontSize * 0.82} fill={color} fontSize={fontSize} fontFamily={fontFamily} fontWeight="bold">
                {lines.map((line, idx) => (
                    <tspan key={idx} x={x + 4} dy={idx === 0 ? 0 : lineGap}>
                        {line}
                    </tspan>
                ))}
            </text>
        </g>
    );
}
