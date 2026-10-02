// Note export (post-v1 round 2) — the two self-serve doors:
// - PNG: rasterize the note column with modern-screenshot (the same engine
//   the embed self-archive trusts), skipping editor chrome via the
//   data-export-exclude attribute, and download it.
// - Print/PDF: a body class + window.print(); the print CSS (in
//   NoteEditorPage.module.css, [data-print-root] recipe) isolates the note
//   column so the browser's Save-as-PDF is the PDF exporter — no new deps,
//   no server round-trip.
//
// ⛔ PNG has a browser canvas ceiling a long note can exceed. A 2,000-
// paragraph note renders a note column roughly 1,732 × 164,000 CSS px; at
// the default scale (2) that asks for a ~3,464 × 328,000px canvas, past
// what a browser's 2D canvas can allocate. Nothing throws when that
// happens — the browser silently hands back an all-but-empty bitmap, which
// is how a member got a 54-byte "PNG" with no warning. See the size-safety
// block below — it is what this file is actually protecting now.

import { domToBlob } from 'modern-screenshot'

// ---------------------------------------------------------------------------
// Canvas size safety
//
// A FIXED limit here is the wrong shape: real browsers disagree by more
// than 15x on what a canvas can be. Chromium allows ~32,767px per side and
// ~268 megapixels of area; a typical ~866px-wide note column hits that
// ceiling only past ~32,760px of height at scale 1, or ~16,380px at scale
// 2 — nowhere near a 2,000-paragraph note's ~164,000px, but WELL past a
// one-size-fits-all conservative number, which would needlessly downgrade
// (or outright refuse) an ordinary mid-length note that this exact browser
// can render at full resolution. Safari / older iOS is far tighter — around
// 16.7 megapixels of area (close to the historical 4096×4096 texture-memory
// limit) — which a Chromium-sized constant would silently exceed.
//
// So: ask THIS engine what it can actually do (canvasCanRender, below),
// rather than guessing from a number picked for a browser the member may
// not be using. HARD_MAX_CANVAS_DIM_PX is kept as a cheap sanity ceiling in
// front of the probe — 32,767px is the largest per-side dimension ANY
// current engine allows, so nothing ever asks a browser to even attempt an
// allocation past the one bound every engine agrees on.
//
// modern-screenshot ships its own `maximumCanvasSize` option — read at
// node_modules/modern-screenshot/dist/index.js, function `bt` (the canvas
// constructor) — and it does NOT do what this needs: when the canvas it
// would allocate exceeds that one number, it scales the WHOLE canvas down
// to fit, silently rendering the full note at a much lower effective
// resolution (the "squashed image" to avoid) instead of failing honestly
// or stepping to a smaller, still-faithful scale. So it is deliberately
// left unset; the checks below replace it.
export const HARD_MAX_CANVAS_DIM_PX = 32767 // Chromium's (and every current engine's) per-side ceiling

// Used ONLY when the real probe cannot run at all (no `document`, or
// `getContext('2d')` returns null — e.g. this project's jsdom test
// environment, which ships no canvas 2D backend). Same iOS-class figures
// the fixed-limit version of this file used, kept as the deterministic
// fallback so tests stay reproducible without a real browser.
export const FALLBACK_MAX_CANVAS_DIM_PX = 16384
export const FALLBACK_MAX_CANVAS_AREA_PX = 16 * 1024 * 1024 // ~16.7 megapixels

export function canvasFitsFallbackLimit(widthPx, heightPx) {
  if (!(widthPx > 0) || !(heightPx > 0)) return false
  return (
    widthPx <= FALLBACK_MAX_CANVAS_DIM_PX &&
    heightPx <= FALLBACK_MAX_CANVAS_DIM_PX &&
    widthPx * heightPx <= FALLBACK_MAX_CANVAS_AREA_PX
  )
}

// Per-(width,height) memo for the real probe below: a probe allocates a
// real canvas backing store, and the same size can be asked about more
// than once per export (scale 2 refused, scale 1 asked next) or across
// repeated exports of the same note in one session.
const _probeCache = new Map()

// Whether THIS context actually renders at all, cached once (it is a
// property of the engine, not of any one width/height). Checked by
// drawing into a trivial, always-supported 4x4 canvas and reading the
// pixel back -- a real browser's 2D context always passes this; a context
// that exists but is a no-op draws nothing and reads back transparent.
//
// This control exists because `getContext('2d') === null` is NOT this
// repo's actual jsdom signature. app/src/test-setup.js installs a
// non-null Proxy-based 2D context (fillRect/drawImage become no-ops,
// getImageData always returns zeroed pixels) so ECharts/zrender can mount
// without crashing in every test file. Checking only for a null context
// would miss that stub entirely: it would call fillRect and drawImage
// believing they worked, read back an always-transparent pixel, and
// report every note -- long or short -- as unrenderable. The control
// below catches a non-functional context whether it is absent, null, or
// (as here) present but inert, without any test-environment-specific
// code in this file.
let _contextActuallyRenders // undefined until first checked

function _canvasContextIsReal() {
  if (_contextActuallyRenders !== undefined) return _contextActuallyRenders
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    _contextActuallyRenders = false
    return false
  }
  let probe = null
  try {
    probe = document.createElement('canvas')
    probe.width = 4
    probe.height = 4
    const ctx = probe.getContext('2d')
    if (!ctx) {
      _contextActuallyRenders = false
      return false
    }
    ctx.fillStyle = '#fff'
    ctx.fillRect(3, 3, 1, 1)
    const pixel = ctx.getImageData(3, 3, 1, 1).data
    _contextActuallyRenders = pixel[3] !== 0
    return _contextActuallyRenders
  } catch {
    _contextActuallyRenders = false
    return false
  } finally {
    if (probe) { probe.width = 0; probe.height = 0 }
  }
}

/** The standard canvas-size-limit detection technique: allocate a canvas
 *  of `width` x `height`, paint its far corner pixel, draw JUST that
 *  corner into a 1x1 canvas, and read it back. A canvas past the engine's
 *  real limit either throws, hands back a null context, or silently
 *  clips/no-ops the draw -- every one of those reads back as a
 *  transparent pixel, which is what this checks for. Wrapped in
 *  try/catch; any throw reads as "cannot render".
 *
 *  Falls back to the fixed, conservative FALLBACK_MAX_CANVAS_* check when
 *  this engine's 2D context does not actually render at all (see
 *  _canvasContextIsReal above) -- so the answer stays deterministic in an
 *  environment with no real canvas to ask, rather than refusing or
 *  allowing blind. */
export function canvasCanRender(width, height) {
  const key = `${width}x${height}`
  if (_probeCache.has(key)) return _probeCache.get(key)
  const result = _probeCanvasRender(width, height)
  _probeCache.set(key, result)
  return result
}

function _probeCanvasRender(width, height) {
  if (!_canvasContextIsReal()) return canvasFitsFallbackLimit(width, height)
  let big = null
  let small = null
  try {
    big = document.createElement('canvas')
    big.width = width
    big.height = height
    const bigCtx = big.getContext('2d')
    if (!bigCtx) return canvasFitsFallbackLimit(width, height)

    bigCtx.fillStyle = '#fff'
    bigCtx.fillRect(width - 1, height - 1, 1, 1)

    small = document.createElement('canvas')
    small.width = 1
    small.height = 1
    const smallCtx = small.getContext('2d')
    if (!smallCtx) return canvasFitsFallbackLimit(width, height)

    smallCtx.drawImage(big, width - 1, height - 1, 1, 1, 0, 0, 1, 1)
    const pixel = smallCtx.getImageData(0, 0, 1, 1).data
    return pixel[3] !== 0 // alpha -- non-transparent means the corner pixel really drew
  } catch {
    return false // a genuine throw IS the engine's answer, not a reason to fall back
  } finally {
    // Release the backing stores rather than waiting on GC for what can be
    // a multi-hundred-megapixel allocation.
    if (big) { big.width = 0; big.height = 0 }
    if (small) { small.width = 0; small.height = 0 }
  }
}

const SCALE_CANDIDATES = [2, 1]

/** The largest scale in SCALE_CANDIDATES (2, then 1) THIS browser can
 *  actually render the note at, or null when even scale 1 cannot.
 *  HARD_MAX_CANVAS_DIM_PX is checked first as a cheap sanity ceiling
 *  (never even ask the probe to allocate past what every engine agrees
 *  is too big); `probeFn` -- late-bound here in the body, never a default
 *  parameter value -- defaults to the real canvasCanRender so a test can
 *  swap in a fixed-answer probe without touching module state. An
 *  unmeasurable element (0×0 -- mid-layout, or no layout engine at all)
 *  returns the default scale rather than refusing a render nothing
 *  proved was too big; the blob-size guard below is the backstop for
 *  that case. */
export function pickSafeScale(elementWidthPx, elementHeightPx, probeFn) {
  if (!(elementWidthPx > 0) || !(elementHeightPx > 0)) return SCALE_CANDIDATES[0]
  const probe = typeof probeFn === 'function' ? probeFn : canvasCanRender
  for (const scale of SCALE_CANDIDATES) {
    const w = elementWidthPx * scale
    const h = elementHeightPx * scale
    if (w > HARD_MAX_CANVAS_DIM_PX || h > HARD_MAX_CANVAS_DIM_PX) continue // no engine allows this regardless of the probe
    if (probe(w, h)) return scale
  }
  return null
}

/** The sentence a member sees when a PNG cannot be made — either this
 *  browser cannot render a canvas big enough for the note at any safe
 *  scale, or it handed back a blob too small to be real content (the
 *  54-byte case — covers an engine whose own limit the probe above could
 *  not see coming, e.g. a memory failure rather than a hard size cap).
 *  Names the doors that DO work for a long note: Print still works (the
 *  browser's own print pipeline has no canvas-pixel ceiling), and every
 *  format on the Export menu is built server-side from the stored note,
 *  not a screenshot. */
export const TOO_LONG_FOR_PNG_MESSAGE =
  "This note is too long for one PNG image. Nothing was downloaded — try Print (Save as PDF), or export it as Markdown, Web page, JSON or Word from the Export menu."

const MIN_PLAUSIBLE_PNG_BYTES = 1024
const MIN_NONTRIVIAL_CANVAS_AREA_PX = 4096 // ~64×64px

/** True when `blob` is implausibly small for a canvas of this size — the
 *  signature of a browser that silently refused the allocation (the
 *  54-byte bug) rather than a legitimately tiny image. A near-empty
 *  canvas is exempt: a one-line note's small PNG is not a failure. */
export function blobLooksLikeFailedRender(blob, canvasWidthPx, canvasHeightPx) {
  if (!blob || blob.size === 0) return true
  if (canvasWidthPx * canvasHeightPx < MIN_NONTRIVIAL_CANVAS_AREA_PX) return false
  return blob.size < MIN_PLAUSIBLE_PNG_BYTES
}

export function safeFileName(title, ext) {
  const base = String(title || '').trim().replace(/[^\w\- ]+/g, '').slice(0, 60).trim()
  return `${base || 'note'}.${ext}`
}

/** Rasterize `el` (the note column) to a PNG download. Resolves
 *  `{ ok: true }` when a file was handed to the browser, or
 *  `{ ok: false, reason? }` when nothing was downloaded. `reason`, when
 *  present, is TOO_LONG_FOR_PNG_MESSAGE — the member-facing sentence; its
 *  absence means an ordinary failure (the caller's own generic message).
 *  `probeFn`, late-bound in pickSafeScale, lets a test drive the size
 *  decision without a real canvas backend. */
export async function exportNoteAsPng(el, title, probeFn) {
  if (!el) return { ok: false }

  const rect = el.getBoundingClientRect()
  const width = rect.width || el.offsetWidth || 0
  const height = rect.height || el.offsetHeight || 0
  const scale = pickSafeScale(width, height, probeFn)
  if (scale == null) {
    // Never hand the member an empty file: refuse before asking the browser
    // to allocate a canvas known to be past its ceiling.
    return { ok: false, reason: TOO_LONG_FOR_PNG_MESSAGE }
  }

  const blob = await domToBlob(el, {
    type: 'image/png',
    scale,
    backgroundColor: '#0c0d10',
    // Chrome that isn't the document: formatting toolbar, inbox tray, empty
    // hero picker. filter=false EXCLUDES the node.
    filter: (node) => !(node instanceof Element && node.hasAttribute('data-export-exclude')),
  })

  if (blobLooksLikeFailedRender(blob, Math.floor(width * scale), Math.floor(height * scale))) {
    // The size pre-check said this should fit, and the browser still came
    // back with next-to-nothing — its own limit is lower than ours. Same
    // refusal, same sentence: never hand the member the 54-byte file.
    return { ok: false, reason: TOO_LONG_FOR_PNG_MESSAGE }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFileName(title, 'png')
  a.click()
  URL.revokeObjectURL(url)
  return { ok: true }
}

/** Print the note (→ the browser's Save as PDF). The body class scopes the
 *  print stylesheet; afterprint cleans it up. */
export function printNote() {
  document.body.classList.add('uct-print-note')
  const off = () => {
    document.body.classList.remove('uct-print-note')
    window.removeEventListener('afterprint', off)
  }
  window.addEventListener('afterprint', off)
  window.print()
}
