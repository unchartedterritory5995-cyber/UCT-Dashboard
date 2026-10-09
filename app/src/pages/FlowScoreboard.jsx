// app/src/pages/FlowScoreboard.jsx
//
// Public Flow Scoreboard — the verified hit-rate trust asset (roadmap T1-2).
// Every Top Flow pick is snapshotted daily; this page shows the aggregate
// outcomes with nothing hidden: win rates INCLUDE losers, the "honest tape"
// shows the last picks regardless of outcome, and the methodology is printed
// verbatim from the API so the numbers and the words can't drift apart.
//
// Data: GET /api/flow-scoreboard (public, read-only, 5-min server cache).
import { useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import UIcon from '../components/ui/UIcon'
import { BoardFromList, useInTerminalPanel, usePanelFreshness, usePanelRerun, usePanelSymbolRows } from '../components/terminal'
import MineChip, { MineEmpty } from '../components/terminal/MineChip'
import useMyTickers from '../hooks/useMyTickers'
import styles from './FlowScoreboard.module.css'
import { currencyPrefix, formatCurrency, formatNumber, formatPercent } from '../lib/presentation/presentationPrimitives'
import jsonFetcher from '../utils/jsonFetcher'

// jsonFetcher THROWS on a non-2xx, a network error and a 30 s deadline. The old fetcher
// mapped every failure to null, which rendered "The tracker is warming up" - an outage read
// as a young tracker (quality pass 2026-10-05).
const fetcher = (url) => jsonFetcher(url, { credentials: 'include' })

/** "Oct 5, 4:12 PM ET" from the payload's generated_at, or null. */
export function asOfText(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

/* ── Formatting helpers ──────────────────────────────────────────────────── */

// A strike is a level a reader compares digit by digit: ungrouped, no padded zeros ("150",
// "2.5"), at most three decimals. The currency sign comes from the shared primitive (a pick
// carries no currency field, so it is "$" — the options tape is US-listed).
export function fmtStrike(s) {
  const n = Number(s)
  if (!Number.isFinite(n)) return String(s ?? '')
  return formatNumber(n, { grouping: false })
}

export function contractLine(p) {
  const cp = p.cp === 'P' ? 'P' : 'C'
  return `${currencyPrefix(p.currency)}${fmtStrike(p.strike)}${cp} ${p.exp || ''}`.trim()
}

// Shared formatter; this page keeps its own sign rule ("+" only above zero, so a
// flat 0.0% reads unsigned) and accepts numeric strings from the API.
const toNum = (v) => (v == null ? NaN : Number(v))
function fmtPct(v, { signed = true, dp = 1 } = {}) {
  const n = toNum(v)
  return formatPercent(n, { decimals: dp, signed: signed && n > 0 })
}

function fmtPrice(v) {
  return formatCurrency(toNum(v))
}

const gainCls = (v) => (v > 0 ? styles.gain : v < 0 ? styles.loss : styles.flat)

function GradeChip({ grade }) {
  if (!grade) return <span className={styles.gradeChipMuted}>—</span>
  const cls = {
    'A+': styles.gradeAPlus,
    A: styles.gradeA,
    B: styles.gradeB,
    C: styles.gradeC,
    D: styles.gradeD,
  }[grade] || styles.gradeChipMuted
  return <span className={`${styles.gradeChip} ${cls}`}>{grade}</span>
}

function OiBadge({ confirmed }) {
  if (!confirmed) return null
  return (
    <span className={styles.oiBadge} title="Open interest rose >10% after the flag — the positioning was opened, not closed">
      <UIcon name="check" size={10} gold /> OI confirmed
    </span>
  )
}

/* ── Page ────────────────────────────────────────────────────────────────── */

// `mine` (terminal `FREC MINE`, wave 3 lane 13): the standouts and the honest tape narrowed to the
// member's own names. Terminal-only: the public page never reads the paid my-sets route.
export default function FlowScoreboard({ embedded = false, mine: mineProp = false }) {
  const { data, error, isLoading, mutate } = useSWR('/api/flow-scoreboard', fetcher, {
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  })

  const overall = data?.overall
  // TERM-019: name this page's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  usePanelFreshness(data && !error
    ? { source: 'UCT flow record (our options flow tape)', observedAt: data.generated_at || null,
      age: { asOfDate: asOfText(data.generated_at) } }
    : null)
  // In a terminal panel the panel header names FREC; the public-page hero copy steps aside.
  const inPanel = useInTerminalPanel()
  const pageCls = embedded ? `${styles.page} ${styles.embedded}`
    : inPanel?.inset ? `${styles.page} ${styles.pageInPanel}` : styles.page
  const hasData = (data?.picks_tracked ?? 0) > 0
  const rerun = usePanelRerun()
  const [mineState, setMine] = useState(!!mineProp)
  const mine = !!inPanel && mineState
  const myNames = useMyTickers({ enabled: mine })
  const toggleMine = (next) => { if (rerun) rerun(next ? 'FREC MINE' : 'FREC'); else setMine(next) }
  const picks = (data?.recent_picks || []).filter((p) => !mine || myNames.has(p.sym))
  const winners = (data?.recent_winners || []).filter((w) => !mine || myNames.has(w.sym))
  // Row <GO>: the honest tape's rows, in order, each loads its name (`$SYM`); its names are
  // the list a "Board of" opens. Only while the tape is on screen.
  const tapeSyms = usePanelSymbolRows(hasData ? picks.map((p) => p.sym) : [], 'FREC picks')

  return (
    <div className={pageCls}>
      {/* ── Hero band ──────────────────────────────────────────────────── */}
      <div className={styles.hero}>
        {!inPanel && <>
        <div className={styles.heroEyebrow}>
          <UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Flow Scoreboard · verified track record
        </div>
        <h1 className={styles.heroTitle}>Every pick, tracked. Every outcome, public.</h1>
        <p className={styles.heroSub}>
          Every Top Flow pick is saved the moment it&rsquo;s flagged and snapshotted daily
          until expiration — winners, losers, all of it. No cherry-picking, no deleted
          calls. This is the tape.
        </p>
        </>}

        {error && !data ? (
          <div className={styles.empty} data-testid="scoreboard-error">
            The scoreboard could not be read right now. That is a gap in what we could read, not a
            statement about the picks.{' '}
            <button type="button" onClick={() => mutate()}>Retry</button>
          </div>
        ) : isLoading && !data ? (
          <div className={styles.loading}>Loading the scoreboard…</div>
        ) : !hasData ? (
          <div className={styles.empty}>
            The tracker is warming up — picks need at least two daily snapshots before
            they&rsquo;re scored, so the first scores land after the next market close. This
            page re-checks every five minutes.
            {data?.too_new > 0 && (
              <span className={styles.emptySub}> {data.too_new} picks are being tracked now.</span>
            )}
          </div>
        ) : (
          <div className={styles.statRow}>
            <div className={styles.statBlock}>
              <span className={styles.statValue}>{fmtPct(overall?.win_rate_25, { signed: false })}</span>
              <span className={styles.statLabel}>of picks hit +25% at peak</span>
            </div>
            <div className={styles.statBlock}>
              <span className={`${styles.statValue} ${gainCls(overall?.avg_max_gain ?? 0)}`}>
                {fmtPct(overall?.avg_max_gain)}
              </span>
              <span className={styles.statLabel}>average peak gain</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statValue}>{data.picks_tracked}</span>
              <span className={styles.statLabel}>
                picks scored{data.too_new > 0 ? ` · ${data.too_new} too new` : ''}
              </span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statValue}>{fmtPct(overall?.oi_confirmed_rate, { signed: false })}</span>
              <span className={styles.statLabel}>OI-confirmed follow-through</span>
            </div>
          </div>
        )}
      </div>

      {hasData && (
        <>
          {/* ── Grade calibration ──────────────────────────────────────── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <UIcon name="patterns" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Grade calibration — do A+ picks beat B?
              </span>
              <span className={styles.sectionMeta}>peak-gain outcomes by flag grade</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Grade calibration: peak-gain outcomes by flag grade">
                <thead>
                  <tr>
                    <th scope="col">Grade</th>
                    <th scope="col" className={styles.num}>Picks</th>
                    <th scope="col" className={styles.num}>Hit +25%</th>
                    <th scope="col" className={styles.num}>Avg peak gain</th>
                    <th scope="col" className={styles.num}>OI-confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_grade || []).map((row) => (
                    <tr key={row.grade} className={row.picks === 0 ? styles.rowDim : ''}>
                      <td><GradeChip grade={row.grade} /></td>
                      <td className={styles.num}>{row.picks}</td>
                      <td className={styles.num}>{fmtPct(row.win_rate_25, { signed: false })}</td>
                      <td className={`${styles.num} ${row.picks ? gainCls(row.avg_max_gain) : ''}`}>
                        {fmtPct(row.avg_max_gain)}
                      </td>
                      <td className={styles.num}>{fmtPct(row.oi_confirmed_rate, { signed: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Recent standouts ───────────────────────────────────────── */}
          {winners.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>
                  <UIcon name="bolt" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  Recent standouts
                </span>
                <span className={styles.sectionMeta}>best peak gains, picks from the last 45 days</span>
              </div>
              <div className={styles.cardGrid}>
                {winners.map((w) => (
                  <div key={`${w.sym}-${w.strike}-${w.exp}-${w.dateSaved}`} className={styles.card}>
                    <div className={styles.cardTop}>
                      <TickerPopup sym={w.sym}>
                        <span className={styles.cardSym}>{w.sym}</span>
                      </TickerPopup>
                      <GradeChip grade={w.grade} />
                    </div>
                    <div className={styles.cardContract}>{contractLine(w)}</div>
                    <div className={`${styles.cardGain} ${gainCls(w.max_gain_pct)}`}>
                      {fmtPct(w.max_gain_pct)} <span className={styles.cardGainLabel}>peak</span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span>flagged {w.dateSaved}</span>
                      <span>· {w.days_tracked}d tracked</span>
                    </div>
                    <OiBadge confirmed={w.oi_confirmed} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── The honest tape ────────────────────────────────────────── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                <UIcon name="journal" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Last {data.recent_picks?.length || 0} picks — the honest tape
              </span>
              <span className={styles.sectionMeta}>
                {mine ? `your names only: ${picks.length} of them` : 'every recent pick, winners and losers alike'}
              </span>
              {inPanel && <MineChip on={mine} onToggle={toggleMine} explainer={myNames.explainer} testId="frec-mine" />}
              <BoardFromList syms={tapeSyms} label="FREC picks" testId="frec-board" />
            </div>
            {mine && picks.length === 0 && (
              <MineEmpty state={myNames.state === 'empty' ? 'ready' : myNames.state}
                what={`is among the last ${data.recent_picks?.length || 0} picks`} explainer={myNames.explainer} testId="frec-mine-empty" />
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Recent picks">
                <thead>
                  <tr>
                    <th scope="col">Pick</th>
                    <th scope="col">Grade</th>
                    <th scope="col" className={styles.dateCol}>Flagged</th>
                    <th scope="col" className={styles.num}>Entry</th>
                    <th scope="col" className={styles.num}>Peak</th>
                    <th scope="col" className={styles.num}>Now</th>
                    <th scope="col" className={styles.num}>OI</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((p) => (
                    <tr key={`${p.sym}-${p.strike}-${p.exp}-${p.dateSaved}`}>
                      <td className={styles.pickCell}>
                        <TickerPopup sym={p.sym}>
                          <span className={styles.tapeSym}>{p.sym}</span>
                        </TickerPopup>
                        <span className={styles.tapeContract}> {contractLine(p)}</span>
                      </td>
                      <td><GradeChip grade={p.grade} /></td>
                      <td className={styles.dateCell}>{p.dateSaved}</td>
                      <td className={styles.num}>{fmtPrice(p.entry)}</td>
                      <td className={`${styles.num} ${gainCls(p.max_gain_pct)}`}>{fmtPct(p.max_gain_pct)}</td>
                      <td className={`${styles.num} ${styles.nowCell} ${gainCls(p.current_gain_pct)}`}>
                        {fmtPct(p.current_gain_pct)}
                      </td>
                      <td className={styles.num}>
                        {/* The tick is an icon a screen reader skips; the cell names itself
                            either way (audit 2026-10-08), never silence for "confirmed". */}
                        {p.oi_confirmed
                          ? <span className={styles.oiTick} title="OI confirmed" role="img" aria-label="OI confirmed" data-testid="frec-oi-yes"><UIcon name="check" size={12} gold /></span>
                          : <span className={styles.oiDash} role="img" aria-label="Not OI-confirmed">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {asOfText(data?.generated_at) && (
        <p className={styles.methodText} data-testid="scoreboard-asof">Scores as of {asOfText(data.generated_at)}.</p>
      )}

      {/* ── Methodology footnote ─────────────────────────────────────────── */}
      {data?.methodology && (
        <div className={styles.methodology}>
          <div className={styles.methodTitle}>Methodology</div>
          <p className={styles.methodText}>{data.methodology}</p>
          {data.window && <p className={styles.windowNote}>{data.window}</p>}
          <p className={styles.disclaimer}>
            Informational only — not investment advice. Options involve substantial risk.
          </p>
        </div>
      )}
    </div>
  )
}
