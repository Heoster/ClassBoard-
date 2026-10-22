"use client";

import type { ShapeComponentProps } from "./types";

export function BasicShape({ annotation, selected, onPointerDown }: ShapeComponentProps) {
    const x = annotation.x * 1000;
    const y = annotation.y * 1000;
    const width = annotation.width * 1000;
    const height = annotation.height * 1000;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rot = annotation.rotation ?? 0;

    const color = annotation.style.color || "#2563eb";
    const fillColor = annotation.style.fill === "none" || !annotation.style.fill ? "none" : annotation.style.fill;
    const strokeWidth = annotation.style.strokeWidth ?? 3;
    const opacity = annotation.style.opacity ?? 1;

    const commonProps = {
        className: selected ? "annotation selected" : "annotation",
        onPointerDown: (e: React.PointerEvent) => onPointerDown(e, annotation),
        transform: rot ? `rotate(${rot} ${cx} ${cy})` : undefined,
        stroke: color,
        strokeWidth,
        fill: fillColor,
        opacity,
    };

    switch (annotation.type) {
        case "rectangle":
            return <rect x={x} y={y} width={width} height={height} rx={4} ry={4} {...commonProps} />;

        case "ellipse":
            return <ellipse cx={cx} cy={cy} rx={Math.abs(width / 2)} ry={Math.abs(height / 2)} {...commonProps} />;

        case "triangle":
            return <polygon points={`${cx},${y} ${x + width},${y + height} ${x},${y + height}`} {...commonProps} />;

        case "diamond":
            return <polygon points={`${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`} {...commonProps} />;

        case "star": {
            const starPoints = Array.from({ length: 10 }, (_, i) => {
                const r = i % 2 ? Math.min(width, height) * 0.2 : Math.min(width, height) * 0.48;
                const angle = -Math.PI / 2 + (i * Math.PI) / 5;
                return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
            }).join(" ");
            return <polygon points={starPoints} {...commonProps} />;
        }

        case "cloud": {
            const r1 = width * 0.18;
            const r2 = width * 0.24;
            const r3 = width * 0.18;
            return (
                <g {...commonProps}>
                    <rect
                        x={x}
                        y={y + height * 0.3}
                        width={width}
                        height={height * 0.65}
                        rx={8}
                        ry={8}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={fillColor}
                        opacity={opacity}
                    />
                    <ellipse
                        cx={x + width * 0.25}
                        cy={y + height * 0.35}
                        rx={r1}
                        ry={height * 0.28}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={fillColor}
                        opacity={opacity}
                    />
                    <ellipse
                        cx={x + width * 0.5}
                        cy={y + height * 0.22}
                        rx={r2}
                        ry={height * 0.32}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={fillColor}
                        opacity={opacity}
                    />
                    <ellipse
                        cx={x + width * 0.75}
                        cy={y + height * 0.35}
                        rx={r3}
                        ry={height * 0.28}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={fillColor}
                        opacity={opacity}
                    />
                </g>
            );
        }

        case "pentagon": {
            const pts = Array.from({ length: 5 }, (_, i) => {
                const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                return `${cx + (Math.cos(angle) * width) / 2},${cy + (Math.sin(angle) * height) / 2}`;
            }).join(" ");
            return <polygon points={pts} {...commonProps} />;
        }

        case "hexagon": {
            const pts = Array.from({ length: 6 }, (_, i) => {
                const angle = (i * Math.PI) / 3;
                return `${cx + (Math.cos(angle) * width) / 2},${cy + (Math.sin(angle) * height) / 2}`;
            }).join(" ");
            return <polygon points={pts} {...commonProps} />;
        }

        case "octagon": {
            const pts = Array.from({ length: 8 }, (_, i) => {
                const angle = -Math.PI / 8 + (i * Math.PI) / 4;
                return `${cx + (Math.cos(angle) * width) / 2},${cy + (Math.sin(angle) * height) / 2}`;
            }).join(" ");
            return <polygon points={pts} {...commonProps} />;
        }

        case "heart": {
            // Normalised heart path scaled to bounding box
            const hx = x;
            const hy = y;
            const hw = width;
            const hh = height;
            const d = `M ${hx + hw * 0.5},${hy + hh * 0.3}
        C ${hx + hw * 0.5},${hy + hh * 0.1} ${hx + hw * 0.15},${hy} ${hx},${hy + hh * 0.2}
        C ${hx - hw * 0.05},${hy + hh * 0.45} ${hx + hw * 0.3},${hy + hh * 0.65} ${hx + hw * 0.5},${hy + hh}
        C ${hx + hw * 0.7},${hy + hh * 0.65} ${hx + hw * 1.05},${hy + hh * 0.45} ${hx + hw},${hy + hh * 0.2}
        C ${hx + hw * 0.85},${hy} ${hx + hw * 0.5},${hy + hh * 0.1} ${hx + hw * 0.5},${hy + hh * 0.3} Z`;
            return <path d={d} {...commonProps} />;
        }

        case "cross": {
            const t = width * 0.28; // arm thickness
            const pts = [
                `${cx - t / 2},${y}`,
                `${cx + t / 2},${y}`,
                `${cx + t / 2},${cy - t / 2}`,
                `${x + width},${cy - t / 2}`,
                `${x + width},${cy + t / 2}`,
                `${cx + t / 2},${cy + t / 2}`,
                `${cx + t / 2},${y + height}`,
                `${cx - t / 2},${y + height}`,
                `${cx - t / 2},${cy + t / 2}`,
                `${x},${cy + t / 2}`,
                `${x},${cy - t / 2}`,
                `${cx - t / 2},${cy - t / 2}`,
            ].join(" ");
            return <polygon points={pts} {...commonProps} />;
        }

        case "parallelogram": {
            const offset = width * 0.2;
            const pts = `${x + offset},${y} ${x + width},${y} ${x + width - offset},${y + height} ${x},${y + height}`;
            return <polygon points={pts} {...commonProps} />;
        }

        case "right-triangle": {
            const pts = `${x},${y} ${x + width},${y + height} ${x},${y + height}`;
            return <polygon points={pts} {...commonProps} />;
        }

        case "cylinder": {
            const ry2 = height * 0.14;
            return (
                <g {...commonProps}>
                    <rect
                        x={x}
                        y={y + ry2}
                        width={width}
                        height={height - ry2 * 2}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={fillColor}
                        opacity={opacity}
                    />
                    <ellipse cx={cx} cy={y + ry2} rx={width / 2} ry={ry2} stroke={color} strokeWidth={strokeWidth} fill={fillColor} opacity={opacity} />
                    <ellipse
                        cx={cx}
                        cy={y + height - ry2}
                        rx={width / 2}
                        ry={ry2}
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={fillColor}
                        opacity={opacity}
                    />
                </g>
            );
        }

        default:
            return <rect x={x} y={y} width={width} height={height} {...commonProps} />;
    }
}
