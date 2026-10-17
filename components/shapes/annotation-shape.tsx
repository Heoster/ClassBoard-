"use client";

import { BasicShape } from "./basic-shapes";
import { BrushShape } from "./brush-shape";
import { ConnectorShape } from "./connector-shapes";
import { GraphShape } from "./graph-shape";
import { TextImageShape } from "./text-image-shape";
import type { ShapeComponentProps } from "./types";

export { TransformBoundingBox, type TransformHandle } from "./transform-box";

const PAD = 18; // extra invisible hit-area padding in SVG units (viewBox is 0-1000)

/** Wraps any shape in a <g> with an invisible enlarged rect for easier touch/tap selection */
function HitAreaWrapper({
  annotation,
  selected,
  isDrawingTool,
  onPointerDown,
  children,
}: ShapeComponentProps & { children: React.ReactNode }) {
  const x = annotation.x * 1000 - PAD;
  const y = annotation.y * 1000 - PAD;
  const w = annotation.width * 1000 + PAD * 2;
  const h = annotation.height * 1000 + PAD * 2;
  const cx = annotation.x * 1000 + (annotation.width * 1000) / 2;
  const cy = annotation.y * 1000 + (annotation.height * 1000) / 2;
  const rot = annotation.rotation ?? 0;

  return (
    <g
      style={{ cursor: selected ? "grab" : isDrawingTool ? "crosshair" : "pointer" }}
      transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}
    >
      {/* Invisible padded hit area for easy tap/select */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="transparent"
        stroke="none"
        pointerEvents={isDrawingTool ? "none" : "all"}
        onPointerDown={(e) => {
          if (!isDrawingTool) {
            e.stopPropagation();
          }
          onPointerDown(e as React.PointerEvent, annotation);
        }}
        style={{ cursor: selected ? "grab" : isDrawingTool ? "crosshair" : "pointer" }}
      />
      {children}
    </g>
  );
}

export function AnnotationShape(props: ShapeComponentProps) {
  const { annotation, selected, isDrawingTool, onPointerDown } = props;

  // Wrap onPointerDown to stopPropagation only when NOT in drawing mode
  const wrappedOnPointerDown = (e: React.PointerEvent, a: typeof annotation) => {
    if (!isDrawingTool) e.stopPropagation();
    onPointerDown(e, a);
  };

  const wrappedProps = { ...props, onPointerDown: wrappedOnPointerDown };

  const brushTypes = ["ink", "calligraphy", "highlighter"];
  const basicShapeTypes = ["rectangle", "ellipse", "triangle", "diamond", "star", "cloud",
    "pentagon", "hexagon", "octagon", "heart", "cross", "parallelogram", "right-triangle", "cylinder"];
  const connectorTypes = ["line", "arrow"];

  if (brushTypes.includes(annotation.type)) {
    // Brush strokes: use HitAreaWrapper with a wide stroke ghost path for easy grab
    return (
      <HitAreaWrapper {...props} isDrawingTool={isDrawingTool} onPointerDown={wrappedOnPointerDown}>
        <BrushShape {...wrappedProps} />
      </HitAreaWrapper>
    );
  }

  if (basicShapeTypes.includes(annotation.type)) {
    return (
      <HitAreaWrapper {...props} onPointerDown={wrappedOnPointerDown}>
        <BasicShape {...wrappedProps} />
      </HitAreaWrapper>
    );
  }

  if (connectorTypes.includes(annotation.type)) {
    return (
      <HitAreaWrapper {...props} onPointerDown={wrappedOnPointerDown}>
        <ConnectorShape {...wrappedProps} />
      </HitAreaWrapper>
    );
  }

  if (annotation.type === "graph") {
    return (
      <HitAreaWrapper {...props} onPointerDown={wrappedOnPointerDown}>
        <GraphShape {...wrappedProps} />
      </HitAreaWrapper>
    );
  }

  if (annotation.type === "text" || annotation.type === "image") {
    return (
      <HitAreaWrapper {...props} onPointerDown={wrappedOnPointerDown}>
        <TextImageShape {...wrappedProps} />
      </HitAreaWrapper>
    );
  }

  return (
    <HitAreaWrapper {...props} onPointerDown={wrappedOnPointerDown}>
      <BasicShape {...wrappedProps} />
    </HitAreaWrapper>
  );
}
