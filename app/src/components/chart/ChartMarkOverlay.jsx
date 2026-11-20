import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { watchChartView } from './chartViewWatcher'
import { estimatePillWidth, layoutMarks, markItems, markSize } from './chartMarkLayout'
import s from './ChartMarkOverlay.module.css'

// The chart's bar markers drawn as HTML labels (StockChart `markerLook`, the Study drill chart): a glowing pointer on the
// bar, a hairline stem when the label stands off, and a pill with the word in the app's type. Positioned from the chart's
// own coordinates (timeScale().timeToCoordinate, the series' priceToCoordinate) and kept in step on pan, zoom, resize,
// a price-scale drag and every bar a replay lands, through watchChartView (every frame while the view moves, resting when
// it is still). Read-only and pointer-transparent. The placement is chartMarkLayout.layoutMarks.
//
// A marker is the library's shape ({ time, position, color, text, shape }) plus, optionally, `glyph` ('diamond' | 'up' |
// 'down' | 'check' | 'cross'), the small sign ahead of the word. A marker with no text draws as a dot under (or over) its
// bar. Each lands with one short ease-in, never a loop, and none under reduced motion.

const GLYPHS = {
  diamond: <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" />,
  up: <path d="M5 1 9.2 8.6H0.8Z" />,
  down: <path d="M5 9 0.8 1.4H9.2Z" />,
  check: <path d="M1.2 5.3 3.9 8 8.8 2" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
  cross: <path d="M1.8 1.8 8.2 8.2M8.2 1.8 1.8 8.2" fill="none" strokeWidth="1.9" strokeLinecap="round" />,
}

function barAt(series, i) {
  try {
    const d = series.dataByIndex?.(i)
    if (!d) return null
    const hi = Number(d.high ?? d.value), lo = Number(d.low ?? d.value)
    return Number.isFinite(hi) && Number.isFinite(lo) ? { hi, lo } : null
  } catch { return null }
}

export default function ChartMarkOverlay({ chartRef, seriesRef, markers, look = 'wide' }) {
  const rootRef = useRef(null)
  const nodes = useRef(new Map())          // key -> { caret, stem, pill }
  const L = useMemo(() => markSize(look), [look])
  const items = useMemo(() => markItems(markers), [markers])

  const place = useCallback(() => {
    const root = rootRef.current
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!root) return
    const hideAll = () => { for (const n of nodes.current.values()) for (const el of [n.caret, n.stem, n.pill]) if (el) el.style.visibility = 'hidden' }
    if (!chart || !series || !items.length) { hideAll(); return }
    let ts
    try { ts = chart.timeScale() } catch { hideAll(); return }
    const y = (p) => { try { const v = series.priceToCoordinate(p); return v == null ? null : v } catch { return null } }
    let plotW = 0, paneH = 0
    try { plotW = ts.width() } catch { /* pre-init */ }
    try { paneH = series.getPane?.()?.getHeight?.() || 0 } catch { /* older API */ }
    const box = root.getBoundingClientRect?.() || { width: 0, height: 0 }
    const frame = { left: 0, top: 0, right: plotW || box.width || 0, bottom: paneH || (box.height ? box.height * 0.8 : 0) }
    if (!(frame.right > 0) || !(frame.bottom > 0)) { hideAll(); return }

    const toLogical = (x) => { try { const l = ts.coordinateToLogical(x); return l == null ? null : Number(l) } catch { return null } }
    const span = (x0, x1) => {
      const a = toLogical(x0), b = toLogical(x1)
      if (a == null || b == null) return null
      let top = Infinity, bottom = -Infinity
      for (let i = Math.ceil(Math.min(a, b) - 0.5); i <= Math.floor(Math.max(a, b) + 0.5); i++) {
        const bar = barAt(series, i)
        if (!bar) continue
        const yh = y(bar.hi), yl = y(bar.lo)
        if (yh != null) top = Math.min(top, yh)
        if (yl != null) bottom = Math.max(bottom, yl)
      }
      return Number.isFinite(top) || Number.isFinite(bottom) ? { top, bottom } : null
    }

    const geo = items.map((it) => {
      let x = null
      try { x = ts.timeToCoordinate(it.time) } catch { x = null }
      const i = x == null ? null : toLogical(x)
      const bar = i == null ? null : barAt(series, Math.round(i))
      const n = nodes.current.get(it.key)
      const measured = n?.pill?.offsetWidth || 0
      return {
        key: it.key, side: it.side, dot: it.dot, x: x == null ? null : Math.round(x) + 0.5,
        top: bar ? y(bar.hi) : null, bottom: bar ? y(bar.lo) : null,
        w: measured || estimatePillWidth(it.text, L, !!it.glyph), h: it.dot ? L.dot : L.h,
      }
    })
    const laid = layoutMarks(geo, frame, L, span)
    for (const p of laid) {
      const n = nodes.current.get(p.key)
      if (!n) continue
      if (p.hidden) { for (const el of [n.caret, n.stem, n.pill]) if (el) el.style.visibility = 'hidden'; continue }
      const down = p.side === 'above'
      if (n.pill) {
        n.pill.style.left = `${p.pillX}px`
        n.pill.style.top = `${p.pillY}px`
        n.pill.style.visibility = 'visible'
        n.pill.dataset.side = p.side
        if (!n.pill.dataset.on) n.pill.dataset.on = '1'   // the ease-in starts the first time the mark is on the chart
      }
      if (n.caret) {
        if (p.caret) {
          n.caret.style.left = `${Math.round(p.x - L.caretW / 2)}px`
          n.caret.style.top = `${Math.round(down ? p.tipY - L.caretH : p.tipY)}px`
          n.caret.dataset.side = p.side
          n.caret.style.visibility = 'visible'
          if (!n.caret.dataset.on) n.caret.dataset.on = '1'
        } else n.caret.style.visibility = 'hidden'
      }
      if (n.stem) {
        if (p.stem) {
          n.stem.style.left = `${Math.round(p.x - 0.5)}px`
          n.stem.style.top = `${Math.round(p.stem[0])}px`
          n.stem.style.height = `${Math.max(1, Math.round(p.stem[1] - p.stem[0]))}px`
          n.stem.dataset.side = p.side
          n.stem.style.visibility = 'visible'
          if (!n.stem.dataset.on) n.stem.dataset.on = '1'
        } else n.stem.style.visibility = 'hidden'
      }
    }
  }, [chartRef, seriesRef, items, L])

  const placeRef = useRef(place)
  // a new set of marks is placed before the frame paints, so a mark never shows at the corner first
  useLayoutEffect(() => { placeRef.current = place; place() }, [place])

  // pan, zoom, a price-scale drag, a bar landed (the series' length rides the view key), a resize
  useEffect(() => {
    let last = ''
    const watcher = watchChartView({
      chartRef,
      seriesRef,
      onRange: () => placeRef.current(),
      extraKey: () => { try { return String(seriesRef.current?.data?.().length ?? '') } catch { return '' } },
      sample: ({ key }) => { if (key !== last) { last = key; placeRef.current() } },
    })
    return () => watcher.stop()
  }, [chartRef, seriesRef])
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => placeRef.current())
    ro.observe(root)
    return () => ro.disconnect()
  }, [])
  // the app's type arriving changes every label's width
  useEffect(() => {
    let live = true
    try { document.fonts?.ready?.then(() => { if (live) placeRef.current() }) } catch { /* no font loading API */ }
    return () => { live = false }
  }, [])

  const vars = {
    '--mk-font': `${L.font}px`, '--mk-h': `${L.h}px`, '--mk-pad': `${L.padX}px`, '--mk-track': `${L.track}em`,
    '--mk-glyph': `${L.glyph}px`, '--mk-glyph-gap': `${L.glyphGap}px`, '--mk-caret-w': `${L.caretW}px`, '--mk-caret-h': `${L.caretH}px`,
    '--mk-dot': `${L.dot}px`,
  }
  const ref = (key, part) => (el) => {
    const n = nodes.current.get(key) || {}
    n[part] = el
    if (n.caret || n.stem || n.pill) nodes.current.set(key, n)
    else nodes.current.delete(key)
  }
  return (
    <div ref={rootRef} className={s.layer} style={vars} data-testid="chart-marks" data-size={L.font <= 11 ? 'phone' : 'wide'} aria-hidden="true">
      {items.map((it) => {
        const c = it.colors
        const tone = { '--mk-tone': c.tone, '--mk-fill-top': c.fillTop, '--mk-fill-bottom': c.fillBottom, '--mk-edge': c.edge, '--mk-glow': c.glow, '--mk-soft': c.soft, '--mk-ink': c.ink }
        return [
          it.dot ? null : <span key={`${it.key}:s`} ref={ref(it.key, 'stem')} className={s.stem} style={{ ...tone, visibility: 'hidden' }} />,
          it.dot ? null : (
            <svg key={`${it.key}:c`} ref={ref(it.key, 'caret')} className={s.caret} style={{ ...tone, visibility: 'hidden' }} viewBox="0 0 10 7" preserveAspectRatio="none">
              <path d="M5 0 10 7H0Z" />
            </svg>
          ),
          <span key={`${it.key}:p`} ref={ref(it.key, 'pill')} className={it.dot ? s.dot : s.pill} style={{ ...tone, visibility: 'hidden' }}
            data-testid="chart-mark" data-text={it.text} data-kind={it.kind || (it.dot ? 'dot' : 'mark')}>
            {it.glyph ? <svg className={s.glyph} viewBox="0 0 10 10" aria-hidden="true">{GLYPHS[it.glyph]}</svg> : null}
            {it.text ? <span className={s.word}>{it.text}</span> : null}
          </span>,
        ]
      })}
    </div>
  )
}
