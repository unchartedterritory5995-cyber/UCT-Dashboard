/**
 * Volume Surge — custom scan lists.
 *
 * Lets a user scan their OWN set of tickers instead of the top-1,000 liquid universe.
 *  • ScopeControl — the toolbar pill + a slick dropdown to create / pick / rename / delete
 *    lists (the whole "make your own list" surface).
 *  • AddTickerBar — a predictive add-ticker bar shown at the bottom of the widget when a
 *    custom list is active.
 * Lists live in the widget opts (persisted with the workspace layout). Styling rides the
 * same --nh-* / --menu-* tokens + UIcon glyphs as the rest of the widget (no emoji).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './VolumeScanWidget.module.css'

let _idc = 0
const newId = () => `vl_${Date.now().toString(36)}_${(_idc++).toString(36)}`

// Build the list mutators once; each returns the next (lists, activeId) via `commit`.
export function makeListHelpers(lists, activeId, commit) {
  return {
    create(name) {
      const id = newId()
      const nm = (name || '').trim() || `List ${lists.length + 1}`
      commit([...lists, { id, name: nm, syms: [] }], id)
      return id
    },
    rename: (id, name) => commit(lists.map(l => (l.id === id ? { ...l, name: name.trim() || l.name } : l)), activeId),
    remove: (id) => commit(lists.filter(l => l.id !== id), activeId === id ? null : activeId),
    setActive: (id) => commit(lists, id),
    addSym(id, sym) {
      const s = String(sym || '').trim().toUpperCase()
      if (!s) return
      commit(lists.map(l => (l.id === id && !l.syms.includes(s) ? { ...l, syms: [...l.syms, s] } : l)), activeId)
    },
    removeSym: (id, sym) =>
      commit(lists.map(l => (l.id === id ? { ...l, syms: l.syms.filter(x => x !== sym) } : l)), activeId),
  }
}

// ── Scope pill + dropdown ──────────────────────────────────────────────────────
export function ScopeControl({ lists, activeId, helpers, themeVars }) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const rootRef = useRef(null)
  const active = lists.find(l => l.id === activeId) || null
  const label = active ? active.name : 'Top 1,000'

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close() }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open])

  const close = () => { setOpen(false); setEditingId(null); setCreating(false); setDraft('') }
  const commitCreate = () => {
    const n = draft.trim()
    if (n) helpers.create(n)
    setCreating(false); setDraft('')
    if (n) setOpen(false)
  }
  const commitRename = (id) => { if (draft.trim()) helpers.rename(id, draft); setEditingId(null); setDraft('') }

  return (
    <div className={styles.scopeWrap} ref={rootRef}>
      <button
        type="button"
        className={`${styles.scopeBtn} ${active ? styles.scopeBtnCustom : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        title="Choose what the scanner watches"
      >
        <UIcon name={active ? 'star' : 'list'} size={11} gold={false} />
        <span className={styles.scopeLabel}>{label}</span>
        <UIcon name="dots" size={11} gold={false} />
      </button>

      {open && (
        <div className={styles.scopeMenu} style={themeVars || undefined} role="menu">
          <button
            type="button"
            className={`${styles.scopeItem} ${!activeId ? styles.scopeItemActive : ''}`}
            onClick={() => { helpers.setActive(null); close() }}
          >
            <UIcon name="list" size={12} gold={false} />
            <span className={styles.scopeItemName}>Top 1,000 <span className={styles.scopeItemHint}>· by $ volume</span></span>
            {!activeId && <UIcon name="check" size={12} gold={false} />}
          </button>

          {lists.length > 0 && <div className={styles.scopeDivider}>YOUR LISTS</div>}
          {lists.map(l => (
            <div key={l.id} className={`${styles.scopeItem} ${l.id === activeId ? styles.scopeItemActive : ''}`}>
              {editingId === l.id ? (
                <input
                  className={styles.scopeEdit}
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(l.id); if (e.key === 'Escape') { setEditingId(null); setDraft('') } }}
                  onBlur={() => commitRename(l.id)}
                />
              ) : (
                <button type="button" className={styles.scopeItemMain} onClick={() => { helpers.setActive(l.id); close() }}>
                  <UIcon name="star" size={12} gold={false} />
                  <span className={styles.scopeItemName}>{l.name}</span>
                  <span className={styles.scopeItemHint}>{l.syms.length}</span>
                </button>
              )}
              <span className={styles.scopeItemBtns}>
                <button type="button" className={styles.scopeIconBtn} title="Rename"
                  onClick={() => { setEditingId(l.id); setDraft(l.name) }}><UIcon name="edit" size={11} gold={false} /></button>
                <button type="button" className={`${styles.scopeIconBtn} ${styles.scopeIconDanger}`} title="Delete list"
                  onClick={() => helpers.remove(l.id)}><UIcon name="trash" size={11} gold={false} /></button>
              </span>
            </div>
          ))}

          <div className={styles.scopeDivider} />
          {creating ? (
            <div className={styles.scopeItem}>
              <input
                className={styles.scopeEdit}
                autoFocus
                placeholder="List name…"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitCreate(); if (e.key === 'Escape') { setCreating(false); setDraft('') } }}
                onBlur={commitCreate}
              />
            </div>
          ) : (
            <button type="button" className={styles.scopeCreate} onClick={() => { setCreating(true); setDraft('') }}>
              <UIcon name="plus" size={12} gold={false} /><span>New list</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Predictive add-ticker bar (bottom) ─────────────────────────────────────────
export function AddTickerBar({ list, helpers }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [hi, setHi] = useState(0)
  const timer = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(q.trim())}&limit=7`, { credentials: 'include' })
        const d = r.ok ? await r.json() : null
        setResults((d?.results || []).slice(0, 7)); setHi(0)
      } catch { setResults([]) }
    }, 140)
    return () => timer.current && clearTimeout(timer.current)
  }, [q])

  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setResults([]) }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [])

  const add = (tk) => {
    const s = (tk || q).trim().toUpperCase()
    if (!s) return
    helpers.addSym(list.id, s)
    setQ(''); setResults([]); setHi(0)
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); add(results[hi]?.ticker) }
    else if (e.key === 'Escape') { setQ(''); setResults([]) }
  }

  return (
    <div className={styles.addBar} ref={wrapRef}>
      {results.length > 0 && (
        <div className={styles.addSuggest}>
          {results.map((r, i) => (
            <button key={r.ticker} type="button"
              className={`${styles.addSuggestItem} ${i === hi ? styles.addSuggestHi : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); add(r.ticker) }}>
              <span className={styles.addSuggestSym}>{r.ticker}</span>
              {r.name && <span className={styles.addSuggestName}>{r.name}</span>}
            </button>
          ))}
        </div>
      )}
      <UIcon name="search" size={12} gold={false} />
      <input
        className={styles.addInput}
        value={q}
        placeholder={`Add ticker to ${list.name}…`}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKey}
        aria-label="Add a ticker to this list"
      />
      <span className={styles.addCount}>{list.syms.length} name{list.syms.length === 1 ? '' : 's'}</span>
    </div>
  )
}
