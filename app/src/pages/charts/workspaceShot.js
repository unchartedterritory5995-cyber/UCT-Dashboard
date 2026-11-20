// app/src/pages/charts/workspaceShot.js
//
// "Screenshot workspace" (owner 11-16): rasterize ONLY the /charts board — the <main> that holds
// the react-grid-layout grid (or the Multi Chart grid). The left site rail, the top row (Add widget /
// Tools), the Layout Dock under the board and the UCT Agent column are siblings of that element, so
// they are outside the capture by construction, not by filtering.
//
// ⛔ LAZY. This module is loaded with `import('./workspaceShot')` from WorkspaceShotButton on the
// click, and modern-screenshot is loaded from here the same way. Nothing on a first open (the
// /charts page, the Notebook's first-open closure — tools/notebook_perf_budgets.py) pays for it.
//
// Charts stay crisp: modern-screenshot clones every <canvas> as an <img> of its OWN backing bitmap
// (canvas.toDataURL — lightweight-charts sizes that bitmap at devicePixelRatio), and the foreignObject
// SVG is rasterized at `scale`, so a chart bitmap lands 1:1 when scale == devicePixelRatio and is
// never re-rendered at CSS size.
//
// SPEED (coordinator 11-16: ~10 s per click on a one-chart board). What the library spends its time
// on, and what this module does about each:
//   - per node, it copies EVERY computed CSS property (~350) after diffing against a default element
//     rendered in a sandbox iframe -> `includeStyleProperties` (SHOT_STYLE_PROPS) limits that to the
//     properties that change pixels, which also shrinks the SVG the browser must parse and paint;
//   - it re-creates that sandbox, re-reads every stylesheet for @font-face, re-fetches every image
//     and re-inlines the fonts on every capture -> ONE context per board element is kept and reused
//     (createContext once; its default-style, font and request caches survive between clicks);
//   - createContext waits for every <img> under the board to load, for the whole `timeout` -> a
//     short wait on creation only, and images that never loaded (lazy, broken) are filtered out;
//   - display:none subtrees (inactive widget tabs) are cloned for nothing -> filtered out.
// The click path is warmed on hover/focus of the button (warmWorkspaceShot): the library is loaded
// and the context created before the click. Dev builds print a timing breakdown (console.debug,
// plus the library's own console.time stages via `debug`).

export const SHOT_MIN_SCALE = 2
export const SHOT_MAX_EDGE = 8000
// 1×1 transparent PNG: a cross-origin image that cannot be read (a company logo without CORS) is
// replaced by this instead of tainting or failing the whole capture.
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** max(2, devicePixelRatio), lowered so the long side of the output never passes SHOT_MAX_EDGE. */
export function shotScale(width, height, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1) {
  const want = Math.max(SHOT_MIN_SCALE, Number.isFinite(dpr) ? dpr : 1)
  const long = Math.max(width || 0, height || 0)
  if (!(long > 0)) return want
  return Math.min(want, SHOT_MAX_EDGE / long)
}

const pad = (n) => String(n).padStart(2, '0')

/** `UCT-workspace-<layout name>-<YYYY-MM-DD-HHmm>.png`, local time, file-system-safe characters only. */
export function workspaceShotFilename(layoutName, when = new Date()) {
  const safe = String(layoutName || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '') || 'board'
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`
  return `UCT-workspace-${safe}-${stamp}.png`
}

// Roles that are only ever transient UI on the board (an open menu, a hover tip).
const TRANSIENT_ROLES = new Set(['menu', 'tooltip'])

/** The node filter: drop transient UI (open menus, tooltips, resize/drag handles, the placement
 *  ghost) and anything marked `data-shot-exclude`. `excludeClasses` are the board's own (hashed)
 *  CSS-module class names, passed in by the workspace so this module imports no stylesheet. */
export function makeShotFilter(excludeClasses = []) {
  const classes = excludeClasses.filter(Boolean)
  return (node) => {
    if (!node || node.nodeType !== 1) return true
    if (node.hasAttribute('data-shot-exclude')) return false
    const role = node.getAttribute('role')
    if (role && TRANSIENT_ROLES.has(role)) return false
    if ((node.getAttribute('data-guide') || '').startsWith('widget.resize.')) return false
    if (node.getAttribute('aria-label') === 'Drag to move widget') return false
    // An <img> that never loaded (lazy, offscreen, broken) paints nothing and would only be fetched
    // and waited on.
    if (node.tagName === 'IMG' && (!node.complete || !node.naturalWidth)) return false
    // display:none subtrees (an inactive widget tab) paint nothing: skip cloning them. SVG children
    // and display:contents have no boxes of their own, so only an HTML element with no box AND a
    // computed display of none is dropped.
    if (typeof node.getClientRects === 'function' && node.namespaceURI === 'http://www.w3.org/1999/xhtml'
      && node.getClientRects().length === 0) {
      try { if (getComputedStyle(node).display === 'none') return false } catch { /* detached */ }
    }
    const cl = node.classList
    if (cl) {
      if (cl.contains('react-resizable-handle') || cl.contains('react-grid-placeholder')) return false
      for (const c of classes) if (cl.contains(c)) return false
    }
    return true
  }
}

/** The first opaque background up the tree, so the PNG carries the board's own colour, never a
 *  transparent hole where the board inherits its background. */
export function boardBackground(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    let bg = ''
    try { bg = getComputedStyle(n).backgroundColor || '' } catch { /* detached */ }
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg
  }
  // None at all: the theme's own canvas (the graphite default when no theme can be read).
  return themeVar('--bg', '#0e0f0d')
}

/** A theme token's value on <html>, else `fallback` (a detached document, jsdom). Inline, not
 *  lib/theme: this module carries no static import (workspaceShot.lazy.test.js). */
function themeVar(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback } catch { return fallback }
}

// The CSS properties that change pixels. Everything else the library would copy (cursor,
// pointer-events, transitions, animation, will-change, user-select, ...) is skipped per node.
export const SHOT_STYLE_PROPS = Object.freeze([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'align-items', 'align-self', 'align-content', 'justify-content', 'justify-items', 'justify-self',
  'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow',
  'grid-auto-columns', 'grid-auto-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'overflow-x', 'overflow-y', 'overflow-clip-margin', 'text-overflow', 'visibility', 'opacity',
  'transform', 'transform-origin', 'translate', 'scale', 'rotate', 'clip-path', 'mix-blend-mode',
  'isolation', 'filter', 'backdrop-filter', 'content-visibility',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'outline-width', 'outline-style', 'outline-color', 'outline-offset', 'box-shadow',
  'background-color', 'background-image', 'background-size', 'background-position-x', 'background-position-y',
  'background-repeat', 'background-clip', 'background-origin', 'background-attachment', 'background-blend-mode',
  'mask-image', 'mask-size', 'mask-position', 'mask-repeat', 'mask-mode',
  '-webkit-mask-image', '-webkit-mask-size', '-webkit-mask-position', '-webkit-mask-repeat',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant-numeric',
  'font-variant-caps', 'font-variant-ligatures', 'font-feature-settings', 'font-variation-settings', 'font-kerning',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-align-last', 'text-indent', 'text-transform',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness',
  'text-underline-offset', 'text-shadow', 'white-space', 'white-space-collapse', 'text-wrap', 'text-wrap-mode',
  'word-break', 'overflow-wrap', 'hyphens', 'vertical-align', 'direction', 'unicode-bidi', 'writing-mode', 'tab-size',
  '-webkit-line-clamp', '-webkit-box-orient', '-webkit-text-fill-color', '-webkit-text-stroke-width',
  '-webkit-text-stroke-color', '-webkit-font-smoothing',
  'list-style-type', 'list-style-position', 'list-style-image',
  'border-collapse', 'border-spacing', 'table-layout', 'caption-side', 'empty-cells',
  'object-fit', 'object-position', 'image-rendering', 'appearance', 'accent-color',
  'scrollbar-width', 'scrollbar-color',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'paint-order',
  'vector-effect', 'stop-color', 'stop-opacity', 'shape-rendering', 'clip-rule', 'dominant-baseline', 'text-anchor',
])

const DEV = !!(import.meta.env && import.meta.env.DEV)
const IMG_WAIT_MS = 1200      // createContext's one-time wait for <img> loads
const RUN_TIMEOUT_MS = 10000  // per-resource fetch + the final SVG decode

// One live context per board element: its sandbox default styles, inlined fonts and fetched images
// carry over from click to click (and from the hover warm-up to the click).
let _ctx = null      // { board, context }
let _ctxPromise = null

const clock = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now())

async function contextFor(board, lib) {
  if (_ctx && _ctx.board === board && board.isConnected !== false) return _ctx.context
  if (_ctxPromise && _ctxPromise.board === board) return _ctxPromise.p
  if (_ctx) { try { lib.destroyContext(_ctx.context) } catch { /* already gone */ } _ctx = null }
  const p = (async () => {
    const context = await lib.createContext(board, {
      type: 'image/png',
      scale: 1,
      debug: DEV,
      timeout: IMG_WAIT_MS,
      autoDestruct: false,
      includeStyleProperties: SHOT_STYLE_PROPS,
      fetch: { placeholderImage: BLANK_PNG },
    })
    context.timeout = RUN_TIMEOUT_MS
    _ctx = { board, context }
    return context
  })()
  _ctxPromise = { board, p }
  try { return await p } finally { if (_ctxPromise?.p === p) _ctxPromise = null }
}

/** Hover/focus warm-up: load the library and build the board's context before the click. Never throws. */
export async function warmWorkspaceShot(board) {
  try {
    if (!board) return
    const lib = await import('modern-screenshot')
    await contextFor(board, lib)
  } catch { /* the click retries for real */ }
}

/** Test seam: forget the cached context. */
export function _resetShotContext() { _ctx = null; _ctxPromise = null }

/** Capture the board element -> { blob, width, height, filename }. Throws on a total failure; a
 *  single unreadable image is replaced (placeholderImage), never fatal. */
export async function captureWorkspace(board, { layoutName, excludeClasses, now = new Date() } = {}) {
  if (!board || typeof board.getBoundingClientRect !== 'function') throw new Error('no board to capture')
  const rect = board.getBoundingClientRect()
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (!(width > 0 && height > 0)) throw new Error('the board has no size')
  const scale = shotScale(width, height)
  const t0 = clock()
  const lib = await import('modern-screenshot')
  const t1 = clock()
  const context = await contextFor(board, lib)
  const t2 = clock()
  // The board may have been resized since the context was made: every per-capture field is set here.
  let kept = 0
  const keep = makeShotFilter(excludeClasses)
  Object.assign(context, {
    width, height, scale, dpi: scale === 1 ? null : 96 * scale,
    backgroundColor: boardBackground(board),
    filter: DEV ? (n) => { const k = keep(n); if (k && n && n.nodeType === 1) kept += 1; return k } : keep,
    tasks: [],
  })
  let blob
  try {
    blob = await lib.domToBlob(context)
  } catch (err) {
    // A broken context must not poison the next click.
    try { lib.destroyContext(context) } catch { /* ignore */ }
    _ctx = null
    throw err
  }
  const t3 = clock()
  if (DEV && typeof console !== 'undefined') {
    console.debug(`[workspace-shot] ${Math.round(t3 - t0)} ms total: import ${Math.round(t1 - t0)} ms, context ${Math.round(t2 - t1)} ms, clone+raster+encode ${Math.round(t3 - t2)} ms; ${kept} elements kept, ${board.querySelectorAll('canvas').length} canvases, ${Math.round(width * scale)}x${Math.round(height * scale)} @${scale.toFixed(2)}x, ${((blob && blob.size) / 1e6 || 0).toFixed(2)} MB`)
  }
  if (!blob || !blob.size) throw new Error('empty capture')
  return { blob, width: Math.round(width * scale), height: Math.round(height * scale), filename: workspaceShotFilename(layoutName, now) }
}

/** Copy a PNG blob to the clipboard. Resolves true on success, false where the browser can't. */
export async function copyPng(blob) {
  try {
    const CI = typeof window !== 'undefined' ? window.ClipboardItem : undefined
    if (!CI || !navigator?.clipboard?.write) return false
    await navigator.clipboard.write([new CI({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

/** Save a blob as a file through a temporary object-URL anchor. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
