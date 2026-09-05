import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import StockChart from '../../../components/StockChart'
import useTechnical from '../hooks/useTechnical'
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

const KEY_LEVEL_COLOR = '#c9a84c' // ut-gold, matches this app's technical-level convention elsewhere

function setupLabel(setup) {
  return (setup || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function daysAgo(dateStr) {
  if (!dateStr) return null
  const then = new Date(`${dateStr}T00:00:00Z`).getTime()
  if (Number.isNaN(then)) return null
  const days = Math.round((Date.now() - then) / 86400000)
  return days
}

function VerdictCard({ v, selected, onSelect }) {
  const age = daysAgo(v.asof_date)
  const ageLabel = age == null ? '' : age <= 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onSelect}
      data-testid="technical-verdict-card"
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer', marginBottom: 8,
        borderColor: selected ? 'var(--ut-gold)' : undefined,
      }}
    >
      <div className={styles.ct}>{setupLabel(v.setup)}</div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>
        Confirmed as of {v.asof_date || '—'}{ageLabel && ` (${ageLabel})`}
        {typeof v.vision_confidence === 'number' && ` · ${Math.round(v.vision_confidence)}% confidence`}
      </div>
      {v.rationale && <div style={{ fontSize: 12, marginBottom: 4 }}>{v.rationale}</div>}
      {Array.isArray(v.checks) && v.checks.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11 }} className={styles.muted}>
          {v.checks.map((c, i) => (
            <li key={i}>{c.passed ? '✓' : '✗'} {c.criterion}</li>
          ))}
        </ul>
      )}
    </button>
  )
}

export default function TechnicalTab({ sym }) {
  const { data, isLoading } = useTechnical(sym, 'D')
  const [searchParams] = useSearchParams()
  const scannerHint = (searchParams.get('setup') || '').trim()

  const verdicts = data?.verdicts || []
  const [selectedKey, setSelectedKey] = useState(null)

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

  const priceLines = useMemo(() => {
    if (!selected || selected.key_level == null) return []
    return [{
      price: selected.key_level, color: KEY_LEVEL_COLOR, lineStyle: 2,
      title: `${setupLabel(selected.setup)} key level`,
    }]
  }, [selected])

  const callouts = useMemo(() => {
    if (!selected || !selected.asof_date) return null
    return [{ time: selected.asof_date, text: setupLabel(selected.setup) }]
  }, [selected])

  const highlightBarTime = selected?.asof_date || null

  return (
    <div className={styles.finWrap}>
      {isLoading && !verdicts.length && <div className={styles.fnote}>Loading technical evidence…</div>}

      {scannerHint && hintMatched === false && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="scanner-hint-stale">
          Detected from Scanner: {setupLabel(scannerHint)} — this setup is no longer
          confirmed as active for {sym}.
        </div>
      )}
      {scannerHint && hintMatched && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="scanner-hint-current">
          Detected from Scanner: {setupLabel(scannerHint)}
        </div>
      )}

      {!isLoading && !verdicts.length && (
        <div className={styles.fnote} data-testid="technical-empty-state">
          No confirmed technical setups on {sym} right now.
        </div>
      )}

      {!!verdicts.length && (
        <>
          <section style={{ marginBottom: 12 }}>
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
            <div style={{ height: 420 }}>
              <StockChart
                sym={sym}
                tf="D"
                showDrawingTools={false}
                priceLines={priceLines}
                callouts={callouts}
                highlightBarTime={highlightBarTime}
                highlightColor={KEY_LEVEL_COLOR}
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
