// GhostPreview — the "suggest-then-confirm" overlay for smart widget placement.
//
// When SMART_PLACEMENT is on and the confirm pref is set, adding a widget does not
// commit immediately: planPlacement computes where it WOULD land, and this overlay
// draws a translucent ghost at that slot (plus a dashed outline on any existing
// widget that would shrink to make room) with Place / Cancel. The user confirms
// (Enter / click) or cancels (Esc), and only then does the layout mutate.
//
// Positioning: react-grid-layout renders items with top/left (useCSSTransforms is
// off) and bakes its containerPadding (= margin = `gap`) into each item's offset.
// We measure the grid element's rect relative to the workspace body once, then apply
// RGL's own item formula so the ghost lands pixel-aligned with real widgets.

import { useEffect, useReducer } from 'react'

function measureMetrics(bodyRef, cols, gap) {
  const body = bodyRef?.current
  const grid = body?.querySelector('.react-grid-layout')
  if (!body || !grid) return null
  const b = body.getBoundingClientRect()
  const g = grid.getBoundingClientRect()
  const containerWidth = g.width
  const colWidth = (containerWidth - gap * (cols - 1) - gap * 2) / cols
  return { originX: g.left - b.left, originY: g.top - b.top, colWidth, gap }
}

function toPx(cell, m, rowHeight) {
  return {
    left: m.originX + (m.colWidth + m.gap) * cell.x + m.gap,
    top: m.originY + (rowHeight + m.gap) * cell.y + m.gap,
    width: m.colWidth * cell.w + m.gap * (cell.w - 1),
    height: rowHeight * cell.h + m.gap * (cell.h - 1),
  }
}

export default function GhostPreview({
  bodyRef, widgets, plan, rowHeight, gap, cols, label,
  onConfirm, onCancel, onSkipConfirm,
}) {
  // Re-render on window resize so the measured geometry stays current while the
  // preview is open. The grid element is always mounted by the time a ghost shows,
  // so metrics are measured synchronously in render (no effect+setState churn).
  const [, bump] = useReducer(x => x + 1, 0)
  useEffect(() => {
    const onResize = () => bump()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const metrics = measureMetrics(bodyRef, cols, gap)

  // Enter = place, Esc = cancel. Capture phase so it wins over the workspace's
  // own type-to-search / shortcut handlers while the preview is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onConfirm() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onConfirm, onCancel])

  if (!plan) return null

  const GOLD = '#c9a84c'
  // metrics can be unmeasurable (e.g. a zero-size jsdom grid); the confirm bar still
  // renders so the action is always reachable — only the on-grid rects are skipped.
  const ghost = metrics ? toPx(plan.place, metrics, rowHeight) : null
  const mutRects = metrics ? (plan.mutations || []).map(mut => {
    const w = widgets.find(x => x.id === mut.id)
    if (!w) return null
    const geom = { x: mut.x ?? w.x, y: mut.y ?? w.y, w: mut.w ?? w.w, h: mut.h ?? w.h }
    return { id: mut.id, ...toPx(geom, metrics, rowHeight) }
  }).filter(Boolean) : []

  // Confirm bar: centered over the ghost when measured, else pinned near the top.
  const bar = ghost
    ? { top: Math.max((metrics.originY || 0) + metrics.gap, ghost.top + 8), left: ghost.left + ghost.width / 2, transform: 'translateX(-50%)' }
    : { top: 12, left: '50%', transform: 'translateX(-50%)' }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      {/* Widgets that would shrink to make room. */}
      {mutRects.map(r => (
        <div
          key={r.id}
          style={{
            position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height,
            border: `2px dashed ${GOLD}80`, borderRadius: 6, boxSizing: 'border-box',
            background: `${GOLD}12`,
          }}
        />
      ))}

      {/* The proposed slot for the new widget. */}
      {ghost && (
        <div
          onClick={onConfirm}
          style={{
            position: 'absolute', left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height,
            border: `2px dashed ${GOLD}`, borderRadius: 6, boxSizing: 'border-box',
            background: `${GOLD}22`, pointerEvents: 'auto', cursor: 'pointer',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          }}
        >
          <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 11, fontWeight: 600, color: GOLD, letterSpacing: 0.3 }}>
            {label}
          </div>
        </div>
      )}

      {/* Confirm / cancel bar. */}
      <div
        style={{
          position: 'absolute', top: bar.top, left: bar.left, transform: bar.transform,
          pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(18,18,20,0.92)', border: `1px solid ${GOLD}66`, borderRadius: 8,
          padding: '6px 8px', boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        }}
      >
        <button
          type="button"
          onClick={onConfirm}
          style={{
            background: GOLD, color: '#1a1a1a', border: 'none', borderRadius: 5,
            padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >Place</button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', color: '#ccc', border: '1px solid #555', borderRadius: 5,
            padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >Cancel</button>
        <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>Enter · Esc</span>
        {onSkipConfirm && (
          <button
            type="button"
            onClick={onSkipConfirm}
            title="Place now and stop asking for confirmation (re-enable in settings)"
            style={{
              background: 'transparent', color: '#7a7a7a', border: 'none', borderRadius: 5,
              padding: '4px 4px', fontSize: 10, cursor: 'pointer', textDecoration: 'underline',
            }}
          >skip next time</button>
        )}
      </div>
    </div>
  )
}
