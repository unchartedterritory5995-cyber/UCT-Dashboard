/**
 * News (Trade Exchange) — the row and its popovers, split out of the widget:
 *   Row            one headline (memoised: a quote tick re-renders only the rows
 *                  naming that symbol), its collapse, Explain (AI), Bookmark,
 *                  one-click Copy and ⋯ (the secondary actions)
 *   InlineExplanation  the AI Explanation of one headline, expanded INSIDE its row
 *                  under the headline (the rows below move down; nothing covered)
 *   ActionsMenu    ⋯: Add to Watchlist, Send to Notebook, Add to Collection, Copy
 *   FilterMenu     categories (multi-select) + this widget's saved presets
 *   HealthPopover  what this browser knows about the feed (feedHealth)
 *   DayBar         the day being read: ‹ date › · calendar · jump to time · Latest
 *                  (useTradeExchangeNewsDay); CalendarPopover, TimePopover
 *   DayList        one day's rows, rendered by time block; blocks far off screen
 *                  are replaced by spacers of their measured height
 *
 * Every integration is the canonical one: a ticker in the text opens the chart
 * (setGroupSym on the widget's colour group), Add to watchlist is the watchlist
 * API TickerActions uses, Send to Notebook is the Notebook's own capture door
 * (sendCaptureToJournal), Copy is the browser clipboard. News alerts are not
 * offered from a headline (switched off in production until the owner approves).
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import Input from '../../../components/ui/Input'
import { requestExplanation, cachedExplanation } from '../../../lib/tradeExchangeNewsExplain'
import { sentRecently } from '../../../lib/tradeExchangeNewsNotebook'
import { CollectionPicker } from './TradeExchangeNewsCollections'
import { CATEGORY_FILTERS, categoryTitle, cleanCategories, explainable, explanationText, fmtReceived, fmtReceivedFull, fmtStamp, hitRanges, runsIn,
  dayLabel, dayStatus, cleanTime, MAX_PRESETS, monthGrid, MONTHS, tickerTitle, tickerTone, timeLabel, tokenize,
  WEEKDAYS } from './tradeExchangeNewsModel'
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

/** `text` with the search's hits marked (<mark>, the Agent's gold): React text only.
 *  `ranges`/`offset`: the WHOLE headline's hits and where this piece starts in it. */
export function Hl({ text, needles, ranges, offset = 0 }) {
  const rs = ranges || (needles?.length ? hitRanges(text, needles) : null)
  if (!rs?.length) return text
  return runsIn(text, rs, offset).map((r, i) => (r.hit ? <mark key={i} className={styles.hit}>{r.text}</mark> : r.text))
}

/** The pieces of a tokenized headline with their offsets in the whole text. */
export function withOffsets(parts) {
  let at = 0
  return parts.map((p) => { const o = at; at += String(p.text ?? '').length; return { ...p, offset: o } })
}

function Headline({ item, linkedSym, onSym, colorMode, prices, staleSymbols, provisional, clampLines, expanded, headRef, needles }) {
  const parts = withOffsets(tokenize(item.content, item.tickers, item.mentions))
  const ranges = needles ? hitRanges(item.content, needles) : null
  const clamp = clampLines && !expanded
  return (
    <span ref={headRef} className={`${styles.headline}${clamp ? ' ' + styles.clamped : ''}`}
      style={clamp ? { WebkitLineClamp: clampLines } : undefined}>
      {parts.map((p, i) => {
        if (!p.sym) return <span key={i}><Hl text={p.text} ranges={ranges} offset={p.offset} /></span>
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
          ><Hl text={p.text} ranges={ranges} offset={p.offset} /></button>
        )
      })}
    </span>
  )
}

/** Only what a row DISPLAYS from a quote: a tick that moves none of it is no render. */
const quoteKey = (q) => (q ? `${q.price}|${q.change_pct}|${q.updated_at || q.timestamp || ''}` : '')
const ROW_KEYS = ['item', 'linkedSym', 'colorMode', 'provisional', 'clampLines', 'expanded', 'flashing',
  'showCategory', 'groupCount', 'groupOpen', 'related', 'onSym', 'onToggleExpand', 'onToggleGroup', 'onActions',
  'actionsOpen', 'onExplain', 'explainOpen', 'onCloseExplain', 'onSave', 'saved', 'needles']
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
  clampLines, expanded, onToggleExpand, flashing, showCategory, groupCount = 0, groupOpen = false,
  onToggleGroup, related = false, onActions, actionsOpen, onExplain, explainOpen, onCloseExplain, onSave, saved = false,
  needles = null }) {
  const headRef = useRef(null)
  const explainRef = useRef(null)
  const long = useLong(headRef, clampLines, item.content, expanded)
  return (
    // ⛔ No selected-row background: a ticker click links the chart and nothing
    // else, so it can never be mistaken for a newly arriving headline. The one
    // tint is the row an explanation has expanded (rowExplaining).
    <div className={`${styles.row}${related ? ' ' + styles.related : ''}${explainOpen ? ' ' + styles.rowExplaining : ''}`} data-seq={item.seq}>
      {flashing && <span className={styles.flash} aria-hidden="true" />}
      <span className={styles.when}>
        <span className={styles.time} title={`Received by UCT ${fmtReceivedFull(item.received_at_ms)} · Trade Exchange does not send a publication time`}>
          {/* the date and time on every row: All history mixes days */}
          {fmtStamp(item.received_at_ms)}
        </span>
        {showCategory && item.category && (
          <span className={styles.category} title={categoryTitle(item)}>{item.category}</span>
        )}
        {groupCount > 0 && (
          <button type="button" className={styles.groupBtn} onClick={() => onToggleGroup(item)} aria-expanded={groupOpen}
            title="The same story, received again in near-identical words. Every copy keeps its own time.">
            {groupOpen ? 'Hide' : '+'}{groupOpen ? ' related' : `${groupCount} related`}
          </button>
        )}
        <span className={styles.rowActions}>
          {onExplain && explainable(item) && (
            <button
              ref={explainRef}
              type="button"
              className={`${styles.rowBtn}${explainOpen ? ' ' + styles.rowBtnOn : ''}`}
              onClick={(e) => { e.stopPropagation(); onExplain(item, e.currentTarget) }}
              aria-label="Explain this headline"
              aria-expanded={!!explainOpen}
              title="Explain (AI)"
            ><UIcon name="sparkle" size={11} gold={false} /></button>
          )}
          {onSave && item.id && (
            // ⛔ a plain currentColor glyph (gold={false}): see the Explain button above.
            <button
              type="button"
              className={`${styles.rowBtn}${saved ? ' ' + styles.rowBtnOn + ' ' + styles.rowBtnSaved : ''}`}
              onClick={(e) => { e.stopPropagation(); onSave(item) }}
              aria-label={saved ? 'Remove bookmark' : 'Save headline'}
              aria-pressed={!!saved}
              title={saved ? 'Remove bookmark' : 'Save headline'}
            ><UIcon name={saved ? 'bookmark-fill' : 'bookmark'} size={11} gold={false} /></button>
          )}
          <CopyButton text={item.content || ''} />
          {onActions && (
            <button
              type="button"
              className={`${styles.rowBtn} ${styles.rowMenuBtn}${actionsOpen ? ' ' + styles.rowBtnOn : ''}`}
              onClick={(e) => { e.stopPropagation(); onActions(item, e.currentTarget) }}
              aria-label="More actions for this headline"
              aria-haspopup="menu"
              aria-expanded={!!actionsOpen}
              title="More: watchlist, Notebook, collections, copy"
            >⋯</button>
          )}
        </span>
      </span>
      <Headline item={item} linkedSym={linkedSym} onSym={onSym} colorMode={colorMode} prices={prices}
        staleSymbols={staleSymbols} provisional={provisional} clampLines={clampLines}
        expanded={expanded} headRef={headRef} needles={needles} />
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
      {explainOpen && <InlineExplanation key={item.id} item={item} onClose={onCloseExplain} openerRef={explainRef} />}
    </div>
  )
}, rowPropsEqual)

// ── AI Explanation: expands INSIDE the headline's row ──

/** One headline's explanation, asked for when it opens (the member's click), shown
 *  directly under the headline it explains -- the row grows, the rows below move
 *  down, nothing is covered. Rendered as TEXT only: React escapes it, nothing is
 *  parsed as HTML or markdown. Escape or ✕ closes it and returns focus to Explain. */
export function InlineExplanation({ item, onClose, openerRef }) {
  const [state, setState] = useState(() => {
    const hit = cachedExplanation(item.id)
    return hit ? { body: hit } : { loading: true }
  })
  const [copied, setCopied] = useState(null)            // null | 'ok' | 'err'
  const [attempt, setAttempt] = useState(0)
  const boxRef = useRef(null)
  useEffect(() => {
    if (state.body) return undefined
    let live = true
    setState({ loading: true })
    requestExplanation(item.id).then((out) => { if (live) setState(out) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open / Retry
  }, [item.id, attempt])
  // Opened near the foot of the list (or grown when the text arrives): keep it in view,
  // moving the list only as far as needed.
  useEffect(() => { boxRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [state])
  useEffect(() => { boxRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(null), COPY_FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [copied])
  const close = useCallback(() => { onClose(); openerRef?.current?.focus?.() }, [onClose, openerRef])
  const { body, error, loading } = state
  return (
    <div ref={boxRef} className={styles.explain} role="region" aria-label="AI Explanation" tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className={styles.explainHead}>
        <span className={styles.explainTitle}><UIcon name="sparkle" size={10} /> AI Explanation</span>
        {body && (
          <button type="button" className={styles.explainCopy}
            onClick={async () => setCopied((await copyText(explanationText(body))) ? 'ok' : 'err')}
            aria-label={copied === 'ok' ? 'Explanation copied' : copied === 'err' ? 'Copy failed' : 'Copy explanation'}
            title={copied === 'ok' ? 'Copied' : copied === 'err' ? 'The browser blocked the clipboard' : 'Copy explanation'}>
            <UIcon name={copied === 'ok' ? 'check' : copied === 'err' ? 'x' : 'copy'} size={10} gold={false} />
          </button>
        )}
        <button type="button" className={styles.explainClose} onClick={close}
          aria-label="Close explanation" title="Close (Esc)"><UIcon name="x" size={10} gold={false} /></button>
      </div>
      <div className={styles.explainBody} aria-live="polite" aria-busy={!!loading}>
        {loading && (
          <div className={styles.explainLoading}>
            <span className={styles.explainSkel} /><span className={styles.explainSkel} />
            <span className={`${styles.explainSkel} ${styles.explainSkelShort}`} />
            <span className={styles.srOnly}>Writing the explanation…</span>
          </div>
        )}
        {body && (
          <>
            <p className={styles.explainText}>{body.explanation}</p>
            <p className={styles.explainText}><strong>Watch:</strong> {body.watch}</p>
            <p className={styles.explainNote}>AI-generated from this headline only · not advice</p>
          </>
        )}
        {error && (
          <div className={styles.explainError}>
            <span>{error.text}</span>
            {error.retry && (
              <button type="button" className={styles.explainAction} onClick={() => setAttempt((n) => n + 1)}>Retry</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

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

/** ⋯ on a headline: the secondary actions. Add to Watchlist (the canonical watchlist
 *  API), Send to Notebook (lib/tradeExchangeNewsNotebook.js -> the Notebook's own
 *  capture door), Add to Collection (saving it if it is not saved yet) and Copy
 *  Headline. The chart is the ticker in the text. Watchlist and Collection open in
 *  place, with a Back to the list. */
export function ActionsMenu({ item, anchorEl, hostEl, themeVars, onClose, onNotebook, onCopied, saved = false }) {
  const boxRef = useRef(null)
  const onKey = usePopover(boxRef, anchorEl, onClose)
  const [view, setView] = useState('main')              // 'main' | 'watchlist' | 'collections'
  const [sending, setSending] = useState(false)
  const [again, setAgain] = useState(() => sentRecently(item.id))
  const hasTickers = (item.tickers || []).length > 0
  useEffect(() => {
    const first = boxRef.current?.querySelector('[role="menuitem"]:not([disabled]), input, [role="menuitem"]')
    if (first) first.focus()
    else boxRef.current?.focus()
  }, [view])
  const width = view === 'main' ? 196 : 214
  const back = (
    <button type="button" role="menuitem" className={`${styles.menuItem} ${styles.menuBack}`} onClick={() => setView('main')}>
      <UIcon name="chevronLeft" size={11} gold={false} /> Back
    </button>
  )
  const notebook = async () => {
    if (sending) return
    setSending(true)
    const r = await onNotebook(item)
    setSending(false)
    if (r.ok) setAgain(true)
    onClose(r)
  }
  return (
    <div ref={boxRef} tabIndex={-1} className={styles.menuPop} style={{ ...(themeVars || {}), ...placeUnder(anchorEl, hostEl, width), width }}
      role="menu" aria-label="Headline actions" onKeyDown={(e) => { onKey(e); menuKeys(e) }}>
      {view === 'main' && (
        <>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={!hasTickers}
            onClick={() => setView('watchlist')} title={hasTickers ? undefined : 'No ticker identified in this headline'}>
            <UIcon name="plus" size={12} gold={false} /> Add to Watchlist
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={sending} onClick={notebook}
            title={again ? 'You sent this a moment ago. Click to send it again.' : 'Add this headline to your current note (or the Notebook inbox)'}>
            <UIcon name="journal" size={12} gold={false} /> {sending ? 'Sending…' : again ? 'Send to Notebook again' : 'Send to Notebook'}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setView('collections')}>
            <UIcon name="library" size={12} gold={false} /> {saved ? 'Collections…' : 'Add to Collection…'}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem}
            onClick={async () => { const ok = await copyText(item.content || ''); onCopied?.(ok); onClose() }}>
            <UIcon name="copy" size={12} gold={false} /> Copy Headline
          </button>
        </>
      )}
      {view === 'watchlist' && <WatchlistPicker item={item} back={back} />}
      {view === 'collections' && (
        <>
          {back}
          <div className={styles.menuHead}>Collections</div>
          <CollectionPicker item={item} />
        </>
      )}
    </div>
  )
}

/** Add one of the headline's symbols to a personal watchlist (the canonical watchlist API). */
function WatchlistPicker({ item, back }) {
  const syms = [...new Set(item.tickers || [])]
  const [sym, setSym] = useState(syms[0] || null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const { data: lists } = useSWR(sym ? '/api/watchlists?include_items=0' : null, fetchJson, { revalidateOnFocus: false })
  const myLists = (Array.isArray(lists) ? lists : []).filter((l) => !l?.is_prebuilt)

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

  return (
    <>
      {back}
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
    </>
  )
}

export function FilterMenu({ anchorEl, hostEl, themeVars, onClose, categories, onCategories, presets, activeId,
  onApply, onSave, onRename, onDelete, linked = false, linkedSym = null, onLinked }) {
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
      role="dialog" aria-label="News filters" onKeyDown={onKey}>
      {onLinked && (
        <>
          <div className={styles.menuHead}>Headlines</div>
          <div className={styles.menuCats} role="group" aria-label="Headlines">
            <button type="button" className={`${styles.menuSym}${!linked ? ' ' + styles.menuSymOn : ''}`} aria-pressed={!linked}
              onClick={() => onLinked(false)}>All headlines</button>
            <button type="button" className={`${styles.menuSym}${linked ? ' ' + styles.menuSymOn : ''}`} aria-pressed={linked}
              onClick={() => onLinked(true)} title="Only headlines naming this widget's linked chart symbol">
              Linked to chart{linkedSym ? ` · ${linkedSym}` : ''}</button>
          </div>
        </>
      )}
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

/** Where a popover opens from the bottom bar: ABOVE its anchor, kept inside. */
function placeAbove(anchorEl, hostEl, width) {
  if (!anchorEl || !hostEl) return { bottom: 32, left: 6 }
  const a = anchorEl.getBoundingClientRect()
  const h = hostEl.getBoundingClientRect()
  const left = Math.max(4, Math.min(a.left - h.left, h.width - width - 4))
  return { bottom: Math.max(4, h.bottom - a.top + 4), left }
}

/** A month of days. Future dates and dates before the archive began are disabled and
 *  say why; a dot marks an archived date with headlines (only what the server reports).
 *  The archive is permanent: nothing in it ever ages out. */
export function CalendarPopover({ selected, meta, anchorEl, hostEl, themeVars, onPick, onClose, history = false,
  allHistory = false, onAll }) {
  const boxRef = useRef(null)
  const onKey = usePopover(boxRef, anchorEl, onClose)
  const [ym, setYm] = useState(() => [Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1])
  const [focus, setFocus] = useState(selected)
  const [year, month] = ym
  const grid = monthGrid(year, month)
  const move = (dy, dm) => {
    const t = new Date(Date.UTC(year + dy, month + dm, 1))
    setYm([t.getUTCFullYear(), t.getUTCMonth()])
  }
  useEffect(() => { boxRef.current?.querySelector(`[data-day="${focus}"]`)?.focus() }, [focus, ym])
  const keys = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step || !e.target.dataset?.day) return
    e.preventDefault()
    const t = new Date(Date.parse(`${e.target.dataset.day}T00:00:00Z`) + step * 86_400_000)
    const k = t.toISOString().slice(0, 10)
    if (t.getUTCMonth() !== month || t.getUTCFullYear() !== year) setYm([t.getUTCFullYear(), t.getUTCMonth()])
    setFocus(k)
  }
  const width = 232
  const nav = (label, glyph, onClick) => (
    <button type="button" className={styles.calNav} onClick={onClick} aria-label={label} title={label}>{glyph}</button>
  )
  return (
    <div ref={boxRef} className={styles.menuPop} style={{ ...(themeVars || {}), ...placeAbove(anchorEl, hostEl, width), top: 'auto', width }}
      role="dialog" aria-label="Choose a date" onKeyDown={(e) => { onKey(e); keys(e) }}>
      {history && onAll && (
        <button type="button" className={`${styles.menuItem}${allHistory ? ' ' + styles.menuItemOn : ''}`} aria-pressed={allHistory}
          onClick={() => { onAll(); onClose() }} title="Every archived headline naming the linked symbol, newest first">
          All history
        </button>
      )}
      <div className={styles.calHead}>
        {nav('Previous year', '«', () => move(-1, 0))}
        {nav('Previous month', '‹', () => move(0, -1))}
        <span className={styles.calTitle} aria-live="polite">{MONTHS[month]} {year}</span>
        {nav('Next month', '›', () => move(0, 1))}
        {nav('Next year', '»', () => move(1, 0))}
      </div>
      <div className={styles.calGrid} role="grid" aria-label={`${MONTHS[month]} ${year}`}>
        {WEEKDAYS.map((w) => <span key={w} className={styles.calDow} role="columnheader" aria-label={w}>{w[0]}</span>)}
        {grid.map(({ key, inMonth }) => {
          const st = dayStatus(key, meta)
          const off = st.kind === 'future' || st.kind === 'unretained'
          const title = st.kind === 'future' ? 'In the future'
            : st.kind === 'unretained' ? 'Before the UCT News archive began'
              : st.kind === 'news' ? `${formatNumber(st.count, { decimals: 0 })} headline${st.count === 1 ? '' : 's'}`
                : st.kind === 'empty' ? 'No headlines on this date' : ''
          return (
            <button key={key} type="button" data-day={key} role="gridcell" disabled={off}
              tabIndex={key === focus ? 0 : -1} aria-selected={key === selected} aria-label={`${dayLabel(key, meta?.today)}${title ? `. ${title}` : ''}`}
              title={title}
              className={[styles.calDay, inMonth ? '' : styles.calOut, key === selected ? styles.calSel : '',
                key === meta?.today ? styles.calToday : '', st.kind === 'news' ? styles.calNews : '',
                st.kind === 'empty' ? styles.calEmpty : ''].filter(Boolean).join(' ')}
              onClick={() => { onPick(key); onClose() }}>
              {Number(key.slice(8))}
            </button>
          )
        })}
      </div>
      {meta?.first_day && (
        <div className={styles.menuNote}>
          Archive from {dayLabel(meta.first_day, meta.today)}{meta.first_day_partial ? ' (began mid-day)' : ''} · every headline is kept
        </div>
      )}
    </div>
  )
}

const TIME_PRESETS = [['04:00', 'Pre-market open'], ['09:30', 'Regular-session open'], ['16:00', 'Regular-session close']]

/** Jump to a time of the selected day (ET): presets or any hour and minute. */
export function TimePopover({ at, anchorEl, hostEl, themeVars, onPick, onClose, live = true, onLatest }) {
  const boxRef = useRef(null)
  const onKey = usePopover(boxRef, anchorEl, onClose)
  const [draft, setDraft] = useState(at || '')
  const [bad, setBad] = useState(false)
  useEffect(() => { boxRef.current?.querySelector('button')?.focus() }, [])
  const go = (t) => { onPick(t); onClose() }
  const width = 236                    // the three shortcuts on one line
  return (
    <div ref={boxRef} className={styles.menuPop} style={{ ...(themeVars || {}), ...placeAbove(anchorEl, hostEl, width), top: 'auto', width }}
      role="dialog" aria-label="Jump to a time" onKeyDown={onKey}>
      {!live && onLatest && (
        <button type="button" className={styles.menuItem} onClick={() => { onLatest(); onClose() }}
          title="Today's newest headlines and the live feed">Latest — today&apos;s live headlines</button>
      )}
      <div className={styles.menuHead}>Jump to time (ET)</div>
      <div className={styles.timePresets}>
        {TIME_PRESETS.map(([t, name]) => (
          <button key={t} type="button" className={`${styles.menuSym}${at === t ? ' ' + styles.menuSymOn : ''}`}
            aria-pressed={at === t} onClick={() => go(t)} title={name}>{timeLabel(t)} ET</button>
        ))}
      </div>
      <form className={styles.presetForm} onSubmit={(e) => {
        e.preventDefault()
        const t = cleanTime(draft)
        if (!t) { setBad(true); return }
        go(t)
      }}>
        <input type="time" step={60} className={`${styles.alertsInput}${bad ? ' ' + styles.pageInputBad : ''}`} value={draft}
          aria-label="Time, hour and minute (ET)" aria-invalid={bad || undefined}
          onChange={(e) => { setDraft(e.target.value); setBad(false) }} />
        <button type="submit" className={styles.alertsAdd}>Go</button>
      </form>
      <div className={styles.menuNote}>Starts at the closest headline at or before this time; scroll up for later ones.</div>
      {at && <button type="button" className={styles.menuItem} onClick={() => go(null)}>Clear — show the whole day from the top</button>}
    </div>
  )
}

/** The footer: ‹ [calendar · date] › on the left, the clock (Jump to Time) on the right.
 *  "Today" for the current ET day; a compact date otherwise. Latest (back to today's live
 *  feed) is the first item of the clock's menu whenever a past day or time is shown. */
export function DayBar({ day, onCalendar, onTime, calendarOpen, timeOpen, calRef, timeRef }) {
  const first = day.meta?.first_day
  const prevOff = !!first && day.dateKey <= first
  const all = !!day.allHistory
  const full = all ? 'All history' : dayLabel(day.dateKey, day.todayKey)
  const label = all ? 'All history' : day.isToday ? 'Today' : full
  const short = all ? 'All history' : day.isToday ? 'Today' : full.replace(/^\w+, /, '')
  const atText = day.at ? `${day.atMatch === 'after' ? 'after' : 'from'} ${timeLabel(day.at)} ET` : null
  return (
    <nav className={styles.dayBar} aria-label="Date">
      <span className={styles.dayNav}>
        <button type="button" className={styles.pageBtn} onClick={day.prevDay} disabled={prevOff || all}
          aria-label="Previous day" title={all ? 'Pick a day from the calendar to browse one day' : prevOff ? 'Earlier dates are not retained' : 'Previous day'}>
          <UIcon name="chevronLeft" size={12} gold={false} />
        </button>
        <button ref={calRef} type="button" className={`${styles.dayBtn}${calendarOpen ? ' ' + styles.dayBtnOn : ''}`} onClick={onCalendar}
          aria-haspopup="dialog" aria-expanded={calendarOpen} aria-label={`Date: ${all ? 'All history' : day.isToday ? `Today, ${full}` : full}. Choose a date`}
          title={all ? 'Every archived headline naming the linked symbol. Choose a day to narrow it' : day.isToday ? `Today, ${full} (ET). Choose a date` : `${full} (ET). Choose a date`}>
          <span className={styles.dayIcon}><UIcon name="calendar" size={12} gold={false} /></span>
          <span className={`${styles.dayText} ${styles.dayLong}`}>{label}</span>
          <span className={`${styles.dayText} ${styles.dayShort}`}>{short}</span>
        </button>
        <button type="button" className={styles.pageBtn} onClick={day.nextDay} disabled={day.isToday || all}
          aria-label="Next day" title={all ? 'Pick a day from the calendar to browse one day' : day.isToday ? 'Today is the latest date' : 'Next day'}>
          <UIcon name="chevronRight" size={12} gold={false} />
        </button>
      </span>
      <button ref={timeRef} type="button" className={`${styles.timeBtn}${day.at || !day.live ? ' ' + styles.dayBtnOn : ''}`} onClick={onTime}
        aria-haspopup="dialog" aria-expanded={timeOpen} disabled={all}
        aria-label={atText ? `Jump to Time: showing ${atText}. Change the time` : 'Jump to Time'}
        title={day.at ? (day.atMatch === 'after'
          ? `Jump to Time · nothing at or before ${timeLabel(day.at)} ET: showing from the day's first headline`
          : `Jump to Time · showing from the closest headline at or before ${timeLabel(day.at)} ET`)
          : all ? 'Jump to Time works within one day: pick a day first' : 'Jump to Time'}>
        <UIcon name="clock" size={13} gold={false} />
      </button>
    </nav>
  )
}

//: Rows render by 15-minute receipt block: a block's membership never changes when
//: news arrives elsewhere, so a block measured off screen keeps its true height.
const BLOCK_MS = 15 * 60_000

function Block({ id, rootRef, children }) {
  const ref = useRef(null)
  // null = rendered; a number = off screen, held at the height it last measured
  const [spacer, setSpacer] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (typeof IntersectionObserver === 'undefined' || !el) return undefined
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setSpacer(null)
      else setSpacer(el.offsetHeight)                 // measured as it leaves: the true height
    }, { root: rootRef.current || null, rootMargin: '1500px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [rootRef])
  return (
    <div ref={ref} data-block={id} style={spacer == null ? undefined : { height: spacer }}>
      {spacer == null ? children : null}
    </div>
  )
}

/** One day's groups (newest first), in time blocks; far-off blocks are spacers.
 *  `viewKey` (date | time | filters): a new view starts with fresh blocks -- a block
 *  kept from the previous view would hold a spacer measured for other rows. */
export function DayList({ groups, rootRef, renderGroup, viewKey = '' }) {
  const blocks = []
  for (const g of groups) {
    const id = Math.floor((g.lead.received_at_ms || 0) / BLOCK_MS)
    const last = blocks[blocks.length - 1]
    if (last && last.id === id) last.groups.push(g)
    else blocks.push({ id, groups: [g] })
  }
  return blocks.map((b) => (
    <Block key={`${viewKey}|${b.id}`} id={b.id} rootRef={rootRef}>
      {b.groups.map(renderGroup)}
    </Block>
  ))
}
