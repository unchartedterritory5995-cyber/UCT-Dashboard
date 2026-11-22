// Compare Symbols → Rotation: where each name sits on RS-Ratio × RS-Momentum against SPY, with
// the path it took to get there (UCT RS Phase 3, unit 3-12).
//
// ⛔ ONE FORMULA, ONE GRAPH (engineering map 2026-11-08, D1 and D5). The points are the Terminal's
// `rrgRows` → `relativeMath.rrgPath` (`RRG_METHOD`), drawn by the Terminal's own extracted graph
// (`components/rotation/RrgGraph`), with the Terminal's method sentence under it. Nothing here
// computes a coordinate.
//
// Which names, in order:
//   1. the panel's own compared symbols, when there are any;
//   2. else a group picked here (theme / sector / industry, through the panel's group resolver);
//   3. else a watchlist picked here (`GET /api/watchlists?include_items=1&include_prebuilt=0`).
// A choice made here (a group or a watchlist picked, or the source buttons) wins over that order.
// At most RRG_MAX (the Terminal's 12): a bigger set shows the 12 highest IBD-style RS ratings, read
// from the screener's own rows (`POST /api/screener/scan`, a ticker scope sorted by
// `rs_rating_ibd`), and says so; when that read is refused or fails, the first 12 by symbol, and
// it says that instead.
//
// Desktop only: the Compare panel mounts after the phone branch (ChartsWorkspace). No gold here:
// the rotation view has no look-here mark (map 3-08); the graph wears the Terminal's colours.
import { useEffect, useMemo, useState } from 'react'
import RrgGraph, { RrgMethodNote } from '../../components/rotation/RrgGraph'
import { RRG_BENCHMARK, RRG_MAX, rrgRows } from '../terminal/panels/RrgPanel'
import { RRG_METHOD } from '../terminal/panels/relativeMath'
import useCloses, { failedText, formingThrough } from '../terminal/panels/useCloses'
import { formatNumber } from '../../lib/presentation/presentationPrimitives'
import { GROUP_TYPES, fetchGroupList, fetchGroupMembers } from './compareGroups'
import c from './CompareSymbolsPanel.module.css'
import {
  QUADRANT_WORDS, capSentence, capUniverse, dedupe, fetchRsRatings, fetchWatchlists, groupNameFor, norm, resolveRotationUniverse,
} from './rotationUniverse'

const TYPE_WORD = { theme: 'theme', sector: 'sector', industry: 'industry' }
const TYPE_LABEL = { theme: 'Theme', sector: 'Sector', industry: 'Industry' }
const P_CLASS = { Leading: 'pLeading', Weakening: 'pWeakening', Lagging: 'pLagging', Improving: 'pImproving' }

/** The sentence for a group read that gave no names: a failed read, or a group with none on file. */
const noMembers = (members, name) => (members ? `${name} has no chartable names on file.` : `Could not read the names in ${name} just now.`)

export default function CompareRotation({ ownSyms = [], intent = null }) {
  const [prefer, setPrefer] = useState(null)
  const [group, setGroup] = useState(null)
  const [pickType, setPickType] = useState('theme')
  const [pickOpen, setPickOpen] = useState(false)
  const [groupList, setGroupList] = useState([])
  const [groupQuery, setGroupQuery] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [watchlists, setWatchlists] = useState(null)   // null = not read yet
  const [watchlistId, setWatchlistId] = useState('')
  const [cadence, setCadence] = useState('W')
  const [note, setNote] = useState('')
  const [ratings, setRatings] = useState({ key: null, value: null })

  const own = useMemo(() => dedupe(ownSyms), [ownSyms])
  const watchlist = useMemo(() => (watchlists || []).find((w) => w.id === watchlistId) || null, [watchlists, watchlistId])
  const universe = useMemo(() => resolveRotationUniverse({ own, group, watchlist, prefer }), [own, group, watchlist, prefer])

  // An explicit open (`uct:compare-open`, unit 3-09) picks the named symbol's group.
  useEffect(() => {
    if (!intent) return undefined
    const g = intent.group
    let alive = true
    ;(async () => {
      let type = null
      let name = null
      if (g && typeof g === 'object') { type = g.type; name = g.name }
      else if (typeof g === 'string' && intent.sym) { type = g; name = await groupNameFor(norm(intent.sym), g) }
      if (!alive || !type || !TYPE_WORD[type]) return
      if (!name) { setNote(`No ${TYPE_WORD[type]} is on file for ${norm(intent.sym)}.`); return }
      const members = await fetchGroupMembers(type, name)
      if (!alive) return
      if (!members?.symbols.length) { setNote(noMembers(members, name)); return }
      setNote('')
      setGroup({ type, ...members })
      setPrefer('group')
    })()
    return () => { alive = false }
  }, [intent])

  // The watchlists are read once, when they can matter.
  const needLists = prefer === 'watchlist' || (!own.length && !group)
  useEffect(() => {
    if (!needLists || watchlists !== null) return undefined
    let alive = true
    fetchWatchlists().then((lists) => { if (alive) setWatchlists(lists) })
    return () => { alive = false }
  }, [needLists, watchlists])

  // The group list for the picker.
  useEffect(() => {
    if (!pickOpen) return undefined
    let alive = true
    setGroupBusy(true)
    fetchGroupList(pickType).then((list) => { if (alive) { setGroupList(list); setGroupBusy(false) } })
    return () => { alive = false }
  }, [pickOpen, pickType])

  // Over the cap: the screener's ratings rank the names (once per set of names).
  const over = universe.syms.length > RRG_MAX
  const allKey = universe.syms.join(',')
  useEffect(() => {
    if (!over) return undefined
    let alive = true
    fetchRsRatings(universe.syms).then((value) => { if (alive) setRatings({ key: allKey, value }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over, allKey])
  const ranking = over && ratings.key !== allKey
  const capped = useMemo(
    () => (ranking ? { shown: [], total: universe.syms.length, order: null } : capUniverse(universe.syms, over ? ratings.value : null)),
    [ranking, universe, over, ratings],
  )
  const fetchList = useMemo(() => (capped.shown.length ? [RRG_BENCHMARK, ...capped.shown] : []), [capped])
  const state = useCloses(fetchList, cadence)
  const rows = useMemo(() => (state.phase === 'ready' ? rrgRows(state.series, capped.shown) : []), [state, capped])

  const pickGroup = async (name) => {
    const members = await fetchGroupMembers(pickType, name)
    if (!members?.symbols.length) { setNote(noMembers(members, name)); return }
    setNote('')
    setGroup({ type: pickType, ...members })
    setPrefer('group')
    setPickOpen(false)
    setGroupQuery('')
  }
  const pickWatchlist = (id) => {
    setWatchlistId(id)
    if (id) { setPrefer('watchlist'); setNote('') }
  }

  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase()
    return q ? groupList.filter((g) => g.name.toLowerCase().includes(q)) : groupList
  }, [groupList, groupQuery])

  const unit = cadence === 'W' ? 'week' : 'session'
  const sourceLabel = universe.source === 'own' ? 'Your compared symbols'
    : universe.source === 'group' ? `${TYPE_LABEL[universe.group.type] || 'Group'}: ${universe.group.name}`
      : universe.source === 'watchlist' ? `Watchlist: ${universe.watchlist.name}` : null
  const cap = capSentence(capped, universe.source === 'group' ? universe.group : null)
  const showPicker = pickOpen || (!universe.source && !own.length)

  return (
    <div className={c.rot} data-testid="compare-rotation">
      <div className={c.rotBar}>
        <div className={c.rotSeg} role="group" aria-label="Names to plot">
          {own.length > 0 && (
            <button type="button" className={c.rotSegBtn} aria-pressed={universe.source === 'own'}
              onClick={() => { setPrefer('own'); setPickOpen(false) }}>Compared ({own.length})</button>
          )}
          <button type="button" className={c.rotSegBtn} aria-pressed={universe.source === 'group'}
            aria-expanded={showPicker}
            onClick={() => {
              // A group already picked comes back first; pressing again opens the picker to change it.
              if (group && universe.source !== 'group') { setPrefer('group'); setPickOpen(false) } else setPickOpen((v) => !v)
            }}>Group</button>
          <label className={c.rotSelectWrap}>
            <span className={c.srOnly}>Watchlist</span>
            <select className={c.rotSelect} value={universe.source === 'watchlist' ? watchlistId : ''}
              onFocus={() => { if (watchlists === null) fetchWatchlists().then(setWatchlists) }}
              onChange={(e) => pickWatchlist(e.target.value)} data-testid="compare-rotation-watchlist">
              <option value="">{watchlists === null ? 'Watchlist…' : watchlists.length ? 'Watchlist…' : 'No watchlists with names'}</option>
              {(watchlists || []).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.symbols.length})</option>)}
            </select>
          </label>
        </div>
        <div className={c.rotSeg} role="group" aria-label="Closes">
          <button type="button" className={c.rotSegBtn} aria-pressed={cadence === 'W'} onClick={() => setCadence('W')}>Weekly</button>
          <button type="button" className={c.rotSegBtn} aria-pressed={cadence === 'D'} onClick={() => setCadence('D')}>Daily</button>
        </div>
      </div>

      {showPicker && (
        <div className={c.groupBox} data-testid="compare-rotation-picker">
          <div className={c.rotSeg} role="group" aria-label="Group type">
            {GROUP_TYPES.map((t) => (
              <button key={t.key} type="button" className={c.rotSegBtn} aria-pressed={pickOpen && pickType === t.key}
                onClick={() => { setPickType(t.key); setPickOpen(true); setGroupQuery('') }}>{t.label}</button>
            ))}
          </div>
          {pickOpen ? (
            <>
              <input aria-label={`Search ${pickType}s`} className={`${c.input} ${c.rotInput}`} value={groupQuery}
                onChange={(e) => setGroupQuery(e.target.value)} placeholder={`Search ${pickType}s…`} spellCheck={false} autoComplete="off" />
              <div className={c.groupResults}>
                {groupBusy ? <div className={c.empty}>Loading…</div> : filteredGroups.length ? filteredGroups.map((g) => (
                  <button key={g.name} type="button" className={c.groupResultRow} onClick={() => pickGroup(g.name)}>
                    <span className={c.groupResultName}>{g.name}</span>
                    <span className={c.groupResultCount}>{g.count}</span>
                  </button>
                )) : <div className={c.empty}>No matches</div>}
              </div>
            </>
          ) : (
            <div className={c.empty}>Pick a group type above, or one of your watchlists, to see where its names sit.</div>
          )}
        </div>
      )}

      {note && <p className={c.rotNote} role="status" data-testid="compare-rotation-note">{note}</p>}
      {sourceLabel && (
        <p className={c.rotSource} data-testid="compare-rotation-source">
          {sourceLabel} · {universe.syms.length} {universe.syms.length === 1 ? 'name' : 'names'}
        </p>
      )}
      {cap && <p className={c.rotMuted} data-testid="compare-rotation-cap">{cap}</p>}

      <RotationBody state={state} rows={rows} ranking={ranking} universe={universe} shown={capped.shown} cadence={cadence} unit={unit} />
    </div>
  )
}

function RotationBody({ state, rows, ranking, universe, shown, cadence, unit }) {
  if (!universe.syms.length) return null
  if (ranking) return <p className={c.rotMuted} role="status">Ranking the names by RS rating…</p>
  if (state.phase === 'warming') return <p className={c.rotMuted} role="status">The server is preparing price history for these names. This takes about a minute.</p>
  if (state.phase !== 'ready') return <p className={c.rotMuted} role="status" data-testid="compare-rotation-loading">Loading the rotation graph…</p>
  const retry = <button type="button" className={c.rotRetry} onClick={state.retry}>Retry</button>
  if (state.failed.includes(RRG_BENCHMARK)) {
    return (
      <p className={c.rotNote} role="status" data-testid="compare-rotation-error">
        Could not read {RRG_BENCHMARK}, the benchmark, just now. Every point on the graph is measured against it, so nothing is drawn. {retry}
      </p>
    )
  }
  if (!rows.length && state.failed.length) {
    return <p className={c.rotNote} role="status" data-testid="compare-rotation-error">{failedText(state)} Nothing could be placed on the graph. {retry}</p>
  }
  if (!rows.length) {
    return (
      <p className={c.rotMuted} role="status" data-testid="compare-rotation-empty">
        Not enough common history to place anything on the graph. It needs about {RRG_METHOD.ratioLen + RRG_METHOD.momLen} {unit}s of closes shared with {RRG_BENCHMARK}.
      </p>
    )
  }
  const plotted = new Set(rows.map((r) => r.sym))
  const short = shown.filter((s) => !plotted.has(s) && !state.failed.includes(s))
  const asOf = rows.reduce((m, r) => (r.asOf > m ? r.asOf : m), '')
  const lead = rows.filter((r) => r.quadrant === 'Leading').map((r) => r.sym)
  const improving = rows.filter((r) => r.quadrant === 'Improving').map((r) => r.sym)
  return (
    <>
      <p className={c.rotLede} data-testid="compare-rotation-lede">
        {`Rotation vs ${RRG_BENCHMARK}, ${cadence === 'W' ? 'weekly' : 'daily'}. `}
        {lead.length ? `Leading: ${lead.join(', ')}. ` : 'Nothing is in Leading. '}
        {improving.length ? `Improving: ${improving.join(', ')}.` : ''}
      </p>
      <div data-testid="compare-rotation-graph"><RrgGraph rows={rows} benchmark={RRG_BENCHMARK} /></div>
      <p className={c.rotMuted} data-testid="compare-rotation-legend">
        {Object.entries(QUADRANT_WORDS).map(([q, words]) => `${q}: ${words}.`).join(' ')}
      </p>
      <div className={c.rotTableBox}>
        <table className={c.rotTable} aria-label={`Where each name sits, vs ${RRG_BENCHMARK}`} data-testid="compare-rotation-table">
          <thead>
            <tr><th scope="col">Symbol</th><th scope="col">Quadrant</th><th scope="col">RS-Ratio</th><th scope="col">RS-Momentum</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sym} data-testid={`compare-rotation-row-${r.sym}`}>
                <th scope="row">{r.sym}{r.name ? <span className={c.rotDim}> {r.name}</span> : null}</th>
                <td>
                  <span className={`${c.rotPill} ${c[P_CLASS[r.quadrant]]}`}>{r.quadrant}</span>
                  <span className={c.srOnly}>: {QUADRANT_WORDS[r.quadrant]}, {r.inQuadrant} {unit}{r.inQuadrant === 1 ? '' : 's'} in it</span>
                </td>
                <td>{formatNumber(r.ratio, { decimals: 2 })}</td>
                <td>{formatNumber(r.momentum, { decimals: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.failed.length > 0 && (
        <p className={c.rotNote} role="status" data-testid="compare-rotation-failed">
          {failedText(state)} {state.failed.length === 1 ? 'It is' : 'They are'} not on the graph. {retry}
        </p>
      )}
      {short.length > 0 && (
        <p className={c.rotNote} role="status">Too little history shared with {RRG_BENCHMARK} to place {short.join(', ')}.</p>
      )}
      <p className={c.rotMuted} data-testid="compare-rotation-method">
        Closes through {asOf}{cadence === 'W' ? ' (the newest week is still forming until Friday\'s close)'
          : formingThrough(state) === asOf ? ' (today\'s bar is still forming: intraday, not a close)' : ''}.{' '}
        <RrgMethodNote benchmark={RRG_BENCHMARK} unit={unit} />
      </p>
    </>
  )
}
