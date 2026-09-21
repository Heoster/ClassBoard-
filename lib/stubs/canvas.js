// Empty stub — pdf.js optionally requires 'canvas' for server-side rendering
// of PDF pages to a Node canvas.  This app renders in the browser only, so
// the dependency is never needed.  Both webpack (alias canvas = false) and
// Turbopack (resolveAlias canvas → this file) point here so the import is a
// no-op in both bundlers.
module.exports = {};
