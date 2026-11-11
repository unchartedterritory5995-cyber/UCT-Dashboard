import { useEffect, useRef } from 'react'

// One-time migration for a position saved BEFORE pixel anchors existed: once the
// chart has drawn, persist the anchor the primitive derived for it, so from then
// on the mark is pinned in pixels — including across a reload into a pane of a
// different size (the company panel open, a narrower widget). Without this the
// old fraction would re-resolve on every load and could land the mark half off
// the edge again. Fires at most once per chart, only when there is a legacy pos.
// (A position UCT Agent writes has no anchor yet either, so this stores one for it: agent/derivedOpts.js.)
export default function useWatermarkAnchorMigration({ chartReady, watermarkAdjusting, watermarkX, watermarkAnchor, onWatermarkAnchor, wmCtrlRef }) {
  const wmMigratedRef = useRef(false)
  useEffect(() => {
    if (!chartReady || watermarkAdjusting || wmMigratedRef.current) return undefined
    if (watermarkX == null || watermarkAnchor || !onWatermarkAnchor) return undefined
    let tries = 0
    const t = setInterval(() => {
      tries += 1
      let a = null
      try { a = wmCtrlRef.current?.getAnchor?.() } catch { /* noop */ }
      if (a) {
        wmMigratedRef.current = true
        clearInterval(t)
        onWatermarkAnchor(a)
      } else if (tries >= 10) clearInterval(t)   // never drawn (hidden widget) — give up
    }, 300)
    return () => clearInterval(t)
  }, [chartReady, watermarkAdjusting, watermarkX, watermarkAnchor, onWatermarkAnchor, wmCtrlRef])
}
