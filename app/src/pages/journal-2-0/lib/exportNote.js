// Note export (post-v1 round 2) — the two self-serve doors:
// - PNG: rasterize the note column with modern-screenshot (the same engine
//   the embed self-archive trusts), skipping editor chrome via the
//   data-export-exclude attribute, and download it.
// - Print/PDF: a body class + window.print(); the print CSS (in
//   NoteEditorPage.module.css, [data-print-root] recipe) isolates the note
//   column so the browser's Save-as-PDF is the PDF exporter — no new deps,
//   no server round-trip.

import { domToBlob } from 'modern-screenshot'

export function safeFileName(title, ext) {
  const base = String(title || '').trim().replace(/[^\w\- ]+/g, '').slice(0, 60).trim()
  return `${base || 'note'}.${ext}`
}

/** Rasterize `el` (the note column) to a PNG download. Returns true when a
 *  file was handed to the browser.
 *
 * Wave 10 TY3: the editor's top-level blocks carry `content-visibility: auto`
 * (NoteEditorPage.module.css) so an off-screen block skips its own layout and
 * paint. `domToBlob` reads the live, rendered DOM directly -- it is not a
 * browser print, so it gets none of Chromium's own "treat as visible while
 * printing" handling -- and a skipped block would rasterize blank. The
 * `uct-exporting-note` body class (matched by that same stylesheet) forces
 * every block back to `content-visibility: visible` for the span of the
 * capture, the same way `printNote()` already scopes its own print CSS with
 * `uct-print-note`.
 *
 * ⚠️ Verified against the BASE build (no content-visibility at all) too: a
 * very long note (2,000 ¶, ~82,000px tall) already rasterizes to a ~54-byte,
 * essentially blank PNG with NO changes from this lane -- the note's render
 * height exceeds the browser's own maximum canvas size, a pre-existing
 * `modern-screenshot` limit this lane did not introduce and is not fixing
 * here. The class above is a correctness guarantee for whatever domToBlob
 * CAN capture, not a claim that every note's PNG export already works. */
export async function exportNoteAsPng(el, title) {
  if (!el) return false
  document.body.classList.add('uct-exporting-note')
  let blob
  try {
    blob = await domToBlob(el, {
      type: 'image/png',
      scale: 2,
      backgroundColor: '#0c0d10',
      // Chrome that isn't the document: formatting toolbar, inbox tray, empty
      // hero picker. filter=false EXCLUDES the node.
      filter: (node) => !(node instanceof Element && node.hasAttribute('data-export-exclude')),
    })
  } finally {
    document.body.classList.remove('uct-exporting-note')
  }
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFileName(title, 'png')
  a.click()
  URL.revokeObjectURL(url)
  return true
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
