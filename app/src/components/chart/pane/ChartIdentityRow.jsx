import SymbolSearch from '../SymbolSearch'
import ChartDayGain from '../../../pages/charts/widgets/ChartDayGain'
import ChartMarketClock from '../../../pages/charts/widgets/ChartMarketClock'

/** The chart's session switch (Regular / Extended hours). Rendered by the identity row,
 *  and — in the /charts integrated header — by the timeframe row instead, beside the
 *  timeframes, because it is a chart setting like the timeframe. */
export function SessionToggle({ session, styles }) {
  if (!session) return null
  return (
    <>
    {session?.mode === 'dwm' && (
      <div className={styles.sessionToggle} role="group" aria-label="Chart session view" data-guide="chart.session">
        <button
          type="button"
          className={`${styles.sessionBtn} ${session.view === 'regular' ? styles.sessionBtnActive : ''}`}
          onClick={() => session.onView('regular')}
          title="Regular trading hours only"
        >{session.abbrev ? 'RTH' : 'Regular Hours'}</button>
        <button
          type="button"
          className={`${styles.sessionBtn} ${session.view === 'extended' ? styles.sessionBtnActive : ''}`}
          onClick={() => { if (session.extEnabled) session.onView('extended') }}
          disabled={!session.extEnabled}
          title={session.extEnabled ? session.extLabel : 'Available during pre-market and post-market'}
        >{session.abbrev ? (/pre/i.test(session.extLabel) ? 'PRE' : 'PM') : session.extLabel}</button>
      </div>
    )}
    {session?.mode === 'intraday' && (
      <div className={styles.sessionToggle} role="group" aria-label="Chart extended hours" data-guide="chart.session">
        <button
          type="button"
          className={`${styles.sessionBtn} ${!session.extHoursOn ? styles.sessionBtnActive : ''}`}
          onClick={() => session.onExtHours(false)}
          title="Regular session only (9:30–4:00 ET), overnight gaps"
        >{session.abbrev ? 'RTH' : 'Regular Hours'}</button>
        <button
          type="button"
          className={`${styles.sessionBtn} ${session.extHoursOn ? styles.sessionBtnActive : ''}`}
          onClick={() => session.onExtHours(true)}
          title="Include pre-market + post-market bars"
        >{session.abbrev ? 'EXT' : 'Extended Hours'}</button>
      </div>
    )}
    </>
  )
}

// The chart's identity line: who am I, what did I do today, which session am I
// showing, and what time is it. Presentational — the host resolves every value.
// Omitting `onSymbolChange` renders a STATIC label (contextual surfaces such as
// a trade drawer must not let the user retarget the chart).
export default function ChartIdentityRow({
  searchRef,
  sym,
  displayLabel,
  labelColor = null,
  logoSym = null,
  brandLogo = false,
  boundsRef = null,
  themeVars = undefined,
  onSymbolChange = null,
  onTypedIntent = null,
  economic = false,
  showChange = true,
  dayGain = null,
  dayGainColors = {},
  delistedDate = null,
  session = null,
  showClock = true,
  rightSlot = null,
  // T3 integrated header (/charts board only). leftSlot renders before the symbol (the
  // widget's link dot); dragHandleClass makes the row the widget's drag handle, and then
  // marks the symbol + the right cluster no-drag so clicks there act instead of dragging.
  leftSlot = null,
  dragHandleClass = null,
  // Integrated header, one-row mode: the timeframe row rendered INSIDE this row,
  // between the day change and the right cluster.
  middleSlot = null,
  // /charts integrated header: render the day change / after-hours readout at the START
  // of the right cluster (left of the session switch) instead of after the symbol, so its
  // width changes (the after-hours number appearing) grow into empty space and never
  // shift the timeframes.
  changeInRight = false,
  // /charts chart widget: the symbol menu (▾ → leveraged ETFs / top holdings), right
  // after the company name.
  afterNameSlot = null,
  rootRef = null,
  styles,
}) {
  // "2017-06-19" → "Jun 2017" for the delisted badge (best-effort; falls back to raw).
  const delistedLabel = (() => {
    if (!delistedDate) return null
    const m = /^(\d{4})-(\d{2})/.exec(String(delistedDate))
    if (!m) return String(delistedDate)
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${MON[Math.max(0, Math.min(11, parseInt(m[2], 10) - 1))]} ${m[1]}`
  })()
  // The day change / after-hours readout (or the Delisted badge in its place).
  const changeEl = (
    delistedLabel ? (
          // Dead ticker: a static badge in place of the (nonexistent) live day-change.
          <span
            className={styles.chartDayGain}
            // Hook for an app-surface header (light /charts, popup, hub) to swap the inline
            // gold below for its own surface's gold (ChartsWorkspace.module.css).
            data-delisted=""
            style={{
              color: '#c9a84c',
              border: '1px solid rgba(201,168,76,0.45)',
              background: 'rgba(201,168,76,0.12)',
              borderRadius: 4,
              padding: '1px 7px',
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
            title={`This company is no longer publicly traded (delisted ${delistedDate}).`}
          >
            Delisted {delistedLabel}
          </span>
        ) : showChange && (dayGain ? (
          <span className={styles.chartDayGain} data-day-gain={dayGain.up ? 'up' : 'down'} style={{ color: dayGain.up ? dayGainColors.up : dayGainColors.down }}>
            {dayGain.up ? '+' : ''}{dayGain.abs.toFixed(2)} ({dayGain.up ? '+' : ''}{dayGain.pct.toFixed(2)}%)
          </span>
        ) : (
          <ChartDayGain sym={sym} upOverride={dayGainColors.up || null} downOverride={dayGainColors.down || null} splitPct={!!dragHandleClass} />
        ))
  )
  const hasRight = changeInRight || session?.mode === 'dwm' || session?.mode === 'intraday' || !!showClock
    || (rightSlot !== null && rightSlot !== undefined && rightSlot !== false)
  return (
    <div ref={rootRef} className={dragHandleClass ? `${styles.chartHeaderTop} ${dragHandleClass}` : styles.chartHeaderTop}>
      {leftSlot}
      {/* data-guide: a STABLE target for UCT Agent's product guide (agent/guide/registry.js) — no behaviour */}
      <div className={dragHandleClass ? `${styles.symbolSlot} charts-no-drag` : styles.symbolSlot} data-guide="chart.symbol">
        {onSymbolChange ? (
          <SymbolSearch
            ref={searchRef}
            sym={sym}
            onSymbolChange={onSymbolChange}
            onTypedIntent={onTypedIntent}
            hideIcon
            fullLabel
            splitLabel={!!dragHandleClass}
            logoSym={logoSym}
            brandLogo={brandLogo}
            displayLabel={displayLabel}
            labelColor={labelColor}
            boundsRef={boundsRef}
            themeVars={themeVars}
            economic={economic}
          />
        ) : (
          // Same test id the SymbolSearch branch renders under, so one query
          // addresses the identity label whichever branch a surface is on.
          <span
            data-testid="sym-label"
            className={styles.symbolStatic}
            style={labelColor ? { color: labelColor } : undefined}
          >
            {displayLabel}
          </span>
        )}
      </div>
      {afterNameSlot}
      {!changeInRight && changeEl}
      {/* The right cluster holds the session toggle, the clock and the host's slot. A compact
          pane (the Ticker Hub sheet) passes none of them, and the cluster is then NOT RENDERED:
          on a phone the row wraps and the cluster is `width: 100%`, so an empty one was a third
          (0px) line plus a row gap, which the hub's fixed identity-row height had to hide. */}
      {middleSlot}
      {hasRight && <div className={dragHandleClass ? `${styles.headerTopRight} charts-no-drag` : styles.headerTopRight}>
        {changeInRight && changeEl}
        <SessionToggle session={session} styles={styles} />
        {showClock && <ChartMarketClock />}
        {rightSlot}
      </div>}
    </div>
  )
}
