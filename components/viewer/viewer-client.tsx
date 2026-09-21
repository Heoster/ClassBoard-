"use client";

import { useEffect, useRef, useState, type PointerEvent, type DragEvent } from "react";
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
    <button className={`page-thumb ${active ? "active" : ""}`} onClick={onClick} aria-label={`Go to page ${pageNumber}`}>
      <canvas ref={thumbnail} />
      <span className="page-thumb-num">Page {pageNumber}</span>
    </button>
  );
}

// ─── Inline confirm dialog (replaces window.confirm) ──────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-msg">
      <div className="confirm-card">
        <p id="confirm-msg">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger-confirm" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
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
  const [fontSize, setFontSize] = useState(32);
  const [opacity, setOpacity] = useState(1.0);
  const [width, setWidth] = useState(3);
  const [size, setSize] = useState(100);
  const [presenting, setPresenting] = useState(false);
  const [status, setStatusRaw] = useState("Cloud sync ready");
  const [statusDismissed, setStatusDismissed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [textPoints, setTextPoints] = useState<Point[] | null>(null);
  const [textValue, setTextValue] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [showPageCounter, setShowPageCounter] = useState(true);
  const pageCounterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [eraserSize, setEraserSize] = useState(24);
  const [isErasing, setIsErasing] = useState(false);
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

  const triggerPageCounter = () => {
    setShowPageCounter(true);
    if (pageCounterTimer.current) clearTimeout(pageCounterTimer.current);
    pageCounterTimer.current = setTimeout(() => setShowPageCounter(false), 2000);
  };

  useEffect(() => {
    triggerPageCounter();
    return () => { if (pageCounterTimer.current) clearTimeout(pageCounterTimer.current); };
  }, [page]);

  // Close dropdowns on Escape — FIX #17
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

  // Close dropdowns when clicking outside — FIX #17
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

  const setStatus = (msg: string) => { setStatusRaw(msg); setStatusDismissed(false); };

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  const pinchRef = useRef<{ dist: number; zoom: number; pan: { x: number; y: number }; mid: { x: number; y: number } } | null>(null);
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

  // ─── Pinch-to-zoom ──────────────────────────────────────────────────────────
  const pinchHandlersRef = useRef<{ onTouchStart: (e: TouchEvent) => void; onTouchMove: (e: TouchEvent) => void; onTouchEnd: (e: TouchEvent) => void } | null>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const getTouchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const getTouchMid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchRef.current = { dist: getTouchDist(e.touches), zoom: zoomRef.current, pan: { ...panRef.current }, mid: getTouchMid(e.touches) };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const scale = getTouchDist(e.touches) / pinchRef.current.dist;
        const newZoom = Math.max(0.25, Math.min(4.0, +(pinchRef.current.zoom * scale).toFixed(3)));
        const newMid = getTouchMid(e.touches);
        const dx = newMid.x - pinchRef.current.mid.x;
        const dy = newMid.y - pinchRef.current.mid.y;
        const zoomDelta = newZoom - pinchRef.current.zoom;
        const rect = el.getBoundingClientRect();
        const focalX = pinchRef.current.mid.x - rect.left - rect.width / 2;
        const focalY = pinchRef.current.mid.y - rect.top - rect.height / 2;
        setZoom(newZoom);
        setPan({ x: pinchRef.current.pan.x + dx - focalX * zoomDelta, y: pinchRef.current.pan.y + dy - focalY * zoomDelta });
      }
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinchRef.current = null; };

    pinchHandlersRef.current = { onTouchStart, onTouchMove, onTouchEnd };
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      pinchHandlersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const svg = overlay.current;
    const h = pinchHandlersRef.current;
    if (!svg || !h) return;
    svg.addEventListener("touchstart", h.onTouchStart, { passive: false });
    svg.addEventListener("touchmove", h.onTouchMove, { passive: false });
    svg.addEventListener("touchend", h.onTouchEnd, { passive: true });
    svg.addEventListener("touchcancel", h.onTouchEnd, { passive: true });
    return () => {
      svg.removeEventListener("touchstart", h.onTouchStart);
      svg.removeEventListener("touchmove", h.onTouchMove);
      svg.removeEventListener("touchend", h.onTouchEnd);
      svg.removeEventListener("touchcancel", h.onTouchEnd);
    };
  }, [pageOrder]);

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

  // ─── Draggable dock — pointer/touch handlers ─────────────────────────────
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
      setStatus("Supabase is not configured — viewing locally.");
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

  // FIX #1: text tool now opens dialog when user draws/taps
  const finish = (e: PointerEvent) => {
    if (!draft || !overlay.current || tool === "select" || tool === "pan" || tool.includes("eraser")) return;
    const points = [...draft, point(e)];
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

    if (isClick && !drawingTypes.includes(tool as AnnotationType)) {
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

    // Shapes are always outline-only (fill: "none") — no fill colour applied
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
    setSelectedId(annotation.id);
    setPropertiesOpen(true);
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

  const endTransform = () => { if (transforming) { setTransforming(null); void saveCloud(annotationsRef.current).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed")); } };

  const isErrorStatus = status.toLowerCase().includes("failed") || status.toLowerCase().includes("unavailable") || status.toLowerCase().includes("error");

  return (
    <main className={presenting ? "viewer presenting" : "viewer"}>
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

      {/* ─── TOP HEADER — FIX #23: clear visual grouping ────────────────── */}
      <header className="viewer-header" onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
        {/* Brand group */}
        <a href="/dashboard" className="viewer-brand">← MAPLES <span>ACADEMY</span></a>

        {/* Title + status — FIX #11: constrained width, won't overflow into Present btn */}
        <div className="document-title">
          <strong title={documentName}>{documentName}</strong>
          {status && !statusDismissed && (
            <small className={`status-badge ${isErrorStatus ? "has-error" : ""}`}>
              <span>{status}</span>
              <button type="button" className="status-dismiss" onClick={() => setStatusDismissed(true)} title="Dismiss message" aria-label="Dismiss status message">✕</button>
            </small>
          )}
        </div>

        {/* File actions group */}
        <div className="header-file-actions">
          <button
            type="button"
            className="header-action-btn header-export-btn"
            title="Export presentation as PDF"
            onClick={async () => {
              try {
                const blob = await pdfExporter.export(source, annotations, pageOrder);
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `${documentName.replace(/\s+/g, "_")}.pdf`;
                link.click();
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "Export failed");
              }
            }}
          >
            📥 Export PDF
          </button>
        </div>

        {/* Undo / Redo in header for quick access */}
        <div className="header-undo-redo">
          <button type="button" title="Undo (Ctrl+Z)" disabled={!history.length}
            onClick={() => {
              if (history.length) {
                const previous = history.at(-1)!;
                setFuture(c => [annotations, ...c]);
                setAnnotations(previous);
                setHistory(c => c.slice(0, -1));
                void saveCloud(previous).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
              }
            }}>↶</button>
          <button type="button" title="Redo (Ctrl+Y)" disabled={!future.length}
            onClick={() => {
              if (future.length) {
                const next = future[0];
                setHistory(c => [...c, annotations]);
                setAnnotations(next);
                setFuture(c => c.slice(1));
                void saveCloud(next).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
              }
            }}>↷</button>
        </div>

        {/* Present button group */}
        <div className="header-present-actions">
          <button type="button" className="present-btn" onClick={() => setPresenting(v => !v)}>
            {presenting ? "⏹ Exit Present" : "▶ Present"}
          </button>
        </div>
      </header>

      {/* ─── LOADING STATE — FIX #12 ─────────────────────────────────────── */}
      {isLoading && (
        <div className="viewer-loading-overlay" aria-live="polite" aria-label="Loading document">
          <div className="viewer-loading-spinner" />
          <span>Loading document…</span>
        </div>
      )}

      {(pdf || pageOrder.length > 0) ? (
        /* FIX #21 + #8: sidebar width unified, canvas fills properly */
        <div className={`viewer-body ${sidebarOpen ? "" : "sidebar-collapsed"}`}>

          {/* ─── SIDEBAR — FIX #5: collapsed state doesn't leak ──────────── */}
          <aside className={`page-sidebar ${sidebarOpen ? "" : "sidebar-collapsed"}`} aria-label="Page thumbnails">
            <button
              className="sidebar-toggle"
              aria-label={sidebarOpen ? "Collapse page thumbnails" : "Expand page thumbnails"}
              onClick={() => setSidebarOpen(v => !v)}
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>

            {sidebarOpen ? (
              <>
                <strong>Pages</strong>
                <div className="page-sidebar-actions">
                  <button onClick={addBlankPage}>＋ Blank page</button>
                  <button onClick={() => reorderPage(-1)} disabled={page === 1}>↑ Move</button>
                  <button onClick={() => reorderPage(1)} disabled={page === pages}>↓ Move</button>
                  <button onClick={() => deletePage()} disabled={pageOrder.length <= 1} className="delete-page-btn">🗑 Delete</button>
                </div>
                {pageOrder.map((item, idx) => (
                  <PageThumbnail key={item.id} pdf={pdf} sourcePage={item.sourcePage} pageNumber={idx + 1} background={item.background} active={page === idx + 1} onClick={() => setPage(idx + 1)} />
                ))}
              </>
            ) : (
              <div className="collapsed-page-list">
                {pageOrder.map((item, idx) => (
                  <button key={item.id} className={`page-num-pill ${page === idx + 1 ? "active" : ""}`} onClick={() => setPage(idx + 1)} title={`Go to page ${idx + 1}`}>
                    {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* ─── MAIN WORKSPACE ──────────────────────────────────────────── */}
          <section className="viewer-workspace">

            {/* FIX #15: zoom wrapper z-index above sidebar toggle */}
            <div className="zoom-controls-wrapper">
              <button className={`zoom-toggle-btn ${zoomMenuOpen ? "active" : ""}`} title="Display & Zoom Options" onClick={() => setZoomMenuOpen(v => !v)} aria-expanded={zoomMenuOpen} aria-haspopup="true">
                <span>🔍 {Math.round(zoom * 100)}%</span>
                <small>▾</small>
              </button>
              {zoomMenuOpen && (
                <div className="zoom-popover-menu" role="menu">
                  <div className="zoom-menu-row">
                    <button title="Zoom Out" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.15).toFixed(2)))}>–</button>
                    <span className="zoom-val" onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</span>
                    <button title="Zoom In" onClick={() => setZoom(z => Math.min(4.0, +(z + 0.15).toFixed(2)))}>+</button>
                  </div>
                  <div className="zoom-menu-divider" />
                  <button className="zoom-menu-item" role="menuitem" onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); setZoomMenuOpen(false); }}>⛶ Fit to Screen</button>
                  <button className="zoom-menu-item" role="menuitem" onClick={() => { toggleFullscreen(); setZoomMenuOpen(false); }}>{isFullscreen ? "🗗 Exit Fullscreen" : "⛶ Fullscreen"}</button>
                </div>
              )}
            </div>

            {/* Stage / Canvas area */}
            <div
              className="stage"
              ref={stage}
              onPointerDown={e => {
                if (tool === "pan" || e.button === 1) {
                  setIsPanning(true);
                  panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }
              }}
              onDoubleClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}
              onPointerMove={e => { if (isPanning) setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }); }}
              onPointerUp={() => setIsPanning(false)}
              onWheel={e => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  setZoom(z => Math.max(0.25, Math.min(4.0, +(z + (e.deltaY > 0 ? -0.1 : 0.1)).toFixed(2))));
                }
              }}
            >
              <div
                className="page-frame"
                style={{
                  transform: zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` : undefined,
                  transformOrigin: "center center",
                  transition: (isPanning || pinchRef.current) ? "none" : "transform 0.1s cubic-bezier(0,0,0.2,1)",
                }}
              >
                {/* smooth page fade transition wrapper */}
                <div
                  ref={pageEl}
                  className={`page ${smoothTransition ? "page-smooth" : ""}`}
                  style={{ cursor: laserPointer ? "crosshair" : undefined }}
                >
                  <canvas ref={canvas} />
                  {/* Grid overlay — rendered before SVG so annotations sit on top */}
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
                    onPointerDown={e => {
                      // FIX #14: only auto-hide dock for actual drawing tools
                      setPropertiesOpen(false);
                      setActiveDropdown(null);
                      setZoomMenuOpen(false);
                      if (autoHideDock && drawingTypes.includes(tool as AnnotationType)) {
                        setDockCollapsed(true);
                      }
                      const pt = point(e);
                      if (tool.includes("eraser")) {
                        setIsErasing(true); setEraserPos(pt); eraseAtPoint(pt);
                      } else if (tool !== "select" && tool !== "pan") {
                        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                        setDraft([pt]);
                      } else if (tool === "select") {
                        setSelectedId(undefined);
                      }
                    }}
                    onPointerMove={e => {
                      const pt = point(e);
                      // Always track position for laser pointer
                      if (laserPointer) setEraserPos(pt);
                      if (tool.includes("eraser")) {
                        setEraserPos(pt);
                        if (isErasing || e.buttons === 1) eraseAtPoint(pt);
                      } else if (transforming) {
                        updateTransform(e);
                      } else if (draft) {
                        const nativeEvt = e.nativeEvent as unknown as { getCoalescedEvents?: () => PointerEvent[] };
                        const coalesced = typeof nativeEvt.getCoalescedEvents === "function" && nativeEvt.getCoalescedEvents().length > 0
                          ? nativeEvt.getCoalescedEvents() : [e];
                        const rect = (pageEl.current ?? overlay.current!).getBoundingClientRect();
                        const newPoints: Point[] = [];
                        for (const cEvt of coalesced) {
                          const p = normalizePoint({ x: cEvt.clientX - rect.left, y: cEvt.clientY - rect.top }, { width: rect.width, height: rect.height });
                          newPoints.push(p);
                        }
                        setDraft(curr => {
                          if (!curr) return newPoints;
                          let updated = [...curr];
                          for (const p of newPoints) {
                            const last = updated.at(-1);
                            if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.0006) updated.push(p);
                          }
                          return updated;
                        });
                      }
                    }}
                    onPointerUp={e => {
                      if (tool.includes("eraser")) {
                        setIsErasing(false); setEraserPos(null);
                        const final = annotationsForErase.current;
                        setHistory(h => [...h, annotations]); setFuture([]);
                        void saveCloud(final).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
                      }
                      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                      }
                      if (transforming) endTransform();
                      finish(e);
                    }}
                    onPointerCancel={e => {
                      if (tool.includes("eraser")) {
                        setIsErasing(false); setEraserPos(null);
                        const final = annotationsForErase.current;
                        setHistory(h => [...h, annotations]); setFuture([]);
                        void saveCloud(final).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
                      }
                      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                      }
                      if (transforming) endTransform();
                      finish(e);
                    }}
                    onPointerLeave={() => {
                      if (isErasing) {
                        const final = annotationsForErase.current;
                        setHistory(h => [...h, annotations]); setFuture([]);
                        void saveCloud(final).catch(err => setStatus(err instanceof Error ? err.message : "Cloud save failed"));
                      }
                      setEraserPos(null); setIsErasing(false);
                    }}                  >
                    <defs>
                      <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L8,3 Z" fill="context-stroke" />
                      </marker>
                    </defs>

                    {/* shapes — hidden when hideAnnotations is on */}
                    {!hideAnnotations && visible.map(annotation => (
                      <AnnotationShape
                        key={annotation.id}
                        annotation={annotation}
                        selected={selectedId === annotation.id}
                        isDrawingTool={!["select", "pan"].includes(tool)}
                        onPointerDown={(e, a) => {
                          if (tool.includes("eraser")) { setIsErasing(true); eraseAtPoint(point(e)); }
                          else if (tool === "select") startTransform(e, "body", a);
                        }}
                      />
                    ))}

                    {selectedAnnotation && (
                      <TransformBoundingBox annotation={selectedAnnotation} onStartTransform={startTransform} />
                    )}

                    {/* Live draft preview ─────────────────────────────────
                        Drawing tools → smooth live stroke.
                        Shape/line/text tools → dotted ghost outline that
                        exactly matches the shape that will be committed.  */}
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
                          {/* Corner size hint — shows W × H in small text */}
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

                    {/* Laser pointer dot — shown when laserPointer mode is on */}
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

              {/* FIX #9: page-counter lives OUTSIDE page-frame so it doesn't move with zoom/pan */}
              <div
                className={`page-counter ${showPageCounter ? "visible" : ""}`}
                onMouseEnter={triggerPageCounter}
                onTouchStart={triggerPageCounter}
              >
                <button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(v => v - 1)}>‹</button>
                <span>Page {page} / {pages}</span>
                <button aria-label="Next page" disabled={page === pages} onClick={() => setPage(v => v + 1)}>›</button>
              </div>
            </div>

            {/* ─── BOTTOM FLOATING DOCK ────────────────────────────────────
                floating-dock-wrapper owns both the pill (collapsed state) and
                the full dock (expanded state). They swap — never overlap.
                When dockPos is set the wrapper switches to fixed positioning
                so the user can drag it anywhere on screen.               */}
            <div
              className={`floating-dock-wrapper ${dockPos ? "dock-free" : ""}`}
              ref={dockRef}
              style={dockPos ? { left: dockPos.x, top: dockPos.y, bottom: "auto", transform: "none" } : undefined}
            >

              {/* Trigger pill — shown when dock is collapsed */}
              {dockCollapsed && (
                <>
                  <div
                    className="dock-edge-target"
                    onClick={() => setDockCollapsed(false)}
                    onTouchStart={() => setDockCollapsed(false)}
                    title="Tap to expand toolbar"
                  />
                  <button
                    type="button"
                    className="dock-trigger-pill"
                    onClick={() => setDockCollapsed(false)}
                    onTouchEnd={e => { e.preventDefault(); setDockCollapsed(false); }}
                    title="Expand Drawing Toolbar"
                    aria-label="Expand Drawing Toolbar"
                  >
                    <span>▲ Drawing Tools</span>
                  </button>
                </>
              )}
              {/* Properties popover — FIX #6: scroll indicator added via CSS */}
              {propertiesOpen && (
                <div className="properties-popover" role="toolbar" aria-label="Style options">
                  {selectedAnnotation && (
                    <>
                      <button onClick={editSelected} disabled={selectedAnnotation.type !== "text"}>✏️ Edit text</button>
                      <button onClick={duplicateSelected}>⧉ Duplicate</button>
                      <button className="delete-action" onClick={() => { deleteAnnotation(selectedAnnotation.id); setSelectedId(undefined); setPropertiesOpen(false); }}>🗑 Delete</button>
                    </>
                  )}

                  {tool.includes("eraser") && (
                    <div className="eraser-options">
                      <label>
                        <span>Eraser Size ({eraserSize}px)</span>
                        <div className="stroke-presets">
                          {[8, 16, 30, 50, 80].map(sz => (
                            <button key={sz} type="button" className={`stroke-btn ${eraserSize === sz ? "active" : ""}`} onClick={() => setEraserSize(sz)}>
                              {sz === 8 ? "Fine" : sz === 16 ? "Small" : sz === 30 ? "Med" : sz === 50 ? "Large" : "XL"}
                            </button>
                          ))}
                        </div>
                        <input aria-label="Eraser size" type="range" min="5" max="100" value={eraserSize} onChange={e => setEraserSize(+e.target.value)} />
                      </label>
                      <div className="clear-options">
                        <strong>Clear:</strong>
                        <button type="button" onClick={clearDrawingsOnPage}>✏️ Ink</button>
                        <button type="button" onClick={clearShapesOnPage}>📐 Shapes</button>
                        <button type="button" className="delete-action" onClick={clearAllOnPage}>🗑️ Page</button>
                      </div>
                    </div>
                  )}

                  {(tool === "text" || selectedAnnotation?.type === "text") && (
                    <>
                      <label>
                        Font Family
                        <select value={selectedAnnotation?.style.fontFamily ?? fontFamily} onChange={e => { const v = e.target.value; setFontFamily(v); if (selectedAnnotation) updateSelected({ style: { fontFamily: v } }); }}>
                          {fontFamilies.map(f => <option key={f.val} value={f.val}>{f.label}</option>)}
                        </select>
                      </label>
                      <label>
                        Text Size ({selectedAnnotation?.style.fontSize ?? fontSize}px)
                        <div className="stroke-presets">
                          <button type="button" className="stroke-btn" onClick={() => { const curr = selectedAnnotation?.style.fontSize ?? fontSize; const next = Math.max(12, curr - 4); setFontSize(next); if (selectedAnnotation) updateSelected({ height: Math.max(selectedAnnotation.height, (next * 1.5) / 1000), style: { fontSize: next } }); }}>A–</button>
                          <button type="button" className="stroke-btn" onClick={() => { const curr = selectedAnnotation?.style.fontSize ?? fontSize; const next = Math.min(160, curr + 6); setFontSize(next); if (selectedAnnotation) updateSelected({ height: Math.max(selectedAnnotation.height, (next * 1.5) / 1000), style: { fontSize: next } }); }}>A+</button>
                          {fontSizePresets.map(fs => (
                            <button key={fs} type="button" className={`stroke-btn ${(selectedAnnotation?.style.fontSize ?? fontSize) === fs ? "active" : ""}`} onClick={() => { setFontSize(fs); if (selectedAnnotation) updateSelected({ height: Math.max(selectedAnnotation.height, (fs * 1.5) / 1000), style: { fontSize: fs } }); }}>{fs}px</button>
                          ))}
                        </div>
                        <input aria-label="Text size slider" type="range" min="12" max="160" step="2" value={selectedAnnotation?.style.fontSize ?? fontSize}
                          onChange={e => { const v = +e.target.value; setFontSize(v); if (selectedAnnotation) updateSelected({ height: Math.max(selectedAnnotation.height, (v * 1.5) / 1000), style: { fontSize: v } }); }} />
                      </label>
                    </>
                  )}

                  <label>
                    Stroke
                    <div className="color-swatches">
                      {strokeColors.map(c => (
                        <button key={c} type="button" className={`color-swatch ${(selectedAnnotation?.style.color ?? color) === c ? "active" : ""}`}
                          style={{ backgroundColor: c, border: c === "#ffffff" ? "1px solid #cbd5e1" : undefined }}
                          data-hex={c} aria-label={`Stroke colour ${c}`} title={c}
                          onClick={() => { setColor(c); if (selectedAnnotation) updateSelected({ style: { color: c } }); }} />
                      ))}
                    </div>
                    <input aria-label="Custom stroke colour" type="color" value={selectedAnnotation?.style.color ?? color}
                      onChange={e => { setColor(e.target.value); if (selectedAnnotation) updateSelected({ style: { color: e.target.value } }); }} />
                  </label>

                  <label>
                    Thickness
                    <div className="stroke-presets">
                      {strokeWidthPresets.map(sp => (
                        <button key={sp.val} type="button" className={`stroke-btn ${(selectedAnnotation?.style.strokeWidth ?? width) === sp.val ? "active" : ""}`}
                          onClick={() => { setWidth(sp.val); if (selectedAnnotation) updateSelected({ style: { strokeWidth: sp.val } }); }}>{sp.label}</button>
                      ))}
                    </div>
                    <input aria-label="Stroke width" type="range" min="1" max="48" value={selectedAnnotation?.style.strokeWidth ?? width}
                      onChange={e => { const v = +e.target.value; setWidth(v); if (selectedAnnotation) updateSelected({ style: { strokeWidth: v } }); }} />
                    <output>{selectedAnnotation?.style.strokeWidth ?? width}px</output>
                  </label>

                  <label>
                    Opacity ({Math.round((selectedAnnotation?.style.opacity ?? opacity) * 100)}%)
                    <input aria-label="Opacity" type="range" min="0.1" max="1" step="0.05" value={selectedAnnotation?.style.opacity ?? opacity}
                      onChange={e => { const v = +e.target.value; setOpacity(v); if (selectedAnnotation) updateSelected({ style: { opacity: v } }); }} />
                  </label>

                  <label>Scale
                    <input aria-label="Scale selected object" type="range" min="25" max="200" value={size} onChange={e => resizeSelected(+e.target.value)} />
                    <output>{size}%</output>
                  </label>

                  {currentPage && (
                    <label>Background <input aria-label="Slide background colour" type="color" value={currentPage.background || "#1e293b"} onChange={e => changePageBackground(e.target.value)} /></label>
                  )}
                </div>
              )}

              {/* ─── FIX #22: Bottom dock split into Drawing group + Presentation group ─── */}
              <div className={`control-dock ${dockCollapsed ? "collapsed" : ""}`}>

                {/* Drag grip — lets the user reposition the toolbar anywhere */}
                <div
                  className="dock-grip"
                  title="Drag to move toolbar · Double-click to snap back"
                  aria-label="Drag toolbar"
                  onPointerDown={e => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const dock = dockRef.current;
                    const rect = dock?.getBoundingClientRect();
                    dockDragRef.current = {
                      startX: e.clientX,
                      startY: e.clientY,
                      originX: rect?.left ?? e.clientX - 200,
                      originY: rect?.top ?? e.clientY - 32,
                      dragging: true,
                    };
                  }}
                  onDoubleClick={() => {
                    // Double-click grip → snap back to default bottom-centre
                    setDockPos(null);
                    if (dockDragRef.current) dockDragRef.current.dragging = false;
                  }}
                >
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>

                {/* GROUP A: Drawing tools */}
                <div className="tool-group drawing-tools-group">

                  {/* Select */}
                  <button type="button" className={tool === "select" ? "tool-active" : ""} title="Select & Edit" onClick={() => { setTool("select"); setActiveDropdown(null); setPropertiesOpen(!!selectedAnnotation); }}>
                    <span>↖</span><small>Select</small>
                  </button>

                  {/* Pan */}
                  <button type="button" className={tool === "pan" ? "tool-active" : ""} title="Pan Canvas" onClick={() => { setTool("pan"); setActiveDropdown(null); setPropertiesOpen(false); }}>
                    <span>✋</span><small>Pan</small>
                  </button>

                  <span className="dock-divider" />

                  {/* Pen group — FIX #10: dropdown uses tool-dropdown-container for outside-click handling */}
                  <div className="tool-dropdown-container" style={{ position: "relative" }}>
                    <button type="button" className={drawingTypes.includes(tool as AnnotationType) ? "tool-active" : ""} title="Pencil & Brushes"
                      aria-expanded={activeDropdown === "pen"} aria-haspopup="true"
                      onClick={() => { if (!drawingTypes.includes(tool as AnnotationType)) { setTool("ink"); setOpacity(1.0); if (width > 8) setWidth(3); } setActiveDropdown(activeDropdown === "pen" ? null : "pen"); setPropertiesOpen(true); }}>
                      <span>{tool === "calligraphy" ? "✒️" : tool === "highlighter" ? "▰" : "✎"}</span>
                      <small>{tool === "calligraphy" ? "Calli" : tool === "highlighter" ? "Hi-lite" : "Pen"} ▾</small>
                    </button>
                    {activeDropdown === "pen" && (
                      <div className="tool-dropdown-menu" style={{ gridTemplateColumns: "repeat(3,1fr)" }} role="menu" onClick={e => e.stopPropagation()}>
                        <button role="menuitem" className={tool === "ink" ? "active" : ""} onClick={() => { setTool("ink"); setOpacity(1.0); if (width > 8) setWidth(3); setActiveDropdown(null); setPropertiesOpen(true); }}>✎ Pen</button>
                        <button role="menuitem" className={tool === "calligraphy" ? "active" : ""} onClick={() => { setTool("calligraphy"); setOpacity(1.0); if (width > 8) setWidth(3); setActiveDropdown(null); setPropertiesOpen(true); }}>✒️ Calli</button>
                        <button role="menuitem" className={tool === "highlighter" ? "active" : ""} onClick={() => { setTool("highlighter"); setOpacity(0.45); if (width < 8) setWidth(14); setActiveDropdown(null); setPropertiesOpen(true); }}>▰ Highlight</button>
                      </div>
                    )}
                  </div>

                  {/* Eraser group */}
                  <div className="tool-dropdown-container" style={{ position: "relative" }}>
                    <button type="button" className={tool.includes("eraser") ? "tool-active" : ""} title="Eraser Tools"
                      aria-expanded={activeDropdown === "eraser"} aria-haspopup="true"
                      onClick={() => { if (!tool.includes("eraser")) setTool("partial-eraser"); setActiveDropdown(activeDropdown === "eraser" ? null : "eraser"); setPropertiesOpen(true); }}>
                      <span>{tool === "stroke-eraser" ? "⌫" : "🧹"}</span>
                      <small>Erase ▾</small>
                    </button>
                    {activeDropdown === "eraser" && (
                      <div className="tool-dropdown-menu" style={{ gridTemplateColumns: "repeat(2,1fr)" }} role="menu" onClick={e => e.stopPropagation()}>
                        <button role="menuitem" className={tool === "partial-eraser" ? "active" : ""} onClick={() => { setTool("partial-eraser"); setActiveDropdown(null); setPropertiesOpen(true); }}>🧹 Pixel</button>
                        <button role="menuitem" className={tool === "stroke-eraser" ? "active" : ""} onClick={() => { setTool("stroke-eraser"); setActiveDropdown(null); setPropertiesOpen(true); }}>⌫ Object</button>
                      </div>
                    )}
                  </div>

                  {/* Shapes — opens the floating shapes panel */}
                  <button
                    type="button"
                    className={["rectangle","ellipse","triangle","diamond","star","cloud","pentagon","hexagon","octagon","heart","cross","parallelogram","right-triangle","cylinder","graph","line","arrow"].includes(tool) ? "tool-active" : ""}
                    title="Shapes & Graph panel"
                    onClick={() => setShapesPanelOpen(v => !v)}
                  >
                    <span>{tool==="ellipse"?"○":tool==="triangle"?"△":tool==="diamond"?"◇":tool==="star"?"☆":tool==="cloud"?"☁":tool==="graph"?"📈":tool==="pentagon"?"⬠":tool==="hexagon"?"⬡":tool==="octagon"?"⯃":tool==="heart"?"♡":tool==="cross"?"✚":tool==="parallelogram"?"▱":tool==="right-triangle"?"◺":tool==="cylinder"?"⌻":tool==="line"?"／":tool==="arrow"?"➜":"□"}</span>
                    <small>Shapes ▾</small>
                  </button>

                  {/* Text */}
                  <button type="button" className={tool === "text" ? "tool-active" : ""} title="Insert Text" onClick={() => { setTool("text"); setActiveDropdown(null); setPropertiesOpen(true); }}>
                    <span>T</span><small>Text</small>
                  </button>

                  {/* FIX #2: Image button now sets tool AND triggers file input */}
                  <button type="button" className={tool === "image" ? "tool-active" : ""} title="Insert Image"
                    onClick={() => { setTool("image"); setActiveDropdown(null); imageInputRef.current?.click(); }}>
                    <span>🖼</span><small>Image</small>
                  </button>
                </div>

                <span className="dock-divider dock-group-divider" />

                {/* GROUP B: Presentation / navigation tools */}
                <div className="tool-group presentation-tools-group">
                  {/* Page navigation */}
                  <div className="dock-pagination">
                    <button type="button" title="Previous Slide" disabled={page === 1} onClick={() => setPage(v => v - 1)}>‹</button>
                    <span>{page} / {pages}</span>
                    <button type="button" title="Next Slide" disabled={page === pages} onClick={() => setPage(v => v + 1)}>›</button>
                  </div>

                  <span className="dock-divider" />

                  {/* Settings */}
                  <button type="button" title="Canvas Settings" onClick={() => setSettingsOpen(true)}>
                    <span>⚙️</span><small>Settings</small>
                  </button>

                  {/* Collapse dock */}
                  <button type="button" title="Collapse Toolbar" onClick={() => setDockCollapsed(true)} style={{ opacity: 0.7 }}>
                    <span>▼</span><small>Hide</small>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="viewer-empty">
          <div>
            <span className="empty-icon">＋</span>
            <h1>Open a lesson or start a 16:9 presentation</h1>
            <p>Teach, draw, and present in real time with interactive smartboard tools.</p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
              <button type="button" className="primary" onClick={() => initBlankDocument("New 16:9 Presentation")}>Start 16:9 Presentation</button>
              <label className="secondary upload">Choose a PDF<input type="file" hidden accept=".pdf,application/pdf" onChange={e => e.target.files?.[0] && open(e.target.files[0]).catch(err => setStatus(err.message))} /></label>
            </div>
          </div>
        </section>
      )}

      {/* ─── FIX #18: Text dialog with proper role + aria-modal ─────────────── */}
      {textPoints && (
        <div className="text-dialog-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setTextPoints(null); }}>
          <form
            className="text-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="text-dialog-title"
            onSubmit={e => { e.preventDefault(); submitText(); }}
          >
            <h2 id="text-dialog-title">Add text annotation</h2>
            <label>
              Text
              <input autoFocus value={textValue} onChange={e => setTextValue(e.target.value)} placeholder="Type text here…" />
            </label>
            <label>
              Font Family
              <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
                {fontFamilies.map(f => <option key={f.val} value={f.val}>{f.label}</option>)}
              </select>
            </label>
            <label>
              Font Size ({fontSize}px)
              <div className="stroke-presets">
                {fontSizePresets.map(fs => (
                  <button key={fs} type="button" className={`stroke-btn ${fontSize === fs ? "active" : ""}`} onClick={() => setFontSize(fs)}>{fs}px</button>
                ))}
              </div>
            </label>
            <div>
              <button type="button" className="secondary" onClick={() => setTextPoints(null)}>Cancel</button>
              <button className="primary" type="submit" disabled={!textValue.trim()}>Add text</button>
            </div>
          </form>
        </div>
      )}

      {/* ─── Settings modal ─────────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="settings-modal-backdrop" onClick={() => setSettingsOpen(false)} role="presentation">
          <div className="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="settings-modal-header">
              <h3 id="settings-title">⚙️ Settings</h3>
              <button type="button" className="sm-close-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings">✕</button>
            </div>

            {/* Tab strip */}
            <div className="settings-tabs" role="tablist">
              {(["canvas", "tools", "document", "view"] as const).map(tab => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={settingsTab === tab}
                  className={`settings-tab-btn ${settingsTab === tab ? "active" : ""}`}
                  onClick={() => setSettingsTab(tab)}
                >
                  {tab === "canvas" && "🎨 Canvas"}
                  {tab === "tools" && "🖊️ Tools"}
                  {tab === "document" && "📄 Document"}
                  {tab === "view" && "👁️ View"}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="settings-modal-body">

              {/* ── TAB: Canvas ── */}
              {settingsTab === "canvas" && (
                <>
                  {/* Slide background */}
                  <div className="settings-section">
                    <h4>Slide Background</h4>
                    <div className="sm-bg-presets">
                      {[
                        { label: "Dark Slate",  color: "#1e293b" },
                        { label: "White",        color: "#ffffff" },
                        { label: "Deep Blue",    color: "#1e3a8a" },
                        { label: "Board Green",  color: "#14532d" },
                        { label: "Midnight",     color: "#0f172a" },
                        { label: "Warm Cream",   color: "#fdf6e3" },
                        { label: "Soft Gray",    color: "#f1f5f9" },
                        { label: "Deep Purple",  color: "#3b0764" },
                      ].map(bg => (
                        <button
                          key={bg.color}
                          type="button"
                          className={`sm-bg-swatch ${currentPage?.background === bg.color ? "active" : ""}`}
                          style={{ background: bg.color }}
                          onClick={() => changePageBackground(bg.color)}
                          title={bg.label}
                          aria-label={bg.label}
                        />
                      ))}
                    </div>
                    <div className="sm-row" style={{ marginTop: "0.5rem" }}>
                      <span className="sm-label">Custom colour</span>
                      <input
                        type="color"
                        className="sm-color-input"
                        value={currentPage?.background || "#1e293b"}
                        onChange={e => changePageBackground(e.target.value)}
                        aria-label="Custom slide background colour"
                      />
                    </div>
                  </div>

                  {/* Grid overlay */}
                  <div className="settings-section">
                    <h4>Grid Overlay</h4>
                    <div className="sm-chip-row">
                      {(["none", "dots", "lines"] as const).map(g => (
                        <button
                          key={g}
                          type="button"
                          className={`sm-chip ${gridType === g ? "active" : ""}`}
                          onClick={() => setGridType(g)}
                        >
                          {g === "none" ? "Off" : g === "dots" ? "⠿ Dots" : "⊞ Lines"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Clear actions */}
                  <div className="settings-section">
                    <h4>Clear This Page</h4>
                    <div className="sm-btn-row">
                      <button type="button" className="sm-btn" onClick={() => { clearDrawingsOnPage(); setSettingsOpen(false); }}>✏️ Clear Ink</button>
                      <button type="button" className="sm-btn" onClick={() => { clearShapesOnPage(); setSettingsOpen(false); }}>📐 Clear Shapes</button>
                      <button type="button" className="sm-btn sm-btn-danger" onClick={() => { clearAllOnPage(); setSettingsOpen(false); }}>🗑️ Clear All</button>
                    </div>
                  </div>
                </>
              )}

              {/* ── TAB: Tools ── */}
              {settingsTab === "tools" && (
                <>
                  {/* Default pen colour */}
                  <div className="settings-section">
                    <h4>Default Pen Colour</h4>
                    <div className="sm-row">
                      <div className="sm-swatch-row">
                        {["#000000","#ffffff","#2563eb","#dc2626","#16a34a","#ca8a04","#7c3aed","#db2777"].map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`sm-color-swatch ${color === c ? "active" : ""}`}
                            style={{ background: c, border: c === "#ffffff" ? "1px solid #d1d5db" : "none" }}
                            onClick={() => setColor(c)}
                            aria-label={`Set pen colour ${c}`}
                          />
                        ))}
                      </div>
                      <input type="color" className="sm-color-input" value={color} onChange={e => setColor(e.target.value)} aria-label="Custom pen colour" />
                    </div>
                  </div>

                  {/* Default stroke width */}
                  <div className="settings-section">
                    <h4>Default Stroke Width</h4>
                    <div className="sm-row" style={{ gap: "1rem" }}>
                      <div className="sm-chip-row">
                        {[2, 4, 6, 10, 16].map(w => (
                          <button key={w} type="button" className={`sm-chip ${width === w ? "active" : ""}`} onClick={() => setWidth(w)}>{w}px</button>
                        ))}
                      </div>
                      <input
                        type="range" min="1" max="48" value={width}
                        onChange={e => setWidth(+e.target.value)}
                        style={{ flex: 1, accentColor: "var(--blue)" }}
                        aria-label="Stroke width"
                      />
                      <span className="sm-value-badge">{width}px</span>
                    </div>
                  </div>

                  {/* Default opacity */}
                  <div className="settings-section">
                    <h4>Default Opacity</h4>
                    <div className="sm-row" style={{ gap: "1rem" }}>
                      <input
                        type="range" min="0.1" max="1" step="0.05" value={opacity}
                        onChange={e => setOpacity(+e.target.value)}
                        style={{ flex: 1, accentColor: "var(--blue)" }}
                        aria-label="Default opacity"
                      />
                      <span className="sm-value-badge">{Math.round(opacity * 100)}%</span>
                    </div>
                  </div>

                  {/* Toolbar behaviour */}
                  <div className="settings-section">
                    <h4>Toolbar Behaviour</h4>
                    <div className="sm-toggle-row">
                      <div className="sm-toggle-label">
                        <strong>Auto-Hide on Drawing</strong>
                        <small>Collapses toolbar when using pen / ink tools</small>
                      </div>
                      <button type="button" className={`sm-toggle-btn ${autoHideDock ? "on" : ""}`} onClick={() => setAutoHideDock(v => !v)}>
                        <span className="sm-toggle-thumb" />
                      </button>
                    </div>
                    <div className="sm-toggle-row">
                      <div className="sm-toggle-label">
                        <strong>Show Page Sidebar</strong>
                        <small>Thumbnails panel on the left edge</small>
                      </div>
                      <button type="button" className={`sm-toggle-btn ${sidebarOpen ? "on" : ""}`} onClick={() => setSidebarOpen(v => !v)}>
                        <span className="sm-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── TAB: Document ── */}
              {settingsTab === "document" && (
                <>
                  {/* Rename */}
                  <div className="settings-section">
                    <h4>Presentation Name</h4>
                    {renamingDoc ? (
                      <div className="sm-row" style={{ gap: "0.5rem" }}>
                        <input
                          className="sm-text-input"
                          value={renameValue}
                          autoFocus
                          maxLength={80}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && renameValue.trim()) { setDocumentName(renameValue.trim()); setRenamingDoc(false); }
                            if (e.key === "Escape") setRenamingDoc(false);
                          }}
                          aria-label="Rename presentation"
                        />
                        <button type="button" className="sm-btn sm-btn-primary" onClick={() => { if (renameValue.trim()) { setDocumentName(renameValue.trim()); setRenamingDoc(false); } }}>Save</button>
                        <button type="button" className="sm-btn" onClick={() => setRenamingDoc(false)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="sm-row" style={{ gap: "0.75rem" }}>
                        <span className="sm-doc-name">{documentName}</span>
                        <button type="button" className="sm-btn" onClick={() => { setRenameValue(documentName); setRenamingDoc(true); }}>✏️ Rename</button>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="settings-section">
                    <h4>Document Info</h4>
                    <div className="sm-info-grid">
                      <div className="sm-info-item"><span className="sm-info-val">{pages}</span><span className="sm-info-lbl">Pages</span></div>
                      <div className="sm-info-item"><span className="sm-info-val">{annotations.filter(a => drawingTypes.includes(a.type as AnnotationType)).length}</span><span className="sm-info-lbl">Ink strokes</span></div>
                      <div className="sm-info-item"><span className="sm-info-val">{annotations.filter(a => !drawingTypes.includes(a.type as AnnotationType)).length}</span><span className="sm-info-lbl">Shapes / Text</span></div>
                      <div className="sm-info-item"><span className="sm-info-val">{annotations.length}</span><span className="sm-info-lbl">Total annotations</span></div>
                    </div>
                  </div>

                  {/* Export */}
                  <div className="settings-section">
                    <h4>Export</h4>
                    <div className="sm-btn-row">
                      <button
                        type="button"
                        className="sm-btn sm-btn-primary"
                        onClick={async () => {
                          const blob = await pdfExporter.export(source, annotations, pageOrder);
                          const link = document.createElement("a");
                          link.href = URL.createObjectURL(blob);
                          link.download = `${documentName.replace(/\s+/g, "_")}.pdf`;
                          link.click();
                          setSettingsOpen(false);
                        }}
                      >📥 Export as PDF</button>
                    </div>
                  </div>

                  {/* Danger zone */}
                  <div className="settings-section settings-danger-zone">
                    <h4>⚠️ Danger Zone</h4>
                    <div className="sm-btn-row">
                      <button type="button" className="sm-btn sm-btn-danger" onClick={() => {
                        showConfirm("Clear ALL annotations on ALL pages? This cannot be undone.", () => {
                          const next: Annotation[] = [];
                          commit(next);
                          setConfirmState(null);
                          setSettingsOpen(false);
                        });
                      }}>🗑️ Clear Entire Presentation</button>
                    </div>
                  </div>
                </>
              )}

              {/* ── TAB: View ── */}
              {settingsTab === "view" && (
                <>
                  {/* Zoom controls */}
                  <div className="settings-section">
                    <h4>Zoom & Display</h4>
                    <div className="sm-row" style={{ gap: "1rem", flexWrap: "wrap" }}>
                      <button type="button" className="sm-btn" onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}>⛶ Reset Zoom (100%)</button>
                      <button type="button" className="sm-btn" onClick={() => setZoom(z => Math.min(4.0, +(z + 0.25).toFixed(2)))}>🔍 Zoom In</button>
                      <button type="button" className="sm-btn" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}>🔍 Zoom Out</button>
                    </div>
                    <div className="sm-row" style={{ gap: "1rem", marginTop: "0.5rem" }}>
                      <span className="sm-label">Current zoom</span>
                      <span className="sm-value-badge">{Math.round(zoom * 100)}%</span>
                    </div>
                  </div>

                  {/* Fullscreen */}
                  <div className="settings-section">
                    <h4>Fullscreen</h4>
                    <div className="sm-btn-row">
                      <button type="button" className="sm-btn" onClick={() => { toggleFullscreen(); setSettingsOpen(false); }}>
                        {isFullscreen ? "🗗 Exit Fullscreen" : "⛶ Enter Fullscreen"}
                      </button>
                    </div>
                  </div>

                  {/* Visibility toggles */}
                  <div className="settings-section">
                    <h4>Visibility</h4>
                    <div className="sm-toggle-row">
                      <div className="sm-toggle-label">
                        <strong>Hide All Annotations</strong>
                        <small>Temporarily hide ink & shapes — slides only</small>
                      </div>
                      <button type="button" className={`sm-toggle-btn ${hideAnnotations ? "on" : ""}`} onClick={() => setHideAnnotations(v => !v)}>
                        <span className="sm-toggle-thumb" />
                      </button>
                    </div>
                    <div className="sm-toggle-row">
                      <div className="sm-toggle-label">
                        <strong>Laser Pointer Mode</strong>
                        <small>Cursor becomes a red laser dot while drawing</small>
                      </div>
                      <button type="button" className={`sm-toggle-btn ${laserPointer ? "on" : ""}`} onClick={() => setLaserPointer(v => !v)}>
                        <span className="sm-toggle-thumb" />
                      </button>
                    </div>
                    <div className="sm-toggle-row">
                      <div className="sm-toggle-label">
                        <strong>Smooth Page Transitions</strong>
                        <small>Fade animation between slides</small>
                      </div>
                      <button type="button" className={`sm-toggle-btn ${smoothTransition ? "on" : ""}`} onClick={() => setSmoothTransition(v => !v)}>
                        <span className="sm-toggle-thumb" />
                      </button>
                    </div>
                  </div>

                  {/* Present mode shortcut */}
                  <div className="settings-section">
                    <h4>Presentation</h4>
                    <div className="sm-btn-row">
                      <button type="button" className="sm-btn sm-btn-primary" onClick={() => { setPresenting(v => !v); setSettingsOpen(false); }}>
                        {presenting ? "⏹ Exit Presentation Mode" : "▶ Start Presenting"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="settings-modal-footer">
              <span className="sm-footer-hint">Changes apply immediately</span>
              <button type="button" className="sm-btn sm-btn-primary" onClick={() => setSettingsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* FIX #13: Inline confirm dialog */}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* ─── FLOATING SHAPES & GRAPH PANEL ───────────────────────────────────
          Separate draggable window. position:fixed so it floats over everything
          and is never clipped by the canvas or workspace overflow.           */}
      {shapesPanelOpen && (
        <div
          ref={shapesPanelRef}
          className="shapes-panel"
          style={shapesPanelPos
            ? { left: shapesPanelPos.x, top: shapesPanelPos.y, right: "auto" }
            : undefined
          }
          role="dialog"
          aria-label="Shapes & Graph panel"
        >
          {/* Drag header */}
          <div
            className="shapes-panel-header"
            onPointerDown={e => {
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
            <span className="shapes-panel-title">⬡ Shapes & Graph</span>
            <button
              type="button"
              className="shapes-panel-close"
              onClick={() => setShapesPanelOpen(false)}
              aria-label="Close shapes panel"
            >✕</button>
          </div>

          {/* ── Basic shapes ── */}
          <div className="shapes-panel-section">
            <span className="shapes-panel-label">Basic</span>
            <div className="shapes-panel-grid">
              {([
                ["rectangle", "□", "Rectangle"],
                ["ellipse",   "○", "Circle"],
                ["triangle",  "△", "Triangle"],
                ["right-triangle","◺","Rt Triangle"],
                ["diamond",   "◇", "Diamond"],
                ["parallelogram","▱","Parallelogram"],
              ] as [string, string, string][]).map(([t, icon, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`shapes-panel-btn ${tool === t ? "active" : ""}`}
                  title={label}
                  onClick={() => { setTool(t as AnnotationType); setPropertiesOpen(true); }}
                >
                  <span className="sp-icon">{icon}</span>
                  <span className="sp-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Polygons ── */}
          <div className="shapes-panel-section">
            <span className="shapes-panel-label">Polygons</span>
            <div className="shapes-panel-grid">
              {([
                ["pentagon",  "⬠", "Pentagon"],
                ["hexagon",   "⬡", "Hexagon"],
                ["octagon",   "⯃", "Octagon"],
                ["cross",     "✚", "Cross"],
              ] as [string, string, string][]).map(([t, icon, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`shapes-panel-btn ${tool === t ? "active" : ""}`}
                  title={label}
                  onClick={() => { setTool(t as AnnotationType); setPropertiesOpen(true); }}
                >
                  <span className="sp-icon">{icon}</span>
                  <span className="sp-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Decorative ── */}
          <div className="shapes-panel-section">
            <span className="shapes-panel-label">Decorative</span>
            <div className="shapes-panel-grid">
              {([
                ["star",     "☆", "Star"],
                ["heart",    "♡", "Heart"],
                ["cloud",    "☁", "Cloud"],
                ["cylinder", "⌻", "Cylinder"],
              ] as [string, string, string][]).map(([t, icon, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`shapes-panel-btn ${tool === t ? "active" : ""}`}
                  title={label}
                  onClick={() => { setTool(t as AnnotationType); setPropertiesOpen(true); }}
                >
                  <span className="sp-icon">{icon}</span>
                  <span className="sp-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Connectors ── */}
          <div className="shapes-panel-section">
            <span className="shapes-panel-label">Connectors</span>
            <div className="shapes-panel-grid">
              {([
                ["line",  "／", "Line"],
                ["arrow", "➜", "Arrow"],
              ] as [string, string, string][]).map(([t, icon, label]) => (
                <button
                  key={t}
                  type="button"
                  className={`shapes-panel-btn ${tool === t ? "active" : ""}`}
                  title={label}
                  onClick={() => { setTool(t as AnnotationType); setPropertiesOpen(true); }}
                >
                  <span className="sp-icon">{icon}</span>
                  <span className="sp-label">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Graph / Data ── */}
          <div className="shapes-panel-section">
            <span className="shapes-panel-label">Data & Graph</span>
            <div className="shapes-panel-grid">
              <button
                type="button"
                className={`shapes-panel-btn ${tool === "graph" ? "active" : ""}`}
                title="Graph"
                onClick={() => { setTool("graph"); setPropertiesOpen(true); }}
              >
                <span className="sp-icon">📈</span>
                <span className="sp-label">Graph</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
