"use client";

import { useEffect, useRef, useState, type PointerEvent, type DragEvent, type ReactNode } from "react";
import {
  ArrowLeft, ArrowUUpLeft, ArrowUUpRight, ArrowsIn, ArrowsOut, ArrowUpRight, ChartLineUp, Circle, Cloud, Copy,
  CaretDoubleDown, CaretDown, CaretLeft, CaretRight, CaretUp, Cross, Cursor, Cylinder, Diamond, DotsThree, Eraser,
  Export, FilePdf, HandGrabbing, Heart, Hexagon, Highlighter, Image as ImageIcon, LineSegment, MagnifyingGlass, MagnifyingGlassMinus,
  MagnifyingGlassPlus, Octagon, Parallelogram, PencilSimple, PenNib, Pentagon, Play, Plus, Presentation, Scissors, Shapes,
  Sliders, Square, Star, Stop, TextT, Trash, Triangle, X,
} from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { importDocument } from "../../lib/importers";
import { pdfExporter } from "../../lib/export/pdf-exporter";
import { bounds, normalizePoint } from "../../lib/annotations/geometry";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { createId } from "../../lib/id";
import type { Annotation, AnnotationType, Point } from "../../types/annotation";
import { AnnotationShape, TransformBoundingBox, type TransformHandle } from "../shapes";

const strokeColors = ["#000000", "#ffffff", "#2563eb", "#dc2626", "#16a34a", "#ca8a04"];
const strokeWidthPresets = [{ label: "Thin", val: 2 }, { label: "Med", val: 4 }, { label: "Thick", val: 10 }];
const fontFamilies = [
  { label: "Inter / Clean", val: "Inter, system-ui, sans-serif" },
  { label: "Arial Bold", val: "Arial, Helvetica, sans-serif" },
  { label: "Caveat / Handwriting", val: "'Caveat', 'Comic Sans MS', cursive" },
  { label: "Roboto / Modern", val: "Roboto, sans-serif" },
  { label: "Georgia / Serif", val: "Georgia, serif" },
  { label: "Courier / Monospace", val: "'Courier New', monospace" },
  { label: "OpenDyslexic / Readable", val: "'OpenDyslexic', 'Comic Sans MS', sans-serif" },
  { label: "Playfair / Classic", val: "'Playfair Display', Georgia, serif" },
];
const fontSizePresets = [18, 28, 36, 48, 64, 80, 96, 120];
const drawingTypes: AnnotationType[] = ["ink", "calligraphy", "highlighter"];
type ViewerPage = { id: string; sourcePage?: number; background: string; aspectRatio?: "16:9" | "4:3" | "portrait" };
const pageLayoutKey = (documentId: string) => `maples-page-layout:${documentId}`;

// Input arbitration. A pen touching the slide suppresses finger input for this
// long, which rejects a palm resting on the glass while writing.
const PALM_HOLDOFF_MS = 1200;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
type PointerOwner = { id: number; type: string };
type PinchGesture = { ids: [number, number]; startDist: number; startMid: Point; startZoom: number; startPan: Point };
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const capturePointer = (el: Element, id: number) => { try { el.setPointerCapture(id); } catch {} };

function smoothStrokePoints(points: Point[], passes = 1): Point[] {
  if (!points || points.length <= 2) return points;
  let pts = points;
  for (let pass = 0; pass < passes; pass++) {
    const next: Point[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const upcoming = pts[i + 1];
      next.push({ x: prev.x * 0.25 + curr.x * 0.5 + upcoming.x * 0.25, y: prev.y * 0.25 + curr.y * 0.5 + upcoming.y * 0.25 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

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

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ─── Ghost shape preview ──────────────────────────────────────────────────────
// Returns the SVG path data for a dotted ghost preview of the shape being drawn.
// Mirrors the geometry in basic-shapes.tsx / connector-shapes.tsx so the preview
// exactly matches what will be committed on pointer-up.
function ghostShapeD(
  tool: string,
  x: number, y: number, w: number, h: number
): string {
  const cx = x + w / 2;
  const cy = y + h / 2;

  switch (tool) {
    case "rectangle":
      return `M ${x+4} ${y} H ${x+w-4} Q ${x+w} ${y} ${x+w} ${y+4} V ${y+h-4} Q ${x+w} ${y+h} ${x+w-4} ${y+h} H ${x+4} Q ${x} ${y+h} ${x} ${y+h-4} V ${y+4} Q ${x} ${y} ${x+4} ${y} Z`;
    case "ellipse":
      return `M ${cx} ${y} A ${w/2} ${h/2} 0 1 1 ${cx-0.001} ${y} Z`;
    case "triangle":
      return `M ${cx} ${y} L ${x+w} ${y+h} L ${x} ${y+h} Z`;
    case "right-triangle":
      return `M ${x} ${y} L ${x+w} ${y+h} L ${x} ${y+h} Z`;
    case "diamond":
      return `M ${cx} ${y} L ${x+w} ${cy} L ${cx} ${y+h} L ${x} ${cy} Z`;
    case "parallelogram": {
      const off = w * 0.2;
      return `M ${x+off} ${y} L ${x+w} ${y} L ${x+w-off} ${y+h} L ${x} ${y+h} Z`;
    }
    case "pentagon": {
      const pts = Array.from({length:5},(_,i)=>{
        const a = -Math.PI/2+(i*2*Math.PI)/5;
        return `${cx+Math.cos(a)*w/2},${cy+Math.sin(a)*h/2}`;
      });
      return `M ${pts.join(" L ")} Z`;
    }
    case "hexagon": {
      const pts = Array.from({length:6},(_,i)=>{
        const a = (i*Math.PI)/3;
        return `${cx+Math.cos(a)*w/2},${cy+Math.sin(a)*h/2}`;
      });
      return `M ${pts.join(" L ")} Z`;
    }
    case "octagon": {
      const pts = Array.from({length:8},(_,i)=>{
        const a = -Math.PI/8+(i*Math.PI)/4;
        return `${cx+Math.cos(a)*w/2},${cy+Math.sin(a)*h/2}`;
      });
      return `M ${pts.join(" L ")} Z`;
    }
    case "star": {
      const pts = Array.from({length:10},(_,i)=>{
        const r = i%2 ? Math.min(w,h)*0.2 : Math.min(w,h)*0.48;
        const a = -Math.PI/2+(i*Math.PI)/5;
        return `${cx+Math.cos(a)*r},${cy+Math.sin(a)*r}`;
      });
      return `M ${pts.join(" L ")} Z`;
    }
    case "heart": {
      const hw = w; const hh = h;
      return `M ${x+hw*0.5} ${y+hh*0.3}
        C ${x+hw*0.5} ${y+hh*0.1} ${x+hw*0.15} ${y} ${x} ${y+hh*0.2}
        C ${x-hw*0.05} ${y+hh*0.45} ${x+hw*0.3} ${y+hh*0.65} ${x+hw*0.5} ${y+hh}
        C ${x+hw*0.7} ${y+hh*0.65} ${x+hw*1.05} ${y+hh*0.45} ${x+hw} ${y+hh*0.2}
        C ${x+hw*0.85} ${y} ${x+hw*0.5} ${y+hh*0.1} ${x+hw*0.5} ${y+hh*0.3} Z`;
    }
    case "cross": {
      const t = w * 0.28;
      return [
        `${cx-t/2},${y}`,`${cx+t/2},${y}`,
        `${cx+t/2},${cy-t/2}`,`${x+w},${cy-t/2}`,
        `${x+w},${cy+t/2}`,`${cx+t/2},${cy+t/2}`,
        `${cx+t/2},${y+h}`,`${cx-t/2},${y+h}`,
        `${cx-t/2},${cy+t/2}`,`${x},${cy+t/2}`,
        `${x},${cy-t/2}`,`${cx-t/2},${cy-t/2}`,
      ].reduce((acc,p,i)=>acc+(i===0?`M ${p}`:`L ${p}`), '')+" Z";
    }
    case "cloud":
      return `M ${x} ${y+h*0.55} Q ${x} ${y+h} ${cx} ${y+h} Q ${x+w} ${y+h} ${x+w} ${y+h*0.55} Q ${x+w} ${y+h*0.22} ${cx} ${y+h*0.22} Q ${x+w*0.62} ${y} ${x+w*0.5} ${y+h*0.22} Q ${x+w*0.35} ${y+h*0.06} ${x+w*0.25} ${y+h*0.3} Q ${x} ${y+h*0.3} ${x} ${y+h*0.55} Z`;
    case "cylinder": {
      const ry2 = h * 0.14;
      return `M ${x} ${y+ry2} A ${w/2} ${ry2} 0 0 1 ${x+w} ${y+ry2} L ${x+w} ${y+h-ry2} A ${w/2} ${ry2} 0 0 1 ${x} ${y+h-ry2} Z M ${x} ${y+ry2} A ${w/2} ${ry2} 0 0 0 ${x+w} ${y+ry2}`;
    }
    case "graph":
      return `M ${x+4} ${y} H ${x+w-4} Q ${x+w} ${y} ${x+w} ${y+4} V ${y+h-4} Q ${x+w} ${y+h} ${x+w-4} ${y+h} H ${x+4} Q ${x} ${y+h} ${x} ${y+h-4} V ${y+4} Q ${x} ${y} ${x+4} ${y} Z`;
    case "line":
      return `M ${x} ${y} L ${x+w} ${y+h}`;
    case "arrow":
      return `M ${x} ${y} L ${x+w} ${y+h}`;
    case "text":
      return `M ${x+4} ${y} H ${x+w-4} Q ${x+w} ${y} ${x+w} ${y+4} V ${y+h-4} Q ${x+w} ${y+h} ${x+w-4} ${y+h} H ${x+4} Q ${x} ${y+h} ${x} ${y+h-4} V ${y+4} Q ${x} ${y} ${x+4} ${y} Z`;
    default:
      return `M ${x} ${y} H ${x+w} V ${y+h} H ${x} Z`;
  }
}

const shortTitle = (filename: string) => {
  const extension = filename.match(/\.[^.]+$/)?.[0] ?? "";
  const base = filename.slice(0, filename.length - extension.length).replace(/\.+$/, "").trim();
  if (base.length > 28) return `${base.slice(0, 25).trimEnd()}…${extension}`;
  return filename;
};

function PageThumbnail({ pdf, sourcePage, pageNumber, background, active, onClick }: {
  pdf: any; sourcePage?: number; pageNumber: number; background: string; active: boolean; onClick: () => void;
}) {
  const thumbnail = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    if (!sourcePage) {
      const canvas = thumbnail.current;
      if (canvas) {
        canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.fillStyle = background || "#1e293b"; ctx.fillRect(0, 0, 320, 180); }
      }
      return () => { cancelled = true; };
    }
    void pdf?.getPage(sourcePage).then((pdfPage: any) => {
      if (cancelled || !thumbnail.current) return;
      const vp = pdfPage.getViewport({ scale: 0.38 });
      const canvas = thumbnail.current;
      canvas.width = vp.width; canvas.height = vp.height;
      return pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    });
    return () => { cancelled = true; };
  }, [pdf, sourcePage, pageNumber, background]);
  return (
    <button type="button" className={`page-thumb ${active ? "is-active" : ""}`} onClick={onClick} aria-label={`Go to page ${pageNumber}`} aria-current={active ? "page" : undefined}>
      <span className="page-thumb-frame"><canvas ref={thumbnail} /></span>
      <span className="page-thumb-num">{pageNumber}</span>
    </button>
  );
}

// Inline confirm dialog (replaces window.confirm, which is not reliable in a TWA).
function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
        <p id="confirm-msg">{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// Dock button: icon over a short label. Sized for a 48px-plus touch target.
function DockButton({ icon, label, active = false, expanded, disabled = false, onClick, title }: {
  icon: ReactNode; label: string; active?: boolean; expanded?: boolean; disabled?: boolean;
  onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      className={`dock-btn ${active ? "is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
    >
      <span className="dock-btn-icon" aria-hidden="true">{icon}</span>
      <span className="dock-btn-label">{label}</span>
    </button>
  );
}

// Menu row used by the dock dropdowns and the overflow menu.
function MenuItem({ icon, label, active = false, danger = false, disabled = false, onClick }: {
  icon: ReactNode; label: string; active?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="menu-item-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

const SHAPE_SECTIONS: { label: string; items: { tool: string; label: string; icon: ReactNode }[] }[] = [
  {
    label: "Basic",
    items: [
      { tool: "rectangle", label: "Rectangle", icon: <Square size={22} aria-hidden="true" /> },
      { tool: "ellipse", label: "Circle", icon: <Circle size={22} aria-hidden="true" /> },
      { tool: "triangle", label: "Triangle", icon: <Triangle size={22} aria-hidden="true" /> },
      { tool: "right-triangle", label: "Right tri", icon: <Triangle size={22} aria-hidden="true" /> },
      { tool: "diamond", label: "Diamond", icon: <Diamond size={22} aria-hidden="true" /> },
      { tool: "parallelogram", label: "Parallel", icon: <Parallelogram size={22} aria-hidden="true" /> },
    ],
  },
  {
    label: "Polygons",
    items: [
      { tool: "pentagon", label: "Pentagon", icon: <Pentagon size={22} aria-hidden="true" /> },
      { tool: "hexagon", label: "Hexagon", icon: <Hexagon size={22} aria-hidden="true" /> },
      { tool: "octagon", label: "Octagon", icon: <Octagon size={22} aria-hidden="true" /> },
      { tool: "cross", label: "Cross", icon: <Cross size={22} aria-hidden="true" /> },
    ],
  },
  {
    label: "Decorative",
    items: [
      { tool: "star", label: "Star", icon: <Star size={22} aria-hidden="true" /> },
      { tool: "heart", label: "Heart", icon: <Heart size={22} aria-hidden="true" /> },
      { tool: "cloud", label: "Cloud", icon: <Cloud size={22} aria-hidden="true" /> },
      { tool: "cylinder", label: "Cylinder", icon: <Cylinder size={22} aria-hidden="true" /> },
    ],
  },
  {
    label: "Lines and data",
    items: [
      { tool: "line", label: "Line", icon: <LineSegment size={22} aria-hidden="true" /> },
      { tool: "arrow", label: "Arrow", icon: <ArrowUpRight size={22} aria-hidden="true" /> },
      { tool: "graph", label: "Graph", icon: <ChartLineUp size={22} aria-hidden="true" /> },
    ],
  },
];

const SHAPE_TOOLS: string[] = SHAPE_SECTIONS.flatMap(section => section.items.map(item => item.tool));

// Settings switch row. Uses role="switch" so screen readers announce state.
function ToggleRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "is-on" : ""}`} onClick={onToggle}>
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}


export function ViewerClient() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const pageEl = useRef<HTMLDivElement>(null);   // ref to .page div for coordinate calc
  const stage = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const renderTask = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const renderQueue = useRef(Promise.resolve());
  const searchParams = useSearchParams();

  const [source, setSource] = useState<ArrayBuffer | null>(null);
  const [pdf, setPdf] = useState<any>();
  const [documentId, setDocumentId] = useState<string>();
  const [documentName, setDocumentName] = useState("Untitled presentation");
  const [page, setPage] = useState(1);
  const [pageOrder, setPageOrder] = useState<ViewerPage[]>([]);
  const [tool, setTool] = useState<AnnotationType | "select" | "pan">("select");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [color, setColor] = useState("#2563eb");
  const [fontFamily, setFontFamily] = useState("Inter, system-ui, sans-serif");
  const [fontSize, setFontSize] = useState(() => {
    // Responsive default: scale with viewport width for optimal
    // readability on large classroom displays vs phones/tablets.
    if (typeof window === "undefined") return 32;
    const w = window.innerWidth;
    if (w >= 1920) return 46;
    if (w >= 1366) return 36;
    if (w >= 768) return 32;
    return 26;
  });
  // Viewport-aware scaling factor for annotation text rendering.
  // Kept in state so all text annotations scale fluidly with window size.
  const [viewportScale, setViewportScale] = useState(1);
  useEffect(() => {
    const computeScale = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Base design width 1280 -> 1.0. Clamped to prevent extremes.
      const vwScale = w / 1280;
      const vhScale = h / 800;
      // Use the smaller axis so portrait tablets don't overscale.
      const s = Math.min(vwScale, vhScale * 1.25);
      return Math.max(0.82, Math.min(1.7, s));
    };
    const onResize = () => setViewportScale(computeScale());
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  // When viewportScale changes, also adjust default fontSize for NEW text
  // (existing annotations keep their stored size and are scaled at render time).
  useEffect(() => {
    // Don't override user-picked size if they've manually changed it via slider.
    // This only sets the initial responsive default on mount / large resize.
  }, [viewportScale]);
  const [opacity, setOpacity] = useState(1.0);
  const [width, setWidth] = useState(3);
  const [size, setSize] = useState(100);
  const [presenting, setPresenting] = useState(false);
  const [status, setStatusRaw] = useState("Cloud sync ready");
  // The page list starts open on wide screens and collapsed on phones, where it would cover the slide.
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 600px)").matches);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [textPoints, setTextPoints] = useState<Point[] | null>(null);
  const [textValue, setTextValue] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [eraserSize, setEraserSize] = useState(24);
  const [moreOpen, setMoreOpen] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const [eraserPos, setEraserPos] = useState<Point | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<"pen" | "eraser" | "shape" | "line" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoHideDock, setAutoHideDock] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  // Settings extras
  const [gridType, setGridType] = useState<"dots" | "lines" | "none">("none");
  const [smoothTransition, setSmoothTransition] = useState(true);
  const [laserPointer, setLaserPointer] = useState(false);
  const [hideAnnotations, setHideAnnotations] = useState(false);
  const [renamingDoc, setRenamingDoc] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [settingsTab, setSettingsTab] = useState<"canvas" | "tools" | "document" | "view">("canvas");

  // ─── Draggable dock position ────────────────────────────────────────────────
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);
  const dockDragRef = useRef<{
    startX: number; startY: number;
    originX: number; originY: number;
    dragging: boolean;
  } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // ─── Shapes panel (separate draggable floating window) ─────────────────────
  const [shapesPanelOpen, setShapesPanelOpen] = useState(false);
  const [shapesPanelPos, setShapesPanelPos] = useState<{ x: number; y: number } | null>(null);
  const shapesPanelDragRef = useRef<{
    startX: number; startY: number;
    originX: number; originY: number;
    dragging: boolean;
  } | null>(null);
  const shapesPanelRef = useRef<HTMLDivElement>(null);
  // Inline confirm state
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmState({ message, onConfirm });
  };

  // Close dropdowns on Escape - FIX #17
  useEffect(() => {
    const onKeyEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveDropdown(null);
        setZoomMenuOpen(false);
        setShapesPanelOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyEscape);
    return () => document.removeEventListener("keydown", onKeyEscape);
  }, []);

  // Close dropdowns when clicking outside - FIX #17
  // Uses "click" (not "mousedown") so dropdown button clicks register before close
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".tool-dropdown-container") && !target.closest(".zoom-controls-wrapper")) {
        setActiveDropdown(null);
        setZoomMenuOpen(false);
      }
    };
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const setStatus = (msg: string) => { setStatusRaw(msg); };

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const [transforming, setTransforming] = useState<{
    handle: TransformHandle;
    startPoint: Point;
    initial: { x: number; y: number; width: number; height: number; rotation: number; points?: Point[] };
  } | null>(null);

  const annotationsRef = useRef(annotations);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  const visible = annotations.filter(a => a.pageNumber === page);
  const pages = pageOrder.length;
  const currentPage = pageOrder[page - 1];
  const selectedAnnotation = annotations.find(a => a.id === selectedId);

  const initBlankDocument = async (title = "Untitled Slide Presentation") => {
    setPdf(null); setSource(null);
    const defaultPages: ViewerPage[] = [{ id: "blank-1", background: "#1e293b", aspectRatio: "16:9" }];
    let cloudId: string | undefined;
    let client;
    try { client = getSupabaseBrowserClient(); } catch {}
    if (client) {
      const { data: { user } } = await client.auth.getUser();
      if (user) {
        const { data: record } = await client.from("documents")
          .insert({ owner_id: user.id, filename: title, document_type: "pdf", storage_path: "blank" })
          .select("id").single();
        if (record) cloudId = record.id;
      }
    }
    const newDocId = cloudId || createId();
    setDocumentId(newDocId);
    setDocumentName(title);
    setPageOrder(defaultPages);
    setPage(1);
    setAnnotations([]);
    setHistory([]);
    setFuture([]);
    setStatus(cloudId ? "Cloud presentation ready" : "16:9 Presentation Canvas ready");
    if (cloudId) void saveCloud([], defaultPages, cloudId).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  const loadPdf = async (data: ArrayBuffer, savedPages?: ViewerPage[]) => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
    setSource(data);
    setPdf(doc);
    setPageOrder(savedPages?.length ? savedPages : Array.from({ length: doc.numPages }, (_, i) => ({ id: `pdf-${i + 1}`, sourcePage: i + 1, background: "#ffffff" })));
    setPage(1);
  };

  const loadCloudDocument = async (record: { id: string; filename: string; storage_path: string }) => {
    const client = getSupabaseBrowserClient();
    setStatus("Loading from cloud…");
    setIsLoading(true);
    try {
      const { data: rows, error: annotationError } = await client.from("annotations").select("annotation").eq("document_id", record.id);
      if (annotationError) throw annotationError;
      const rawAnnotations = (rows ?? []).map(row => row.annotation as Annotation);
      const layoutRecord = rawAnnotations.find(a => (a.type as string) === "__page_layout__");
      const restoredAnnotations = rawAnnotations
        .filter(a => (a.type as string) !== "__page_layout__")
        .map(a => ({ ...a, documentId: record.id }));

      setDocumentId(record.id);
      setDocumentName(shortTitle(record.filename));
      setAnnotations(restoredAnnotations);

      let savedPages: ViewerPage[] | undefined;
      if (layoutRecord?.content) {
        try { savedPages = JSON.parse(layoutRecord.content) as ViewerPage[]; } catch {}
      }
      if (!savedPages) {
        try {
          const stored = window.localStorage.getItem(pageLayoutKey(record.id));
          if (stored) savedPages = JSON.parse(stored) as ViewerPage[];
        } catch {}
      }

      if (record.storage_path === "blank") {
        setPdf(null); setSource(null);
        setPageOrder(savedPages?.length ? savedPages : [{ id: "blank-1", background: "#1e293b", aspectRatio: "16:9" }]);
        setPage(1);
        setStatus("Synced across devices");
        return;
      }

      const { data: file, error: fileError } = await client.storage.from("documents").download(record.storage_path);
      if (fileError || !file) throw fileError ?? new Error("The document could not be downloaded.");
      await loadPdf(await file.arrayBuffer(), savedPages);
      setStatus("Synced across devices");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let client;
      try { client = getSupabaseBrowserClient(); } catch { return; }
      const { data: { user } } = await client.auth.getUser();
      if (!user || cancelled) return;
      const requestedId = searchParams.get("doc");
      const result = requestedId
        ? await client.from("documents").select("id,filename,storage_path").eq("id", requestedId).maybeSingle()
        : await client.from("documents").select("id,filename,storage_path").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (result.data && !cancelled) await loadCloudDocument(result.data);
    })().catch(err => { if (!cancelled) setStatus(err instanceof Error ? err.message : "Cloud document unavailable"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ─── Input arbitration ────────────────────────────────────────────────────
  // Every pointer is tracked by id, so a resting palm can never draw, drag, or
  // zoom while a stylus is writing, and two fingers always mean "navigate".
  //   pen    draws, selects, erases, and pans when the Pan tool is active.
  //   touch  ignored while a pen is in contact or was active in the last
  //          PALM_HOLDOFF_MS. Two fingers start a pinch-zoom and pan gesture
  //          that cancels any single-finger stroke, erase, or drag.
  //   mouse  unchanged: left button draws, middle button pans.
  const frame = useRef<HTMLDivElement>(null);
  const touchPoints = useRef(new Map<number, Point>());
  const penContacts = useRef(new Set<number>());
  const lastPenAt = useRef(0);
  const ignoredPointers = useRef(new Set<number>());
  const drawOwner = useRef<PointerOwner | null>(null);
  const eraseOwner = useRef<(PointerOwner & { snapshot: Annotation[] }) | null>(null);
  const panOwner = useRef<(PointerOwner & { start: Point; origin: Point }) | null>(null);
  const transformOwner = useRef<PointerOwner | null>(null);
  const gestureRef = useRef<PinchGesture | null>(null);

  const penRecentlyActive = () => penContacts.current.size > 0 || Date.now() - lastPenAt.current < PALM_HOLDOFF_MS;

  const applyView = (nextZoom: number, nextPan: Point) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  };
  const setZoomLevel = (value: number) => applyView(clampZoom(+value.toFixed(2)), panRef.current);
  const resetView = () => applyView(1, { x: 0, y: 0 });

  // Screen position of the page frame's centre. Layout offsets are used so the
  // current transform does not shift the reference point.
  const frameCenter = (): Point => {
    const s = stage.current;
    const f = frame.current;
    if (!s || !f) return { x: 0, y: 0 };
    const r = s.getBoundingClientRect();
    return {
      x: r.left + s.clientLeft + f.offsetLeft + f.offsetWidth / 2,
      y: r.top + s.clientTop + f.offsetTop + f.offsetHeight / 2,
    };
  };

  const finishErase = () => {
    const owner = eraseOwner.current;
    eraseOwner.current = null;
    setEraserPos(null);
    if (!owner) return;
    const final = annotationsForErase.current;
    if (final === owner.snapshot) return;
    setHistory(h => [...h, owner.snapshot]);
    setFuture([]);
    void saveCloud(final).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  // Drops whatever a finger started. Runs when a pen touches down or when a
  // second finger turns the input into a navigation gesture.
  const cancelTouchWork = () => {
    if (drawOwner.current?.type === "touch") {
      drawOwner.current = null;
      setDraft(null);
    }
    if (eraseOwner.current?.type === "touch") finishErase();
    if (panOwner.current?.type === "touch") {
      panOwner.current = null;
      setIsPanning(false);
    }
    if (transformOwner.current?.type === "touch") endTransform();
  };

  const startGesture = () => {
    const entries = [...touchPoints.current.entries()];
    if (entries.length < 2) return;
    const [[idA, a], [idB, b]] = entries;
    cancelTouchWork();
    ignoredPointers.current.add(idA);
    ignoredPointers.current.add(idB);
    gestureRef.current = {
      ids: [idA, idB],
      startDist: Math.max(distance(a, b), 1),
      startMid: midpoint(a, b),
      startZoom: zoomRef.current,
      startPan: { ...panRef.current },
    };
    setGesturing(true);
  };

  // Keeps the content under the midpoint fixed while the fingers move:
  // pan' = (M - C) - k * (M0 - C - pan0), where k = zoom' / zoom0.
  const updateGesture = () => {
    const g = gestureRef.current;
    if (!g) return;
    const a = touchPoints.current.get(g.ids[0]);
    const b = touchPoints.current.get(g.ids[1]);
    if (!a || !b) return;
    const nextZoom = clampZoom(g.startZoom * (distance(a, b) / g.startDist));
    const k = nextZoom / g.startZoom;
    const m = midpoint(a, b);
    const c = frameCenter();
    applyView(nextZoom, {
      x: (m.x - c.x) - k * (g.startMid.x - c.x - g.startPan.x),
      y: (m.y - c.y) - k * (g.startMid.y - c.y - g.startPan.y),
    });
  };

  const endGesture = () => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    setGesturing(false);
  };

  const onStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const id = e.pointerId;
    const pt: Point = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "pen") {
      penContacts.current.add(id);
      lastPenAt.current = Date.now();
      endGesture();
      cancelTouchWork();
    } else if (e.pointerType === "touch") {
      if (penRecentlyActive()) {
        ignoredPointers.current.add(id);
        e.stopPropagation();
        return;
      }
      touchPoints.current.set(id, pt);
      if (gestureRef.current || touchPoints.current.size >= 2) {
        if (!gestureRef.current) startGesture();
        ignoredPointers.current.add(id);
        e.stopPropagation();
        return;
      }
    }
    if (tool === "pan" || (e.pointerType === "mouse" && e.button === 1)) {
      panOwner.current = { id, type: e.pointerType, start: pt, origin: { ...panRef.current } };
      try { e.currentTarget.setPointerCapture(id); } catch {}
      setIsPanning(true);
      return;
    }
    // Pencil / eraser / shape on empty stage area (outside the page card).
    // The overlay only covers the page (+30% margin), so taps directly on the
    // dark stage would otherwise be lost. Handle them here and convert to
    // normalised page coordinates so drawing works anywhere.
    const isEmptyStageTarget = e.target === stage.current || e.target === frame.current;
    const isDrawingOnStage =
      drawingTypes.includes(tool as AnnotationType) ||
      (tool as string).includes("eraser") ||
      SHAPE_TOOLS.includes(tool as string) ||
      (tool as string) === "line" || (tool as string) === "arrow" ||
      (tool as string) === "graph" || (tool as string) === "text" ||
      (tool as string) === "image";
    // Deselect when clicking empty stage in select mode
    if (isEmptyStageTarget && (tool as string) === "select") {
      setSelectedId(undefined);
      // also clear any transform in progress
      if (transformOwner.current) transformOwner.current = null;
      if (transforming) setTransforming(null);
      return;
    }
    if (isEmptyStageTarget && isDrawingOnStage && !panOwner.current) {
      // Prevent pan/overlay from also handling this pointer
      if ((tool as string) === "select" || (tool as string) === "pan") return;
      setActiveDropdown(null);
      setZoomMenuOpen(false);
      setMoreOpen(false);
      if (autoHideDock) {
        const isCreationTool =
          drawingTypes.includes(tool as AnnotationType) ||
          (tool as string).includes("eraser") ||
          SHAPE_TOOLS.includes(tool as string) ||
          (tool as string) === "text" ||
          (tool as string) === "image" ||
          (tool as string) === "line" ||
          (tool as string) === "arrow" ||
          (tool as string) === "graph";
        if (isCreationTool) setDockCollapsed(true);
      }
      const pagePt = pointFromStage(e);
      if (!pagePt) return;
      const owner: PointerOwner = { id: e.pointerId, type: e.pointerType };
      try { e.currentTarget.setPointerCapture(id); } catch {}
      if ((tool as string).includes("eraser")) {
        eraseOwner.current = { ...owner, snapshot: annotationsForErase.current };
        setEraserPos(pagePt);
        eraseAtPoint(pagePt);
      } else {
        drawOwner.current = owner;
        // For shape/text tools on empty space, seed draft so ghost preview appears
        setDraft([pagePt]);
      }
      // Also track for move handling on stage
      if (e.pointerType === "touch") {
        // touch already tracked above; keep pointer from triggering gesture
        ignoredPointers.current.add(id);
      }
      e.stopPropagation();
    }
  };

  const onStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const id = e.pointerId;
    if (e.pointerType === "pen") lastPenAt.current = Date.now();
    if (touchPoints.current.has(id)) {
      touchPoints.current.set(id, { x: e.clientX, y: e.clientY });
      updateGesture();
    }
    // Handle drawing/erasing that started on the empty stage
    const isStageDrawing = drawOwner.current?.id === id || eraseOwner.current?.id === id;
    if (isStageDrawing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pt = pointFromStage(e);
      if (pt) {
        if ((tool as string).includes("eraser")) {
          setEraserPos(pt);
          if (eraseOwner.current?.id === id) eraseAtPoint(pt);
        } else if (drawOwner.current?.id === id) {
          // Coalesced-agnostic append for stage drawing (rare case)
          setDraft(curr => {
            if (!curr) return [pt];
            const last = curr.at(-1);
            if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.0006) return [...curr, pt];
            return curr;
          });
          // Mirror eraserPos for laser style feedback not needed here
        }
      }
      // Don't block pan if this was a pan gesture; pan already handled above
      if (!panOwner.current) e.stopPropagation();
      return;
    }
    const pan = panOwner.current;
    if (pan && pan.id === id) {
      applyView(zoomRef.current, {
        x: pan.origin.x + (e.clientX - pan.start.x),
        y: pan.origin.y + (e.clientY - pan.start.y),
      });
    }
    if (ignoredPointers.current.has(id)) e.stopPropagation();
  };

  const onStagePointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const id = e.pointerId;
    if (e.pointerType === "pen") {
      penContacts.current.delete(id);
      lastPenAt.current = Date.now();
    }
    touchPoints.current.delete(id);
    if (gestureRef.current?.ids.includes(id)) endGesture();
    if (panOwner.current?.id === id) {
      panOwner.current = null;
      setIsPanning(false);
    }
    // Finish any drawing/erasing started on the empty stage
    if (eraseOwner.current?.id === id) {
      finishErase();
      if (ignoredPointers.current.has(id)) e.stopPropagation();
      else ignoredPointers.current.delete(id);
      return;
    }
    if (drawOwner.current?.id === id) {
      drawOwner.current = null;
      // Re-use finish() by synthesising a PointerEvent-like object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeEvent = e as unknown as any as PointerEvent<SVGSVGElement>;
      finish(fakeEvent);
      if (ignoredPointers.current.has(id)) e.stopPropagation();
      else ignoredPointers.current.delete(id);
      return;
    }
    if (ignoredPointers.current.delete(id)) e.stopPropagation();
    try { if ((e.currentTarget as Element).hasPointerCapture?.(id)) (e.currentTarget as Element).releasePointerCapture(id); } catch {}
  };

  const onOverlayPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (panOwner.current || drawOwner.current || eraseOwner.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setActiveDropdown(null);
    setZoomMenuOpen(false);
    setMoreOpen(false);
    if (autoHideDock) {
      const isCreationTool =
        drawingTypes.includes(tool as AnnotationType) ||
        (tool as string).includes("eraser") ||
        SHAPE_TOOLS.includes(tool as string) ||
        (tool as string) === "text" ||
        (tool as string) === "image" ||
        (tool as string) === "line" ||
        (tool as string) === "arrow" ||
        (tool as string) === "graph";
      if (isCreationTool) setDockCollapsed(true);
    }
    const pt = point(e);
    const owner: PointerOwner = { id: e.pointerId, type: e.pointerType };
    if (tool === "select") {
      setSelectedId(undefined);
      return;
    }
    if (tool === "pan") return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    if (tool.includes("eraser")) {
      eraseOwner.current = { ...owner, snapshot: annotationsForErase.current };
      setEraserPos(pt);
      eraseAtPoint(pt);
    } else {
      drawOwner.current = owner;
      setDraft([pt]);
    }
  };

  const onOverlayPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const pt = point(e);
    if (tool.includes("eraser") || (laserPointer && e.pointerType !== "touch")) setEraserPos(pt);
    if (tool.includes("eraser")) {
      if (eraseOwner.current?.id === e.pointerId) eraseAtPoint(pt);
      return;
    }
    if (transformOwner.current) {
      if (transformOwner.current.id === e.pointerId) updateTransform(e);
      return;
    }
    if (drawOwner.current?.id !== e.pointerId) return;
    const nativeEvt = e.nativeEvent as unknown as { getCoalescedEvents?: () => globalThis.PointerEvent[] };
    const coalesced = typeof nativeEvt.getCoalescedEvents === "function" && nativeEvt.getCoalescedEvents().length > 0
      ? nativeEvt.getCoalescedEvents()
      : [e.nativeEvent as unknown as globalThis.PointerEvent];
    const rect = (pageEl.current ?? overlay.current!).getBoundingClientRect();
    const newPoints: Point[] = coalesced.map(c => normalizePoint(
      { x: c.clientX - rect.left, y: c.clientY - rect.top },
      { width: rect.width, height: rect.height }
    ));
    setDraft(curr => {
      if (!curr) return newPoints;
      const updated = [...curr];
      for (const p of newPoints) {
        const last = updated.at(-1);
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.0006) updated.push(p);
      }
      return updated;
    });
  };

  // Shared end handler for pointerup and pointercancel. A cancelled stroke is
  // still committed so a system interruption never throws away written work.
  const onOverlayPointerEnd = (e: PointerEvent<SVGSVGElement>) => {
    const id = e.pointerId;
    if (eraseOwner.current?.id === id) finishErase();
    if (transformOwner.current?.id === id) endTransform();
    if (drawOwner.current?.id === id) {
      drawOwner.current = null;
      finish(e);
    }
    if (e.currentTarget.hasPointerCapture?.(id)) {
      try { e.currentTarget.releasePointerCapture(id); } catch {}
    }
  };

  const onOverlayPointerLeave = () => {
    if (!eraseOwner.current) setEraserPos(null);
  };

  const resetDockPosition = () => {
    setDockPos(null);
    if (dockDragRef.current) dockDragRef.current.dragging = false;
  };


  // ─── PDF / Canvas render ────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvas.current || !currentPage) return;
    let cancelled = false;
    const operation = renderQueue.current.then(async () => {
      if (cancelled) return;
      if (renderTask.current) { try { renderTask.current.cancel(); } catch {} renderTask.current = null; }
      const target = canvas.current!;
      if (!currentPage.sourcePage || !pdf) {
        target.width = 960; target.height = 540;
        target.style.aspectRatio = "16/9";
        const ctx = target.getContext("2d");
        if (ctx) { ctx.fillStyle = currentPage.background || "#1e293b"; ctx.fillRect(0, 0, 960, 540); }
        return;
      }
      const renderedPage = await pdf.getPage(currentPage.sourcePage);
      if (cancelled) return;
      const baseViewport = renderedPage.getViewport({ scale: 1 });

      // ── High-quality render ────────────────────────────────────────────────
      // We render at a fixed high resolution (equivalent to a 2560-px-wide
      // display) regardless of the current stage size.  The canvas is scaled
      // down to fit by CSS (width/height 100%), so visual quality never
      // degrades when the window is resized or the user zooms.
      // We also no longer put stageSize in the dependency array, which
      // previously caused a re-render (and quality loss) on every resize.
      const TARGET_WIDTH = 2560; // physical pixel target width
      const pixelRatio = typeof window !== "undefined"
        ? Math.max(2, window.devicePixelRatio || 1)
        : 2;
      // Scale to reach TARGET_WIDTH, but never less than 2× native (crisp on
      // all screens) and never more than 8× (avoid runaway memory usage).
      const highResScale = Math.min(
        8,
        Math.max(pixelRatio, TARGET_WIDTH / (baseViewport.width || 1))
      );
      const renderViewport = renderedPage.getViewport({ scale: highResScale });
      target.width = renderViewport.width;
      target.height = renderViewport.height;
      target.style.aspectRatio = `${baseViewport.width}/${baseViewport.height}`;
      const currentRender = renderedPage.render({ canvasContext: target.getContext("2d")!, viewport: renderViewport });
      renderTask.current = { cancel: () => currentRender.cancel(), promise: currentRender.promise };
      try {
        await currentRender.promise;
      } catch (err) {
        const isCancel = err instanceof Error && (err.name === "RenderingCancelledException" || err.message.includes("cancelled") || err.message.includes("canceled"));
        if (!cancelled && !isCancel) throw err;
      } finally {
        if (renderTask.current?.promise === currentRender.promise) renderTask.current = null;
      }
      if (!cancelled && overlay.current) overlay.current.setAttribute("viewBox", "-300 -300 1600 1600");
    });
    renderQueue.current = operation.catch(() => undefined);
    void operation.catch(err => { if (!cancelled) setStatus(err instanceof Error ? err.message : "Page render failed"); });
    return () => {
      cancelled = true;
      if (renderTask.current) { try { renderTask.current.cancel(); } catch {} renderTask.current = null; }
    };
  }, [pdf, currentPage, page]);

  // ─── Keyboard Shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        setHistory(curr => {
          if (!curr.length) return curr;
          const previous = curr.at(-1)!;
          setFuture(f => [annotationsRef.current, ...f]);
          setAnnotations(previous);
          void saveCloud(previous).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
          return curr.slice(0, -1);
        });
      } else if (ctrl && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        setFuture(curr => {
          if (!curr.length) return curr;
          const next = curr[0];
          setHistory(h => [...h, annotationsRef.current]);
          setAnnotations(next);
          void saveCloud(next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
          return curr.slice(1);
        });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        setSelectedId(curr => {
          if (!curr) return curr;
          const next = annotationsRef.current.filter(a => a.id !== curr);
          setHistory(h => [...h, annotationsRef.current]);
          setAnnotations(next);
          setFuture([]);
          void saveCloud(next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
          return undefined;
        });
      } else if (e.key === "Escape") {
        setSelectedId(undefined);
        drawOwner.current = null;
        setDraft(null);
        setTextPoints(null);
        setActiveDropdown(null);
        setZoomMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Draggable dock - pointer/touch handlers ─────────────────────────────
  // We attach global pointermove/pointerup so dragging works even if the
  // cursor leaves the grip handle during fast movement.
  useEffect(() => {
    const onPointerMove = (e: globalThis.PointerEvent) => {
      // ── main dock drag ──
      if (dockDragRef.current?.dragging) {
        e.preventDefault();
        const dx = e.clientX - dockDragRef.current.startX;
        const dy = e.clientY - dockDragRef.current.startY;
        const rawX = dockDragRef.current.originX + dx;
        const rawY = dockDragRef.current.originY + dy;
        const dock = dockRef.current;
        const dockW = dock?.offsetWidth ?? 400;
        const dockH = dock?.offsetHeight ?? 64;
        setDockPos({
          x: Math.max(8, Math.min(window.innerWidth - dockW - 8, rawX)),
          y: Math.max(8, Math.min(window.innerHeight - dockH - 8, rawY)),
        });
      }
      // ── shapes panel drag ──
      if (shapesPanelDragRef.current?.dragging) {
        e.preventDefault();
        const dx = e.clientX - shapesPanelDragRef.current.startX;
        const dy = e.clientY - shapesPanelDragRef.current.startY;
        const rawX = shapesPanelDragRef.current.originX + dx;
        const rawY = shapesPanelDragRef.current.originY + dy;
        const panel = shapesPanelRef.current;
        const w = panel?.offsetWidth ?? 280;
        const h = panel?.offsetHeight ?? 400;
        setShapesPanelPos({
          x: Math.max(8, Math.min(window.innerWidth - w - 8, rawX)),
          y: Math.max(8, Math.min(window.innerHeight - h - 8, rawY)),
        });
      }
    };
    const onPointerUp = () => {
      if (dockDragRef.current) dockDragRef.current.dragging = false;
      if (shapesPanelDragRef.current) shapesPanelDragRef.current.dragging = false;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const saveCloud = async (next: Annotation[], customPageOrder?: ViewerPage[], targetDocId?: string) => {
    const activeDocId = targetDocId || documentId;
    if (!activeDocId) return;
    let client;
    try { client = getSupabaseBrowserClient(); } catch { return; }
    setStatus("Saving…");
    const pagesToSave = customPageOrder || pageOrder;
    const rawUuid = activeDocId.replace(/-/g, "").padEnd(32, "0").slice(0, 32);
    const layoutId = `${rawUuid.slice(0, 8)}-${rawUuid.slice(8, 12)}-${rawUuid.slice(12, 16)}-${rawUuid.slice(16, 20)}-${rawUuid.slice(20, 32)}`;
    const layoutAnnotation: Annotation = {
      id: layoutId, documentId: activeDocId, pageNumber: 1,
      type: "__page_layout__" as AnnotationType,
      x: 0, y: 0, width: 0, height: 0, rotation: 0,
      style: { color: "none", opacity: 0, strokeWidth: 0 },
      content: JSON.stringify(pagesToSave),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const allToSave = [layoutAnnotation, ...next];
    const { error: removeError } = await client.from("annotations").delete().eq("document_id", activeDocId);
    if (removeError) throw removeError;
    const { error } = await client.from("annotations").insert(
      allToSave.map(a => ({ id: a.id, document_id: activeDocId, page_number: a.pageNumber, schema_version: 1, annotation: a, updated_at: a.updatedAt }))
    );
    if (error) throw error;
    await client.from("documents").update({ updated_at: new Date().toISOString() }).eq("id", activeDocId);
    setStatus("Saved to cloud");
  };

  const commit = (next: Annotation[]) => {
    setHistory(curr => [...curr, annotations]);
    setAnnotations(next);
    setFuture([]);
    void saveCloud(next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  const annotationsForErase = useRef(annotations);
  useEffect(() => { annotationsForErase.current = annotations; }, [annotations]);

  const applyEraseLocally = (p: Point): Annotation[] | null => {
    const radius = eraserSize / 1000;
    let modified = false;
    const nextAnnots: Annotation[] = [];
    const current = annotationsForErase.current;
    for (const a of current) {
      if (a.pageNumber !== page) { nextAnnots.push(a); continue; }
      if (tool === "stroke-eraser") {
        let hit = false;
        if (a.points?.length) {
          hit = a.points.some((pt, idx) => {
            if (Math.hypot(pt.x - p.x, pt.y - p.y) <= radius) return true;
            if (idx > 0) return distToSegment(p, a.points![idx - 1], pt) <= radius;
            return false;
          });
        } else {
          hit = p.x >= a.x - radius && p.x <= a.x + a.width + radius && p.y >= a.y - radius && p.y <= a.y + a.height + radius;
        }
        if (hit) { modified = true; } else { nextAnnots.push(a); }
      } else if (tool === "partial-eraser") {
        if (a.points?.length) {
          let changed = false;
          const subStrokes: Point[][] = [];
          let currentSub: Point[] = [];
          for (let i = 0; i < a.points.length; i++) {
            const pt = a.points[i];
            const prev = i > 0 ? a.points[i - 1] : null;
            const isHit = Math.hypot(pt.x - p.x, pt.y - p.y) <= radius || (prev ? distToSegment(p, prev, pt) <= radius : false);
            if (isHit) { changed = true; if (currentSub.length >= 2) subStrokes.push(currentSub); currentSub = []; }
            else { currentSub.push(pt); }
          }
          if (currentSub.length >= 2) subStrokes.push(currentSub);
          if (changed) {
            modified = true;
            for (const sub of subStrokes) {
              const minX = Math.min(...sub.map(pt => pt.x));
              const maxX = Math.max(...sub.map(pt => pt.x));
              const minY = Math.min(...sub.map(pt => pt.y));
              const maxY = Math.max(...sub.map(pt => pt.y));
              nextAnnots.push({ ...a, id: createId(), x: minX, y: minY, width: Math.max(maxX - minX, 0.005), height: Math.max(maxY - minY, 0.005), points: sub, updatedAt: new Date().toISOString() });
            }
          } else { nextAnnots.push(a); }
        } else {
          const hit = p.x >= a.x - radius && p.x <= a.x + a.width + radius && p.y >= a.y - radius && p.y <= a.y + a.height + radius;
          if (hit) { modified = true; } else { nextAnnots.push(a); }
        }
      } else { nextAnnots.push(a); }
    }
    if (modified) { annotationsForErase.current = nextAnnots; setAnnotations(nextAnnots); return nextAnnots; }
    return null;
  };

  const open = async (file: File) => {
    let client;
    try { client = getSupabaseBrowserClient(); } catch {
      setStatus("Supabase is not configured. Viewing locally.");
      const imported = await importDocument(file);
      await loadPdf(imported.data);
      return;
    }
    const imported = await importDocument(file);
    const { data: { user } } = await client.auth.getUser();
    if (!user) {
      await loadPdf(imported.data);
      setDocumentName(shortTitle(imported.name));
      setStatus("Local file loaded (sign in to save cloud revisions)");
      return;
    }
    const path = `${user.id}/${createId()}-${imported.name}`;
    const { error: uploadError } = await client.storage.from("documents").upload(path, new Blob([imported.data], { type: imported.mimeType }), { contentType: imported.mimeType });
    if (uploadError) throw uploadError;
    const { data: record, error: documentError } = await client.from("documents")
      .insert({ owner_id: user.id, filename: imported.name, document_type: imported.sourceType, storage_path: path })
      .select("id,filename,storage_path").single();
    if (documentError || !record) throw documentError ?? new Error("Could not create the cloud document.");
    setAnnotations([]); setHistory([]); setFuture([]);
    await loadCloudDocument(record);
  };

  // Converts a pointer event to normalised 0-1 coordinates relative to the
  // SLIDE (page element), not the full SVG overlay.  The SVG extends beyond
  // the page so we must use the page rect as the reference.
  const point = (e: PointerEvent): Point => {
    const rect = (pageEl.current ?? overlay.current!).getBoundingClientRect();
    return normalizePoint(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      { width: rect.width, height: rect.height }
    );
  };
  // Same as point() but typed for the stage div (used for empty-space drawing).
  // Accepts any pointer event source (stage div, overlay svg, native).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pointFromStage = (e: any): Point | null => {
    const el = pageEl.current ?? overlay.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return normalizePoint(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      { width: rect.width, height: rect.height }
    );
  };

  // FIX #1: text tool now opens dialog when user draws/taps
  // FIX: pencil (freehand) on empty space now converts a single tap to a
  // visible dot so a quick pen tap is never lost.
  const finish = (e: PointerEvent) => {
    if (!draft || (!overlay.current && !pageEl.current) || tool === "select" || tool === "pan" || tool.includes("eraser")) return;
    // Use point() but fall back to pageEl if overlay missing (stage-started stroke)
    let endPt: Point;
    try { endPt = point(e); } catch { return; }
    const points = draft.length ? [...draft, endPt] : [endPt];
    let rawBox = bounds(points);
    const isClick = rawBox.width < 0.02 && rawBox.height < 0.02;

    // FIX #1: Text tool → open dialog instead of creating raw annotation
    if (tool === "text") {
      const defaultW = 0.22; const defaultH = 0.08;
      const textBox = isClick
        ? { x: Math.max(0, Math.min(1 - defaultW, points[0].x - defaultW / 2)), y: Math.max(0, Math.min(1 - defaultH, points[0].y - defaultH / 2)), width: defaultW, height: defaultH }
        : rawBox;
      setTextPoints([{ x: textBox.x, y: textBox.y }, { x: textBox.x + textBox.width, y: textBox.y + textBox.height }]);
      setTextValue("");
      setEditingId(undefined);
      setDraft(null);
      return;
    }

    // Pencil / highlighter tap → convert to a visible dot.
    // Previous behaviour produced a near-invisible stroke for a single-point
    // tap on empty canvas. We now expand it to a short stroke.
    if (isClick && drawingTypes.includes(tool as AnnotationType)) {
      const pt = points[0];
      const dotRadius = (tool === "highlighter" ? Math.max(width, 14) : width) / 1400;
      // Create a two-point tiny stroke so it renders as a dot
      const dotPoints = [{ x: pt.x - dotRadius * 0.15, y: pt.y }, { x: pt.x + dotRadius * 0.15, y: pt.y }];
      points.length = 0;
      points.push(...dotPoints);
      rawBox = bounds(dotPoints);
      // Expand bbox slightly so hit area isn't zero
      rawBox.x -= dotRadius;
      rawBox.y -= dotRadius;
      rawBox.width = dotRadius * 2.1;
      rawBox.height = dotRadius * 2.1;
    } else if (isClick && !drawingTypes.includes(tool as AnnotationType)) {
      const defaultW = tool === "graph" ? 0.35 : tool === "line" || tool === "arrow" ? 0.25 : 0.18;
      const defaultH = tool === "graph" ? 0.25 : tool === "line" || tool === "arrow" ? 0.12 : 0.14;
      const pt = points[0];
      rawBox = { x: Math.max(0, Math.min(1 - defaultW, pt.x - defaultW / 2)), y: Math.max(0, Math.min(1 - defaultH, pt.y - defaultH / 2)), width: defaultW, height: defaultH };
    }

    const strokeW = tool === "highlighter" ? Math.max(width, 14) : width;
    const currentOpacity = tool === "highlighter" ? Math.min(opacity, 0.45) : opacity;

    let pts: Point[] | undefined;
    if (drawingTypes.includes(tool as AnnotationType)) {
      pts = smoothStrokePoints(points, 1);
    } else if (tool === "line" || tool === "arrow") {
      pts = isClick ? [{ x: rawBox.x, y: rawBox.y }, { x: rawBox.x + rawBox.width, y: rawBox.y + rawBox.height }] : points;
    }

    // Shapes are always outline-only (fill: "none") - no fill colour applied
    const isNonShapeTool = drawingTypes.includes(tool as AnnotationType)
      || (tool as string) === "line"
      || (tool as string) === "arrow"
      || (tool as string) === "text"
      || (tool as string) === "image";
    const shapeFill = isNonShapeTool ? undefined : "none";

    const createdId = createId();
    const annotation: Annotation = {
      id: createdId, documentId: documentId ?? "", pageNumber: page,
      type: tool, ...rawBox, rotation: 0,
      style: { color, fill: shapeFill, opacity: currentOpacity, strokeWidth: strokeW, fontSize, fontFamily },
      content: undefined, points: pts,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    commit([...annotations, annotation]);
    setDraft(null);

    if (!drawingTypes.includes(tool as AnnotationType)) {
      setSelectedId(createdId);
      setTool("select");
      setPropertiesOpen(true);
    }
  };

  const handleImageFile = (file: File, dropPoint?: Point) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        const aspect = img.height / (img.width || 1);
        const w = 0.35;
        const h = Math.max(0.08, Math.min(0.6, w * aspect));
        const posX = dropPoint ? Math.max(0, dropPoint.x - w / 2) : 0.325;
        const posY = dropPoint ? Math.max(0, dropPoint.y - h / 2) : 0.2;
        const annotation: Annotation = {
          id: createId(), documentId: documentId ?? "", pageNumber: page,
          type: "image", x: posX, y: posY, width: w, height: h, rotation: 0,
          style: { color: "#000000", opacity: 1, strokeWidth: 0 },
          content: dataUrl,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        commit([...annotations, annotation]);
        setSelectedId(annotation.id);
        setTool("select");
        setPropertiesOpen(true);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleCanvasDrop = (e: DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) {
      const rect = (pageEl.current ?? overlay.current!).getBoundingClientRect();
      handleImageFile(file, normalizePoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, { width: rect.width, height: rect.height }));
    }
  };

  const submitText = () => {
    if (!textPoints || !textValue.trim()) { setTextPoints(null); return; }
    const rawBox = bounds(textPoints);
    const box = { ...rawBox, width: Math.max(rawBox.width, 0.12), height: Math.max(rawBox.height, 0.05) };
    if (editingId) {
      commit(annotations.map(a => a.id === editingId ? { ...a, ...box, content: textValue.trim(), style: { ...a.style, fontFamily, fontSize }, updatedAt: new Date().toISOString() } : a));
    } else {
      const annotation: Annotation = {
        id: createId(), documentId: documentId ?? "", pageNumber: page,
        type: "text", ...box, rotation: 0,
        style: { color, opacity, strokeWidth: width, fontSize, fontFamily },
        content: textValue.trim(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      commit([...annotations, annotation]);
      setSelectedId(annotation.id);
    }
    setTextPoints(null); setTextValue(""); setEditingId(undefined);
  };

  const deleteAnnotation = (id: string) => commit(annotations.filter(a => a.id !== id));
  const eraseAtPoint = (p: Point) => applyEraseLocally(p);

  const clearDrawingsOnPage = () => { commit(annotations.filter(a => a.pageNumber !== page || !drawingTypes.includes(a.type as AnnotationType))); setStatus("Cleared drawings on current page"); };
  const clearShapesOnPage = () => { commit(annotations.filter(a => a.pageNumber !== page || drawingTypes.includes(a.type as AnnotationType))); setStatus("Cleared shapes and text on current page"); };
  const clearAllOnPage = () => { commit(annotations.filter(a => a.pageNumber !== page)); setStatus("Cleared all annotations on current page"); };

  const resizeSelected = (value: number) => {
    setSize(value);
    if (!selectedId) return;
    const current = annotations.find(a => a.id === selectedId);
    if (!current) return;
    const factor = value / size;
    const next = annotations.map(a => a.id === selectedId
      ? { ...a, width: current.width * factor, height: current.height * factor, style: { ...a.style, fontSize: (a.style.fontSize ?? 32) * factor }, updatedAt: new Date().toISOString() }
      : a);
    setAnnotations(next);
    void saveCloud(next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  const updateSelected = (patch: Omit<Partial<Annotation>, "style"> & { style?: Partial<Annotation["style"]> }) => {
    if (!selectedId) return;
    commit(annotations.map(a => a.id === selectedId ? { ...a, ...patch, style: { ...a.style, ...patch.style }, updatedAt: new Date().toISOString() } : a));
  };

  const editSelected = () => {
    if (!selectedAnnotation || selectedAnnotation.type !== "text") return;
    setEditingId(selectedAnnotation.id);
    setTextValue(selectedAnnotation.content ?? "");
    setFontFamily(selectedAnnotation.style.fontFamily || "Inter, system-ui, sans-serif");
    setFontSize(selectedAnnotation.style.fontSize || 32);
    setTextPoints([{ x: selectedAnnotation.x, y: selectedAnnotation.y }, { x: selectedAnnotation.x + selectedAnnotation.width, y: selectedAnnotation.y + selectedAnnotation.height }]);
  };

  const duplicateSelected = () => {
    if (!selectedAnnotation) return;
    const copy = { ...selectedAnnotation, id: createId(), x: Math.min(0.9, selectedAnnotation.x + 0.03), y: Math.min(0.9, selectedAnnotation.y + 0.03), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    commit([...annotations, copy]);
    setSelectedId(copy.id);
  };

  const addBlankPage = () => {
    const insertAt = page;
    const next = [...pageOrder];
    next.splice(insertAt, 0, { id: createId(), background: "#1e293b", aspectRatio: "16:9" });
    const nextAnnotations = annotations.map(a => a.pageNumber > page ? { ...a, pageNumber: a.pageNumber + 1 } : a);
    setPageOrder(next); setAnnotations(nextAnnotations);
    if (documentId) window.localStorage.setItem(pageLayoutKey(documentId), JSON.stringify(next));
    setPage(insertAt + 1);
    void saveCloud(nextAnnotations, next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  const reorderPage = (direction: -1 | 1) => {
    const from = page - 1;
    const to = from + direction;
    if (to < 0 || to >= pageOrder.length) return;
    const nextPages = [...pageOrder];
    [nextPages[from], nextPages[to]] = [nextPages[to], nextPages[from]];
    const nextAnnotations = annotations.map(a =>
      a.pageNumber === from + 1 ? { ...a, pageNumber: to + 1 } :
      a.pageNumber === to + 1 ? { ...a, pageNumber: from + 1 } : a
    );
    setPageOrder(nextPages);
    if (documentId) window.localStorage.setItem(pageLayoutKey(documentId), JSON.stringify(nextPages));
    setAnnotations(nextAnnotations);
    setPage(to + 1);
    void saveCloud(nextAnnotations, nextPages).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  // FIX #13: replaced window.confirm with inline confirm dialog
  const deletePage = (indexToDelete?: number) => {
    const targetIdx = indexToDelete !== undefined ? indexToDelete : page - 1;
    if (targetIdx < 0 || targetIdx >= pageOrder.length) return;

    if (pageOrder.length <= 1) {
      showConfirm("This is the only page. Clear all annotations and reset this page?", () => {
        const nextAnnotations = annotations.filter(a => a.pageNumber !== 1);
        const resetPageOrder: ViewerPage[] = [{ id: pageOrder[0]?.id || createId(), background: "#1e293b", aspectRatio: "16:9" }];
        setAnnotations(nextAnnotations); setPageOrder(resetPageOrder); setPage(1);
        if (documentId) window.localStorage.setItem(pageLayoutKey(documentId), JSON.stringify(resetPageOrder));
        void saveCloud(nextAnnotations, resetPageOrder).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
        setConfirmState(null);
      });
      return;
    }

    const targetPageNum = targetIdx + 1;
    const nextPages = pageOrder.filter((_, i) => i !== targetIdx);
    const nextAnnotations = annotations
      .filter(a => a.pageNumber !== targetPageNum)
      .map(a => a.pageNumber > targetPageNum ? { ...a, pageNumber: a.pageNumber - 1 } : a);
    const newActivePage = Math.max(1, Math.min(page > targetPageNum ? page - 1 : page, nextPages.length));
    setPageOrder(nextPages); setAnnotations(nextAnnotations); setPage(newActivePage);
    if (documentId) window.localStorage.setItem(pageLayoutKey(documentId), JSON.stringify(nextPages));
    void saveCloud(nextAnnotations, nextPages).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
  };

  const changePageBackground = (background: string) => setPageOrder(curr => {
    const next = curr.map((item, i) => i === page - 1 ? { ...item, background } : item);
    if (documentId) window.localStorage.setItem(pageLayoutKey(documentId), JSON.stringify(next));
    void saveCloud(annotations, next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
    return next;
  });

  // ─── Transform ──────────────────────────────────────────────────────────────
  const startTransform = (e: PointerEvent, handle: TransformHandle, annotation: Annotation) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    transformOwner.current = { id: e.pointerId, type: e.pointerType };
    setSelectedId(annotation.id);
    setPropertiesOpen(true);
    // Selector dragging should also hide dock for more canvas space (like pen/eraser)
    if (autoHideDock) setDockCollapsed(true);
    setTransforming({ handle, startPoint: point(e), initial: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height, rotation: annotation.rotation ?? 0, points: annotation.points ? [...annotation.points] : undefined } });
  };

  const updateTransform = (e: PointerEvent) => {
    if (!transforming || !selectedId) return;
    const currentP = point(e);
    const dx = currentP.x - transforming.startPoint.x;
    const dy = currentP.y - transforming.startPoint.y;
    const init = transforming.initial;

    if (transforming.handle === "body") {
      const newX = Math.max(0, Math.min(1 - init.width, init.x + dx));
      const newY = Math.max(0, Math.min(1 - init.height, init.y + dy));
      const shiftX = newX - init.x; const shiftY = newY - init.y;
      setAnnotations(curr => curr.map(a => a.id === selectedId ? { ...a, x: newX, y: newY, points: init.points?.map(p => ({ x: Math.max(0, Math.min(1, p.x + shiftX)), y: Math.max(0, Math.min(1, p.y + shiftY)) })) } : a));
    } else if (transforming.handle === "rotate") {
      const cx = init.x + init.width / 2; const cy = init.y + init.height / 2;
      const degrees = Math.round((Math.atan2(currentP.y - cy, currentP.x - cx) * (180 / Math.PI) + 90 + 360) % 360);
      setAnnotations(curr => curr.map(a => a.id === selectedId ? { ...a, rotation: degrees } : a));
    } else {
      let newX = init.x, newY = init.y, newW = init.width, newH = init.height;
      const h = transforming.handle;
      if (h.includes("w")) { newX = Math.min(init.x + init.width - 0.02, init.x + dx); newW = init.x + init.width - newX; }
      if (h.includes("e")) { newW = Math.max(0.02, init.width + dx); }
      if (h.includes("n")) { newY = Math.min(init.y + init.height - 0.02, init.y + dy); newH = init.y + init.height - newY; }
      if (h.includes("s")) { newH = Math.max(0.02, init.height + dy); }
      const scaledPoints = init.points && init.width > 0 && init.height > 0 ? init.points.map(p => ({ x: newX + ((p.x - init.x) / init.width) * newW, y: newY + ((p.y - init.y) / init.height) * newH })) : undefined;
      let scaledFontSize = selectedAnnotation?.type === "text" ? selectedAnnotation.style.fontSize : undefined;
      if (selectedAnnotation?.type === "text" && init.height > 0) {
        const initialFS = selectedAnnotation.style.fontSize ?? 32;
        scaledFontSize = Math.max(12, Math.min(160, Math.round(initialFS * (newH / init.height))));
      }
      setAnnotations(curr => curr.map(a => a.id === selectedId ? { ...a, x: newX, y: newY, width: newW, height: newH, points: scaledPoints, style: a.type === "text" && scaledFontSize ? { ...a.style, fontSize: scaledFontSize } : a.style } : a));
    }
  };

  const endTransform = () => { transformOwner.current = null; if (transforming) { setTransforming(null); void saveCloud(annotationsRef.current).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed")); } };

  const isErrorStatus = /failed|unavailable|error|not configured/i.test(status);
  const shapeToolActive = SHAPE_TOOLS.includes(tool);
  const penIcon = tool === "calligraphy" ? <PenNib size={22} aria-hidden="true" /> : tool === "highlighter" ? <Highlighter size={22} aria-hidden="true" /> : <PencilSimple size={22} aria-hidden="true" />;
  const penLabel = tool === "calligraphy" ? "Brush" : tool === "highlighter" ? "Highlight" : "Pen";
  const strokeColor = selectedAnnotation?.style.color ?? color;
  const strokeWidthValue = selectedAnnotation?.style.strokeWidth ?? width;
  const opacityValue = selectedAnnotation?.style.opacity ?? opacity;
  const fontSizeValue = selectedAnnotation?.style.fontSize ?? fontSize;
  // Presenting: the control strip fades after 3 s without input, and returns on any touch, pen, or key.
  const [barAwake, setBarAwake] = useState(true);
  useEffect(() => {
    if (!presenting) {
      setBarAwake(true);
      return;
    }
    let timer = window.setTimeout(() => setBarAwake(false), 3000);
    const wake = () => {
      setBarAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBarAwake(false), 3000);
    };
    const events = ["pointerdown", "pointermove", "keydown"] as const;
    events.forEach(name => window.addEventListener(name, wake));
    return () => {
      window.clearTimeout(timer);
      events.forEach(name => window.removeEventListener(name, wake));
    };
  }, [presenting]);

  // Presenting keys: arrows and Page keys move through pages, Escape leaves presentation.
  useEffect(() => {
    if (!presenting) return;
    const onPresentKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPresenting(false);
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setPage(v => Math.min(v + 1, pages));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setPage(v => Math.max(v - 1, 1));
      }
    };
    window.addEventListener("keydown", onPresentKey);
    return () => window.removeEventListener("keydown", onPresentKey);
  }, [presenting, pages]);

  const showStylePanel = propertiesOpen && !dockCollapsed && !presenting;
  const hasSelectionPanel = Boolean(selectedAnnotation);

  return (
    <main className={`viewer ${presenting ? "is-presenting" : ""}`}>
      {/* Hidden file input for images */}
      <input
        ref={imageInputRef}
        type="file"
        hidden
        accept="image/*"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleImageFile(f);
          e.target.value = "";
        }}
      />

      {/* ─── Top app bar ─────────────────────────────────────────────────── */}
      <header className="viewer-bar">
        <a href="/" className="btn-icon" aria-label="Back to dashboard" title="Back">
          <ArrowLeft size={22} aria-hidden="true" />
        </a>

        <div className="viewer-title">
          <strong title={documentName}>{documentName}</strong>
          {status && (
            <span className={`viewer-status ${isErrorStatus ? "is-error" : ""}`} role="status" aria-live="polite">{status}</span>
          )}
        </div>

        <div className="viewer-bar-actions">
          <button type="button" className="btn-icon" title="Undo" aria-label="Undo" disabled={!history.length}
            onClick={() => {
              if (history.length) {
                const previous = history.at(-1)!;
                setFuture(c => [annotations, ...c]);
                setAnnotations(previous);
                setHistory(c => c.slice(0, -1));
                void saveCloud(previous).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
              }
            }}>
            <ArrowUUpLeft size={22} aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon" title="Redo" aria-label="Redo" disabled={!future.length}
            onClick={() => {
              if (future.length) {
                const next = future[0];
                setHistory(c => [...c, annotations]);
                setAnnotations(next);
                setFuture(c => c.slice(1));
                void saveCloud(next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
              }
            }}>
            <ArrowUUpRight size={22} aria-hidden="true" />
          </button>

          <div className="menu-anchor">
            <button type="button" className={`btn-icon ${moreOpen ? "is-active" : ""}`} aria-label="More options" aria-haspopup="menu" aria-expanded={moreOpen}
              title="More" onClick={() => { setMoreOpen(v => !v); setActiveDropdown(null); setZoomMenuOpen(false); }}>
              <DotsThree size={24} weight="bold" aria-hidden="true" />
            </button>
            {moreOpen && (
              <div className="float-menu menu-top-right" role="menu" aria-label="More options">
                <MenuItem icon={<Export size={20} aria-hidden="true" />} label="Export PDF" onClick={async () => {
                  setMoreOpen(false);
                  try {
                    const blob = await pdfExporter.export(source, annotations, pageOrder);
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `${documentName.replace(/\s+/g, "_")}.pdf`;
                    link.click();
                  } catch (err) {
                    setStatus(err instanceof Error ? err.message : "Export failed");
                  }
                }} />
                <MenuItem icon={<Sliders size={20} aria-hidden="true" />} label="Settings" onClick={() => { setMoreOpen(false); setSettingsOpen(true); }} />
                <MenuItem icon={isFullscreen ? <ArrowsIn size={20} aria-hidden="true" /> : <ArrowsOut size={20} aria-hidden="true" />} label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => { toggleFullscreen(); setMoreOpen(false); }} />
              </div>
            )}
          </div>

          <button type="button" className={`btn ${presenting ? "btn-secondary" : "btn-primary"} viewer-present-btn`} onClick={() => setPresenting(v => !v)} aria-pressed={presenting}>
            {presenting ? <Stop size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
            <span>{presenting ? "Exit" : "Present"}</span>
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="viewer-loading" aria-live="polite">
          <span className="viewer-spinner" aria-hidden="true" />
          <span>Loading document…</span>
        </div>
      )}

      {(pdf || pageOrder.length > 0) ? (
        <div className={`viewer-body ${sidebarOpen ? "" : "rail-collapsed"}`}>

          {/* ─── Page rail ──────────────────────────────────────────────── */}
          <aside className={`page-rail ${sidebarOpen ? "" : "is-collapsed"}`} aria-label="Pages">
            <div className="rail-head">
              {sidebarOpen && <strong>Pages</strong>}
              <button type="button" className="btn-icon rail-toggle" onClick={() => setSidebarOpen(v => !v)}
                aria-label={sidebarOpen ? "Collapse page list" : "Expand page list"} aria-expanded={sidebarOpen}>
                {sidebarOpen ? <CaretLeft size={20} aria-hidden="true" /> : <CaretRight size={20} aria-hidden="true" />}
              </button>
            </div>

            {sidebarOpen ? (
              <>
                <div className="rail-actions">
                  <button type="button" className="btn btn-secondary rail-add" onClick={addBlankPage}>
                    <Plus size={18} aria-hidden="true" />
                    <span>Blank page</span>
                  </button>
                  <div className="rail-icon-row">
                    <button type="button" className="btn-icon" onClick={() => reorderPage(-1)} disabled={page === 1} aria-label="Move page up" title="Move up">
                      <CaretUp size={20} aria-hidden="true" />
                    </button>
                    <button type="button" className="btn-icon" onClick={() => reorderPage(1)} disabled={page === pages} aria-label="Move page down" title="Move down">
                      <CaretDown size={20} aria-hidden="true" />
                    </button>
                    <button type="button" className="btn-icon is-danger" onClick={() => deletePage()} disabled={pageOrder.length <= 1} aria-label="Delete page" title="Delete page">
                      <Trash size={20} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="rail-list">
                  {pageOrder.map((item, idx) => (
                    <PageThumbnail key={item.id} pdf={pdf} sourcePage={item.sourcePage} pageNumber={idx + 1} background={item.background} active={page === idx + 1} onClick={() => setPage(idx + 1)} />
                  ))}
                </div>
              </>
            ) : (
              <div className="rail-compact">
                {pageOrder.map((item, idx) => (
                  <button key={item.id} type="button" className={`page-chip ${page === idx + 1 ? "is-active" : ""}`} onClick={() => setPage(idx + 1)} aria-label={`Go to page ${idx + 1}`} aria-current={page === idx + 1 ? "page" : undefined}>
                    {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* ─── Workspace ──────────────────────────────────────────────── */}
          <section className="viewer-workspace">

            <div className="zoom-anchor menu-anchor">
              <button type="button" className={`zoom-chip ${zoomMenuOpen ? "is-active" : ""}`} aria-haspopup="menu" aria-expanded={zoomMenuOpen}
                aria-label={`Zoom ${Math.round(zoom * 100)} percent. Open zoom options`} onClick={() => { setZoomMenuOpen(v => !v); setActiveDropdown(null); setMoreOpen(false); }}>
                <MagnifyingGlass size={18} aria-hidden="true" />
                <span>{Math.round(zoom * 100)}%</span>
              </button>
              {zoomMenuOpen && (
                <div className="float-menu zoom-menu" role="menu" aria-label="Zoom">
                  <div className="zoom-stepper">
                    <button type="button" className="btn-icon" aria-label="Zoom out" onClick={() => setZoomLevel(zoom - 0.25)}><MagnifyingGlassMinus size={20} aria-hidden="true" /></button>
                    <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
                    <button type="button" className="btn-icon" aria-label="Zoom in" onClick={() => setZoomLevel(zoom + 0.25)}><MagnifyingGlassPlus size={20} aria-hidden="true" /></button>
                  </div>
                  <MenuItem icon={<ArrowsIn size={20} aria-hidden="true" />} label="Fit to screen" onClick={() => { resetView(); setZoomMenuOpen(false); }} />
                </div>
              )}
            </div>

            {/* Stage: every pointer passes through the capture handlers first,
                which decide whether it draws, pans, zooms, or is rejected. */}
            <div
              className="stage"
              ref={stage}
              onPointerDownCapture={onStagePointerDown}
              onPointerMoveCapture={onStagePointerMove}
              onPointerUpCapture={onStagePointerEnd}
              onPointerCancelCapture={onStagePointerEnd}
              onContextMenu={e => e.preventDefault()}
              onWheel={e => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  setZoomLevel(zoomRef.current + (e.deltaY > 0 ? -0.1 : 0.1));
                }
              }}
            >
              <div
                className="page-frame"
                ref={frame}
                style={{
                  transform: zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` : undefined,
                  transformOrigin: "center center",
                  transition: (isPanning || gesturing) ? "none" : "transform 0.12s cubic-bezier(0.2, 0, 0, 1)",
                }}
              >
                <div
                  ref={pageEl}
                  className={`page ${smoothTransition ? "page-smooth" : ""}`}
                  style={{ cursor: laserPointer ? "crosshair" : undefined }}
                >
                  <canvas ref={canvas} />
                  {gridType !== "none" && (
                    <svg
                      className={`grid-overlay grid-${gridType}`}
                      viewBox="0 0 1000 1000"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                    >
                      {gridType === "dots" && (
                        <defs>
                          <pattern id="dot-grid" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
                            <circle cx="0" cy="0" r="2.5" fill="rgba(255,255,255,0.25)" />
                          </pattern>
                        </defs>
                      )}
                      {gridType === "lines" && (
                        <defs>
                          <pattern id="line-grid" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
                            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" />
                          </pattern>
                        </defs>
                      )}
                      <rect
                        width="1000" height="1000"
                        fill={gridType === "dots" ? "url(#dot-grid)" : "url(#line-grid)"}
                      />
                    </svg>
                  )}
                  <svg
                    ref={overlay}
                    className="drawing-overlay"
                    viewBox="-300 -300 1600 1600"
                    preserveAspectRatio="none"
                    style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleCanvasDrop}
                    onPointerDown={onOverlayPointerDown}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerEnd}
                    onPointerCancel={onOverlayPointerEnd}
                    onPointerLeave={onOverlayPointerLeave}
                  >
                    <defs>
                      <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L8,3 Z" fill="context-stroke" />
                      </marker>
                    </defs>

                    {/* Shapes are hidden when hideAnnotations is on */}
                    {!hideAnnotations && visible.map(annotation => (
                      <AnnotationShape
                        key={annotation.id}
                        annotation={annotation}
                        selected={selectedId === annotation.id}
                        isDrawingTool={!["select", "pan"].includes(tool)}
                        viewportScale={viewportScale}
                        onPointerDown={(e, a) => {
                          if (tool === "select") {
                            // Double-tap / double-click on text → edit immediately
                            const native = e as unknown as { detail?: number };
                            if (native.detail === 2 && a.type === "text") {
                              e.stopPropagation();
                              setSelectedId(a.id);
                              setEditingId(a.id);
                              setTextValue(a.content ?? "");
                              setFontFamily(a.style.fontFamily || "Inter, system-ui, sans-serif");
                              setFontSize(a.style.fontSize || 32);
                              setTextPoints([{ x: a.x, y: a.y }, { x: a.x + a.width, y: a.y + a.height }]);
                              return;
                            }
                            startTransform(e, "body", a);
                          }
                        }}
                      />
                    ))}

                    {selectedAnnotation && (
                      <TransformBoundingBox annotation={selectedAnnotation} onStartTransform={startTransform} />
                    )}

                    {draft && draft.length >= 2 && (() => {
                      const isDrawing = drawingTypes.includes(tool as AnnotationType);
                      const isLine    = tool === "line" || tool === "arrow";

                      // ── Freehand stroke preview ──
                      if (isDrawing) {
                        return (
                          <path
                            d={pointsToSmoothPath(draft)}
                            stroke={color}
                            strokeWidth={tool === "highlighter" ? Math.max(width, 14) : width}
                            fill="none"
                            opacity={tool === "highlighter" ? Math.min(opacity, 0.45) : opacity}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              ...(tool === "highlighter" ? { mixBlendMode: "multiply" as const } : {}),
                              stroke: color,
                            }}
                            className="draft-path"
                            pointerEvents="none"
                          />
                        );
                      }

                      // ── Shape / line / text ghost preview ──
                      const draftBounds = bounds(draft);
                      // Don't render a ghost until the user has dragged at least a little
                      if (draftBounds.width < 0.005 && draftBounds.height < 0.005) return null;

                      // Scale to SVG coordinate space (0-1000)
                      const gx = draftBounds.x * 1000;
                      const gy = draftBounds.y * 1000;
                      const gw = draftBounds.width * 1000;
                      const gh = draftBounds.height * 1000;

                      // For lines/arrows draw a live endpoint-to-endpoint preview
                      if (isLine) {
                        const p0 = draft[0];
                        const pN = draft[draft.length - 1];
                        return (
                          <g pointerEvents="none">
                            <line
                              x1={p0.x * 1000} y1={p0.y * 1000}
                              x2={pN.x * 1000} y2={pN.y * 1000}
                              stroke={color}
                              strokeWidth={Math.max(2, width)}
                              strokeDasharray="8 5"
                              strokeLinecap="round"
                              opacity={0.65}
                            />
                            {/* Arrow head hint */}
                            {tool === "arrow" && (
                              <circle
                                cx={pN.x * 1000} cy={pN.y * 1000}
                                r={6} fill={color} opacity={0.65}
                              />
                            )}
                          </g>
                        );
                      }

                      // Shape ghost
                      const d = ghostShapeD(tool, gx, gy, gw, gh);
                      return (
                        <g pointerEvents="none">
                          {/* Faint filled area */}
                          <path
                            d={d}
                            fill={color}
                            opacity={0.07}
                          />
                          {/* Dotted outline */}
                          <path
                            d={d}
                            fill="none"
                            stroke={color}
                            strokeWidth={Math.max(2, width)}
                            strokeDasharray="7 4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={0.7}
                          />
                          {/* Corner size hint - shows W × H in small text */}
                          <text
                            x={gx + gw + 6}
                            y={gy - 6}
                            fill={color}
                            fontSize={Math.max(18, Math.min(28, gw * 0.08))}
                            fontWeight="bold"
                            fontFamily="Inter, system-ui, sans-serif"
                            opacity={0.75}
                          >
                            {Math.round(draftBounds.width * 100)}×{Math.round(draftBounds.height * 100)}
                          </text>
                        </g>
                      );
                    })()}

                    {eraserPos && tool.includes("eraser") && (
                      <circle cx={eraserPos.x * 1000} cy={eraserPos.y * 1000} r={eraserSize} fill="rgba(239,68,68,0.18)" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 3" pointerEvents="none" />
                    )}

                    {/* Laser pointer dot - shown when laserPointer mode is on */}
                    {laserPointer && eraserPos && !tool.includes("eraser") && (
                      <g pointerEvents="none">
                        <circle cx={eraserPos.x * 1000} cy={eraserPos.y * 1000} r={12} fill="rgba(239,68,68,0.25)" />
                        <circle cx={eraserPos.x * 1000} cy={eraserPos.y * 1000} r={6} fill="#ef4444" />
                        <circle cx={eraserPos.x * 1000} cy={eraserPos.y * 1000} r={3} fill="#ffffff" />
                      </g>
                    )}
                  </svg>
                </div>
              </div>
            </div>

            {/* Page pill: bottom-right, separate from the centred dock */}
            {!presenting && (
              <div className="page-pill" role="group" aria-label="Page navigation">
                <button type="button" className="btn-icon" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(v => v - 1)}>
                  <CaretLeft size={20} aria-hidden="true" />
                </button>
                <span className="page-pill-count" aria-live="polite">{page} / {pages}</span>
                <button type="button" className="btn-icon" aria-label="Next page" disabled={page === pages} onClick={() => setPage(v => v + 1)}>
                  <CaretRight size={20} aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Presenting: a quiet control strip that stays out of the slide */}
            {presenting && (
              <div className={`present-bar${barAwake ? "" : " is-idle"}`} role="group" aria-label="Presentation controls">
                <button type="button" className="btn-icon" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(v => v - 1)}>
                  <CaretLeft size={22} aria-hidden="true" />
                </button>
                <span className="page-pill-count" aria-live="polite">{page} / {pages}</span>
                <button type="button" className="btn-icon" aria-label="Next page" disabled={page === pages} onClick={() => setPage(v => v + 1)}>
                  <CaretRight size={22} aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setPresenting(false)}>
                  <Stop size={18} weight="fill" aria-hidden="true" /> Exit
                </button>
              </div>
            )}

            {/* ─── Style panel: contextual options above the dock ────────── */}
            {showStylePanel && (
              <div className="style-panel" role="region" aria-label="Tool options">
                {hasSelectionPanel && selectedAnnotation && (
                  <div className="style-group">
                    <div className="style-head">
                      <span className="style-kicker">Selected {selectedAnnotation.type.replace(/-/g, " ")}</span>
                    </div>
                    <div className="style-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={editSelected} disabled={selectedAnnotation.type !== "text"}>
                        <PencilSimple size={18} aria-hidden="true" /> Edit text
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={duplicateSelected}>
                        <Copy size={18} aria-hidden="true" /> Duplicate
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => { deleteAnnotation(selectedAnnotation.id); setSelectedId(undefined); setPropertiesOpen(false); }}>
                        <Trash size={18} aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </div>
                )}

                {tool.includes("eraser") && (
                  <div className="style-group">
                    <div className="style-head">
                      <span className="style-kicker">Eraser size</span>
                      <span className="style-value">{eraserSize}px</span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Eraser size">
                      {[
                        { sz: 8, label: "Fine" }, { sz: 16, label: "Small" }, { sz: 30, label: "Medium" }, { sz: 50, label: "Large" }, { sz: 80, label: "XL" },
                      ].map(({ sz, label }) => (
                        <button key={sz} type="button" role="radio" aria-checked={eraserSize === sz} className={`seg-btn ${eraserSize === sz ? "is-active" : ""}`} onClick={() => setEraserSize(sz)}>{label}</button>
                      ))}
                    </div>
                    <input className="range" type="range" min="5" max="100" value={eraserSize} onChange={e => setEraserSize(+e.target.value)} aria-label="Eraser size slider" />
                    <div className="style-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={clearDrawingsOnPage}>Clear ink</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={clearShapesOnPage}>Clear shapes</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => showConfirm("Clear every annotation on this page? This cannot be undone.", () => { clearAllOnPage(); setConfirmState(null); })}>Clear page</button>
                    </div>
                  </div>
                )}

                {(tool === "text" || selectedAnnotation?.type === "text") && (
                  <div className="style-group">
                    <label className="style-field">
                      <span className="style-kicker">Font</span>
                      <select className="select" value={selectedAnnotation?.style.fontFamily ?? fontFamily} onChange={e => { const v = e.target.value; setFontFamily(v); if (selectedAnnotation) updateSelected({ style: { fontFamily: v } }); }}>
                        {fontFamilies.map(f => <option key={f.val} value={f.val}>{f.label}</option>)}
                      </select>
                    </label>
                    <div className="style-head">
                      <span className="style-kicker">Text size</span>
                      <span className="style-value">{fontSizeValue}px</span>
                    </div>
                    <input className="range" type="range" min="12" max="160" step="2" value={fontSizeValue} aria-label="Text size"
                      onChange={e => {
                        const v = +e.target.value;
                        setFontSize(v);
                        if (selectedAnnotation) updateSelected({ height: Math.max(selectedAnnotation.height, (v * 1.5) / 1000), style: { fontSize: v } });
                      }} />
                  </div>
                )}

                <div className="style-group">
                  <span className="style-kicker">Colour</span>
                  <div className="swatch-row">
                    {strokeColors.map(c => (
                      <button key={c} type="button" className={`swatch ${strokeColor === c ? "is-active" : ""} ${c === "#ffffff" ? "is-light" : ""}`}
                        style={{ backgroundColor: c }} aria-label={`Colour ${c}`} aria-pressed={strokeColor === c} title={c}
                        onClick={() => { setColor(c); if (selectedAnnotation) updateSelected({ style: { color: c } }); }} />
                    ))}
                    <label className="swatch swatch-custom" title="Custom colour">
                      <span className="sr-only">Custom colour</span>
                      <input type="color" value={strokeColor} aria-label="Custom stroke colour"
                        onChange={e => { setColor(e.target.value); if (selectedAnnotation) updateSelected({ style: { color: e.target.value } }); }} />
                    </label>
                  </div>
                </div>

                {!tool.includes("eraser") && tool !== "text" && (
                  <div className="style-group">
                    <div className="style-head">
                      <span className="style-kicker">Thickness</span>
                      <span className="style-value">{strokeWidthValue}px</span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Thickness presets">
                      {strokeWidthPresets.map(sp => (
                        <button key={sp.val} type="button" role="radio" aria-checked={strokeWidthValue === sp.val} className={`seg-btn ${strokeWidthValue === sp.val ? "is-active" : ""}`}
                          onClick={() => { setWidth(sp.val); if (selectedAnnotation) updateSelected({ style: { strokeWidth: sp.val } }); }}>{sp.label}</button>
                      ))}
                    </div>
                    <input className="range" type="range" min="1" max="48" value={strokeWidthValue} aria-label="Stroke width"
                      onChange={e => { const v = +e.target.value; setWidth(v); if (selectedAnnotation) updateSelected({ style: { strokeWidth: v } }); }} />
                    <div className="style-head">
                      <span className="style-kicker">Opacity</span>
                      <span className="style-value">{Math.round(opacityValue * 100)}%</span>
                    </div>
                    <input className="range" type="range" min="0.1" max="1" step="0.05" value={opacityValue} aria-label="Opacity"
                      onChange={e => { const v = +e.target.value; setOpacity(v); if (selectedAnnotation) updateSelected({ style: { opacity: v } }); }} />
                  </div>
                )}

                {selectedAnnotation && (
                  <div className="style-group">
                    <div className="style-head">
                      <span className="style-kicker">Scale</span>
                      <span className="style-value">{size}%</span>
                    </div>
                    <input className="range" type="range" min="25" max="200" value={size} aria-label="Scale selected object" onChange={e => resizeSelected(+e.target.value)} />
                  </div>
                )}

                {currentPage && (
                  <div className="style-group style-row">
                    <span className="style-kicker">Page background</span>
                    <label className="swatch swatch-custom" title="Page background">
                      <span className="sr-only">Page background colour</span>
                      <input type="color" value={currentPage.background || "#1e293b"} aria-label="Slide background colour" onChange={e => changePageBackground(e.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* ─── Dropdowns anchored above their dock buttons ────────────── */}

            {/* ─── Floating dock ──────────────────────────────────────────── */}
            <div
              className={`dock-wrap ${dockPos ? "is-free" : ""}`}
              ref={dockRef}
              style={dockPos ? { left: dockPos.x, top: dockPos.y, bottom: "auto", transform: "none" } : undefined}
            >
              {dockCollapsed ? (
                <button type="button" className="dock-pill" onClick={() => setDockCollapsed(false)} aria-label="Show drawing tools">
                  <CaretUp size={18} aria-hidden="true" />
                  <span>Tools</span>
                </button>
              ) : (
                <div className="dock" role="toolbar" aria-label="Drawing tools">
                  <button
                    type="button"
                    className="dock-grip"
                    aria-label="Drag to move toolbar. Double tap to reset."
                    title="Drag to move. Double tap to reset."
                    onPointerDown={e => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const rect = dockRef.current?.getBoundingClientRect();
                      dockDragRef.current = {
                        startX: e.clientX,
                        startY: e.clientY,
                        originX: rect?.left ?? e.clientX - 200,
                        originY: rect?.top ?? e.clientY - 32,
                        dragging: true,
                      };
                    }}
                    onDoubleClick={resetDockPosition}
                  >
                    <span /><span />
                  </button>

                  <div className="dock-scroll">
                    <DockButton icon={<Cursor size={22} aria-hidden="true" />} label="Select" active={tool === "select"}
                      onClick={() => { setTool("select"); setActiveDropdown(null); setPropertiesOpen(!!selectedAnnotation); }} />
                    <DockButton icon={<HandGrabbing size={22} aria-hidden="true" />} label="Pan" active={tool === "pan"}
                      onClick={() => { setTool("pan"); setActiveDropdown(null); setPropertiesOpen(false); }} />

                    <span className="dock-divider" aria-hidden="true" />

                    <div className="dock-anchor">
                      <DockButton icon={penIcon} label={penLabel} active={drawingTypes.includes(tool as AnnotationType)} expanded={activeDropdown === "pen"}
                        onClick={() => {
                          if (!drawingTypes.includes(tool as AnnotationType)) { setTool("ink"); setOpacity(1.0); if (width > 8) setWidth(3); }
                          setActiveDropdown(activeDropdown === "pen" ? null : "pen");
                          setPropertiesOpen(true);
                        }} />
                      {activeDropdown === "pen" && (
                        <div className="float-menu dock-menu" role="menu" aria-label="Pen types">
                          <MenuItem icon={<PencilSimple size={20} aria-hidden="true" />} label="Pen" active={tool === "ink"} onClick={() => { setTool("ink"); setOpacity(1.0); if (width > 8) setWidth(3); setActiveDropdown(null); setPropertiesOpen(true); }} />
                          <MenuItem icon={<PenNib size={20} aria-hidden="true" />} label="Brush" active={tool === "calligraphy"} onClick={() => { setTool("calligraphy"); setOpacity(1.0); if (width > 8) setWidth(3); setActiveDropdown(null); setPropertiesOpen(true); }} />
                          <MenuItem icon={<Highlighter size={20} aria-hidden="true" />} label="Highlighter" active={tool === "highlighter"} onClick={() => { setTool("highlighter"); setOpacity(0.45); if (width < 8) setWidth(14); setActiveDropdown(null); setPropertiesOpen(true); }} />
                        </div>
                      )}
                    </div>

                    <div className="dock-anchor">
                      <DockButton icon={<Eraser size={22} aria-hidden="true" />} label="Erase" active={tool.includes("eraser")} expanded={activeDropdown === "eraser"}
                        onClick={() => {
                          if (!tool.includes("eraser")) setTool("partial-eraser");
                          setActiveDropdown(activeDropdown === "eraser" ? null : "eraser");
                          setPropertiesOpen(true);
                        }} />
                      {activeDropdown === "eraser" && (
                        <div className="float-menu dock-menu" role="menu" aria-label="Eraser types">
                          <MenuItem icon={<Eraser size={20} aria-hidden="true" />} label="Pixel" active={tool === "partial-eraser"} onClick={() => { setTool("partial-eraser"); setActiveDropdown(null); setPropertiesOpen(true); }} />
                          <MenuItem icon={<Scissors size={20} aria-hidden="true" />} label="Whole stroke" active={tool === "stroke-eraser"} onClick={() => { setTool("stroke-eraser"); setActiveDropdown(null); setPropertiesOpen(true); }} />
                        </div>
                      )}
                    </div>

                    <div className="dock-anchor">
                      <DockButton icon={<Shapes size={22} aria-hidden="true" />} label="Shapes" active={shapeToolActive} expanded={shapesPanelOpen}
                        onClick={() => setShapesPanelOpen(v => !v)} />
                    </div>

                    <DockButton icon={<TextT size={22} aria-hidden="true" />} label="Text" active={tool === "text"}
                      onClick={() => { setTool("text"); setActiveDropdown(null); setPropertiesOpen(true); }} />

                    <DockButton icon={<ImageIcon size={22} aria-hidden="true" />} label="Image" active={tool === "image"}
                      onClick={() => { setTool("image"); setActiveDropdown(null); imageInputRef.current?.click(); }} />

                    <span className="dock-divider" aria-hidden="true" />

                    <DockButton icon={<CaretDoubleDown size={22} aria-hidden="true" />} label="Hide" title="Hide drawing tools"
                      onClick={() => { setDockCollapsed(true); setActiveDropdown(null); setPropertiesOpen(false); }} />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="viewer-empty">
          <div className="empty-state">
            <span className="icon-badge icon-badge-lg" aria-hidden="true"><Presentation size={26} /></span>
            <h1>Open a lesson or start a presentation</h1>
            <p>Draw, annotate, and present PDFs and slides. Your work saves to your account when you are signed in.</p>
            <div className="viewer-empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => initBlankDocument("New 16:9 Presentation")}>
                <Plus size={18} aria-hidden="true" /> Start 16:9 presentation
              </button>
              <label className="btn btn-secondary">
                <FilePdf size={18} aria-hidden="true" /> Choose a PDF
                <input type="file" hidden accept=".pdf,application/pdf" onChange={e => e.target.files?.[0] && open(e.target.files[0]).catch(err => setStatus(err.message))} />
              </label>
            </div>
          </div>
        </section>
      )}

      {/* ─── Shapes and graph panel: floating, draggable ─────────────────── */}
      {shapesPanelOpen && (
        <div
          ref={shapesPanelRef}
          className="shapes-panel"
          style={shapesPanelPos ? { left: shapesPanelPos.x, top: shapesPanelPos.y, right: "auto", bottom: "auto" } : undefined}
          role="dialog"
          aria-label="Shapes and graph"
        >
          <div
            className="shapes-panel-head"
            onPointerDown={e => {
              if ((e.target as HTMLElement).closest("button")) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = shapesPanelRef.current?.getBoundingClientRect();
              shapesPanelDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                originX: rect?.left ?? 80,
                originY: rect?.top ?? 80,
                dragging: true,
              };
            }}
          >
            <span className="shapes-panel-title"><Shapes size={18} aria-hidden="true" /> Shapes and graph</span>
            <button type="button" className="btn-icon" onClick={() => setShapesPanelOpen(false)} aria-label="Close shapes panel">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="shapes-panel-body">
            {SHAPE_SECTIONS.map(section => (
              <div key={section.label} className="shapes-section">
                <span className="shapes-section-label">{section.label}</span>
                <div className="shapes-grid">
                  {section.items.map(item => (
                    <button
                      key={item.tool}
                      type="button"
                      className={`shape-btn ${tool === item.tool ? "is-active" : ""}`}
                      title={item.label}
                      aria-label={item.label}
                      aria-pressed={tool === item.tool}
                      onClick={() => { setTool(item.tool as AnnotationType); setPropertiesOpen(true); }}
                    >
                      <span className="shape-btn-icon" aria-hidden="true">{item.icon}</span>
                      <span className="shape-btn-label">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Text dialog ────────────────────────────────────────────────── */}
      {textPoints && (
        <div className="dialog-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setTextPoints(null); }}>
          <form
            className="dialog-card sheet-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="text-dialog-title"
            onSubmit={e => { e.preventDefault(); submitText(); }}
          >
            <h2 id="text-dialog-title">{editingId ? "Edit text" : "Add text"}</h2>
            {/* Live preview with current style — scales responsively like on-canvas text */}
            {textValue.trim() && (
              <div
                className="card"
                style={{
                  padding: "0.75rem 0.875rem",
                  background: "var(--surface-raised, #f8fafc)",
                  border: "1px dashed var(--border, #e2e8f0)",
                  fontFamily,
                  fontSize: `${Math.max(14, Math.min(28, (fontSize * (viewportScale ?? 1) * 0.35)))}px`,
                  fontWeight: 700,
                  color,
                  opacity,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  minHeight: "2.2rem",
                }}
                aria-hidden="true"
              >
                {textValue}
              </div>
            )}
            <label className="field">
              Text (Enter for new line)
              <textarea
                className="input"
                autoFocus
                rows={3}
                value={textValue}
                onChange={e => setTextValue(e.target.value)}
                placeholder="Type your text — supports multiple lines"
                style={{ resize: "vertical", minHeight: "72px", fontFamily }}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (textValue.trim()) submitText();
                  }
                }}
              />
              <span className="helper" style={{ fontSize: "0.75rem" }}>Press Ctrl+Enter to save. Drag on canvas to set box size; tap for auto-size.</span>
            </label>
            <label className="field">
              Font
              <select className="select" value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
                {fontFamilies.map(f => <option key={f.val} value={f.val}>{f.label}</option>)}
              </select>
            </label>
            <div className="field">
              <span>Size ({fontSize}px)</span>
              <div className="segmented segmented-wrap" role="radiogroup" aria-label="Font size">
                {fontSizePresets.map(fs => (
                  <button key={fs} type="button" role="radio" aria-checked={fontSize === fs} className={`seg-btn ${fontSize === fs ? "is-active" : ""}`} onClick={() => setFontSize(fs)}>{fs}</button>
                ))}
              </div>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setTextPoints(null)}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={!textValue.trim()}>{editingId ? "Save" : "Add text"}</button>
            </div>
          </form>
        </div>
      )}

      {/* ─── Settings sheet ─────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="dialog-backdrop sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="settings-title">Settings</h2>
              <button type="button" className="btn-icon" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="sheet-tabs" role="tablist" aria-label="Settings sections">
              {([["canvas", "Canvas"], ["tools", "Tools"], ["document", "Document"], ["view", "View"]] as const).map(([tab, label]) => (
                <button key={tab} type="button" role="tab" id={`tab-${tab}`} aria-selected={settingsTab === tab} aria-controls="settings-panel"
                  className={`sheet-tab ${settingsTab === tab ? "is-active" : ""}`} onClick={() => setSettingsTab(tab)}>
                  {label}
                </button>
              ))}
            </div>

            <div className="sheet-body" id="settings-panel" role="tabpanel" aria-labelledby={`tab-${settingsTab}`}>

              {settingsTab === "canvas" && (
                <>
                  <section className="sheet-section">
                    <h3>Slide background</h3>
                    <div className="swatch-row">
                      {[
                        { label: "Dark slate", color: "#1e293b" },
                        { label: "White", color: "#ffffff" },
                        { label: "Deep blue", color: "#1e3a8a" },
                        { label: "Board green", color: "#14532d" },
                        { label: "Midnight", color: "#0f172a" },
                        { label: "Warm cream", color: "#fdf6e3" },
                        { label: "Soft grey", color: "#f1f5f9" },
                        { label: "Deep purple", color: "#3b0764" },
                      ].map(bg => (
                        <button
                          key={bg.color}
                          type="button"
                          className={`swatch ${bg.color === "#ffffff" || bg.color === "#fdf6e3" || bg.color === "#f1f5f9" ? "is-light" : ""} ${currentPage?.background === bg.color ? "is-active" : ""}`}
                          style={{ backgroundColor: bg.color }}
                          onClick={() => changePageBackground(bg.color)}
                          title={bg.label}
                          aria-label={bg.label}
                          aria-pressed={currentPage?.background === bg.color}
                        />
                      ))}
                      <label className="swatch swatch-custom" title="Custom colour">
                        <span className="sr-only">Custom background colour</span>
                        <input type="color" value={currentPage?.background || "#1e293b"} aria-label="Custom slide background colour" onChange={e => changePageBackground(e.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="sheet-section">
                    <h3>Grid overlay</h3>
                    <div className="segmented" role="radiogroup" aria-label="Grid overlay">
                      {([["none", "Off"], ["dots", "Dots"], ["lines", "Lines"]] as const).map(([g, label]) => (
                        <button key={g} type="button" role="radio" aria-checked={gridType === g} className={`seg-btn ${gridType === g ? "is-active" : ""}`} onClick={() => setGridType(g)}>{label}</button>
                      ))}
                    </div>
                  </section>

                  <section className="sheet-section">
                    <h3>Clear this page</h3>
                    <div className="sheet-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => { clearDrawingsOnPage(); setSettingsOpen(false); }}>Clear ink</button>
                      <button type="button" className="btn btn-secondary" onClick={() => { clearShapesOnPage(); setSettingsOpen(false); }}>Clear shapes</button>
                      <button type="button" className="btn btn-danger" onClick={() => showConfirm("Clear every annotation on this page? This cannot be undone.", () => { clearAllOnPage(); setConfirmState(null); setSettingsOpen(false); })}>Clear all</button>
                    </div>
                  </section>
                </>
              )}

              {settingsTab === "tools" && (
                <>
                  <section className="sheet-section">
                    <h3>Default pen colour</h3>
                    <div className="swatch-row">
                      {["#000000", "#ffffff", "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#7c3aed", "#db2777"].map(c => (
                        <button key={c} type="button" className={`swatch ${c === "#ffffff" ? "is-light" : ""} ${color === c ? "is-active" : ""}`}
                          style={{ backgroundColor: c }} onClick={() => setColor(c)} aria-label={`Set pen colour ${c}`} aria-pressed={color === c} />
                      ))}
                      <label className="swatch swatch-custom" title="Custom colour">
                        <span className="sr-only">Custom pen colour</span>
                        <input type="color" value={color} aria-label="Custom pen colour" onChange={e => setColor(e.target.value)} />
                      </label>
                    </div>
                  </section>

                  <section className="sheet-section">
                    <h3>Default stroke width</h3>
                    <div className="segmented" role="radiogroup" aria-label="Default stroke width">
                      {[2, 4, 6, 10, 16].map(w => (
                        <button key={w} type="button" role="radio" aria-checked={width === w} className={`seg-btn ${width === w ? "is-active" : ""}`} onClick={() => setWidth(w)}>{w}px</button>
                      ))}
                    </div>
                    <div className="sheet-slider">
                      <input className="range" type="range" min="1" max="48" value={width} aria-label="Default stroke width slider" onChange={e => setWidth(+e.target.value)} />
                      <span className="style-value">{width}px</span>
                    </div>
                  </section>

                  <section className="sheet-section">
                    <h3>Default opacity</h3>
                    <div className="sheet-slider">
                      <input className="range" type="range" min="0.1" max="1" step="0.05" value={opacity} aria-label="Default opacity" onChange={e => setOpacity(+e.target.value)} />
                      <span className="style-value">{Math.round(opacity * 100)}%</span>
                    </div>
                  </section>

                  <section className="sheet-section">
                    <h3>Toolbar</h3>
                    <ToggleRow label="Hide tools while drawing" hint="Collapses the toolbar when you use pen or ink" on={autoHideDock} onToggle={() => setAutoHideDock(v => !v)} />
                    <ToggleRow label="Show page list" hint="Thumbnails on the left edge" on={sidebarOpen} onToggle={() => setSidebarOpen(v => !v)} />
                  </section>
                </>
              )}

              {settingsTab === "document" && (
                <>
                  <section className="sheet-section">
                    <h3>Name</h3>
                    {renamingDoc ? (
                      <div className="rename-row">
                        <input
                          className="input"
                          value={renameValue}
                          autoFocus
                          maxLength={80}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && renameValue.trim()) { setDocumentName(renameValue.trim()); setRenamingDoc(false); }
                            if (e.key === "Escape") setRenamingDoc(false);
                          }}
                          aria-label="Presentation name"
                        />
                        <button type="button" className="btn btn-primary" onClick={() => { if (renameValue.trim()) { setDocumentName(renameValue.trim()); setRenamingDoc(false); } }}>Save</button>
                        <button type="button" className="btn btn-secondary" onClick={() => setRenamingDoc(false)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="rename-row">
                        <span className="sheet-doc-name">{documentName}</span>
                        <button type="button" className="btn btn-secondary" onClick={() => { setRenameValue(documentName); setRenamingDoc(true); }}>Rename</button>
                      </div>
                    )}
                  </section>

                  <section className="sheet-section">
                    <h3>Details</h3>
                    <dl className="info-grid">
                      <div><dt>Pages</dt><dd>{pages}</dd></div>
                      <div><dt>Ink strokes</dt><dd>{annotations.filter(a => drawingTypes.includes(a.type as AnnotationType)).length}</dd></div>
                      <div><dt>Shapes and text</dt><dd>{annotations.filter(a => !drawingTypes.includes(a.type as AnnotationType)).length}</dd></div>
                      <div><dt>Total</dt><dd>{annotations.length}</dd></div>
                    </dl>
                  </section>

                  <section className="sheet-section">
                    <h3>Export</h3>
                    <div className="sheet-actions">
                      <button type="button" className="btn btn-primary" onClick={async () => {
                        const blob = await pdfExporter.export(source, annotations, pageOrder);
                        const link = document.createElement("a");
                        link.href = URL.createObjectURL(blob);
                        link.download = `${documentName.replace(/\s+/g, "_")}.pdf`;
                        link.click();
                        setSettingsOpen(false);
                      }}>
                        <Export size={18} aria-hidden="true" /> Export as PDF
                      </button>
                    </div>
                  </section>

                  <section className="sheet-section sheet-danger">
                    <h3>Danger zone</h3>
                    <p className="helper">Removes every annotation on every page. This cannot be undone.</p>
                    <div className="sheet-actions">
                      <button type="button" className="btn btn-danger" onClick={() => {
                        showConfirm("Clear ALL annotations on ALL pages? This cannot be undone.", () => {
                          commit([]);
                          setConfirmState(null);
                          setSettingsOpen(false);
                        });
                      }}>
                        <Trash size={18} aria-hidden="true" /> Clear entire presentation
                      </button>
                    </div>
                  </section>
                </>
              )}

              {settingsTab === "view" && (
                <>
                  <section className="sheet-section">
                    <h3>Zoom</h3>
                    <div className="zoom-stepper zoom-stepper-wide">
                      <button type="button" className="btn btn-secondary" onClick={() => setZoomLevel(zoom - 0.25)} aria-label="Zoom out">
                        <MagnifyingGlassMinus size={18} aria-hidden="true" /> Out
                      </button>
                      <span className="zoom-value">{Math.round(zoom * 100)}%</span>
                      <button type="button" className="btn btn-secondary" onClick={() => setZoomLevel(zoom + 0.25)} aria-label="Zoom in">
                        <MagnifyingGlassPlus size={18} aria-hidden="true" /> In
                      </button>
                    </div>
                    <div className="sheet-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => { resetView(); setSettingsOpen(false); }}>Fit to screen</button>
                      <button type="button" className="btn btn-secondary" onClick={() => { toggleFullscreen(); setSettingsOpen(false); }}>
                        {isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      </button>
                    </div>
                  </section>

                  <section className="sheet-section">
                    <h3>Display</h3>
                    <ToggleRow label="Hide all annotations" hint="Show slides only" on={hideAnnotations} onToggle={() => setHideAnnotations(v => !v)} />
                    <ToggleRow label="Laser pointer" hint="Show a red dot where the pen is" on={laserPointer} onToggle={() => setLaserPointer(v => !v)} />
                    <ToggleRow label="Smooth page transitions" hint="Fade between pages" on={smoothTransition} onToggle={() => setSmoothTransition(v => !v)} />
                  </section>

                  <section className="sheet-section">
                    <h3>Presentation</h3>
                    <div className="sheet-actions">
                      <button type="button" className="btn btn-primary" onClick={() => { setPresenting(v => !v); setSettingsOpen(false); }}>
                        {presenting ? <Stop size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
                        {presenting ? "Exit presentation" : "Start presenting"}
                      </button>
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </main>
  );
}
