/**
 * PsychologySection — the Insights → Psychology section (P5 Task A9).
 *
 * "How your head shows up in your P&L." Reads the `analytics.psychology` slice
 * (built backend-side in Task A8) and renders three honest panels:
 *
 *   1. Emotion × Outcome — one diverging bar per emotion tag (from
 *      `emotionOutcomes`, sorted by avgPnl desc): green when the emotion's mean
 *      NET P&L is ≥ 0, red when < 0, with a `<ConfidenceStat>`-gated win rate
 *      (n<10 grayed) and the trade count. Emotions with fewer than 3 trades are
 *      dimmed + annotated "thin sample" (the FE display gate — the backend
 *      returns every emotion, even sparse ones).
 *   2. Cost of Mistakes — the NET $ bled on mistake-tagged trades (headline) plus
 *      a per-mistake breakdown (mistake · total · count).
 *   3. Revenge / Tilt — the `revenge.flags` (symbol · "re-entered N min after a
 *      loss"), each dismissible with "Not revenge". HONESTY GATE: on a date-only
 *      account (no execution times → the detector can't run), we say so instead
 *      of falsely reporting a clean "no revenge" list.
 *
 * Empty state (the feature): when NOTHING is tagged (`taggedTradeCount === 0`),
 * the panels are replaced by a designed pitch card that invites rapid tagging.
 * Its button calls the optional `onStartRapidTag` prop (wired by a later task,
 * A11); absent → a harmless no-op.
 *
 * Revenge dismissal persistence (v1 choice): dismissed `pairKey`s live in
 * localStorage under `uct.j2.revengeDismissed` (a JSON array). We filter the
 * flags against it before rendering; "Not revenge" appends the pairKey and
 * re-renders. Frontend-only — a future task could thread these to the backend
 * `_psychology_section(suppressed_pairs=…)` param (already present, defaults
 * empty) for cross-device suppression.
 *
 * Presentational — reads its slice off `analytics.psychology`, no fetching. NO
 * emoji: every glyph is a <UIcon>.
 */

import { useCallback, useState } from 'react'
import { useSWRConfig } from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import RapidTagFlow from '../psychology/RapidTagFlow'
import MakeRuleButton from './MakeRuleButton'
import MyRulesList from './MyRulesList'
import styles from './PsychologySection.module.css'

const CONF_MIN = 10 // canonical confidence threshold — win rate grayed below it
const THIN_SAMPLE = 3 // emotions with fewer than this are dimmed + annotated
const DISMISS_KEY = 'uct.j2.revengeDismissed'
// Below this share of trades carrying a real execution time, treat the book as
// date-only for revenge purposes (the honesty gate — don't imply "no revenge").
const TIMED_COVERAGE_MIN = 0.2

// ── formatters (match RegimeSection/PlaybookSection so units read the same) ──
const fmtPct = (v) => `${(v * 100).toFixed(0)}%`
const fmtDollar = (v) => {
  if (!v) return '$0'
  return `${v > 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`
}

// ── localStorage helpers for the dismissed-revenge pairKeys ──────────────────
function loadDismissed() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISS_KEY) : null
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveDismissed(arr) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(arr))
  } catch {
    /* storage unavailable — the in-memory state still hides the flag this session */
  }
}

export default function PsychologySection({ analytics, accountId, onStartRapidTag }) {
  const [dismissed, setDismissed] = useState(loadDismissed)
  const [rapidTagOpen, setRapidTagOpen] = useState(false)
  const { mutate } = useSWRConfig()

  // Open the rapid-tag flow from the pitch card. The optional `onStartRapidTag`
  // prop is kept as an additional hook for a parent that wants to know (called
  // too when present) — but the section owns the flow's open state itself.
  const startRapidTag = useCallback(() => {
    setRapidTagOpen(true)
    onStartRapidTag?.()
  }, [onStartRapidTag])

  // Tagging trades feeds every psychology panel — revalidate the analytics key
  // so the section comes alive, then close.
  const completeRapidTag = useCallback(() => {
    mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
    setRapidTagOpen(false)
  }, [mutate])

  const dismiss = useCallback((pairKey) => {
    if (!pairKey) return
    setDismissed((prev) => {
      if (prev.includes(pairKey)) return prev
      const next = [...prev, pairKey]
      saveDismissed(next)
      return next
    })
  }, [])

  const psy = analytics?.psychology || {}
  const taggedTradeCount = psy.taggedTradeCount || 0

  const emotionOutcomes = Array.isArray(psy.emotionOutcomes) ? psy.emotionOutcomes : []
  const cost = psy.costOfMistakes || { total: 0, byMistake: [] }
  const revenge = psy.revenge || { flags: [], timeComponentCoverage: { timed: 0, total: 0 } }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h4 className={styles.title}>Trading psychology</h4>
        <p className={styles.sub}>
          How your tagged emotions and mistakes show up in your P&amp;L. Everything
          here needs tags — the more of your trades you tag, the sharper it gets.
        </p>
      </div>

      {taggedTradeCount === 0 ? (
        <PitchCard onStart={startRapidTag} />
      ) : (
        <>
          <div className={styles.panels}>
            <EmotionPanel emotions={emotionOutcomes} />
            <CostPanel cost={cost} accountId={accountId} />
            <RevengePanel revenge={revenge} dismissed={dismissed} onDismiss={dismiss} />
          </div>
          <MyRulesList accountId={accountId} />
        </>
      )}

      {rapidTagOpen && (
        <RapidTagFlow
          open
          onClose={() => setRapidTagOpen(false)}
          onComplete={completeRapidTag}
        />
      )}
    </div>
  )
}

// ── Panel 1: Emotion × Outcome ───────────────────────────────────────────────

function EmotionPanel({ emotions }) {
  // Sort by avgPnl desc (best-feeling → worst); nulls sink last.
  const rows = [...emotions].sort((a, b) => {
    const av = typeof a.avgPnl === 'number' ? a.avgPnl : -Infinity
    const bv = typeof b.avgPnl === 'number' ? b.avgPnl : -Infinity
    return bv - av
  })
  const maxAbs = Math.max(1, ...rows.map((e) => Math.abs(e.avgPnl || 0)))

  return (
    <section className={styles.panel}>
      <h5 className={styles.panelTitle}>Emotion &times; outcome</h5>
      <p className={styles.panelSub}>
        Mean net P&amp;L per emotion you tagged. Win rate is grayed on fewer than{' '}
        {CONF_MIN} trades; emotions on fewer than {THIN_SAMPLE} are a thin sample.
      </p>
      {rows.length === 0 ? (
        <p className={styles.panelEmpty}>
          No emotion-tagged trades yet. Tag how a trade felt — calm, greedy,
          anxious — to see which states pay you and which cost you.
        </p>
      ) : (
        <div className={styles.emoRows}>
          {rows.map((e) => (
            <EmotionRow key={e.emotion} e={e} maxAbs={maxAbs} />
          ))}
        </div>
      )}
    </section>
  )
}

function EmotionRow({ e, maxAbs }) {
  const n = e.tradeCount || 0
  const thin = n < THIN_SAMPLE
  const avg = typeof e.avgPnl === 'number' ? e.avgPnl : null
  const winRate = typeof e.winRate === 'number' ? e.winRate : null
  const pos = avg !== null && avg >= 0
  // Diverging bar: magnitude relative to the biggest |avgPnl|, growing out from
  // the center — right (green) when net-positive, left (red) when net-negative.
  const pct = avg === null ? 0 : Math.max(0, Math.min(1, Math.abs(avg) / maxAbs))

  return (
    <div className={styles.emoRow}>
      <div className={styles.emoTop}>
        <div className={styles.emoLabel}>
          <span className={styles.emoName}>{e.emotion}</span>
        </div>

        <div className={styles.emoBarTrack}>
          <div className={styles.emoBarNegHalf}>
            {avg !== null && !pos && (
              <div
                className={`${styles.emoBarFill} ${styles.emoBarNeg} ${thin ? styles.emoBarDim : ''}`}
                style={{ width: `${pct * 100}%` }}
              />
            )}
          </div>
          <div className={styles.emoBarPosHalf}>
            {avg !== null && pos && (
              <div
                className={`${styles.emoBarFill} ${styles.emoBarPos} ${thin ? styles.emoBarDim : ''}`}
                style={{ width: `${pct * 100}%` }}
              />
            )}
          </div>
        </div>

        <div className={styles.emoStat}>
          <ConfidenceStat value={winRate} n={n} min={CONF_MIN} format={fmtPct} label="Win Rate" />
        </div>
      </div>

      <div className={styles.emoSecondary}>
        <span
          className={`${styles.emoAvg} ${avg === null ? '' : pos ? styles.emoAvgPos : styles.emoAvgNeg}`}
        >
          Avg P&amp;L {avg !== null ? fmtDollar(avg) : '—'}
        </span>
        <span>
          {n} trade{n === 1 ? '' : 's'}
        </span>
        {thin && <span className={styles.thinTag}>thin sample</span>}
      </div>
    </div>
  )
}

// ── Panel 2: Cost of Mistakes ────────────────────────────────────────────────

function CostPanel({ cost, accountId }) {
  const total = typeof cost.total === 'number' ? cost.total : 0
  const byMistake = Array.isArray(cost.byMistake) ? cost.byMistake : []
  const bled = total < 0

  return (
    <section className={styles.panel}>
      <h5 className={styles.panelTitle}>Cost of mistakes</h5>
      {byMistake.length === 0 ? (
        <p className={styles.panelEmpty}>
          No mistakes tagged yet. Tag a mistake on a losing trade — FOMO, chasing,
          no stop — and this adds up what each one is costing you.
        </p>
      ) : (
        <>
          <div className={styles.costHead}>
            <span className={`${styles.costBig} ${bled ? styles.costBigNeg : styles.costBigPos}`}>
              {fmtDollar(total)}
            </span>
            <span className={styles.costCaption}>
              {bled ? 'bled on mistake-tagged trades' : 'on mistake-tagged trades'}
            </span>
          </div>
          <div className={styles.mistakeRows}>
            {byMistake.map((m) => (
              <div key={m.mistake} className={styles.mistakeRow}>
                <span className={styles.mistakeName}>{m.mistake}</span>
                <span
                  className={`${styles.mistakeTotal} ${
                    (m.total || 0) >= 0 ? styles.mistakeTotalPos : ''
                  }`}
                >
                  {fmtDollar(m.total || 0)}
                </span>
                <span className={styles.mistakeCount}>
                  {m.count} trade{m.count === 1 ? '' : 's'}
                </span>
                <MakeRuleButton
                  mistake={m.mistake}
                  count={m.count}
                  total={m.total || 0}
                  accountId={accountId}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// ── Panel 3: Revenge / Tilt ──────────────────────────────────────────────────

function RevengePanel({ revenge, dismissed, onDismiss }) {
  const cov = revenge.timeComponentCoverage || { timed: 0, total: 0 }
  const timed = cov.timed || 0
  const total = cov.total || 0
  const flags = Array.isArray(revenge.flags) ? revenge.flags : []
  const visible = flags.filter((f) => !dismissed.includes(f.pairKey))

  // Honesty gate: a book that's (nearly) all date-only can't be scanned for
  // revenge — say so instead of implying a clean "no revenge" all-clear. Real
  // flags (which require timed rows) always take priority when present.
  const dateOnly = timed === 0 || (total > 0 && timed / total < TIMED_COVERAGE_MIN)

  return (
    <section className={styles.panel}>
      <h5 className={styles.panelTitle}>Revenge &amp; tilt</h5>
      <p className={styles.panelSub}>
        Re-entering the same symbol within an hour of a loss on it — the classic
        tilt tell. Not every re-entry is revenge; dismiss any that wasn't.
      </p>

      {visible.length > 0 ? (
        <div className={styles.revList}>
          {visible.map((f) => (
            <div key={f.pairKey} className={styles.revRow}>
              <div className={styles.revMain}>
                <span className={styles.revSym}>{f.symbol}</span>
                <span className={styles.revDesc}>
                  re-entered {Math.round(f.minutesApart)} min after a loss
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onDismiss(f.pairKey)}
                aria-label={`Dismiss the revenge flag on ${f.symbol} — not revenge`}
              >
                Not revenge
              </button>
            </div>
          ))}
        </div>
      ) : dateOnly ? (
        <div className={styles.revNote} role="note">
          <UIcon name="warning" size={16} className={styles.revNoteGlyph} />
          <span>
            Revenge detection needs execution times — your trades are date-only, so
            there&apos;s no way to tell a fast re-entry from a next-day one. Add
            entry/exit times (or connect a broker) and this lights up.
          </span>
        </div>
      ) : (
        <p className={styles.revClean}>No revenge patterns detected.</p>
      )}
    </section>
  )
}

// ── Empty state: the rapid-tag pitch card (taggedTradeCount === 0) ───────────

function PitchCard({ onStart }) {
  return (
    <div className={styles.pitch}>
      <UIcon name="tag" size={26} className={styles.pitchGlyph} />
      <h5 className={styles.pitchTitle}>Tag your last 20 trades — about 2 minutes</h5>
      <p className={styles.pitchText}>
        Add the emotion you felt and any mistake to each trade, and this section
        comes alive: which states pay you, what your mistakes cost, and when you
        tilt.
      </p>
      <button
        type="button"
        className={styles.pitchBtn}
        onClick={() => onStart && onStart()}
      >
        Tag my trades
      </button>
    </div>
  )
}
