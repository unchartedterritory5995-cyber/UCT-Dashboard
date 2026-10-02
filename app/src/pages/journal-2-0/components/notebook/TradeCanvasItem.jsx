import { Component, memo, Suspense, useEffect, useMemo, useRef } from 'react'
import { lazyLeaf } from '../../lib/lazyChunk'
import { CHART_MIN_ZOOM, dayLabel, itemLabel, roleOf, tfLabel, fmtPrice } from '../../lib/tradeCanvas'
import styles from './TradeCanvasBoard.module.css'

/**
 * Wave 11 lane 11D — ONE card on the trade-plan canvas (a text card, a sticky
 * note or a chart). Memoised on its props, which are all stable or primitive:
 * the board hands every card the same `api` object for its whole life, so a
 * pointer move, a pan or a zoom re-renders NO card — the board moves the layer
 * and, while a card is dragged, writes that card's transform directly.
 *
 * Pointer handling lives on the board (one delegated handler); a card only says
 * who it is (`data-canvas-item`) and where its resize handle is
 * (`data-canvas-resize`).
 */

// The chart is the heaviest thing on a board (lightweight-charts + StockChart),
// so it loads on first use and only for a card that is on screen at a readable
// zoom. A crash inside one chart must never take the board down with it.
// ⛔ `lazyLeaf`, never `lazyChunk` (ruling D-I2): the chart sits inside its OWN
// boundary (ChartBoundary below), so a stale chunk shows that card's fallback
// line instead of reloading the page out from under the board.
const ChartEmbed = lazyLeaf(() => import('./ChartEmbed'))

class ChartBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.warn('[trade-canvas] a chart card failed to draw', err) }
  render() {
    if (this.state.failed) return <p className={styles.chartNote}>This chart could not be drawn. Its symbol, timeframe and date are kept.</p>
    return this.props.children
  }
}

function ChartBody({ item, levels, showChart }) {
  const attrs = useMemo(() => ({
    widgetId: 'chart',
    // ⛔ A frozen card is a SNAPSHOT whose `to` is its as-of day: ChartEmbed turns
    // that into StockChart's `replayCutoff`, which sends `?to=` and hides every
    // later bar. A live card has no `to` and follows the market.
    mode: item.mode === 'frozen' ? 'snapshot' : 'live',
    params: { symbol: item.symbol, tf: item.tf, to: item.mode === 'frozen' ? item.asOf : null },
    // Levels attached to THIS chart, as horizontal price lines (the chart's own
    // controlled annotation layer; nothing is written back from it).
    annotations: levels.map((lv) => ({
      id: `level-${lv.id}`, type: 'horizontal', points: [{ price: lv.price }],
      color: roleOf(lv.role).color, lineWidth: 2, showPriceLabel: true,
    })),
  }), [item.symbol, item.tf, item.mode, item.asOf, levels])
  const placeholder = (
    <p className={styles.chartNote}>
      {item.symbol} · {tfLabel(item.tf)} chart{showChart ? ' — loading…' : ' — zoom in to see it'}
    </p>
  )
  if (!showChart) return placeholder
  return (
    <ChartBoundary>
      <Suspense fallback={placeholder}>
        <ChartEmbed attrs={attrs} />
      </Suspense>
    </ChartBoundary>
  )
}

function TextBody({ item, editing, api }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
  }, [editing])
  if (editing) {
    return (
      <textarea
        ref={ref}
        className={styles.cardEditor}
        defaultValue={item.text}
        maxLength={1000}
        aria-label={item.kind === 'sticky' ? 'Sticky note text' : 'Card text'}
        onBlur={(e) => api.finishEdit(item.id, e.target.value, { refocus: false })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
            e.preventDefault()
            e.stopPropagation()
            api.finishEdit(item.id, e.currentTarget.value, { refocus: true })
          }
        }}
      />
    )
  }
  return item.text
    ? <p className={styles.cardText}>{item.text}</p>
    : <p className={styles.cardEmpty}>Empty — press Enter or double-click to write</p>
}

function CanvasItem({ item, selected, current, editing, readOnly, levels, zoomOk, api }) {
  const label = itemLabel(item)
  const style = {
    transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
    width: `${item.w}px`,
    height: `${item.h}px`,
  }
  const kindClass = item.kind === 'chart' ? styles.chartCard
    : item.kind === 'sticky' ? `${styles.sticky} ${styles[`sticky_${item.color}`] || ''}` : styles.textCard
  return (
    <div
      ref={(el) => api.register(item.id, el)}
      data-canvas-item={item.id}
      data-kind={item.kind}
      data-selected={selected ? 'true' : undefined}
      className={`${styles.item} ${kindClass} ${selected ? styles.itemSelected : ''}`}
      style={style}
      role="group"
      aria-roledescription="canvas item"
      aria-label={selected ? `${label}, selected` : label}
      tabIndex={current ? 0 : -1}
      onFocus={(e) => { if (e.target === e.currentTarget) api.focused(item.id) }}
    >
      {item.kind === 'chart' ? (
        <>
          <div className={styles.chartHead}>
            <span className={styles.chartSym}>{item.symbol}</span>
            <span className={styles.chartTf}>{tfLabel(item.tf)}</span>
            {item.mode === 'frozen'
              ? <span className={styles.badgeFrozen}>Frozen · {dayLabel(item.asOf)}</span>
              : <span className={styles.badgeLive}>Live</span>}
            {levels.length > 0 && (
              <span className={styles.chartLevels}>
                {levels.map((lv) => (
                  <span key={lv.id} className={styles.levelChip} style={{ '--level-color': roleOf(lv.role).color }}>
                    {lv.label} {fmtPrice(lv.price)}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className={styles.chartBody}>
            <ChartBody item={item} levels={levels} showChart={zoomOk} />
          </div>
        </>
      ) : (
        <TextBody item={item} editing={editing} api={api} />
      )}
      {selected && !readOnly && (
        <div className={styles.resize} data-canvas-resize={item.id} aria-hidden="true" />
      )}
    </div>
  )
}

export const NO_LEVELS = Object.freeze([])
export { CHART_MIN_ZOOM }
export default memo(CanvasItem)
