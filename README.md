# Smartboard Tool — Free Interactive Classroom Presentation Software

> Open-source smartboard and PDF annotation platform for teachers. Annotate PDFs, draw shapes, present lessons, and export — from any device, in real time. Built with Next.js 15, React 19, and Supabase.

[![License](https://img.shields.io/github/license/Heoster/ClassBoard-)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-cloud--sync-green)](https://supabase.com/)

---

## What is Smartboard Tool?

**Smartboard Tool** is a free, open-source interactive classroom presentation application that runs entirely in the browser. It replaces expensive physical smartboards, clunky desktop presentation software, and paid annotation subscriptions.

Teachers can open any PDF document, annotate it live with pen, shapes, and text, present it in full-screen mode, and export the annotated result as a PDF — all from a laptop, tablet, or interactive display, with no installation required beyond a browser.

**Key use cases:**
- Interactive whiteboard replacement for classrooms and lecture halls
- Live PDF annotation during lessons and meetings
- Slide presentation with real-time drawing tools
- Remote teaching with mobile device integration via QR code
- Digital note-taking and diagram creation on blank canvas

---

## Features

### Drawing and Annotation Tools (25 tools total)

| Category | Tools |
|---|---|
| Freehand | Pen (ink), Calligraphy, Highlighter |
| Erasers | Pixel eraser (partial stroke), Object eraser (full stroke) |
| Basic shapes | Rectangle, Ellipse, Triangle, Right triangle, Diamond, Parallelogram |
| Polygons | Pentagon, Hexagon, Octagon, Cross |
| Decorative | Star, Heart, Cloud, Cylinder |
| Connectors | Line, Arrow |
| Content | Text (8 fonts), Image (drag-and-drop) |
| Data | Graph / coordinate plane |

### Viewer and Presentation
- **High-resolution PDF rendering** — renders at 2560px equivalent width; quality never degrades on resize or zoom
- **16:9 blank canvas** — start a slide presentation without a PDF
- **Ghost shape preview** — dotted outline shows exact shape position and dimensions while dragging
- **Draw outside canvas** — annotations can extend beyond the slide boundary onto the dark stage
- **Zoom and pan** — mouse wheel, click-drag, pinch-to-zoom, double-click to reset
- **Present mode** — hides all toolbar UI, leaving only the clean slide for projection
- **Page counter** — auto-hides, shows on navigation
- **Smooth or instant page transitions**

### Workspace and Productivity
- **Draggable floating toolbar** — grip handle to reposition anywhere; double-click to snap back to centre
- **Separate draggable shapes panel** — keeps all 15+ shapes and graph accessible as a persistent floating window
- **Undo / redo** — full deterministic history with Ctrl+Z / Ctrl+Y; also in the header for one-click access
- **Keyboard shortcuts** — Ctrl+Z undo, Ctrl+Y redo, Delete removes selection, Escape cancels draft
- **Auto-hide toolbar** — collapses during drawing; swipe up or tap to restore
- **Collapsible page sidebar** — thumbnail strip on the left; collapses to icon pills

### Settings (4 tabs)
- **Canvas** — slide background presets + custom colour picker, dot/line grid overlay, clear actions
- **Tools** — default pen colour, stroke width, opacity, auto-hide toggle, sidebar toggle
- **Document** — rename presentation, annotation stats (pages, strokes, shapes), PDF export, clear entire presentation
- **View** — zoom controls, fullscreen, hide all annotations, laser pointer mode, smooth transitions, present mode shortcut

### Cloud and Collaboration
- **Supabase cloud sync** — all annotations saved in real time; open the same document on another device and continue immediately
- **Row-level security** — each user can only access their own documents via Supabase RLS policies
- **Mobile upload via QR code** — scan from any smartphone to upload documents to the active session wirelessly
- **Multi-device session** — annotations are persisted and restored across browser sessions

### Export
- **PDF export with annotations** — one-click export from the top bar; all drawings, shapes, and text are baked into the output PDF
- Original PDF is never modified; annotations are stored as a separate versioned layer

---

## Screenshots and Demo

![Maples Academy Smartboard Tool demo](examples/demo.gif)

*Live PDF annotation with pen, shapes, and text in the viewer*

![Mobile upload via QR code](examples/mobile.gif)

*Mobile device upload via QR code pairing*

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19, TypeScript 5, Vanilla CSS |
| PDF rendering | PDF.js 4.3.136 |
| PDF export | pdf-lib 1.17 |
| Auth & database | Supabase (PostgreSQL + Row Level Security) |
| Storage | Supabase private storage buckets |
| QR code | qrcode |
| Testing | Vitest |
| Deployment | Vercel / any Node.js host |

---

## Requirements

- Node.js 20 or newer
- pnpm (or npm / yarn)
- A Supabase project (optional for local-only use)

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Heoster/ClassBoard-.git
cd ClassBoard-
pnpm install
```

### 2. Configure environment variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The app renders its full local UI without Supabase. Sign-in, cloud sync, and multi-device sessions require these values.

> **Security note:** Use only the publishable key in browser-exposed variables. Never expose a Supabase service-role key in `.env.local`, client code, or deployment logs.

### 3. Apply the database migration

Apply [`supabase/migrations/20260912000000_classboard.sql`](supabase/migrations/20260912000000_classboard.sql) using the Supabase CLI or SQL editor. The migration creates:
- `documents`, `annotations`, `exports`, `upload_sessions`, `presentation_sessions`, `realtime_events` tables
- Row-level security policies for all tables
- Private `documents`, `exports`, and `assets` storage buckets

### 4. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Useful Commands

```bash
pnpm dev        # Start Next.js development server (http://localhost:3000)
pnpm build      # Create an optimised production build
pnpm start      # Serve the production build
pnpm typecheck  # Run TypeScript type checking without emitting files
pnpm test       # Run the Vitest test suite
```

---

## App Routes

| Route | Purpose |
|---|---|
| `/` | Landing page — redirects authenticated users to the dashboard |
| `/sign-in` | Email/password authentication |
| `/dashboard` | Browse and manage saved documents |
| `/viewer` | Main smartboard workspace — PDF viewer, annotation tools, present mode, export |
| `/documents` | Full document library with delete and open actions |
| `/upload` | QR code generation for mobile device pairing |
| `/upload/:sessionId` | Mobile-optimised upload page opened by scanning the QR code |
| `/settings` | User preferences and account management |
| `/api/import` | Server route for optional PPT/PPTX → PDF conversion |

---

## PPT and PPTX Support

PDF files are handled natively. PPT and PPTX files require a separate authenticated HTTPS conversion service:

```env
PRESENTATION_CONVERTER_URL=https://your-converter.example.com/convert
PRESENTATION_CONVERTER_TOKEN=your-server-only-token
```

Keep these values server-side only. They are consumed by `app/api/import/route.ts` and are never exposed to the browser.

---

## Deployment

1. Push the repository to GitHub (or connect directly in Vercel).
2. Set the same environment variables in your deployment host.
3. Apply the Supabase migration before enabling saved documents.
4. Use `pnpm build` as the build command.

The app is compatible with Vercel, Railway, Fly.io, Render, and any platform that supports Node.js 20 with the Next.js standalone output.

---

## Frequently Asked Questions

**Is this free to use and self-host?**
Yes. The code is open-source under the project's license. You can self-host it for free on any Node.js platform. The only potential cost is your Supabase plan if you exceed the free tier limits.

**Does it work offline or without Supabase?**
Yes. The viewer, all drawing tools, and PDF export work entirely in the browser without a network connection. Supabase is only required for saving documents to the cloud and signing in.

**What PDF files are supported?**
Any standard PDF. The viewer uses PDF.js 4.3.136. Password-protected PDFs are not currently supported.

**Can multiple teachers use it at the same time?**
Each authenticated user has their own documents isolated by Supabase row-level security. Real-time multiplayer editing is not currently implemented.

**How are annotations stored?**
Annotations are stored as a JSON layer in the Supabase `annotations` table, keyed by document ID and page number. The original PDF file is never modified. Annotations are serialised as normalised 0–1 coordinates and reconstructed on load.

**What devices are supported?**
Any device with a modern browser — desktop, laptop, tablet (including Apple Pencil on iPad), and interactive smartboard displays. Pinch-to-zoom and touch drawing are fully supported.

**Can I export my annotations?**
Yes — use the 📥 Export PDF button in the top bar, or the Settings → Document tab. Annotations are baked into the exported PDF using pdf-lib.

---

## Project Notes

- PDF.js is intentionally pinned to version **4.3.136**. Upgrading to a newer patch may change rendering behaviour.
- Review [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSE`](LICENSE) before distributing the application.
- ESLint is configured with `.eslintrc` (legacy format). The project uses `eslint: { ignoreDuringBuilds: true }` in `next.config.mjs` due to an ESLint v8/v9 compatibility gap. TypeScript (`pnpm typecheck`) is the primary static analysis tool.

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach. Please run `pnpm typecheck` and `pnpm build` before submitting.

---

## License

See [LICENSE](LICENSE) for details.

---

*Classboard Tool — interactive whiteboard software · classroom presentation tool · PDF annotator · free smartboard app · open-source teaching software*
