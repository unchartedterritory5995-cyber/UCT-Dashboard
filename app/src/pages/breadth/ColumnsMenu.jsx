/**
 * The Breadth Monitor's "Columns" menu (owner 2026-11-19, design A "Signature popover",
 * simplified). The top-bar button names the active template; the menu is the Signature
 * panel (ContextPopover `signature`; a bottom sheet on a phone):
 *
 *   Templates — UCT Core (built-in, locked) and the member's own; the current one has the
 *     gold ✓ (the only gold here). Own templates: ⋯ → Rename · Duplicate · Delete (Delete
 *     confirms in the row). "+ Save current as template…" turns into a name field.
 *     An edited built-in shows one quiet strip: "+ Save as new…" · "Revert". No prompts.
 *   Find a column… — then the checklist, by family (collapsible, with a b/total count).
 *   Footer — "Reset to UCT Core" (only when something differs) · "Done".
 *
 * Column ORDER stays with the header click menu (Move left / Move right). Every write goes
 * through the `customize` hook (useBreadthCustomize), never storage directly.
 *
 * `columnTag(key)` is a HOOK for the universe work: return null, a string ("Market-wide"), or
 * `{ label, title?, na? }` ("n/a for Nasdaq", `na` dims the row). Nothing here decides it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ContextPopover from '../../components/mobile/ContextPopover'
import Input from '../../components/ui/Input'
import { COLUMN_INFO } from './columnInfo'
import { DEFAULT_PRESET, NAME_MAX, templateLabel, validatePresetName } from './useBreadthCustomize'
import s from './ColumnsMenu.module.css'

const WIDTH = 384
const ADD = '+add'  // the "+ Save current as template…" row's focus id

// "Primary Breadth" → "Primary breadth"; short all-caps words (MA, A-D) stay.
const sentence = (g) => String(g ?? '').split(' ')
  .map((w, i) => (i === 0 || (/^[A-Z0-9/-]+$/.test(w) && w.length <= 3) ? w : w.toLowerCase()))
  .join(' ')

function families(cols) {
  const seen = new Map()
  for (const c of cols) {
    const g = c.group ?? 'Other'
    if (!seen.has(g)) seen.set(g, [])
    seen.get(g).push(c)
  }
  return [...seen.entries()].map(([group, list]) => ({ group, label: sentence(group), list }))
}

const Lock = () => (
  <svg className={s.lock} width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)
const Chevron = ({ open }) => (
  <svg className={`${s.car}${open ? ' ' + s.carOpen : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** One inline name field (save / rename): Enter saves, Esc cancels (via the menu's onClose). */
function NameField({ initial = '', label, cta, onSubmit, onCancel, taken }) {
  const [v, setV] = useState(initial)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const submit = () => {
    const e = validatePresetName(v, taken)
    if (e) { setErr(e); return }
    onSubmit(v.trim())
  }
  return (
    <div className={s.fieldWrap}>
      <div className={s.field}>
        <Input ref={ref} className={s.inp} aria-label={label} value={v} maxLength={NAME_MAX + 10}
          placeholder="Template name"
          error={err || undefined}
          onChange={(e) => { setV(e.target.value); setErr(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }} />
        <button type="button" className={s.white} onClick={submit}>{cta}</button>
      </div>
      {err && <div className={s.err} role="alert">{err}</div>}
    </div>
  )
}

export default function ColumnsMenu({
  cols,
  customize,
  buttonClassName = '',
  openClassName = '',
  chevronClassName = '',
  columnTag = null,
}) {
  const {
    activePreset, presetNames, hidden, isEdited, differsFromDefault,
    toggleHidden, switchPreset, savePreset, renamePreset, duplicatePreset, deletePreset,
    revertDraft, resetActive,
  } = customize
  const [anchor, setAnchor] = useState(null)
  const open = anchor != null
  const btnRef = useRef(null)
  const wasOpen = useRef(false)
  const rootRef = useRef(null)
  const subRef = useRef(null)
  const findRef = useRef(null)
  // ONE inline editor at a time: { kind: 'save' | 'saveNew' | 'rename' | 'confirm' | 'menu', id?, pos? }
  const [edit, setEdit] = useState(null)
  const editRef = useRef(null)
  useEffect(() => { editRef.current = edit }, [edit])
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  // A template row to focus after the next render (after save / rename / cancel / delete).
  const focusTplRef = useRef(null)
  const setFocusTpl = (id) => { focusTplRef.current = id }

  const fams = useMemo(() => families(cols), [cols])
  const own = presetNames.filter(n => n !== DEFAULT_PRESET)

  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect()
    // The family holding most of the visible columns starts open; the rest folded.
    let best = null, bestN = -1
    for (const f of fams) {
      const n = f.list.filter(c => !hidden.has(c.key)).length
      if (n > bestN) { best = f.group; bestN = n }
    }
    setExpanded(new Set(best ? [best] : []))
    setQ('')
    setEdit(null)
    setAnchor({ x: Math.round(r.right - WIDTH), y: Math.round(r.bottom + 6), max: Math.max(280, window.innerHeight - r.bottom - 18) })
  }
  const close = useCallback(() => { setAnchor(null); setEdit(null) }, [])
  // Esc / outside click: an open inline editor closes first; the menu on the next one.
  const onPopoverClose = useCallback(() => {
    if (editRef.current) {
      const back = editRef.current
      setEdit(null)
      setFocusTpl(back.id ?? ADD)
      return
    }
    close()
  }, [close])

  useEffect(() => {
    const id = focusTplRef.current
    if (!id || !open) return
    focusTplRef.current = null
    const el = [...(rootRef.current?.querySelectorAll('[data-tpl]') ?? [])].find(b => b.dataset.tpl === id)
    el?.focus()
  })

  useEffect(() => {
    if (edit?.kind === 'menu') subRef.current?.querySelector('button')?.focus()
  }, [edit])

  const taken = (except) => own.filter(n => n !== except)

  // ── keyboard: ↑↓ / Home / End walk the rows (the sub-menu's own rows while it is open) ──
  const onKeyNav = (e) => {
    const MOVES = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
    const t = e.target
    if (e.key === 'ArrowRight' && t.dataset?.tpl) {
      const more = t.parentElement?.querySelector('[data-more]')
      if (more) { e.preventDefault(); more.focus() }
      return
    }
    const move = MOVES[e.key]
    if (move == null) return
    if (t.tagName === 'INPUT' && (t !== findRef.current || e.key !== 'ArrowDown')) return
    const scope = (edit?.kind === 'menu' && subRef.current) || rootRef.current
    if (!scope) return
    const rows = [...scope.querySelectorAll('[data-nav]')].filter(el => !el.disabled)
    if (!rows.length) return
    const at = rows.indexOf(t)
    const next = move === 'first' ? 0 : move === 'last' ? rows.length - 1
      : at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + move))
    e.preventDefault()
    e.stopPropagation()
    if (at === 0 && move === -1 && scope === rootRef.current) { findRef.current?.focus(); return }
    rows[next].focus()
  }

  const openSub = (id, btn) => {
    const rr = rootRef.current.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    setEdit({ kind: 'menu', id, pos: { top: br.bottom - rr.top + 2, right: rr.right - br.right } })
  }

  const query = q.trim().toLowerCase()
  const match = (c) => {
    if (!query) return true
    const info = COLUMN_INFO[c.key]
    return `${info?.name ?? ''} ${c.label} ${c.group} ${info?.desc ?? ''}`.toLowerCase().includes(query)
  }
  const shownFams = fams.map(f => ({ ...f, rows: f.list.filter(match) })).filter(f => f.rows.length)

  const tagOf = (key) => {
    const t = columnTag?.(key)
    if (!t) return null
    return typeof t === 'string' ? { label: t } : t
  }

  const templateRow = (id) => {
    const isBuiltin = id === DEFAULT_PRESET
    const label = templateLabel(id)
    const cur = id === activePreset
    if (edit?.kind === 'rename' && edit.id === id) {
      return (
        <NameField key={id} initial={id} label={`Rename ${label}`} cta="Save" taken={taken(id)}
          onCancel={() => { setEdit(null); setFocusTpl(id) }}
          onSubmit={(name) => { renamePreset(id, name); setEdit(null); setFocusTpl(name) }} />
      )
    }
    if (edit?.kind === 'confirm' && edit.id === id) {
      return (
        <div key={id} className={`${s.row} ${s.confirm}`} role="group" aria-label={`Delete ${label}?`}>
          <span className={s.confirmText}>Delete “{label}”?</span>
          <span className={s.right}>
            <button type="button" className={s.quiet} data-nav autoFocus
              onClick={() => { setEdit(null); setFocusTpl(id) }}>Keep</button>
            <button type="button" className={`${s.pill} ${s.down}`} data-nav
              onClick={() => { deletePreset(id); setEdit(null); setFocusTpl(activePreset === id ? DEFAULT_PRESET : activePreset) }}>Delete</button>
          </span>
        </div>
      )
    }
    return (
      <div key={id} className={`${s.tplRow}${edit?.kind === 'menu' && edit.id === id ? ' ' + s.tplRowOn : ''}`}>
        <button type="button" className={`${s.row}${isBuiltin ? '' : ' ' + s.tplOwn}${cur ? ' ' + s.cur : ''}`} data-nav data-tpl={id}
          aria-current={cur ? 'true' : undefined}
          onClick={() => switchPreset(id)}>
          <span className={s.chk} aria-hidden="true">{cur ? '✓' : ''}</span>
          <span className={s.name}>{label}</span>
          {isBuiltin && isEdited && (
            <span className={s.edited} title={`${label}, edited, not saved`}>· edited<span className={s.gdot} aria-hidden="true" /></span>
          )}
          {isBuiltin && <span className={s.right} title="Built-in template"><Lock /><span className={s.srOnly}>, built-in</span></span>}
        </button>
        {!isBuiltin && (
          <button type="button" className={s.more} data-more aria-label={`${label} actions`}
            aria-haspopup="menu" aria-expanded={edit?.kind === 'menu' && edit.id === id}
            onClick={(e) => (edit?.kind === 'menu' && edit.id === id ? setEdit(null) : openSub(id, e.currentTarget))}>⋯</button>
        )}
      </div>
    )
  }

  const btnLabel = templateLabel(activePreset)
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${buttonClassName} ${s.btn} ${open ? openClassName : ''}`}
        data-guide="breadth.customize"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={isEdited ? `${btnLabel}, edited, not saved` : 'Choose which metrics show as columns in the sheet'}
        onPointerDown={() => { wasOpen.current = open }}
        onClick={() => {
          if (open || wasOpen.current) { wasOpen.current = false; close(); return }
          openMenu()
        }}
      >
        <span className={s.btnDim}>Columns</span>
        <span className={s.btnName}>{btnLabel}</span>
        {isEdited && <span className={s.btnDim}>· edited</span>}
        {isEdited && <span className={s.gdot} aria-hidden="true" />}
        <span className={chevronClassName} aria-hidden="true">
          <svg width="9" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      <ContextPopover
        open={open}
        anchor={anchor}
        onClose={onPopoverClose}
        returnFocusTo={btnRef}
        width={WIDTH}
        signature
        title="Columns"
        guide="breadth.columnsMenu"
        sheetClassName={s.sheet}
      >
        <div ref={rootRef} className={s.root} style={anchor ? { '--cm-max': `${anchor.max}px` } : undefined}
          onKeyDown={onKeyNav} data-testid="breadth-columns-menu">
          <div className={s.gl}>Templates</div>
          <div className={s.tpls}>
            {presetNames.map(id => (
              <div key={id} className={s.tplWrap}>
                {templateRow(id)}
                {id === DEFAULT_PRESET && isEdited && (
                  edit?.kind === 'saveNew' ? (
                    <NameField label="New template name" cta="Save" taken={own}
                      onCancel={() => { setEdit(null); setFocusTpl(DEFAULT_PRESET) }}
                      onSubmit={(name) => { savePreset(name); setEdit(null); setFocusTpl(name) }} />
                  ) : (
                    <div className={s.strip} data-testid="breadth-columns-edited">
                      <span className={s.stripText}>Not saved</span>
                      <button type="button" className={s.prim} data-nav onClick={() => setEdit({ kind: 'saveNew', id: DEFAULT_PRESET })}>+ Save as new…</button>
                      <button type="button" className={s.quiet} data-nav onClick={revertDraft}>Revert</button>
                    </div>
                  )
                )}
              </div>
            ))}
            {edit?.kind === 'save' ? (
              <NameField label="New template name" cta="Save" taken={own}
                onCancel={() => { setEdit(null); setFocusTpl(ADD) }}
                onSubmit={(name) => { savePreset(name); setEdit(null); setFocusTpl(name) }} />
            ) : (
              <button type="button" className={`${s.row} ${s.add}`} data-nav data-tpl={ADD} onClick={() => setEdit({ kind: 'save' })}>
                <span className={s.chk} aria-hidden="true">+</span>Save current as template…
              </button>
            )}
          </div>
          <div className={s.hr} />
          <label className={s.find}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <Input ref={findRef} data-autofocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Find a column…" aria-label="Find a column" />
          </label>
          <div className={s.list}>
            {shownFams.length === 0 && <div className={s.empty}>No column matches “{q.trim()}”.</div>}
            {shownFams.map(f => {
              const isOpen = query ? true : expanded.has(f.group)
              const used = f.list.filter(c => !hidden.has(c.key)).length
              return (
                <div key={f.group} className={s.fam}>
                  <button type="button" className={s.fold} data-nav aria-expanded={isOpen} disabled={!!query}
                    onClick={() => setExpanded(prev => {
                      const n = new Set(prev)
                      if (n.has(f.group)) n.delete(f.group); else n.add(f.group)
                      return n
                    })}>
                    <Chevron open={isOpen} />
                    <span>{f.label}</span>
                    <span className={s.cnt}>{used}/{f.list.length}</span>
                  </button>
                  {isOpen && f.rows.map(c => {
                    const on = !hidden.has(c.key)
                    const info = COLUMN_INFO[c.key]
                    const tag = tagOf(c.key)
                    return (
                      <button key={c.key} type="button" role="checkbox" aria-checked={on} data-nav
                        className={`${s.row} ${s.col}${tag?.na ? ' ' + s.na : ''}`}
                        aria-description={info?.desc}
                        onClick={() => toggleHidden(c.key)}>
                        <span className={`${s.sq}${on ? ' ' + s.sqOn : ''}`} aria-hidden="true">{on ? '✓' : ''}</span>
                        <span className={`${s.name} ${s.wrap}`}>{info?.name ?? c.label}</span>
                        <span className={s.right}>
                          {tag ? <span className={s.tag} title={tag.title}>{tag.label}</span> : <span className={s.short}>{c.label}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className={s.foot}>
            <button type="button" className={s.quiet} disabled={!differsFromDefault} onClick={resetActive}
              title={differsFromDefault ? 'Show the UCT Core columns again' : 'Already showing UCT Core'}>Reset to UCT Core</button>
            <span className={s.sp} />
            <button type="button" className={s.pill} onClick={close}>Done</button>
          </div>
          {edit?.kind === 'menu' && (
            <div ref={subRef} className={s.sub} role="menu" aria-label={`${edit.id} actions`}
              style={{ top: edit.pos.top, right: edit.pos.right }}>
              <button type="button" role="menuitem" className={s.row} data-nav onClick={() => setEdit({ kind: 'rename', id: edit.id })}>Rename</button>
              <button type="button" role="menuitem" className={s.row} data-nav
                onClick={() => { const n = duplicatePreset(edit.id); setEdit(null); if (n) setFocusTpl(n) }}>Duplicate</button>
              <div className={s.hr} role="separator" />
              <button type="button" role="menuitem" className={`${s.row} ${s.down}`} data-nav onClick={() => setEdit({ kind: 'confirm', id: edit.id })}>Delete</button>
            </div>
          )}
        </div>
      </ContextPopover>
    </>
  )
}
