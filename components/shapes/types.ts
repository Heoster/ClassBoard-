import type { Annotation, AnnotationStyle, AnnotationType, Point } from "../../types/annotation";

export type { Annotation, AnnotationStyle, AnnotationType, Point };

export type ShapeComponentProps = {
    annotation: Annotation;
    selected?: boolean;
    /** When true, pointer events should bubble through so the drawing tool can capture them on the SVG overlay */
    isDrawingTool?: boolean;
    onPointerDown: (event: React.PointerEvent, annotation: Annotation) => void;
};
