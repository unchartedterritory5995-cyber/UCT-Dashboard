// Journal Widgets — the durability half of an embed: the archived PNG behind
// every snapshot, and the capture-time bars warm. Both are best-effort and
// fire-and-forget; an embed is never blocked (or broken) by either.

import { domToBlob } from 'modern-screenshot'

// Chart canvases are transiently EMPTY (all-transparent bitmaps) for a frame
// during LWC resize/relayout, and domToBlob copies whatever bitmap it finds —
// the archive then shows legend + drawings over a hole where the candles were
// (live finding: intermittent on re-captures). Before rasterizing, wait for
// the big-canvas tier to actually carry paint — bounded, and FAIL-OPEN: after
// the budget the capture proceeds regardless (a late frame beats no archive,
// and a probe that can't measure must never block).
const PAINT_PROBE = { retries: 4, delayMs: 500, minOpaqueRatio: 0.05 }

/** Pure verdict over canvas summaries ({w, h, rectW, rectH, opaqueRatio}).
 *  Only the biggest tier votes — a pane's crosshair layer and tiny icon
 *  canvases are legitimately near-empty. The tier is sized by the LARGER of
 *  bitmap and CSS rect area (an unsized 300×150 default bitmap stretched
 *  over the pane must still vote). null opaqueRatio = unmeasurable (no 2d
 *  context / tainted) = counts as painted. */
export function canvasesLookPainted(summaries, minOpaqueRatio = PAINT_PROBE.minOpaqueRatio) {
  const area = (s) => Math.max((s.w || 0) * (s.h || 0), (s.rectW || 0) * (s.rectH || 0))
  const sized = (summaries || []).filter((s) => area(s) > 32 * 32)
  if (!sized.length) return true // DOM-only widget — nothing to wait for
  const maxArea = Math.max(...sized.map(area))
  const tier = sized.filter((s) => area(s) >= maxArea * 0.8)
  return tier.some((s) => s.opaqueRatio == null || s.opaqueRatio >= minOpaqueRatio)
}

function summarizeCanvases(el) {
  return [...el.querySelectorAll('canvas')].map((c) => {
    let opaqueRatio = null
    try {
      const ctx = c.getContext('2d')
      if (ctx && c.width > 0 && c.height > 0) {
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        const strideBytes = 16 * 4
        let opaque = 0
        for (let i = 3; i < data.length; i += strideBytes) if (data[i] > 8) opaque += 1
        opaqueRatio = opaque / Math.max(1, Math.floor(data.length / strideBytes))
      }
    } catch { /* unmeasurable — fail open via null */ }
    const r = typeof c.getBoundingClientRect === 'function' ? c.getBoundingClientRect() : null
    return { w: c.width, h: c.height, rectW: r?.width || 0, rectH: r?.height || 0, opaqueRatio }
  })
}

/** Rasterize an embed's DOM (chart canvases included — LWC canvases are
 *  same-origin and untainted) to a PNG Blob. 2× pixel ratio so the archive
 *  reads crisply when the entry is later viewed larger than the capture. */
export async function captureElementPng(el) {
  if (!el) return null
  for (let attempt = 0; attempt < PAINT_PROBE.retries; attempt += 1) {
    if (canvasesLookPainted(summarizeCanvases(el))) break
    await new Promise((r) => setTimeout(r, PAINT_PROBE.delayMs))
  }
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
