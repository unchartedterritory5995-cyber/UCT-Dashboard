import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import StockChart from '../../../components/StockChart'
import useTechnical from '../hooks/useTechnical'
import { etCalendarDaysBetween } from '../../../lib/marketClock/etTime'
import UIcon from '../../../components/ui/UIcon'
import { CHART_INK } from '../../../components/research-kit/charts/echartsCore'
import { ABSENT } from '../../../lib/presentation/presentationPrimitives'
import { usePanelFreshness, panelAsOf } from '../../../components/terminal/terminalPanel'
import { themeInk, useThemeVersion } from '../themeInk'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

// Chart/Technical Intelligence Convergence (owner authorization, Phase B).
// Deterministic only — no AI, no new pattern detection, no new charting
// engine. Source of truth is the EXISTING /api/patterns/{sym} endpoint
// (confirmed_only default), which serves Opus-vision-CONFIRMED setups —
// never the raw rule-engine firehose. See useTechnical.js for why that
// distinction is load-bearing, not a style choice.
//
// "View on Chart" is an embedded StockChart, not a separate page/route —
// Research has never had a chart surface before this tab; reusing the
// existing markers/priceLines/callouts/highlightBarTime props (the same
// ones Model Book already uses in production) is the smallest way to add
// one without building a second charting engine.

// The key level is drawn in the app's gold (--ut-gold), resolved for the canvas so a
// catalog or light theme recolours it like every other accent.
const keyLevelInk = () => themeInk('--ut-gold', CHART_INK.gold)

// Acronyms the fallback title-casing would mangle ("Macd", "Vsa", "Avwap"). These are
// WORDS of a setup id ("macd_bullish_cross"), not indicator ids, so they are held as the
// upper-case acronym itself: keyed by the lower-case spelling, the table read as a hand-list
// of indicator ids to chart/engine/__tests__/enumerationSites.test.js, and no new indicator
// ever has to be added here.
const ACRONYMS = new Set(['MACD', 'VSA', 'AVWAP', 'VWAP', 'RSI', 'SMA', 'EMA', 'ATR', 'HTF', 'EP'])

/** The server's `setup_name` (the pattern engine's own name) when it sent one; otherwise the id,
 *  title-cased with acronyms kept (quality pass 2026-10-05: "Macd Bullish Cross"). */
export function setupLabel(setup, name = null) {
  if (name) return name
  return (setup || '').split('_').filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : (w[0].toUpperCase() + w.slice(1)))).join(' ')
}

// Whole ET calendar days since `asof_date` (a market date). It used to round
// the millisecond gap from UTC midnight, which said "1 day ago" for a verdict
// dated today from mid-afternoon ET onward.
export function daysAgo(dateStr, now = Date.now()) {
  if (!dateStr) return null
  const days = etCalendarDaysBetween(String(dateStr).slice(0, 10), now)
  return Number.isFinite(days) ? days : null
}

function VerdictCard({ v, selected, onSelect }) {
  const age = daysAgo(v.asof_date)
  const ageLabel = age == null ? '' : age <= 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`
  // Wave 3 (TECH P2 #26): the whole card was a <button> wrapping <div>s and a <ul> (invalid
  // content model), so a screen reader read the entire card as one long button name. The card is
  // a plain box now; its title is the button (named by the setup, still a pressed toggle), and a
  // stretched hit area keeps the whole card clickable for a mouse.
  return (
    <div
      data-testid="technical-verdict-card"
      className={`${styles.card} ${styles.verdictCard} ${selected ? styles.verdictOn : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        // the selected card drives the chart below; say which one is chosen in more than colour
        aria-pressed={!!selected}
        className={`${styles.ct} ${styles.verdictPick}`}
        data-testid="technical-verdict-pick"
      >{setupLabel(v.setup, v.setup_name)}</button>
      <div className={styles.verdictLine}>
        Confirmed as of {v.asof_date || ABSENT}{ageLabel && ` (${ageLabel})`}
        {typeof v.vision_confidence === 'number' && ` · ${Math.round(v.vision_confidence)}% confidence`}
      </div>
      {v.rationale && <div className={styles.verdictLine}>{v.rationale}</div>}
      {Array.isArray(v.checks) && v.checks.length > 0 && (
        <ul className={styles.checkList}>
          {v.checks.map((c, i) => (
            <li key={i} className={styles.checkItem}>
              <UIcon name={c.passed ? 'check' : 'x'} size={12} gold={false}
                className={c.passed ? styles.up : styles.down} title={c.passed ? 'Passed' : 'Failed'} />
              {c.criterion}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TechnicalTab({ sym }) {
  const { data, isLoading, error, paywalled, mutate } = useTechnical(sym, 'D')
  const [searchParams] = useSearchParams()
  const scannerHint = (searchParams.get('setup') || '').trim()

  const verdicts = data?.verdicts || []
  // Seam 24: how many setups were evaluated in the same 7-day window, confirmed
  // and rejected alike. Only ever a COUNT — the judge's reasons for rejecting a
  // setup stay on the admin surface.
  const evaluated = Number(data?.evaluated) || 0
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  // The verdicts are dated row by row ("Confirmed as of …"); the header names the source only.
  // The header's as-of is when the judge last ran on this ticker (`as_of`, epoch s).
  usePanelFreshness(data && !error && !paywalled ? panelAsOf('UCT pattern scanner (daily bars)', data.as_of) : null)
  const [selectedKey, setSelectedKey] = useState(null)

  // ⛔ Clear the manual selection when the TICKER changes. `selectedKey` is a
  // `setup|asof_date` pair, and two different securities can legitimately
  // share one -- so a carried-over key silently marks a DIFFERENT company's
  // verdict as this member's active choice, and drives the chart's key level
  // and callout from it. The `verdicts[0]` fallback hides this whenever the
  // pair does NOT collide, which is exactly what makes it worth an explicit
  // reset rather than trusting the fallback.
  useEffect(() => { setSelectedKey(null) }, [sym])

  // Scanner-origin continuity: the hint only ever picks WHICH already-fetched,
  // currently-confirmed verdict to emphasize — it never asserts a verdict
  // exists on its own. If the hinted setup isn't in the current confirmed
  // list, that's reported honestly below rather than silently ignored.
  useEffect(() => {
    if (!scannerHint || selectedKey || !verdicts.length) return
    const match = verdicts.find(v => v.setup === scannerHint)
    if (match) setSelectedKey(`${match.setup}|${match.asof_date}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerHint, verdicts.length])

  const hintMatched = scannerHint
    ? verdicts.some(v => v.setup === scannerHint)
    : null

  const selected = useMemo(() => {
    if (!verdicts.length) return null
    if (selectedKey) {
      const found = verdicts.find(v => `${v.setup}|${v.asof_date}` === selectedKey)
      if (found) return found
    }
    return verdicts[0]
  }, [verdicts, selectedKey])

  // Re-resolve the key-level ink when the member switches theme.
  const themeVersion = useThemeVersion()
  const priceLines = useMemo(() => {
    if (!selected || selected.key_level == null) return []
    return [{
      price: selected.key_level, color: keyLevelInk(), lineStyle: 2,
      title: `${setupLabel(selected.setup, selected.setup_name)} key level`,
    }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, themeVersion])

  const callouts = useMemo(() => {
    if (!selected || !selected.asof_date) return null
    return [{ time: selected.asof_date, text: setupLabel(selected.setup, selected.setup_name) }]
  }, [selected])

  const highlightBarTime = selected?.asof_date || null

  return (
    <div className={styles.finWrap}>
      {isLoading && !verdicts.length && <ResearchLoading label="Loading technical evidence" />}

      {scannerHint && hintMatched === false && (
        <div className={styles.entityNote} data-testid="scanner-hint-stale">
          Detected from Scanner: {setupLabel(scannerHint)} — this setup is no longer
          confirmed as active for {sym}.
        </div>
      )}
      {scannerHint && hintMatched && (
        <div className={styles.entityNote} data-testid="scanner-hint-current">
          Detected from Scanner: {setupLabel(scannerHint)}
        </div>
      )}

      {/* TERM-088 -- a failed read is not "nothing confirmed". This branch
          must be checked BEFORE the empty-state below, or an outage renders
          as "none confirmed" -- collapsing the confirmed/rejected signal
          this tab exists to preserve into a false "nothing confirmed"
          bucket. */}
      {!isLoading && paywalled && (
        <div className={styles.fnote} data-testid="technical-paywalled">Technical setups require a paid plan.</div>
      )}
      {!isLoading && error && (
        <div className={styles.fnote} data-testid="technical-error">
          Couldn't load technical setups for {sym}.
          {' '}
          <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )}

      {!isLoading && !error && !paywalled && !verdicts.length && (
        <div className={styles.fnote} data-testid="technical-empty-state">
          {evaluated > 0 ? (
            <>
              {evaluated} setup{evaluated === 1 ? '' : 's'} evaluated on {sym} in
              the last 7 days — none confirmed. Setups are re-checked hourly
              during market hours.
            </>
          ) : (
            <>
              No confirmed technical setups on {sym} right now. Setups are
              re-checked hourly during market hours.
            </>
          )}
        </div>
      )}

      {!!verdicts.length && (
        <>
          <section className={styles.verdictList}>
            {verdicts.map(v => {
              const key = `${v.setup}|${v.asof_date}`
              return (
                <VerdictCard
                  key={key}
                  v={v}
                  selected={selected && key === `${selected.setup}|${selected.asof_date}`}
                  onSelect={() => setSelectedKey(key)}
                />
              )
            })}
          </section>

          <section className={styles.card} data-testid="technical-chart">
            <div className={styles.ct}>View on Chart</div>
            <div className={styles.techChart}>
              <StockChart
                sym={sym}
                tf="D"
                showDrawingTools={false}
                priceLines={priceLines}
                callouts={callouts}
                highlightBarTime={highlightBarTime}
                highlightColor={keyLevelInk()}
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
