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
 *  file was handed to the browser. */
export async function exportNoteAsPng(el, title) {
  if (!el) return false
  const blob = await domToBlob(el, {
    type: 'image/png',
    scale: 2,
    backgroundColor: '#0c0d10',
    // Chrome that isn't the document: formatting toolbar, inbox tray, empty
    // hero picker. filter=false EXCLUDES the node.
    filter: (node) => !(node instanceof Element && node.hasAttribute('data-export-exclude')),
  })
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
