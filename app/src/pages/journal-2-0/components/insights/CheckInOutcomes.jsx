/**
 * CheckInOutcomes — the "By check-in" view in Insights → Psychology (P2 Tier 3, Task 5).
 *
 * Reads `analytics.psychology.checkIns` (built server-side by `analytics._checkin_section`) and
 * shows how the day's mood and focus check-in line up with that day's trades: a two-tab table,
 * Mood · Focus, one row per level, each row the level's word, days, trades, win rate and average
 * net P&L.
 *
 * ⛔ LAZY ONLY. PsychologySection loads this through `lazyLeaf`, and only while `tier3Enabled()`,
 * so this file does not ride the Notebook's first open. It does not import `checkinWords.js`: the
 * words are the payload's, pinned to that file server-side by tests/test_analytics_checkins.py.
 * The switch lives in PsychologySection, once; this view does not ask it again.
 *
 * The sample wording comes from `lib/sampleSize.js` (ruling R3), and the band keys on the n the
 * win rate actually rests on: `decisiveCount` (wins + losses), never `tradeCount` (ruling
 * R-T3-T5-R4). 12 trades with 11 breakevens is a rate on ONE trade, so it is greyed with
 * `Too few trades`; a thin row shows its 95% range from `sampleSize.js`'s own `rateStat` /
 * `wordStat`. The trades column still shows `tradeCount`. The server sends every level 1..5,
 * with avgPnl / winRate null when a level has no trades, so a zero is never shown as a measured
 * result.
 *
 * Presentational, no fetching. No emoji.
 */

import { useCallback, useId, useRef, useState } from 'react'
import { band, rateStat, WORDING, wordStat } from '../../lib/sampleSize'
import styles from './CheckInOutcomes.module.css'

export const EMPTY_TEXT =
  'Add a check-in block to your daily note to see how mood and focus line up with your trading.'
export const TOO_FEW_TEXT = 'Too few trades'

const TABS = Object.freeze([
  Object.freeze({ key: 'mood', label: 'Mood' }),
  Object.freeze({ key: 'focus', label: 'Focus' }),
])

const fmtPct = (v) => `${(v * 100).toFixed(0)}%`
const fmtDollar = (v) => {
  if (!v) return '$0'
  return `${v > 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export default function CheckInOutcomes({ checkIns }) {
  const [active, setActive] = useState('mood')
  const tabRefs = useRef({})
  const baseId = useId()

  const onKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.key === active)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setActive(next.key)
    tabRefs.current[next.key]?.focus()
  }, [active])

  const days = checkIns?.checkInDays || 0

  return (
    <section className={styles.panel} aria-labelledby={`${baseId}-title`}>
      <h5 id={`${baseId}-title`} className={styles.title}>By check-in</h5>
      {days === 0 ? (
        <p className={styles.empty}>{EMPTY_TEXT}</p>
      ) : (
        <>
          <p className={styles.sub}>
            Your trades grouped by the day&apos;s mood and focus check-in.{' '}
            {plural(days, 'check-in day', 'check-in days')}, {plural(checkIns.joinedTrades || 0, 'trade', 'trades')} on them.
            A day with two check-ins takes their average.
          </p>
          <div className={styles.tabs} role="tablist" aria-label="Check-in dimension">
            {TABS.map((t) => (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[t.key] = el }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.key}`}
                aria-selected={active === t.key}
                aria-controls={`${baseId}-panel`}
                tabIndex={active === t.key ? 0 : -1}
                className={active === t.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => setActive(t.key)}
                onKeyDown={onKeyDown}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`}>
            <LevelTable rows={Array.isArray(checkIns[active]) ? checkIns[active] : []} />
          </div>
          {checkIns.unjoined > 0 && (
            <p className={styles.note}>
              {plural(checkIns.unjoined, 'trade has', 'trades have')} no trading day, so{' '}
              {checkIns.unjoined === 1 ? 'it is' : 'they are'} left out.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function LevelTable({ rows }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col" className={styles.num}>Days</th>
            <th scope="col" className={styles.num}>Trades</th>
            <th scope="col" className={styles.num}>Win rate</th>
            <th scope="col" className={styles.num}>Avg P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <LevelRow key={r.level} r={r} />)}
        </tbody>
      </table>
    </div>
  )
}

function LevelRow({ r }) {
  const n = r.tradeCount || 0
  // The rate's own n. Missing reads 0 (greyed): never fall back to tradeCount, which is the bug.
  const decisive = typeof r.decisiveCount === 'number' ? r.decisiveCount : 0
  const b = band(decisive)
  const tooFew = b === 'too_few'
  const avg = typeof r.avgPnl === 'number' ? r.avgPnl : null
  const winRate = typeof r.winRate === 'number' ? r.winRate : null
  // The wins behind the rate, so sampleSize.js computes the range; rate * n is wins exactly
  // up to float error, hence the round.
  const rangeText = winRate === null
    ? null
    : wordStat(rateStat(Math.round(winRate * decisive), decisive), fmtPct).rangeText
  return (
    <tr className={tooFew ? styles.rowThin : undefined} data-band={b}>
      <th scope="row" className={styles.level}>
        <span className={styles.word}>{r.word}</span>
        {tooFew && <span className={styles.tag}>{TOO_FEW_TEXT}</span>}
        {b === 'thin' && <span className={styles.tag}>{WORDING.thin}</span>}
      </th>
      <td className={styles.num}>{r.days || 0}</td>
      <td className={styles.num}>{n}</td>
      <td className={styles.num}>
        <span>{winRate === null ? '—' : fmtPct(winRate)}</span>
        {rangeText && <span className={styles.range}>{rangeText}</span>}
      </td>
      <td
        className={`${styles.num} ${avg === null ? '' : avg >= 0 ? styles.pos : styles.neg}`}
      >
        {avg === null ? '—' : fmtDollar(avg)}
      </td>
    </tr>
  )
}
