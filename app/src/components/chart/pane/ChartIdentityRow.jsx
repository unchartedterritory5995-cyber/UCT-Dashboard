import SymbolSearch from '../SymbolSearch'
import ChartDayGain from '../../../pages/charts/widgets/ChartDayGain'
import ChartMarketClock from '../../../pages/charts/widgets/ChartMarketClock'

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
  showChange = true,
  dayGain = null,
  dayGainColors = {},
  delistedDate = null,
  session = null,
  showClock = true,
  rightSlot = null,
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
  return (
    <div ref={rootRef} className={styles.chartHeaderTop}>
      <div className={styles.symbolSlot}>
        {onSymbolChange ? (
          <SymbolSearch
            ref={searchRef}
            sym={sym}
            onSymbolChange={onSymbolChange}
            hideIcon
            fullLabel
            logoSym={logoSym}
            brandLogo={brandLogo}
            displayLabel={displayLabel}
            labelColor={labelColor}
            boundsRef={boundsRef}
            themeVars={themeVars}
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
      {delistedLabel ? (
        // Dead ticker: a static badge in place of the (nonexistent) live day-change.
        <span
          className={styles.chartDayGain}
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
        <span className={styles.chartDayGain} style={{ color: dayGain.up ? dayGainColors.up : dayGainColors.down }}>
          {dayGain.up ? '+' : ''}{dayGain.abs.toFixed(2)} ({dayGain.up ? '+' : ''}{dayGain.pct.toFixed(2)}%)
        </span>
      ) : (
        <ChartDayGain sym={sym} upOverride={dayGainColors.up || null} downOverride={dayGainColors.down || null} />
      ))}
      <div className={styles.headerTopRight}>
        {session?.mode === 'dwm' && (
          <div className={styles.sessionToggle} role="group" aria-label="Chart session view">
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
          <div className={styles.sessionToggle} role="group" aria-label="Chart extended hours">
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
        {showClock && <ChartMarketClock />}
        {rightSlot}
      </div>
    </div>
  )
}
