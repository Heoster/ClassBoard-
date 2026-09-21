/** @type {import('next').NextConfig} */

// In development Next.js React Fast Refresh and the webpack HMR runtime use
// eval() internally (via the react-refresh-utils bundle).  The CSP must allow
// 'unsafe-eval' in dev or the browser throws an EvalError before the page boots.
// In production the refresh runtime is never shipped, so we keep the strict CSP.
const isDev = process.env.NODE_ENV === "development";

const nextConfig = {
  // ─── Build ──────────────────────────────────────────────────────────────────
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
  // ESLint runs as a separate CI step (npm run lint) so builds stay fast.
  // Remove this line to also enforce lint during `next build`.
  eslint: { ignoreDuringBuilds: true },

  // Suppress "X-Powered-By: Next.js" header — minor security hardening
  poweredByHeader: false,

  // ─── Webpack (used by `next build` and `next dev` without --turbopack) ────────
  // Turbopack has its own alias config below and ignores this block.
  webpack(config) {
    // pdf.js tries to require 'canvas' in Node; alias it to false for browser builds
    config.resolve.alias.canvas = false;
    return config;
  },

  // ─── Turbopack alias (used by `next dev --turbopack`) ────────────────────────
  // Mirrors the webpack canvas=false alias so pdf.js doesn't crash in Turbopack
  // dev mode.  We point `canvas` at the built-in empty module stub.
  // Without this block, Next.js logs "Webpack is configured while Turbopack is not".
  turbopack: {
    resolveAlias: {
      // Empty stub — pdf.js's optional canvas dependency is not needed in the browser
      canvas: "./lib/stubs/canvas.js",
    },
  },

  // ─── HTTP headers ──────────────────────────────────────────────────────────
  async headers() {
    return [
      // ── Security headers on every response ──────────────────────────────────
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Stop browsers guessing MIME types
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer policy — don't leak URL to third parties
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Permissions: allow fullscreen (needed for present mode) and clipboard
          {
            key: "Permissions-Policy",
            value: "fullscreen=*, clipboard-write=*, clipboard-read=(self)",
          },
          // Basic CSP — blocks inline eval in production; allows Supabase, unpkg (pdfjs worker).
          // 'unsafe-eval' is added only in development for Next.js Fast Refresh / HMR.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-eval' only in dev (React Fast Refresh needs it).
              // 'unsafe-inline' kept for Next.js inline script injection.
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com"
                : "script-src 'self' 'unsafe-inline' https://unpkg.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.io",
              "connect-src 'self' https://*.supabase.co https://*.supabase.io wss://*.supabase.co https://unpkg.com",
              "worker-src 'self' blob: https://unpkg.com",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },

      // ── Service worker: no-cache so updates apply immediately ───────────────
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },

      // ── Manifest: short cache so icon/name updates propagate quickly ─────────
      {
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },

      // ── Static icons: long cache (content-addressable by filename) ───────────
      {
        source: "/:icon(icon-.*\\.svg|apple-touch-icon\\.svg|favicon\\.svg)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },

      // ── Next.js hashed chunks: immutable forever ─────────────────────────────
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  // ─── Redirects ──────────────────────────────────────────────────────────────
  async redirects() {
    return [
      // PWA share_target: POST /viewer is handled by the viewer page.
      // Redirect bare /index.html → / for any static host that serves it.
      {
        source: "/index.html",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
