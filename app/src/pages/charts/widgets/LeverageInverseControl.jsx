// app/src/pages/charts/widgets/LeverageInverseControl.jsx
// Leverage/Inverse single-stock ETF switcher (spec §2). Self-contained:
// ChartWidget only mounts it and passes handleSymbolChange as onSelect —
// every symbol swap goes through that prop, no context reads, no own state.
//
// Segmented pill (STOCK | {factor}X ↑ | {factor}X ↓ | ▾) styled to read native
// to the tfBar right-cluster: same 22px height / 10px 700 caps / 4px-radius
// bordered-toggle idiom as .sessionToggle in ChartsWorkspace.module.css.
// The ▾ caret opens a fixed-position family panel (all long + short funds,
// liquidity-desc as delivered by the API) for manual fund overrides.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useSingleStockEtfs from '../../../hooks/useSingleStockEtfs'
import styles from './LeverageInverseControl.module.css'

const fmtVol = (v) => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B/d`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M/d`
  : `$${(v / 1e3).toFixed(0)}K/d`

// 2 → "2", 1.5 → "1.5" (labels like "2X ↑" / "1.5X ↑")
const fmtFactor = (f) => {
  const n = Number(f)
  return Number.isFinite(n) && n > 0 ? String(n) : '?'
}

// Panel geometry (must mirror the module CSS): header+padding ≈ 72px chrome
// (3 group labels — STOCK/Long/Short — at 20px each + 12px panel padding), each
// fund row 30px. The STOCK group + its single row are ALWAYS present, so both
// the chrome (3 labels) and the row count (+1) budget for them. Used to estimate
// the panel height BEFORE it renders so we can clamp it on-screen — the charts
// workspace is viewport-locked, so an off-screen panel is unrecoverable.
const PANEL_W = 316
const PANEL_CHROME_H = 72
const PANEL_ROW_H = 30
const GUTTER = 8
const GAP = 4

export default function LeverageInverseControl({ sym, onSelect, themeVars = null }) {
  const { family, hasFamily } = useSingleStockEtfs(sym)
  // Panel state carries the sym it was opened FOR: `open` derives false the
  // moment the ticker changes under us (via this control or any other path),
  // so the stale panel closes on the same render — no setState-in-effect.
  const [panel, setPanel] = useState(null) // { sym, top, left, maxHeight } | null
  const wrapRef = useRef(null)
  const panelRef = useRef(null)

  const open = !!panel && panel.sym === sym

  const seat = !family ? null
    : sym === family.underlying ? 'stock'
    : (family.long || []).some(r => r.ticker === sym) ? 'long'
    : (family.short || []).some(r => r.ticker === sym) ? 'short' : null

  // Esc + outside-click close the panel (same idiom as TimeframeMenu; the
  // setTimeout(0) keeps the opening click from immediately closing it).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setPanel(null) }
    const onDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return
      if (wrapRef.current && wrapRef.current.contains(e.target)) return
      setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      clearTimeout(t)
    }
  }, [open])

  const toggleOpen = useCallback(() => {
    if (open) { setPanel(null); return }
    const el = wrapRef.current
    if (!el || !family) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Horizontal: right-align the panel to the pill, clamped to 8px gutters.
    const left = Math.max(GUTTER, Math.min(r.right - PANEL_W, vw - PANEL_W - GUTTER))
    // Vertical clamp: estimate height ≈ chrome + rows*30; if it won't fit
    // below the anchor, open ABOVE (floored at the top gutter). maxHeight is
    // capped to the chosen side's available space; the row list scrolls.
    const rows = 1 + (family.long?.length || 0) + (family.short?.length || 0) // +1: the STOCK row
    const estH = PANEL_CHROME_H + rows * PANEL_ROW_H
    const spaceBelow = vh - GUTTER - (r.bottom + GAP)
    const openAbove = r.bottom + GAP + estH > vh - GUTTER
    const top = openAbove ? Math.max(GUTTER, r.top - estH - GAP) : r.bottom + GAP
    const maxHeight = Math.max(96, openAbove ? r.top - GAP - GUTTER : spaceBelow)
    setPanel({ sym, top, left, maxHeight })
  }, [open, family, sym])

  const pick = useCallback((ticker) => {
    setPanel(null)
    if (ticker) onSelect?.(ticker)
  }, [onSelect])

  if (!hasFamily) return null

  const longs = family.long || []
  const shorts = family.short || []
  const bestLongRow = longs.find(r => r.ticker === family.best_long) || longs[0] || null
  const bestShortRow = shorts.find(r => r.ticker === family.best_short) || shorts[0] || null
  const bestLong = family.best_long || bestLongRow?.ticker || null
  const bestShort = family.best_short || bestShortRow?.ticker || null

  // The caret's label names the family when a leveraged member is charted
  // ("More NBIS ETFs") — with the LONG/SHORT seat lit, screen-reader users
  // need the trigger anchored to the underlying, and it keeps the STOCK
  // segment the only "stock"-named button. On the stock seat it reads
  // "More single-stock ETFs" (spec §2.2).
  const caretLabel = seat === 'long' || seat === 'short'
    ? `More ${family.underlying} ETFs`
    : 'More single-stock ETFs'

  // The underlying common stock as a panel row — the way BACK to the stock from
  // any seat, and (critically) the ONLY route to it when the pill has collapsed
  // to caret-only. Same markup/columns as the fund rows (no emoji); it carries a
  // neutral "1X" badge instead of a leveraged factor, no volume/★, and the same
  // filled indicator when the underlying is the charted symbol.
  const renderStockRow = () => {
    const on = sym === family.underlying
    return (
      <button
        type="button"
        role="menuitem"
        className={`${styles.row} ${on ? styles.rowCurrent : ''}`}
        onClick={() => pick(family.underlying)}
      >
        <span className={styles.rowTicker}>{family.underlying}</span>
        <span className={styles.rowName}>Common stock</span>
        <span className={`${styles.rowFactor} ${styles.rowFactorStock}`}>1X</span>
        <span className={styles.rowVol}>—</span>
        <span className={styles.rowBestPad} aria-hidden="true" />
        <span
          className={`${styles.rowDot} ${on ? styles.rowDotOn : ''}`}
          aria-hidden="true"
        />
      </button>
    )
  }

  const renderRow = (row, side, best) => (
    <button
      key={row.ticker}
      type="button"
      role="menuitem"
      className={`${styles.row} ${row.ticker === sym ? styles.rowCurrent : ''}`}
      onClick={() => pick(row.ticker)}
    >
      <span className={styles.rowTicker}>{row.ticker}</span>
      <span className={styles.rowName} title={row.name || ''}>{row.name || ''}</span>
      <span className={`${styles.rowFactor} ${side === 'short' ? styles.rowFactorShort : styles.rowFactorLong}`}>
        {fmtFactor(row.factor)}X{side === 'short' ? '↓' : '↑'}
      </span>
      <span className={styles.rowVol}>{fmtVol(row.avg_dollar_vol)}</span>
      {row.ticker === best
        ? <span className={styles.rowBest}>★ most liquid</span>
        : <span className={styles.rowBestPad} aria-hidden="true" />}
      {/* filled indicator on the currently-charted member — an empty span
          (reserved on every row) so it never pollutes the row's textContent */}
      <span
        className={`${styles.rowDot} ${row.ticker === sym ? styles.rowDotOn : ''}`}
        aria-hidden="true"
      />
    </button>
  )

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div className={styles.pill}>
        <button
          type="button"
          className={`${styles.segBtn} ${seat === 'stock' ? styles.segStockActive : ''}`}
          title={seat === 'stock' ? 'Charting the common stock' : `Back to ${family.underlying}`}
          onClick={() => pick(family.underlying)}
        >
          STOCK
        </button>
        <button
          type="button"
          className={`${styles.segBtn} ${styles.segLev} ${seat === 'long' ? styles.segLongActive : ''}`}
          disabled={!bestLongRow}
          title={bestLongRow
            ? `${bestLong} — ${fmtFactor(bestLongRow.factor)}x long ${family.underlying}, most liquid`
            : 'No leveraged single-stock ETF listed yet'}
          onClick={() => pick(bestLong)}
        >
          {bestLongRow ? `${fmtFactor(bestLongRow.factor)}X ` : ''}↑
        </button>
        <button
          type="button"
          className={`${styles.segBtn} ${styles.segLev} ${seat === 'short' ? styles.segShortActive : ''}`}
          disabled={!bestShortRow}
          title={bestShortRow
            ? `${bestShort} — ${fmtFactor(bestShortRow.factor)}x short ${family.underlying}, most liquid`
            : 'No inverse single-stock ETF listed yet'}
          onClick={() => pick(bestShort)}
        >
          {bestShortRow ? `${fmtFactor(bestShortRow.factor)}X ` : ''}↓
        </button>
        <button
          type="button"
          className={styles.caretBtn}
          aria-label={caretLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          ▾
        </button>
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          style={{ ...(themeVars || {}), top: panel.top, left: panel.left, maxHeight: panel.maxHeight }}
          role="menu"
          aria-label={`${family.underlying} single-stock ETFs`}
        >
          <div className={styles.panelScroll}>
            <div className={`${styles.groupLabel} ${styles.groupStock}`}>Stock</div>
            {renderStockRow()}
            {longs.length > 0 && (
              <>
                <div className={`${styles.groupLabel} ${styles.groupLong}`}>Long</div>
                {longs.map(row => renderRow(row, 'long', bestLong))}
              </>
            )}
            {shorts.length > 0 && (
              <>
                <div className={`${styles.groupLabel} ${styles.groupShort}`}>Short</div>
                {shorts.map(row => renderRow(row, 'short', bestShort))}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
