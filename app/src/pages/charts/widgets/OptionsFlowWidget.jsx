/**
 * Options Flow widget — the firm's live options-flow tape, right on the chart board.
 *
 * Reuses the EXISTING flow database + endpoints (no new pipeline):
 *   • market-wide Tape / Biggest → GET /api/live/massive/recent (JSON alert rows,
 *     carrying _direction / _type / grade / timestamp).
 *   • market-wide Sentiment      → GET /api/flow/top-conviction (pre-aggregated
 *     per-ticker conviction board).
 *   • per-symbol (all views)     → GET /api/flow/ticker/{sym} (uncapped CSV for one
 *     ticker) parsed with optionsFlow/flowCompute.parseCSV, then Tape/Biggest/
 *     Sentiment are all derived client-side from that one ticker's prints.
 *
 * LEADS WITH the live Tape; a segmented control switches the lead view
 * (Tape · Biggest · Sentiment). A scope toggle flips market-wide firehose ⟷
 * per-symbol (per-symbol follows the linked chart's color group). Rich filters
 * (min premium · calls/puts · sweeps/blocks · bull/bear) narrow the feed.
 *
 * Appearance (canvas + text color + text size + up/down colors) is a per-widget ⚙
 * blob; an uncustomized widget follows the app theme (light → white canvas + dark
 * text, OLED → black canvas + light text).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences from '../../../hooks/usePreferences'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import { parseCSV } from '../../optionsFlow/flowCompute'
import NewsSettingsPanel from './NewsSettingsPanel'
import {
  mergeOptionsFlowWidgetSettings, optionsFlowWidgetStyleVars, optionsFlowDefaultsForTheme,
} from './optionsFlowWidgetSettings'
import styles from './OptionsFlowWidget.module.css'

// ── tiny formatters (same recipe as OptionsFlowPreview) ──
function fmt(n) {
  const a = Math.abs(n || 0)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${(n || 0).toFixed(0)}`
}
function fmtStrike(s) {
  const v = Number(s)
  if (!Number.isFinite(v)) return String(s ?? '')
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
// Display a print time from either an epoch (alerts) or an ET clock string (CSV).
function fmtTime(t) {
  if (t == null || t === '') return ''
  if (typeof t === 'number') {
    const d = new Date(t < 1e12 ? t * 1000 : t)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  const m = String(t).match(/^(\d{1,2}:\d{2})(?::\d{2})?\s*([AaPp][Mm])?/)
  return m ? `${m[1]}${m[2] ? ' ' + m[2].toUpperCase() : ''}` : String(t)
}

// A market-wide "recent" alert row → the widget's common row model.
function normAlert(a) {
  return {
    id: `a${a.id}`,
    ticker: (a.ticker || '').toUpperCase(),
    cp: a.cp === 'P' ? 'P' : 'C',
    strike: Number(a.strike),
    exp: a.exp,
    dte: a.dte,
    premium: Number(a.alertPremium) || 0,
    spot: Number(a.spot) || 0,
    type: (a._type || '').toUpperCase(),           // SWEEP / BLOCK / ML
    dir: (a._direction || '').toUpperCase(),        // BULL / BEAR
    grade: a.grade || '',
    moneyness: a.moneynessLabel || '',
    sector: a._sector || '',
    er: a._er === 'T',
    time: Number(a.timestamp) || null,
    _ts: (Number(a.timestamp) || 0) * 1000,
  }
}

// One parsed CSV print (per-symbol) → the widget's common row model. Direction is
// derived from call/put × trade side (buy@ask vs sell@bid) — the standard read:
// calls bought / puts sold = bullish, calls sold / puts bought = bearish.
function normCsv(r, i) {
  const cp = String(r.cp || '').toUpperCase().startsWith('P') ? 'P' : 'C'
  const buySide = String(r.side || '').toUpperCase().startsWith('A')
  const dir = cp === 'C' ? (buySide ? 'BULL' : 'BEAR') : (buySide ? 'BEAR' : 'BULL')
  const premium = Number(r.premium) || 0
  if (!r.ticker || !premium) return null
  const ds = `${r.date || ''} ${r.time || ''}`.trim()
  const parsed = ds ? Date.parse(ds) : NaN
  return {
    id: `c${i}_${r.ticker}_${r.strike}_${r.premium}_${r.time || ''}`,
    ticker: String(r.ticker).toUpperCase(),
    cp,
    strike: Number(r.strike),
    exp: r.expiry || '',
    dte: Number(r.dte) || null,
    premium,
    spot: Number(r.spot) || 0,
    type: String(r.type || '').toUpperCase(),
    dir,
    grade: '',
    moneyness: '',
    sector: r.sector || '',
    er: String(r.er || '').toUpperCase() === 'T',
    time: r.time || null,
    _ts: Number.isNaN(parsed) ? 0 : parsed,
  }
}

// Unified fetcher: branch on the URL so one SWR fetcher serves all three sources.
async function flowFetcher(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`flow ${r.status}`)
  if (url.includes('/flow/ticker/')) {
    const text = await r.text()
    return { kind: 'csv', rows: parseCSV(text) }
  }
  const j = await r.json()
  if (url.includes('top-conviction')) return { kind: 'board', items: Array.isArray(j.items) ? j.items : [] }
  return { kind: 'alerts', alerts: Array.isArray(j.alerts) ? j.alerts : [], status: j.status || null }
}

const MIN_PREM_OPTS = [
  { v: 0, label: 'All' },
  { v: 250000, label: '$250K' },
  { v: 500000, label: '$500K' },
  { v: 1000000, label: '$1M' },
]

export default function OptionsFlowWidget({ color, opts, onOptsChange }) {
  // One-directional link on click (→ chart follows). For per-symbol SCOPE we also
  // READ the linked color group's symbol so the tape follows the chart.
  const { groupSyms, setGroupSym } = useWorkspace() || {}
  const goToSym = useCallback((sym) => {
    if (sym && setGroupSym) setGroupSym(color, sym.toUpperCase())
  }, [setGroupSym, color])

  // ── persisted view state (lead / scope / filters) ──
  const lead = opts?.lead || 'tape'                 // 'tape' | 'biggest' | 'sentiment'
  const scope = opts?.scope || 'market'             // 'market' | 'symbol'
  const filters = useMemo(() => ({
    minPrem: 0, cp: 'all', type: 'all', dir: 'all', ...(opts?.filters || {}),
  }), [opts?.filters])
  const patchOpts = useCallback(
    (patch) => onOptsChange?.({ ...(opts || {}), ...patch }),
    [opts, onOptsChange],
  )
  const setFilter = useCallback(
    (k, v) => patchOpts({ filters: { ...filters, [k]: v } }),
    [patchOpts, filters],
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = (filters.minPrem ? 1 : 0) + (filters.cp !== 'all' ? 1 : 0)
    + (filters.type !== 'all' ? 1 : 0) + (filters.dir !== 'all' ? 1 : 0)

  // ── appearance settings (⚙) ──
  const { prefs } = usePreferences()
  const settings = useMemo(
    () => mergeOptionsFlowWidgetSettings(opts?.settings ?? optionsFlowDefaultsForTheme(prefs.theme)),
    [opts?.settings, prefs.theme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback(
    (patch) => onOptsChange?.({ ...(opts || {}), settings: { ...settings, ...patch } }),
    [opts, settings, onOptsChange],
  )
  const resetSettings = useCallback(
    () => onOptsChange?.({ ...(opts || {}), settings: null }),
    [opts, onOptsChange],
  )
  const rootStyle = useMemo(() => optionsFlowWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  // ── which symbol does per-symbol scope follow? ──
  const symForScope = scope === 'symbol' ? String(groupSyms?.[color] || '').toUpperCase() : ''

  // ── data source keyed by (scope, symbol, lead) ──
  const swrKey = useMemo(() => {
    if (scope === 'symbol') {
      return symForScope ? `/api/flow/ticker/${symForScope}?source=stocks&days=1` : null
    }
    if (lead === 'sentiment') return '/api/flow/top-conviction?limit=24'
    return `/api/live/massive/recent?limit=120&sort_by=${lead === 'biggest' ? 'premium' : 'recent'}`
  }, [scope, symForScope, lead])

  const { data, error, isLoading } = useMobileSWR(swrKey, flowFetcher, {
    refreshInterval: 12000,
    dedupingInterval: 6000,
    marketHoursOnly: true,
  })

  // Normalized print rows (tape/biggest) + conviction board (sentiment).
  const rows = useMemo(() => {
    if (!data) return []
    if (data.kind === 'alerts') return data.alerts.map(normAlert)
    if (data.kind === 'csv') return data.rows.map(normCsv).filter(Boolean)
    return []
  }, [data])

  const board = useMemo(() => (data?.kind === 'board' ? data.items : []), [data])

  // Client-side filter + sort for the tape/biggest lists.
  const view = useMemo(() => {
    const f = rows.filter(r => {
      if (filters.minPrem && r.premium < filters.minPrem) return false
      if (filters.cp !== 'all' && r.cp !== filters.cp) return false
      if (filters.type !== 'all' && r.type !== filters.type) return false
      if (filters.dir !== 'all' && r.dir !== filters.dir) return false
      return true
    })
    f.sort((a, b) => (lead === 'biggest' ? b.premium - a.premium : b._ts - a._ts))
    return f.slice(0, 60)
  }, [rows, filters, lead])

  // Per-symbol sentiment: bull vs bear premium split for the ONE ticker.
  const symSent = useMemo(() => {
    if (scope !== 'symbol') return null
    let bull = 0, bear = 0
    rows.forEach(r => { if (r.dir === 'BULL') bull += r.premium; else if (r.dir === 'BEAR') bear += r.premium })
    const tot = bull + bear
    return { bull, bear, tot, bullPct: tot ? Math.round((bull / tot) * 100) : 50 }
  }, [scope, rows])

  // ── flash-in: newly-arrived print ids glow briefly on each poll ──
  const seenRef = useRef(new Set())
  const [flash, setFlash] = useState(() => new Set())
  // Switching data source (scope / lead / symbol) starts a fresh feed — reseed the
  // "seen" set so the whole new list doesn't flash as if it just printed.
  useEffect(() => { seenRef.current = new Set(); setFlash(new Set()) }, [swrKey])
  useEffect(() => {
    if (lead === 'sentiment') return
    const fresh = []
    for (const r of view) if (!seenRef.current.has(r.id)) fresh.push(r.id)
    // First load seeds the "seen" set WITHOUT flashing the whole list.
    const seeding = seenRef.current.size === 0
    view.forEach(r => seenRef.current.add(r.id))
    if (seeding || !fresh.length) return
    setFlash(prev => { const n = new Set(prev); fresh.forEach(id => n.add(id)); return n })
    const t = setTimeout(() => {
      setFlash(prev => { const n = new Set(prev); fresh.forEach(id => n.delete(id)); return n })
    }, 950)
    return () => clearTimeout(t)
  }, [view, lead])

  // ── row renderers ──
  const renderPrint = (r) => {
    const up = r.dir === 'BULL'
    const down = r.dir === 'BEAR'
    const dirCls = up ? styles.up : down ? styles.down : ''
    return (
      <div
        key={r.id}
        className={`${styles.row}${flash.has(r.id) ? ' ' + styles.flash : ''}`}
        onClick={() => goToSym(r.ticker)}
        title={`Show ${r.ticker} on the linked chart`}
      >
        <span className={`${styles.dirIcon} ${dirCls}`} aria-hidden="true">{up ? '▲' : down ? '▼' : '•'}</span>
        <div className={styles.main}>
          <div className={styles.line1}>
            <span className={styles.rowSym}>{r.ticker}</span>
            <span className={`${styles.contract} ${r.cp === 'C' ? styles.up : styles.down}`}>
              ${fmtStrike(r.strike)}{r.cp}
            </span>
            {r.exp && <span className={styles.exp}>{r.exp}</span>}
            {r.type === 'SWEEP' && <span className={`${styles.tag} ${styles.tagSweep}`}>SWEEP</span>}
            {r.type === 'BLOCK' && <span className={`${styles.tag} ${styles.tagBlock}`}>BLOCK</span>}
            {r.er && <span className={`${styles.tag} ${styles.tagEr}`}>ER</span>}
          </div>
          {r.moneyness && <div className={styles.sub}>{r.moneyness}{r.dte != null ? ` · ${r.dte}DTE` : ''}</div>}
        </div>
        <span className={styles.right}>
          <span className={`${styles.prem} ${dirCls}`}>{fmt(r.premium)}</span>
          <span className={styles.time}>{fmtTime(r.time)}</span>
        </span>
      </div>
    )
  }

  const renderBoardCard = (it, i) => {
    const up = String(it.dir).toUpperCase() === 'BULL'
    const tc = it.topContract || {}
    return (
      <div
        key={it.sym || i}
        className={styles.card}
        onClick={() => goToSym(it.sym)}
        title={`Show ${it.sym} on the linked chart`}
      >
        <span className={styles.cardRank}>{it.rank ?? i + 1}</span>
        <div className={styles.cardMain}>
          <div className={styles.line1}>
            <span className={styles.rowSym}>{it.sym}</span>
            {it.er && <span className={`${styles.tag} ${styles.tagEr}`}>ER</span>}
            <span className={`${styles.dirPill} ${up ? styles.up : styles.down}`}>{up ? 'BULL' : 'BEAR'}</span>
          </div>
          {tc.strike != null && (
            <div className={styles.sub}>
              {tc.cp} ${fmtStrike(tc.strike)} {tc.exp}{tc.hits > 1 ? ` · ${tc.hits}×` : ''}
              {tc.premium ? ` · ${fmt(tc.premium)}` : ''}
            </div>
          )}
        </div>
        <span className={styles.right}>
          <span className={`${styles.prem} ${up ? styles.up : styles.down}`}>{fmt(it.netPremium)}</span>
          <span className={styles.bull}>{it.bullPct}% bull</span>
        </span>
      </div>
    )
  }

  // ── body switch ──
  let body
  if (scope === 'symbol' && !symForScope) {
    body = (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}><UIcon name="flow" size={26} /></span>
        No linked symbol.<br />Set this widget to a chart color group, or switch scope to <b>Market</b>.
      </div>
    )
  } else if (error) {
    body = <div className={styles.empty}>Couldn’t load flow. Retrying…</div>
  } else if (lead === 'sentiment' && scope === 'market') {
    body = board.length
      ? <div className={styles.list}>{board.map(renderBoardCard)}</div>
      : <div className={styles.empty}>{isLoading ? 'Loading conviction board…' : 'No conviction data yet.'}</div>
  } else if (lead === 'sentiment' && scope === 'symbol') {
    body = (
      <div className={styles.list}>
        {symSent && symSent.tot > 0 && (
          <div className={styles.ratioWrap}>
            <div className={styles.ratioHead}>
              <span className={styles.up}>{fmt(symSent.bull)} bull</span>
              <span className={styles.ratioPct}>{symSent.bullPct}%</span>
              <span className={styles.down}>{fmt(symSent.bear)} bear</span>
            </div>
            <div className={styles.ratioBar}>
              <span className={styles.ratioUp} style={{ width: `${symSent.bullPct}%` }} />
              <span className={styles.ratioDown} style={{ width: `${100 - symSent.bullPct}%` }} />
            </div>
          </div>
        )}
        {view.length
          ? [...view].sort((a, b) => b.premium - a.premium).map(renderPrint)
          : <div className={styles.empty}>{isLoading ? 'Loading…' : `No flow for ${symForScope}.`}</div>}
      </div>
    )
  } else if (view.length) {
    body = <div className={styles.list}>{view.map(renderPrint)}</div>
  } else if (rows.length) {
    body = <div className={styles.empty}>No prints match the current filters.</div>
  } else {
    body = (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}><UIcon name="flow" size={26} /></span>
        {isLoading ? 'Loading flow…'
          : scope === 'symbol' ? `No recent flow for ${symForScope}.`
            : 'Waiting for live flow…'}
      </div>
    )
  }

  const leadOpts = [
    { key: 'tape', label: 'Tape' },
    { key: 'biggest', label: 'Biggest' },
    { key: 'sentiment', label: 'Sentiment' },
  ]

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Options Flow Settings"
          showPerf={false}
          extraSections={[
            { label: 'Text size', rows: [{ key: 'textSize', label: 'Size', type: 'segmented', options: [
              { key: 's', label: 'S' }, { key: 'm', label: 'M' }, { key: 'l', label: 'L' },
            ] }] },
            { label: 'Flow colors', rows: [
              { key: 'upColor', label: 'Bullish / calls', hint: 'up' },
              { key: 'downColor', label: 'Bearish / puts', hint: 'down' },
            ] },
          ]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* Header: title + gear */}
      <div className={styles.bar}>
        <span className={styles.titleWrap}>
          <UIcon name="flow" size={14} />
          <span className={styles.title}>Options Flow</span>
        </span>
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Options Flow widget settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {/* Controls: scope · lead · filter funnel */}
      <div className={styles.controls}>
        <span className={styles.seg}>
          <button
            type="button"
            className={`${styles.segBtn}${scope === 'market' ? ' ' + styles.segBtnOn : ''}`}
            onClick={() => patchOpts({ scope: 'market' })}
          >Market</button>
          <button
            type="button"
            className={`${styles.segBtn}${scope === 'symbol' ? ' ' + styles.segBtnOn : ''}`}
            onClick={() => patchOpts({ scope: 'symbol' })}
            title="Follow the linked chart's symbol"
          >{symForScope || 'Symbol'}</button>
        </span>
        <span className={styles.seg}>
          {leadOpts.map(o => (
            <button
              key={o.key}
              type="button"
              className={`${styles.segBtn}${lead === o.key ? ' ' + styles.segBtnOn : ''}`}
              onClick={() => patchOpts({ lead: o.key })}
            >{o.label}</button>
          ))}
        </span>
        <button
          type="button"
          className={`${styles.funnelBtn}${filtersOpen ? ' ' + styles.funnelBtnOn : ''}`}
          onClick={() => setFiltersOpen(o => !o)}
          title="Filters"
          disabled={lead === 'sentiment' && scope === 'market'}
        >
          <UIcon name="filter" size={12} gold={false} />
          {activeFilterCount > 0 && <span className={styles.funnelCount}>{activeFilterCount}</span>}
        </button>
      </div>

      {/* Filter strip (collapsible) */}
      {filtersOpen && !(lead === 'sentiment' && scope === 'market') && (
        <div className={styles.filterStrip}>
          <div className={styles.filterRow}>
            <span className={styles.filterLabel}>Min</span>
            {MIN_PREM_OPTS.map(o => (
              <button
                key={o.v}
                type="button"
                className={`${styles.chip}${filters.minPrem === o.v ? ' ' + styles.chipOn : ''}`}
                onClick={() => setFilter('minPrem', o.v)}
              >{o.label}</button>
            ))}
          </div>
          <div className={styles.filterRow}>
            <span className={styles.chipGroup}>
              {[{ k: 'all', l: 'All' }, { k: 'C', l: 'Calls' }, { k: 'P', l: 'Puts' }].map(o => (
                <button key={o.k} type="button"
                  className={`${styles.chip}${filters.cp === o.k ? ' ' + styles.chipOn : ''}${o.k === 'C' ? ' ' + styles.chipUp : o.k === 'P' ? ' ' + styles.chipDown : ''}`}
                  onClick={() => setFilter('cp', o.k)}
                >{o.l}</button>
              ))}
            </span>
            <span className={styles.chipGroup}>
              {[{ k: 'all', l: 'Any' }, { k: 'SWEEP', l: 'Sweep' }, { k: 'BLOCK', l: 'Block' }].map(o => (
                <button key={o.k} type="button"
                  className={`${styles.chip}${filters.type === o.k ? ' ' + styles.chipOn : ''}`}
                  onClick={() => setFilter('type', o.k)}
                >{o.l}</button>
              ))}
            </span>
            <span className={styles.chipGroup}>
              {[{ k: 'all', l: 'All' }, { k: 'BULL', l: 'Bull' }, { k: 'BEAR', l: 'Bear' }].map(o => (
                <button key={o.k} type="button"
                  className={`${styles.chip}${filters.dir === o.k ? ' ' + styles.chipOn : ''}${o.k === 'BULL' ? ' ' + styles.chipUp : o.k === 'BEAR' ? ' ' + styles.chipDown : ''}`}
                  onClick={() => setFilter('dir', o.k)}
                >{o.l}</button>
              ))}
            </span>
          </div>
        </div>
      )}

      {body}
    </div>
  )
}
