/**
 * Wave 13 lane 13I-2 — the visual playbook: the member's tagged chart blocks as a grid ("my
 * VCPs", "my breakouts"), each card with its frozen chart, its frozen fingerprint and the
 * outcome of the trade it planned, plus the stats of whatever slice the filters leave.
 *
 * The SERVER owns every number (`api/services/journal_two/visual_playbook.py`): the cards, the
 * outcome join on 13A's stable trade_ref, the slice stats from the per-setup authority, and the
 * R3 sample band. This file builds the query and shows the answer. ⛔ A failed read THROWS so
 * SWR carries an error — a swallowed failure would render as "no charts", a claim about the
 * member's playbook the server never made (the swallowedFetch census, TERM-033).
 *
 * R3 (ruling): under 10 trades the stats read "too few to judge" and sit behind a reveal;
 * 10-24 read "thin sample" with a range; 25 and up are shown plainly.
 *
 * The regime filter is a labelled, disabled placeholder until lane 13E's frozen entry context
 * exists — the server says so in `regime.reason`, and this renders that sentence.
 *
 * Mounted as a sheet from the fingerprint panel. `VisualPlaybookBody` is the page body for the
 * integrator's route (App.jsx and My Playbook's link arrive after lane 13B, plan section 5.5).
 */
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Sheet from '../../../../components/mobile/Sheet'
import { useIsTouch } from '../../../../hooks/useBreakpoint'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { SETUP_FAMILIES, canonicalSetupTag, tagsInFamily } from '../../lib/setupTagMap'
import { FIELD_LABELS, formatFingerprintValue } from '../../lib/fingerprintChecklist'
import styles from './VisualPlaybook.module.css'

export const VISUAL_PLAYBOOK_FLAG = 'notebook_visual_playbook_enabled'
const BASE = '/api/j2/notebook-visual-playbook'

/** The fingerprint ranges the filter bar offers: field, which bound, and its words. */
export const RANGE_INPUTS = Object.freeze([
  { field: 'rs_rank', bound: 'min', label: 'RS rank at least' },
  { field: 'base_depth_pct', bound: 'max', label: 'Base depth at most (%)' },
  { field: 'adr_pct', bound: 'min', label: 'ADR at least (%)' },
  { field: 'pole_pct', bound: 'min', label: 'Prior run at least (%)' },
])

const CARD_FIELDS = ['rs_rank', 'base_depth_pct', 'adr_pct', 'pole_pct']
const OUTCOME_WORDS = { win: 'Win', loss: 'Loss', breakeven: 'Breakeven', none: 'No trade linked' }

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Playbook request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** The query string for a filter state. Pure, so the rail can read it. */
export function buildPlaybookQuery({ setupChoice = '', outcome = '', timeframe = '', ranges = {} } = {}) {
  const q = new URLSearchParams()
  if (setupChoice.startsWith('tag:')) q.append('setup', setupChoice.slice(4))
  else if (setupChoice.startsWith('family:')) for (const t of tagsInFamily(setupChoice.slice(7))) q.append('setup', t)
  if (outcome) q.set('outcome', outcome)
  if (timeframe) q.set('timeframe', timeframe)
  for (const { field, bound } of RANGE_INPUTS) {
    const raw = ranges[field]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    q.append('range', bound === 'min' ? `${field}:${n}:` : `${field}::${n}`)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const rFmt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}R`)

function SliceStats({ stats }) {
  const [revealed, setRevealed] = useState(false)
  if (!stats) return null
  const numbers = (
    <dl className={styles.statNumbers}>
      <div><dt>Win rate</dt><dd>{pct(stats.winRate)}{stats.winRateRange ? ` (range ${pct(stats.winRateRange[0])}–${pct(stats.winRateRange[1])})` : ''}</dd></div>
      <div><dt>Average R</dt><dd>{rFmt(stats.avgR)}{stats.avgRRange ? ` (range ${rFmt(stats.avgRRange[0])} to ${rFmt(stats.avgRRange[1])})` : ''}</dd></div>
      <div><dt>Wins / losses / even</dt><dd>{stats.wins} / {stats.losses} / {stats.breakeven}</dd></div>
    </dl>
  )
  return (
    <section className={styles.stats} aria-label="This slice" data-testid="slice-stats" data-band={stats.band}>
      <p className={styles.statHead}>
        <strong>{stats.trades}</strong> {stats.trades === 1 ? 'trade' : 'trades'} from <strong>{stats.charts}</strong>{' '}
        {stats.charts === 1 ? 'chart' : 'charts'}
        {stats.unlinkedCharts ? ` (${stats.unlinkedCharts} with no trade linked yet)` : ''}
        {stats.wording && <> · <span className={styles.band}>{stats.wording}</span></>}
      </p>
      {stats.band === 'too_few' ? (
        stats.trades === 0 ? null : (
          <>
            <button type="button" className={styles.linkBtn} aria-expanded={revealed} onClick={() => setRevealed((v) => !v)}>
              {revealed ? 'Hide the numbers' : 'Show the numbers anyway'}
            </button>
            {revealed && numbers}
          </>
        )
      ) : numbers}
    </section>
  )
}

function Card({ card }) {
  const alt = `${card.symbol} ${card.timeframe} chart as of ${card.asOf || 'unknown day'}`
  const primary = card.trades[0]
  return (
    <li className={styles.card} data-testid="playbook-card" data-outcome={card.outcome}>
      {card.image?.url ? (
        <img className={styles.cardImg} src={card.image.url} alt={alt} loading="lazy"
          width={card.image.w || undefined} height={card.image.h || undefined} />
      ) : (
        <div className={styles.cardImgEmpty} role="img" aria-label={`${alt}: no frozen image yet`}>
          No frozen image yet
        </div>
      )}
      <div className={styles.cardBody}>
        <p className={styles.cardTitle}>
          <span className={styles.sym}>{card.symbol}</span> <span className={styles.tag}>{card.setupTag}</span>
        </p>
        <p className={styles.cardMeta}>{card.asOf} · {card.timeframe}{card.fingerprintAsOf ? ` · fingerprint ${card.fingerprintAsOf}` : ' · not fingerprinted yet'}</p>
        <ul className={styles.cardFields} aria-label="Fingerprint">
          {CARD_FIELDS.map((f) => (
            <li key={f}>{FIELD_LABELS[f]} {formatFingerprintValue(f, card.values?.[f]) ?? 'n/a'}</li>
          ))}
        </ul>
        <p className={`${styles.outcome} ${styles[`o_${card.outcome}`] || ''}`}>
          {OUTCOME_WORDS[card.outcome]}
          {primary ? ` · ${rFmt(primary.rMultiple)}` : ''}
          {card.trades.length > 1 ? ` · ${card.trades.length} trades` : ''}
        </p>
        <a className={styles.linkBtn} href={`/journal?j2tab=notebook&note=${encodeURIComponent(card.noteId)}`}>
          Open “{card.noteTitle || 'note'}”
        </a>
      </div>
    </li>
  )
}

export function VisualPlaybookBody({ initialSetup = null }) {
  const tag = canonicalSetupTag(initialSetup)
  const [setupChoice, setSetupChoice] = useState(tag ? `tag:${tag}` : '')
  const [outcome, setOutcome] = useState('')
  const [timeframe, setTimeframe] = useState('')
  const [ranges, setRanges] = useState({})
  const query = buildPlaybookQuery({ setupChoice, outcome, timeframe, ranges })
  // Typing a number fetches once it settles, not per keystroke.
  const [settled, setSettled] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setSettled(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data, error, isLoading, mutate } = useSWR(`${BASE}/cards${settled}`, getJson, { revalidateOnFocus: false, keepPreviousData: true })
  const facets = data?.facets || { setups: {}, timeframes: {} }
  const tagOptions = useMemo(() => Object.keys(facets.setups || {}).sort(), [facets.setups])

  return (
    <div className={styles.body} data-testid="visual-playbook">
      <form className={styles.filters} aria-label="Filter your playbook" onSubmit={(e) => e.preventDefault()}>
        <label className={styles.field}>
          <span>Setup</span>
          <select value={setupChoice} onChange={(e) => setSetupChoice(e.target.value)}>
            <option value="">All setups</option>
            <optgroup label="Your tags">
              {tagOptions.map((t) => <option key={t} value={`tag:${t}`}>{t} ({facets.setups[t]})</option>)}
              {setupChoice.startsWith('tag:') && !tagOptions.includes(setupChoice.slice(4)) && (
                <option value={setupChoice}>{setupChoice.slice(4)} (0)</option>
              )}
            </optgroup>
            <optgroup label="Families">
              {SETUP_FAMILIES.map((f) => <option key={f} value={`family:${f}`}>All {f}</option>)}
            </optgroup>
          </select>
        </label>
        <label className={styles.field}>
          <span>Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any outcome</option>
            {Object.entries(OUTCOME_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Timeframe</span>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option value="">Any timeframe</option>
            {Object.keys(facets.timeframes || {}).sort().map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Market regime</span>
          <select disabled value="" aria-describedby="vp-regime-why">
            <option value="">Not available yet</option>
          </select>
          <span id="vp-regime-why" className={styles.hint}>{data?.regime?.reason || 'Regime filtering is not built yet.'}</span>
        </label>
        {RANGE_INPUTS.map(({ field, label }) => (
          <label key={field} className={styles.field}>
            <span>{label}</span>
            <input type="number" inputMode="decimal" value={ranges[field] ?? ''}
              onChange={(e) => setRanges((r) => ({ ...r, [field]: e.target.value }))} />
          </label>
        ))}
      </form>

      {error && (
        <p className={styles.error} role="alert">
          Your playbook could not be read ({error.status || 'network'}).{' '}
          <button type="button" className={styles.linkBtn} onClick={() => mutate()}>Try again</button>
        </p>
      )}
      {isLoading && !data && <p className={styles.muted} role="status">Loading your playbook…</p>}

      {data && (
        <>
          <SliceStats key={settled} stats={data.stats} />
          {Object.entries(data.excludedMissing || {}).map(([f, n]) => (
            <p key={f} className={styles.muted}>
              {n} {n === 1 ? 'chart was' : 'charts were'} left out: no {FIELD_LABELS[f] || f} in the fingerprint.
            </p>
          ))}
          {data.pending > 0 && <p className={styles.muted}>{data.pending} more charts are still being fingerprinted.</p>}
          {data.cards.length ? (
            <ul className={styles.grid} aria-label="Tagged charts">
              {data.cards.map((c) => <Card key={`${c.noteId}/${c.embedKey}`} card={c} />)}
            </ul>
          ) : (
            <p className={styles.muted}>
              No tagged charts match. Tag a chart in a note (the Setup picker under the chart) to build your playbook.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default function VisualPlaybook({ open, onClose, initialSetup = null }) {
  // Opened by a click, so the touch read is current (CLAUDE.md: useIsTouch is stale only at first paint).
  const isTouch = useIsTouch()
  if (notebookFlag(VISUAL_PLAYBOOK_FLAG) !== true) return null
  return (
    <Sheet open={open} onClose={onClose} title="Visual playbook" labelledByTitle
      variant={isTouch ? 'fullscreen' : 'modal'} maxWidth={1100}>
      <VisualPlaybookBody initialSetup={initialSetup} />
    </Sheet>
  )
}
