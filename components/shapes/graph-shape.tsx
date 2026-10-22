"use client";

import type { ShapeComponentProps } from "./types";

export function GraphShape({ annotation, selected, onPointerDown }: ShapeComponentProps) {
    const x = annotation.x * 1000;
    const y = annotation.y * 1000;
    const width = annotation.width * 1000;
    const height = annotation.height * 1000;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rot = annotation.rotation ?? 0;

    const color = annotation.style.color || "#2563eb";
    const fillColor = annotation.style.fill === "none" || !annotation.style.fill ? "rgba(255, 255, 255, 0.95)" : annotation.style.fill;
    const strokeWidth = annotation.style.strokeWidth ?? 2;
    const opacity = annotation.style.opacity ?? 1;

    const commonGroupProps = {
        className: selected ? "annotation selected" : "annotation",
        onPointerDown: (e: React.PointerEvent) => onPointerDown(e, annotation),
        transform: rot ? `rotate(${rot} ${cx} ${cy})` : undefined,
        opacity,
    };

    const gridSteps = 10;
    const stepX = width / gridSteps;
    const stepY = height / gridSteps;

    const verticalGridlines = Array.from({ length: gridSteps - 1 }, (_, i) => x + (i + 1) * stepX);
    const horizontalGridlines = Array.from({ length: gridSteps - 1 }, (_, i) => y + (i + 1) * stepY);

    return (
        <g {...commonGroupProps}>
            {/* Background card */}
            <rect x={x} y={y} width={width} height={height} rx={6} ry={6} fill={fillColor} stroke={color} strokeWidth={strokeWidth} opacity={0.95} />

            {/* Minor Gridlines */}
            {verticalGridlines.map((gx, idx) => (
                <line key={`v-${idx}`} x1={gx} y1={y} x2={gx} y2={y + height} stroke={color} strokeWidth={1} opacity={0.25} strokeDasharray="3 3" />
            ))}
            {horizontalGridlines.map((gy, idx) => (
                <line key={`h-${idx}`} x1={x} y1={gy} x2={x + width} y2={gy} stroke={color} strokeWidth={1} opacity={0.25} strokeDasharray="3 3" />
            ))}

            {/* Main X Axis */}
            <line x1={x + 8} y1={cy} x2={x + width - 12} y2={cy} stroke={color} strokeWidth={Math.max(2, strokeWidth * 1.2)} markerEnd="url(#arrowhead)" />
            {/* Main Y Axis */}
            <line x1={cx} y1={y + height - 8} x2={cx} y2={y + 12} stroke={color} strokeWidth={Math.max(2, strokeWidth * 1.2)} markerEnd="url(#arrowhead)" />

            {/* X Ticks & Labels */}
            {[-4, -2, 2, 4].map(val => {
                const tx = cx + (val / 5) * (width / 2) * 0.85;
                return (
                    <g key={`xtick-${val}`}>
                        <line x1={tx} y1={cy - 4} x2={tx} y2={cy + 4} stroke={color} strokeWidth={2} />
                        <text x={tx} y={cy + 14} fill={color} fontSize={Math.max(10, width * 0.035)} textAnchor="middle" fontWeight="bold">
                            {val}
                        </text>
                    </g>
                );
            })}

            {/* Y Ticks & Labels */}
            {[-4, -2, 2, 4].map(val => {
                const ty = cy - (val / 5) * (height / 2) * 0.85;
                return (
                    <g key={`ytick-${val}`}>
                        <line x1={cx - 4} y1={ty} x2={cx + 4} y2={ty} stroke={color} strokeWidth={2} />
                        <text x={cx - 8} y={ty + 3} fill={color} fontSize={Math.max(10, height * 0.035)} textAnchor="end" fontWeight="bold">
                            {val}
                        </text>
                    </g>
                );
            })}

            {/* Axis Titles X & Y */}
            <text x={x + width - 14} y={cy - 8} fill={color} fontSize={Math.max(12, width * 0.045)} fontWeight="bold">
                X
            </text>
            <text x={cx + 10} y={y + 18} fill={color} fontSize={Math.max(12, height * 0.045)} fontWeight="bold">
                Y
            </text>
            {/* Origin Label (0,0) */}
            <text x={cx - 8} y={cy + 14} fill={color} fontSize={Math.max(9, width * 0.03)} fontWeight="bold">
                0
            </text>
        </g>
    );
}
