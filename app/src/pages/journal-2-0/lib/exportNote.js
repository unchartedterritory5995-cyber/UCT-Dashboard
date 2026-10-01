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
// Real browser ceilings, picked conservatively under ALL of them rather
// than detecting the browser:
//   - Chromium: ~32,767px per side, ~268 megapixels of area.
//   - Safari / older iOS: far tighter — around 16.7 megapixels of area
//     (close to the historical 4096×4096 ≈ 16.78MP texture-memory limit).
// MAX_CANVAS_DIM_PX sits at half Chromium's per-side cap (a 2x margin for
// rounding and engines this wasn't measured against); MAX_CANVAS_AREA_PX is
// the tighter iOS-class area figure. The same two numbers protect every
// engine without per-browser detection, at the cost of occasionally
// refusing a render a desktop Chromium tab could technically still make.
//
// modern-screenshot ships its own `maximumCanvasSize` option — read at
// node_modules/modern-screenshot/dist/index.js, function `bt` (the canvas
// constructor) — and it does NOT do what this needs: when the canvas it
// would allocate exceeds that one number, it scales the WHOLE canvas down
// to fit, silently rendering the full note at a much lower effective
// resolution (the "squashed image" to avoid) instead of failing honestly.
// So it is deliberately left unset; the checks below replace it.
export const MAX_CANVAS_DIM_PX = 16384
export const MAX_CANVAS_AREA_PX = 16 * 1024 * 1024 // ~16.7 megapixels

export function canvasFitsSafeLimit(widthPx, heightPx) {
  if (!(widthPx > 0) || !(heightPx > 0)) return false
  return (
    widthPx <= MAX_CANVAS_DIM_PX &&
    heightPx <= MAX_CANVAS_DIM_PX &&
    widthPx * heightPx <= MAX_CANVAS_AREA_PX
  )
}

const SCALE_CANDIDATES = [2, 1]

/** The largest scale in SCALE_CANDIDATES (2, then 1) whose resulting
 *  canvas still fits the safe limit, or null when even scale 1 does not
 *  fit. An unmeasurable element (0×0 — mid-layout, or no layout engine at
 *  all) returns the default scale rather than refusing a render nothing
 *  proved was too big; the blob-size guard below is the backstop for
 *  that case. */
export function pickSafeScale(elementWidthPx, elementHeightPx) {
  if (!(elementWidthPx > 0) || !(elementHeightPx > 0)) return SCALE_CANDIDATES[0]
  for (const scale of SCALE_CANDIDATES) {
    if (canvasFitsSafeLimit(elementWidthPx * scale, elementHeightPx * scale)) return scale
  }
  return null
}

/** The sentence a member sees when a PNG cannot be made — either the note
 *  is too long to fit the safe canvas limit, or the browser handed back a
 *  blob too small to be real content (the 54-byte case — covers a browser
 *  whose own limit is lower than the constant above). Names the doors that
 *  DO work for a long note: Print still works (the browser's own print
 *  pipeline has no canvas-pixel ceiling), and every format on the Export
 *  menu is built server-side from the stored note, not a screenshot. */
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
 *  absence means an ordinary failure (the caller's own generic message). */
export async function exportNoteAsPng(el, title) {
  if (!el) return { ok: false }

  const rect = el.getBoundingClientRect()
  const width = rect.width || el.offsetWidth || 0
  const height = rect.height || el.offsetHeight || 0
  const scale = pickSafeScale(width, height)
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
