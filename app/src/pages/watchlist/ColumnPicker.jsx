// The Watchlist column library (owner 11-14): a quiet dropdown in the library rail's look.
// Tabs All · In use · Presets; "Find a column…"; bold groups that fold, one line per column
// with a gold ✓ when it shows (+ on hover), "Soon" on the ones still waiting for data; a hint
// strip that says what the hovered column shows, with its value for the current ticker;
// In use = drag to reorder, × to remove; Presets = one click loads a set, Save keeps yours.
// Every action goes through the Watchlist's own column handlers (onToggle / onMove /
// onApply / onReset), so the picker never writes the column layout itself.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../components/ui/UIcon'
import { OPTIONAL_COLS, EXTRA_COLS, COL_LABELS } from './watchlistColumns'
import { COLUMN_GROUPS, LIVE_COLUMNS, FACT_COLUMNS, SOON_COLUMNS, EXISTING_PLACEMENT, COLUMN_PRESETS } from './watchlistColumnCatalog'
import styles from './ColumnPicker.module.css'

const PRESETS_LS = 'uct.watchlist.colPresets'
const W = 268
const H = 480
// Words members use that a label does not spell.
const SAY = {
  premarket: ['gap'], gap: ['gap'], short: ['shortf', 'shortr'], squeeze: ['shortf', 'shortr', 'float'],
  extended: ['ema20d', 'sma50d', 'a50'], average: ['ema20d', 'sma50d', 'sma200d', 'avgvol', 'avgdv'],
  moving: ['ema20d', 'sma50d', 'sma200d', 'mastack'], ema: ['ema20d'], sma: ['sma50d', 'sma200d'],
  relative: ['rsrank', 'rsline', 'rvol'], strength: ['rsrank', 'rsline', 'rsi'], rs: ['rsrank', 'rsline'],
  earnings: ['earn', 'dte', 'epsg', 'revg', 'epsny'], growth: ['epsg', 'revg', 'epsny'], valuation: ['pe', 'pefwd', 'ps'],
  target: ['ptup', 'consensus'], analyst: ['ptup', 'consensus'], range: ['dayrange', 'adr', 'atr', 'dcr'],
  year: ['ytd', 'y1', 'h52', 'l52'], high: ['h52', 'fromhigh'], low: ['l52', 'fromlow'], volatility: ['adr', 'atr', 'beta'],
  ownership: ['inst', 'insider'], dividend: ['divy'], profit: ['netm', 'roe'],
}

function readPresets() {
  try { const v = JSON.parse(localStorage.getItem(PRESETS_LS) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writePresets(v) {
  try { localStorage.setItem(PRESETS_LS, JSON.stringify(v)) } catch { /* storage off: this session only */ }
}

/** Every column the picker offers, in its group, with a description (real ones + Soon). */
function buildCatalog() {
  const real = [...OPTIONAL_COLS, ...EXTRA_COLS]
  const out = []
  for (const c of real) {
    const live = LIVE_COLUMNS[c.key], fact = FACT_COLUMNS[c.key], old = EXISTING_PLACEMENT[c.key]
    const group = live?.group || fact?.group || old?.[0]
    if (!group) continue
    out.push({ key: c.key, label: live?.label || fact?.label || c.label, group, desc: live?.desc || fact?.desc || old?.[1] || '', isNew: !!(live || fact) })
  }
  for (const s of SOON_COLUMNS) out.push({ ...s, soon: true })
  return out
}

export default function ColumnPicker({
  anchorEl = null, point = null, visibleKeys = [], onToggle, onMove, onApply, onReset, onClose, sampleFor, themeVars = null,
}) {
  const catalog = useMemo(buildCatalog, [])
  const byKey = useMemo(() => Object.fromEntries(catalog.map((c) => [c.key, c])), [catalog])
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState(() => new Set())
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)
  const [mine, setMine] = useState(readPresets)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const findRef = useRef(null)
  const shown = useMemo(() => new Set(visibleKeys), [visibleKeys])
  const inUse = visibleKeys.filter((k) => k !== 'flag' && k !== 'sym' && byKey[k])

  // Place under the + (right-aligned), or at the right-click point; kept on screen.
  useLayoutEffect(() => {
    const place = () => {
      const vw = window.innerWidth, vh = window.innerHeight
      let left, top
      if (anchorEl) { const r = anchorEl.getBoundingClientRect(); left = r.right - W; top = r.bottom + 6 }
      else if (point) { left = point.x; top = point.y }
      else { left = 16; top = 16 }
      left = Math.max(8, Math.min(left, vw - W - 8))
      top = Math.max(8, Math.min(top, vh - Math.min(H, vh - 16) - 8))
      setPos({ left: Math.round(left), top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorEl, point])
  useEffect(() => { if (tab === 'all') findRef.current?.focus() }, [tab])
  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !anchorEl?.contains(e.target)) onClose?.() }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [anchorEl, onClose])

  const query = q.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return null
    const extra = new Set(Object.entries(SAY).filter(([w]) => w.startsWith(query) || (query.length > 2 && query.startsWith(w))).flatMap(([, ks]) => ks))
    return catalog.filter((c) => (c.label + ' ' + c.desc).toLowerCase().includes(query) || extra.has(c.key))
  }, [catalog, query])

  const mark = (label) => {
    if (!query) return label
    const i = label.toLowerCase().indexOf(query)
    if (i < 0) return label
    return <>{label.slice(0, i)}<mark>{label.slice(i, i + query.length)}</mark>{label.slice(i + query.length)}</>
  }
  const row = (c) => {
    const on = shown.has(c.key)
    return (
      <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={on} aria-disabled={c.soon || undefined}
        className={`${styles.item}${on ? ' ' + styles.on : ''}${c.soon ? ' ' + styles.soonItem : ''}`}
        onClick={() => { if (!c.soon) onToggle(c.key) }} onMouseEnter={() => setHover(c.key)} onFocus={() => setHover(c.key)}
        title={c.soon ? 'Coming soon' : undefined}>
        <span className={styles.name}>{mark(c.label)}</span>
        {c.soon ? <span className={styles.soon}>Soon</span>
          : <span className={styles.mark} aria-hidden="true"><UIcon name={on ? 'check' : 'plus'} size={12} gold={false} /></span>}
      </button>
    )
  }

  const savePreset = () => {
    const cols = inUse
    if (!cols.length) return
    const next = [...mine, { name: `My set ${mine.length + 1}`, cols }]
    setMine(next); writePresets(next)
  }
  const dropPreset = (i) => { const next = mine.filter((_, j) => j !== i); setMine(next); writePresets(next) }

  const h = hover && byKey[hover]
  const sample = h && !h.soon ? sampleFor?.(h.key) : null

  let body
  if (tab === 'use') {
    body = (
      <>
        <div className={styles.gh}>Showing<span className={styles.cnt}>drag to reorder</span></div>
        <div className={`${styles.item} ${styles.fixed}`}><span className={styles.grip} /><span className={styles.name}>Symbol</span><span className={styles.soon}>always</span></div>
        {inUse.map((k) => (
          <div key={k} draggable className={`${styles.item} ${styles.use}${drag === k ? ' ' + styles.dragging : ''}${over === k ? ' ' + styles.over : ''}`}
            onDragStart={() => setDrag(k)} onDragEnd={() => { setDrag(null); setOver(null) }}
            onDragOver={(e) => { if (drag && drag !== k) { e.preventDefault(); setOver(k) } }}
            onDrop={(e) => { e.preventDefault(); if (drag && drag !== k) onMove(drag, k); setDrag(null); setOver(null) }}
            onMouseEnter={() => setHover(k)}>
            <span className={styles.grip} aria-hidden="true">⋮⋮</span>
            <span className={styles.name}>{byKey[k]?.label || COL_LABELS[k]?.[0] || k}</span>
            <button type="button" className={styles.x} onClick={() => onToggle(k)} aria-label={`Remove ${byKey[k]?.label || k}`}><UIcon name="x" size={11} gold={false} /></button>
          </div>
        ))}
        <button type="button" className={styles.newList} onClick={() => setTab('all')}><UIcon name="plus" size={12} gold={false} /> Add columns</button>
      </>
    )
  } else if (tab === 'presets') {
    body = (
      <>
        <div className={styles.gh}>UCT presets</div>
        {COLUMN_PRESETS.map((p) => (
          <button key={p.name} type="button" className={`${styles.item} ${styles.flat}`} onClick={() => onApply(p.cols)}
            onMouseEnter={() => setHover(null)} title={p.cols.map((k) => byKey[k]?.label || k).join(' · ')}>
            <span className={styles.name}>{p.name}</span><span className={styles.cnt}>{p.cols.length}</span>
          </button>
        ))}
        <div className={styles.gh}>My presets</div>
        {mine.length ? mine.map((p, i) => (
          <div key={p.name + i} className={`${styles.item} ${styles.flat}`}>
            <button type="button" className={styles.linkish} onClick={() => onApply(p.cols)} title={p.cols.map((k) => byKey[k]?.label || k).join(' · ')}>
              <span className={styles.name}>{p.name}</span>
            </button>
            <span className={styles.cnt}>{p.cols.length}</span>
            <button type="button" className={styles.x} onClick={() => dropPreset(i)} aria-label={`Delete ${p.name}`}><UIcon name="x" size={11} gold={false} /></button>
          </div>
        )) : <div className={styles.empty}>None yet.</div>}
        <button type="button" className={styles.newList} onClick={savePreset} disabled={!inUse.length}><UIcon name="plus" size={12} gold={false} /> Save current columns</button>
      </>
    )
  } else if (matches) {
    body = matches.length
      ? <><div className={styles.gh}>{matches.length} {matches.length === 1 ? 'match' : 'matches'}</div>{matches.map(row)}</>
      : <div className={styles.empty}>No column matches “{q.trim()}”.<br />Try short, earnings, RS or extended.</div>
  } else {
    body = COLUMN_GROUPS.map((g) => {
      const list = catalog.filter((c) => c.group === g.key)
      if (!list.length) return null
      const used = list.filter((c) => shown.has(c.key)).length
      const open = !closed.has(g.key)
      return (
        <div key={g.key} className={styles.group}>
          <button type="button" className={`${styles.gh} ${styles.head}`} aria-expanded={open}
            onClick={() => setClosed((prev) => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>
            <span className={`${styles.car}${open ? ' ' + styles.carOpen : ''}`} aria-hidden="true"><UIcon name="chevronDown" size={11} gold={false} /></span>
            {g.label}
            <span className={styles.cnt}>{used ? <><b>{used}</b> / </> : null}{list.length}</span>
          </button>
          {open && list.map(row)}
        </div>
      )
    })
  }

  return createPortal(
    <div ref={ref} className={styles.panel} role="menu" aria-label="Columns" data-guide="watchlist.colMenu"
      style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }) }}>
      <div className={styles.tabs} role="tablist">
        {[['all', 'All'], ['use', 'In use', inUse.length + 1], ['presets', 'Presets']].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={styles.tab} onClick={() => { setTab(k); setQ('') }}>
            {l}{n != null && <span className={styles.tabCount}> ({n})</span>}
          </button>
        ))}
      </div>
      {tab === 'all' && (
        <label className={styles.find}>
          <UIcon name="search" size={13} gold={false} />
          <input ref={findRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a column…" aria-label="Find a column" />
        </label>
      )}
      <div className={styles.scroll}>{body}</div>
      <div className={styles.hint} aria-live="polite">
        {h ? (
          <>
            <b>{h.label}</b>{h.soon ? <span className={styles.dim}> · coming soon</span> : null}
            {sample?.text ? <span className={`${styles.smp}${sample.sign > 0 ? ' ' + styles.up : sample.sign < 0 ? ' ' + styles.down : ''}`}>{sample.sym} {sample.text}</span> : null}
            <br />{h.desc}
          </>
        ) : <span className={styles.dim}>Hover a column to see what it shows.</span>}
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.footBtn} onClick={onReset}>Reset columns</button>
        <span className={styles.footSp} />
        <button type="button" className={styles.footBtn} onClick={onClose}>Done</button>
      </div>
    </div>,
    document.body,
  )
}
