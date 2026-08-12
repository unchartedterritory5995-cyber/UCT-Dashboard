// Journal Widgets — the durability half of an embed: the archived PNG behind
// every snapshot, and the capture-time bars warm. Both are best-effort and
// fire-and-forget; an embed is never blocked (or broken) by either.

import { domToBlob } from 'modern-screenshot'

/** Rasterize an embed's DOM (chart canvases included — LWC canvases are
 *  same-origin and untainted) to a PNG Blob. 2× pixel ratio so the archive
 *  reads crisply when the entry is later viewed larger than the capture. */
export async function captureElementPng(el) {
  if (!el) return null
  return domToBlob(el, { type: 'image/png', scale: 2 })
}

/** Upload an archive PNG through the existing note-image pipeline (PNG is
 *  already on the server's allowlist; auth-scoped serving; R2-backed-up).
 *  Behind this one seam so R2/presigned storage can swap in when sharing
 *  ships. Returns {url, width, height}. */
export async function storeFallbackImage(noteId, blob) {
  const fd = new FormData()
  // A typeless Blob uploads as application/octet-stream and the server's
  // MIME allowlist 400s it — the notebook importer already learned this the
  // hard way (MIME_BY_EXT). Name + type BOTH set, explicitly.
  fd.append('file', new File([blob], 'widget-embed.png', { type: 'image/png' }))
  const res = await fetch(`/api/j2/notes/${noteId}/images`, {
    method: 'POST', credentials: 'include', body: fd,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `archive upload failed (${res.status})`)
  }
  return res.json()
}

/** Capture-time warm: ask the server to deep-fill this (ticker, tf) so the
 *  embed can re-render from data for the life of the entry (the server rail
 *  is bounded + throttled; this is a hint, not a dependency). */
export function kickSnapshotWarm(params) {
  const ticker = params?.symbol
  if (!ticker) return
  try {
    fetch('/api/bars/warm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // `to` (the capture anchor) lets the daily warm short-circuit when the
      // store already holds history at/before it, instead of a full re-fetch.
      body: JSON.stringify({ ticker, tf: params.tf || 'D', to: params.to ?? null }),
    }).catch(() => {})
  } catch { /* fire-and-forget */ }
}
