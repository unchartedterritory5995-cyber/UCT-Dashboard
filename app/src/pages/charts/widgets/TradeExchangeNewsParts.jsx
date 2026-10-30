/**
 * News (Trade Exchange) — the row and its popovers, split out of the widget:
 *   Row            one headline (memoised: a quote tick re-renders only the rows
 *                  naming that symbol), its collapse, impact mark, one-click copy
 *                  and ⋯ (add to watchlist)
 *   ActionsMenu    Add a headline's symbol to a personal watchlist
 *   FilterMenu     categories (multi-select) + this widget's saved presets
 *   HealthPopover  what this browser knows about the feed (feedHealth)
 *   Pager          numbered pages of the retained archive (useTradeExchangeNewsPages)
 *
 * Every integration is the canonical one: a ticker in the text opens the chart
 * (setGroupSym on the widget's colour group), Add to watchlist is the watchlist
 * API TickerActions uses, Copy is the browser clipboard. News alerts are not
 * offered from a headline (switched off in production until the owner approves).
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import { CATEGORY_FILTERS, categoryTitle, cleanCategories, fmtReceived, fmtReceivedFull,
  MAX_PRESETS, parsePageInput, tickerTitle, tickerTone, tokenize } from './tradeExchangeNewsModel'
import styles from './TradeExchangeNewsWidget.module.css'

const TONE_CLASS = { up: 'symUp', down: 'symDown', flat: 'symFlat', none: 'symNone' }

// ── long-headline collapse: ONE ResizeObserver for every clamped headline ──
//
// A clamped headline is "long" when its text overflows the clamp
// (scrollHeight > clientHeight). ⛔ Measured ONLY in the observer's callback --
// one batch, after layout, reads only -- never in a layout effect per row: that
// forced a fresh layout for every row (3 widgets x 1,000 headlines went from an
// 1.2 s to a 7.3 s main-thread block in the harness). An expanded headline keeps
// its answer (it was long, so Show less stays) and is not observed meanwhile.
let _ro = null
const _roCallbacks = new Map()
function observeSize(el, cb) {
  if (typeof ResizeObserver === 'undefined') { cb(); return () => {} }
  if (!_ro) {
    _ro = new ResizeObserver((entries) => {
      for (const e of entries) _roCallbacks.get(e.target)?.()
    })
  }
  _roCallbacks.set(el, cb)
  _ro.observe(el)
  return () => { _roCallbacks.delete(el); _ro?.unobserve(el) }
}

//: Below this many characters per clamped line a headline cannot reach the clamp
//: even in the narrowest widget (~140 px of text at 11 px), so it is never observed.
const MIN_CHARS_PER_LINE = 16

function useLong(ref, lines, content, expanded) {
  const [long, setLong] = useState(false)
  useEffect(() => {
    const el = ref.current
    // unclamped, expanded, or too short to wrap past the clamp: nothing to measure
    if (!el || !lines || expanded || String(content || '').length <= lines * MIN_CHARS_PER_LINE) return undefined
    return observeSize(el, () => setLong(el.scrollHeight > el.clientHeight + 1))
  }, [ref, lines, content, expanded])
  return long
}

function Headline({ item, linkedSym, onSym, colorMode, prices, staleSymbols, provisional, clampLines, expanded, headRef }) {
  const parts = tokenize(item.content, item.tickers, item.mentions)
  const clamp = clampLines && !expanded
  return (
    <span ref={headRef} className={`${styles.headline}${clamp ? ' ' + styles.clamped : ''}`}
      style={clamp ? { WebkitLineClamp: clampLines } : undefined}>
      {parts.map((p, i) => {
        if (!p.sym) return <span key={i}>{p.text}</span>
        const q = prices?.[p.sym]
        const stale = !!staleSymbols?.has?.(p.sym)
        const t = tickerTone(q, stale)
        const tone = colorMode === 'performance' ? styles[TONE_CLASS[t]]
          : colorMode === 'neutral' ? styles.symNeutral : ''
        return (
          <button
            key={i}
            type="button"
            className={`${styles.sym}${tone ? ' ' + tone : ''}${p.sym === linkedSym ? ' ' + styles.symLinked : ''}`}
            onClick={() => onSym(p.sym)}
            title={`${tickerTitle(p.sym, q, stale, { named: p.named })}${provisional ? ' · ticker detected automatically (provisional)' : ''}`}
          >{p.text}</button>
        )
      })}
    </span>
  )
}

/** Only what a row DISPLAYS from a quote: a tick that moves none of it is no render. */
const quoteKey = (q) => (q ? `${q.price}|${q.change_pct}|${q.updated_at || q.timestamp || ''}` : '')
const ROW_KEYS = ['item', 'linkedSym', 'colorMode', 'provisional', 'clampLines', 'expanded', 'flashing',
  'impact', 'showCategory', 'groupCount', 'groupOpen', 'related', 'onSym', 'onToggleExpand', 'onToggleGroup', 'onActions',
  'actionsOpen']
function rowPropsEqual(a, b) {
  for (const k of ROW_KEYS) if (a[k] !== b[k]) return false
  if (!a.quotesUsed && !b.quotesUsed) return true
  for (const t of a.item.tickers || []) {
    if (quoteKey(a.prices?.[t]) !== quoteKey(b.prices?.[t])) return false
    if (!!a.staleSymbols?.has?.(t) !== !!b.staleSymbols?.has?.(t)) return false
  }
  return true
}

/** Copy `text` exactly as given: the async clipboard, else the legacy copy command
 *  (a browser that blocks both gets `false`, never a thrown error). */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand?.('copy') === true
    ta.remove()
    return ok
  } catch {
    return false
  }
}

const COPY_FEEDBACK_MS = 1400

/** One click: the WHOLE original headline (also the part behind Show more). */
function CopyButton({ text }) {
  const [state, setState] = useState(null)             // null | 'ok' | 'err'
  useEffect(() => {
    if (!state) return undefined
    const t = setTimeout(() => setState(null), COPY_FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [state])
  const label = state === 'ok' ? 'Headline copied' : state === 'err' ? 'Copy failed: the browser blocked the clipboard' : 'Copy headline'
  return (
    <button type="button" className={`${styles.rowBtn}${state ? ' ' + styles.rowBtnOn + ' ' + (state === 'ok' ? styles.rowBtnOk : styles.rowBtnErr) : ''}`}
      onClick={async (e) => { e.stopPropagation(); setState((await copyText(text)) ? 'ok' : 'err') }}
      aria-label={label} title={label}>
      <UIcon name={state === 'ok' ? 'check' : state === 'err' ? 'x' : 'copy'} size={11} />
      {state && <span className={styles.srOnly} role="status">{label}</span>}
    </button>
  )
}

export const Row = memo(function Row({ item, linkedSym, onSym, colorMode, prices, staleSymbols, provisional,
  clampLines, expanded, onToggleExpand, flashing, impact, showCategory, groupCount = 0, groupOpen = false,
  onToggleGroup, related = false, onActions, actionsOpen }) {
  const headRef = useRef(null)
  const long = useLong(headRef, clampLines, item.content, expanded)
  return (
    // ⛔ No selected-row background: a ticker click links the chart and nothing
    // else, so it can never be mistaken for a newly arriving headline.
    <div className={`${styles.row}${related ? ' ' + styles.related : ''}`} data-seq={item.seq}>
      {flashing && <span className={styles.flash} aria-hidden="true" />}
      <span className={styles.when}>
        <span className={styles.time} title={`Received by UCT ${fmtReceivedFull(item.received_at_ms)} · Trade Exchange does not send a publication time`}>
          {fmtReceived(item.received_at_ms)}
        </span>
        {showCategory && item.category && (
          <span className={styles.category} title={categoryTitle(item)}>{item.category}</span>
        )}
        {impact && (
          <span className={`${styles.impact}${impact.breaking ? ' ' + styles.impactBreaking : ''}`} title={impact.title}>{impact.label}</span>
        )}
        {groupCount > 0 && (
          <button type="button" className={styles.groupBtn} onClick={() => onToggleGroup(item)} aria-expanded={groupOpen}
            title="The same story, received again in near-identical words. Every copy keeps its own time.">
            {groupOpen ? 'Hide' : '+'}{groupOpen ? ' related' : `${groupCount} related`}
          </button>
        )}
        <span className={styles.rowActions}>
          <CopyButton text={item.content || ''} />
          {(item.tickers || []).length > 0 && (
            <button
              type="button"
              className={`${styles.rowBtn} ${styles.rowMenuBtn}${actionsOpen ? ' ' + styles.rowBtnOn : ''}`}
              onClick={(e) => { e.stopPropagation(); onActions(item, e.currentTarget) }}
              aria-label="Add a symbol to a watchlist"
              aria-haspopup="menu"
              aria-expanded={!!actionsOpen}
              title="Add to watchlist"
            >⋯</button>
          )}
        </span>
      </span>
      <Headline item={item} linkedSym={linkedSym} onSym={onSym} colorMode={colorMode} prices={prices}
        staleSymbols={staleSymbols} provisional={provisional} clampLines={clampLines}
        expanded={expanded} headRef={headRef} />
      <span className={styles.badges}>
        {item.repeat_count > 0 && (
          <span className={styles.badge} title={`Received ${item.repeat_count + 1} times within a minute (a resend or a repeat publication)`}>×{item.repeat_count + 1}</span>
        )}
        {item.delayed && (
          <span className={`${styles.badge} ${styles.badgeDelayed}`} title="Reached UCT late — recovered after an interruption">delayed</span>
        )}
      </span>
      {(long || expanded) && clampLines > 0 && (
        <button type="button" className={styles.moreText} onClick={() => onToggleExpand(item.seq)} aria-expanded={!!expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}, rowPropsEqual)

// ── popover plumbing: click-away + Escape, focus returned to the opener ──
function usePopover(boxRef, anchorEl, onClose) {
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || anchorEl?.contains?.(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [boxRef, anchorEl, onClose])
  return useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      anchorEl?.focus?.()
    }
  }, [anchorEl, onClose])
}

/** Arrow keys move between a menu's items (role=menuitem). */
function menuKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = [...e.currentTarget.querySelectorAll('[role="menuitem"]:not([disabled])')]
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement)
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
  items[next].focus()
}

/** Where a popover sits inside the widget root: under its anchor, kept inside. */
function placeUnder(anchorEl, hostEl, width) {
  if (!anchorEl || !hostEl) return { top: 36, right: 6 }
  const a = anchorEl.getBoundingClientRect()
  const h = hostEl.getBoundingClientRect()
  const top = Math.max(4, Math.min(a.bottom - h.top + 2, h.height - 60))
  const left = Math.max(4, Math.min(a.right - h.left - width, h.width - width - 4))
  return { top, left }
}

const fetchJson = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []))

/** ⋯ on a headline: add one of its symbols to a personal watchlist. The chart is
 *  the ticker in the text; copying is the row's own button. */
export function ActionsMenu({ item, anchorEl, hostEl, themeVars, onClose }) {
  const boxRef = useRef(null)
  const onKey = usePopover(boxRef, anchorEl, onClose)
  const syms = [...new Set(item.tickers || [])]
  const [sym, setSym] = useState(syms[0] || null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const { data: lists } = useSWR(sym ? '/api/watchlists?include_items=0' : null, fetchJson, { revalidateOnFocus: false })
  const myLists = (Array.isArray(lists) ? lists : []).filter((l) => !l?.is_prebuilt)
  const focused = useRef(false)
  useEffect(() => {
    // Focus the first list once they arrive (a symbol chip or the box until then).
    const first = boxRef.current?.querySelector('[role="menuitem"]')
    if (first && !focused.current) { focused.current = true; first.focus() }
    else if (!first) boxRef.current?.focus()
  }, [lists])

  const addTo = useCallback(async (list) => {
    if (busy || !sym) return
    setBusy(true)
    try {
      const r = await fetch(`/api/watchlists/${encodeURIComponent(list.id)}/items`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym, notes: '' }),
      })
      const body = await r.json().catch(() => ({}))
      // ⭐ The server's answer is the result: never "added" on a refusal or a duplicate.
      setResult(!r.ok ? { tone: 'err', text: body.detail || `Could not add ${sym} (HTTP ${r.status})` }
        : body.duplicate ? { tone: 'ok', text: `${sym} is already on ${list.name}` }
          : { tone: 'ok', text: `Added ${sym} to ${list.name}` })
    } catch {
      setResult({ tone: 'err', text: 'Could not reach UCT — try again' })
    } finally {
      setBusy(false)
    }
  }, [busy, sym])

  const width = 210
  return (
    <div ref={boxRef} tabIndex={-1} className={styles.menuPop} style={{ ...(themeVars || {}), ...placeUnder(anchorEl, hostEl, width), width }}
      role="menu" aria-label="Add to watchlist" onKeyDown={(e) => { onKey(e); menuKeys(e) }}>
      <div className={styles.menuHead}>{sym ? `Add ${sym} to watchlist` : 'Add to watchlist'}</div>
      {syms.length > 1 && (
        <div className={styles.menuSyms} role="group" aria-label="Security">
          {syms.map((s) => (
            <button key={s} type="button" className={`${styles.menuSym}${s === sym ? ' ' + styles.menuSymOn : ''}`}
              aria-pressed={s === sym} onClick={() => { setSym(s); setResult(null) }}>{s}</button>
          ))}
        </div>
      )}
      {sym && (
        <div className={styles.menuLists}>
          {!lists && <div className={styles.menuNote}>Loading lists…</div>}
          {lists && !myLists.length && <div className={styles.menuNote}>No personal watchlists yet.</div>}
          {myLists.map((l) => (
            <button key={l.id} type="button" role="menuitem" className={styles.menuItem} disabled={busy} onClick={() => addTo(l)}>
              <UIcon name="plus" size={12} /> {l.name}
            </button>
          ))}
        </div>
      )}
      {!sym && <div className={styles.menuNote}>No ticker identified in this headline.</div>}
      {result && <div className={result.tone === 'err' ? styles.alertsErr : styles.alertsOk} role="status">{result.text}</div>}
    </div>
  )
}

export function FilterMenu({ anchorEl, hostEl, themeVars, onClose, categories, onCategories, presets, activeId,
  onApply, onSave, onRename, onDelete }) {
  const boxRef = useRef(null)
  const onKey = usePopover(boxRef, anchorEl, onClose)
  const selected = new Set(cleanCategories(categories))
  const all = !selected.size
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(null)       // { id, name }
  const toggle = (c) => {
    const next = new Set(selected)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    onCategories(next.size === CATEGORY_FILTERS.length ? [] : CATEGORY_FILTERS.filter((x) => next.has(x)))
  }
  const width = 220
  return (
    <div ref={boxRef} className={styles.menuPop} style={{ ...(themeVars || {}), ...placeUnder(anchorEl, hostEl, width), width }}
      role="dialog" aria-label="Filters and presets" onKeyDown={onKey}>
      <div className={styles.menuHead}>Categories</div>
      <div className={styles.menuCats} role="group" aria-label="Categories">
        <button type="button" className={`${styles.menuSym}${all ? ' ' + styles.menuSymOn : ''}`} aria-pressed={all}
          onClick={() => onCategories([])}>All</button>
        {CATEGORY_FILTERS.map((c) => (
          <button key={c} type="button" className={`${styles.menuSym}${selected.has(c) ? ' ' + styles.menuSymOn : ''}`}
            aria-pressed={selected.has(c)} onClick={() => toggle(c)}>{c}</button>
        ))}
      </div>
      <div className={styles.menuHead}>Presets</div>
      {!presets.length && <div className={styles.menuNote}>Save this widget&apos;s filters and display as a preset.</div>}
      {presets.map((p) => (
        <div key={p.id} className={styles.presetRow}>
          {renaming?.id === p.id ? (
            <form className={styles.presetForm} onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) onRename(p.id, renaming.name.trim()); setRenaming(null) }}>
              <Input className={styles.alertsInput} value={renaming.name} autoFocus maxLength={40} aria-label="Preset name"
                onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
            </form>
          ) : (
            <button type="button" className={`${styles.presetName}${p.id === activeId ? ' ' + styles.presetOn : ''}`}
              aria-pressed={p.id === activeId} onClick={() => onApply(p)} title="Apply this preset">{p.name}</button>
          )}
          <button type="button" className={styles.iconBtn} onClick={() => setRenaming({ id: p.id, name: p.name })}
            aria-label={`Rename preset ${p.name}`} title="Rename"><UIcon name="edit" size={11} /></button>
          <button type="button" className={styles.iconBtn} onClick={() => onDelete(p.id)}
            aria-label={`Delete preset ${p.name}`} title="Delete"><UIcon name="trash" size={11} /></button>
        </div>
      ))}
      {presets.length < MAX_PRESETS && (
        <form className={styles.presetForm} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName('') } }}>
          <Input className={styles.alertsInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
            placeholder="Save current as…" aria-label="New preset name" />
          <button type="submit" className={styles.alertsAdd} disabled={!name.trim()}>Save</button>
        </form>
      )}
    </div>
  )
}

export function HealthPopover({ lines, anchorEl, hostEl, themeVars, onClose }) {
  const boxRef = useRef(null)
  const onKey = usePopover(boxRef, anchorEl, onClose)
  const width = 250
  useEffect(() => { boxRef.current?.focus() }, [])
  return (
    <div ref={boxRef} tabIndex={-1} className={styles.menuPop} style={{ ...(themeVars || {}), ...placeUnder(anchorEl, hostEl, width), width }}
      role="dialog" aria-label="Feed health" onKeyDown={onKey}>
      <div className={styles.menuHead}>Feed health</div>
      <dl className={styles.health}>
        {lines.map((l) => (
          <div key={l.key} className={styles.healthLine} data-key={l.key}>
            <dt>{l.label}</dt>
            <dd className={l.tone === 'warn' ? styles.healthWarn : l.tone === 'off' ? styles.healthOff : undefined}>{l.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** The typed page number. Keyed by the page it shows, so a page change starts a
 *  fresh draft (no state synced in an effect). */
function PageInput({ page, pages, onPage }) {
  const [draft, setDraft] = useState(String(page))
  const [bad, setBad] = useState(false)
  const known = typeof pages === 'number'
  const commit = () => {
    const n = parsePageInput(draft, pages)
    if (n == null) { setBad(true); setDraft(String(page)); return }
    setBad(false)
    if (n !== page) onPage(n)
  }
  return (
    <input
      className={`${styles.pageInput}${bad ? ' ' + styles.pageInputBad : ''}`}
      value={draft}
      inputMode="numeric"
      aria-label={known ? `Page number, 1 to ${pages}` : 'Page number'}
      aria-invalid={bad || undefined}
      title={known ? `Type a page from 1 to ${pages} and press Enter` : 'Type a page and press Enter'}
      onChange={(e) => { setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 6)); setBad(false) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setDraft(String(page)); setBad(false); e.currentTarget.blur() }
      }}
      onBlur={() => { if (draft !== String(page)) commit() }}
    />
  )
}

/** First · Previous · [page] / pages · Next · Last, and Latest off page 1.
 *  Page 1 is the newest; higher numbers go back in time. `pages` null = not
 *  known yet (Next and Last stay disabled rather than guessing). */
export function Pager({ page, pages, loading, onPage, onLatest }) {
  const known = typeof pages === 'number'
  const nav = (n, label, icon, disabled, cls = '') => (
    <button type="button" className={`${styles.pageBtn}${cls ? ' ' + cls : ''}`} onClick={() => onPage(n)} disabled={disabled}
      aria-label={label} title={label}>
      <UIcon name={icon} size={10} />
    </button>
  )
  return (
    <nav className={styles.pager} aria-label="Headline pages" aria-busy={!!loading}>
      {nav(1, 'First page (newest)', 'skipBack', page <= 1, styles.pageEdge)}
      {nav(page - 1, 'Previous page (newer)', 'chevronLeft', page <= 1)}
      <span className={styles.pageBox}>
        <PageInput key={page} page={page} pages={pages} onPage={onPage} />
        <span className={styles.pageOf}>/ {known ? pages : '…'}</span>
      </span>
      {nav(page + 1, 'Next page (older)', 'chevronRight', !known || page >= pages)}
      {nav(pages || 1, 'Last page (oldest)', 'skipForward', !known || page >= pages, styles.pageEdge)}
      {page > 1 && (
        <button type="button" className={styles.pageLatest} onClick={onLatest} title="Back to the newest headlines and the live feed">Latest</button>
      )}
    </nav>
  )
}
