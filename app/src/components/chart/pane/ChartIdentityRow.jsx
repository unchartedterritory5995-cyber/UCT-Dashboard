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
  session = null,
  showClock = true,
  styles,
}) {
  return (
    <div className={styles.chartHeaderTop}>
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
          <span className={styles.symbolStatic} style={labelColor ? { color: labelColor } : undefined}>
            {displayLabel}
          </span>
        )}
      </div>
      {showChange && (dayGain ? (
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
            >Regular Hours</button>
            <button
              type="button"
              className={`${styles.sessionBtn} ${session.view === 'extended' ? styles.sessionBtnActive : ''}`}
              onClick={() => { if (session.extEnabled) session.onView('extended') }}
              disabled={!session.extEnabled}
              title={session.extEnabled ? session.extLabel : 'Available during pre-market and post-market'}
            >{session.extLabel}</button>
          </div>
        )}
        {session?.mode === 'intraday' && (
          <div className={styles.sessionToggle} role="group" aria-label="Chart extended hours">
            <button
              type="button"
              className={`${styles.sessionBtn} ${!session.extHoursOn ? styles.sessionBtnActive : ''}`}
              onClick={() => session.onExtHours(false)}
              title="Regular session only (9:30–4:00 ET), overnight gaps"
            >Regular Hours</button>
            <button
              type="button"
              className={`${styles.sessionBtn} ${session.extHoursOn ? styles.sessionBtnActive : ''}`}
              onClick={() => session.onExtHours(true)}
              title="Include pre-market + post-market bars"
            >Extended Hours</button>
          </div>
        )}
        {showClock && <ChartMarketClock />}
      </div>
    </div>
  )
}
