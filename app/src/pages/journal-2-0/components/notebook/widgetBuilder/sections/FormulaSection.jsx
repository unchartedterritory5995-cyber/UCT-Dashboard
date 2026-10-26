import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../../../../../../components/ui/UIcon'
import Section from './Section'
import { reasonOf } from '../builderCatalog'
import { FUNCTION_DOCS, suggest } from '../../../../lib/widgetFormula/widgetFormula'
import {
  S_FIELD_CAP, MAX_FIELDS, FORMULA_PREFIX, compileStored, displayOf, storedOf, nameProblem, formulaMeasureOptions,
  measureId, boxPosOf, probeLine, pyStrip,
} from '../formulaFields'
import { bandOf, placeList, revealDelta, scrollParentOf, LIST_MAX } from '../formulaListPlace'
import b from '../WidgetBuilderSheet.module.css'
import styles from './FormulaSection.module.css'

const USAGE = new Map(FUNCTION_DOCS.map((d) => [d.name, d.usage]))

/**
 * "Your own fields" (wave 10, Task 10.16; spec 5.5): at most five named formulas, under "What to measure". Collapsed
 * to "Add your own field" until the widget has one. Each field: its Name, its Formula box (label syntax shown, the
 * canonical form saved, ruling W10-R2), its Format, and Remove.
 *
 * The box answers at once, with no request: the dialect's own sentence (the formula twin, which the shared vector file
 * binds to the server) and the name's (the server's screen, mirrored in formulaFields). The server's `formula` error,
 * by its formula id and position, shows only where it differs; once valid, the preview's first-row line and its skip
 * notice. Autocomplete opens on `[` (fields) and on a letter (functions): arrow keys move, Enter or Tab inserts,
 * Escape closes the list (one level, the builder's rule: the sheet asks `escapeRef` first). Positions handed to the
 * textarea are UTF-16 units (`suggest` takes and answers them); a dialect position is code points and is carried
 * across with `codePointToUtf16`.
 *
 * Edits settle after `settleMs` (the preview's debounce): each settled edit is ONE undo step. `flushRef` settles
 * every pending edit at once (Save calls it first, so what is saved is what the boxes say).
 *
 * A phone keyboard (the W10.8 walk fix): a focused box is scrolled into what is visible (the body between the title
 * and the sticky footer, cut to the visual viewport), again whenever the visual viewport moves while it has focus,
 * and its suggestions open above it when there is no room below (formulaListPlace). A name's "Give the field a name."
 * waits until the member has typed in the Name, left the field, or tried to save (`showErrors`).
 *
 * ⛔ Member words only: "Your own fields", "Formula". Never "formula field", "plan", "source", "definition".
 */
export default function FormulaSection({
  cat, plan, compiled, fields, unit, settleMs, probes, serverErrors, onAdd, onEdit, onRemove, onMeasure, onSplit,
  onFilter, escapeRef, flushRef, showErrors = false,
}) {
  const formulas = Array.isArray(plan.formulas) ? plan.formulas : []
  const capId = useId()
  const baseId = useId()
  const [drafts, setDrafts] = useState(() => new Map())
  // What the plan held for each field the last time this section and the plan agreed: an edit from elsewhere
  // (undo, redo, a draft resumed) is a plan value that differs from it, and then the plan wins.
  const synced = useRef(new Map())
  const timers = useRef(new Map())
  const pending = useRef(new Map())
  const boxes = useRef(new Map())
  const names = useRef(new Map())
  const caret = useRef(null)
  const focusNew = useRef(false)
  const [list, setList] = useState(null)          // {id, items, active}
  const [announce, setAnnounce] = useState('')
  // W10.8: the fields whose Name the member has typed in, or left (a name problem is said only for those).
  const [touched, setTouched] = useState(() => new Set())
  const touch = useCallback((id) => setTouched((t) => (t.has(id) ? t : new Set(t).add(id))), [])
  // W10.8: where the open list sits ({id, side, maxHeight}), and the box that has focus.
  const [place, setPlace] = useState(null)
  const focused = useRef(null)

  const draftOf = (f) => drafts.get(f.id) || { name: f.name, box: displayOf(f.expr, fields) }

  // The plan moved under a field (undo, redo, a load): its draft follows, and an edit not yet settled is dropped.
  const formulasKey = JSON.stringify(formulas)
  useEffect(() => {
    setDrafts((prev) => {
      const next = new Map()
      for (const f of formulas) {
        const seen = synced.current.get(f.id)
        const d = prev.get(f.id)
        const nameSame = !!d && !!seen && seen.name === f.name
        const exprSame = !!d && !!seen && seen.expr === f.expr
        if (!nameSame) cancel(`${f.id}:name`)
        if (!exprSame) cancel(`${f.id}:box`)
        next.set(f.id, { name: nameSame ? d.name : f.name, box: exprSame ? d.box : displayOf(f.expr, fields) })
        synced.current.set(f.id, { name: f.name, expr: f.expr })
      }
      for (const id of [...synced.current.keys()]) if (!formulas.some((f) => f.id === id)) synced.current.delete(id)
      return next
    })
    setList((l) => (l && !formulas.some((f) => f.id === l.id) ? null : l))
    // `fields` changes only with the source, which also replaces the formulas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulasKey])

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t) }, [])

  function cancel(key) {
    clearTimeout(timers.current.get(key))
    timers.current.delete(key)
    pending.current.delete(key)
  }

  function settleOne(key) {
    if (!pending.current.has(key)) return false
    const value = pending.current.get(key)
    cancel(key)
    const [id, part] = key.split(':')
    const seen = synced.current.get(id) || { name: '', expr: '' }
    if (part === 'box') {
      const stored = storedOf(value, fields)
      synced.current.set(id, { ...seen, expr: stored })
      onEdit(id, { expr: stored })
      const r = compileStored(value, fields)
      setAnnounce(r.ok ? '' : r.sentence)
    } else {
      synced.current.set(id, { ...seen, name: value })
      onEdit(id, { name: value })
    }
    return true
  }

  function change(f, part, value) {
    // Functional: two edits in one tick (a name and a box) must both stand.
    setDrafts((m) => new Map(m).set(f.id, { ...(m.get(f.id) || { name: f.name, box: displayOf(f.expr, fields) }), [part]: value }))
    const key = `${f.id}:${part}`
    clearTimeout(timers.current.get(key))
    pending.current.set(key, value)
    timers.current.set(key, setTimeout(() => settleOne(key), settleMs))
  }

  if (flushRef) {
    flushRef.current = () => {
      let any = false
      for (const key of [...pending.current.keys()]) any = settleOne(key) || any
      return any
    }
  }
  if (escapeRef) {
    escapeRef.current = () => {
      if (!list) return false
      setList(null)
      return true
    }
  }

  // Focus: a new field's Name; an inserted suggestion leaves the caret after it (UTF-16 units).
  useLayoutEffect(() => {
    if (focusNew.current && formulas.length) {
      focusNew.current = false
      names.current.get(formulas[formulas.length - 1].id)?.focus()
    }
    const c = caret.current
    if (c) {
      caret.current = null
      const el = boxes.current.get(c.id)
      if (el) {
        el.focus()
        el.setSelectionRange(c.pos, c.pos)
      }
    }
  })

  // W10.8: scroll a focused box into what is visible, then place its open list (under it, or above it when there is
  // no room under it). It reads layout and sets state only when the placement changed (H14: no render loop).
  const listRef = useRef(list)
  listRef.current = list
  const fit = useCallback((id) => {
    const el = boxes.current.get(id)
    if (!el) return
    const sc = scrollParentOf(el)
    const band = bandOf(sc)
    let r = el.getBoundingClientRect()
    const d = revealDelta(r, band)
    if (d && sc) {
      sc.scrollTop += d
      r = el.getBoundingClientRect()
    }
    const l = listRef.current
    const next = l && l.id === id ? { id, ...placeList(r, band, Math.min(LIST_MAX, l.items.length * 44 + 8)) } : null
    setPlace((cur) => (cur?.id === next?.id && cur?.side === next?.side && cur?.maxHeight === next?.maxHeight ? cur : next))
  }, [])
  const listKey = list ? `${list.id}:${list.items.length}` : ''
  useLayoutEffect(() => {
    if (list) fit(list.id)
    else setPlace((cur) => (cur === null ? cur : null))
    // `listKey` is the list's identity and size: moving the active option does not re-place it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, fit])
  // The keyboard opening (or closing) RESIZES the visual viewport: the focused box is fitted again, after layout.
  // Never on its scroll: a member panning or zooming with the keyboard up keeps where they put it (review m-5). With
  // no visualViewport, the window's resize stands in for it.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const vv = window.visualViewport || null
    let raf = 0
    const again = () => {
      if (!focused.current) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { if (focused.current) fit(focused.current) })
    }
    const target = vv || window
    target.addEventListener('resize', again)
    return () => {
      cancelAnimationFrame(raf)
      target.removeEventListener('resize', again)
    }
  }, [fit])

  const openList = (f, value, at) => {
    const items = suggest(value, at, fields)
    setList(items.length ? { id: f.id, items, active: 0 } : null)
  }
  const onBoxChange = (f, e) => {
    const value = e.target.value
    const at = e.target.selectionStart ?? value.length
    change(f, 'box', value)
    // Opens on `[` and on a letter; while open, follows what is typed.
    const typed = value.slice(Math.max(0, at - 1), at)
    if (typed === '[' || /[A-Za-z]/.test(typed) || list?.id === f.id) openList(f, value, at)
    else setList(null)
  }
  const insert = (f, item) => {
    const box = draftOf(f).box
    const next = box.slice(0, item.from) + item.insert + box.slice(item.to)
    change(f, 'box', next)
    caret.current = { id: f.id, pos: item.from + item.insert.length }
    setList(null)
  }
  const onBoxKey = (f, e) => {
    if (!list || list.id !== f.id) return
    const n = list.items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : n - 1
      setList({ ...list, active: (list.active + step) % n })
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      insert(f, list.items[list.active])
    }
  }

  const full = formulas.length >= MAX_FIELDS
  const draftPlan = { ...plan, formulas: formulas.map((f) => ({ ...f, name: draftOf(f).name })) }
  const measureOptions = formulaMeasureOptions(plan, compiled)
  const measured = new Set((plan.measures || []).map(measureId))
  const measuresFull = (plan.measures || []).length >= cat.maxMeasures
  const filtersFull = (plan.filters || []).length >= cat.maxFilters
  const formats = cat.formats || []

  return (
    <Section id="formulas" title="Your own fields">
      <p className={b.srOnly} role="status">{announce}</p>
      {formulas.map((f, index) => {
        const d = draftOf(f)
        const id = `${baseId}-${f.id}`
        const resultId = `${id}-result`
        const nameErrId = `${id}-name`
        const listId = `${id}-list`
        const shownName = pyStrip(d.name)
        const r = compileStored(d.box, fields)
        const storedNow = r.ok ? r.compiled.canonical : d.box
        const sErr = serverErrors?.get(f.id)
        const serverShown = sErr && sErr.sent === storedNow && (r.ok || r.sentence !== sErr.sentence || r.pos !== sErr.pos)
          ? sErr : null
        const probe = probes?.get(f.id)
        const probeShown = r.ok && !serverShown && probe && probe.sentExpr === storedNow ? probe.probe : null
        const firstLine = probeShown ? probeLine(probeShown, { kind: r.compiled.kind, format: f.format, unit }) : ''
        // W10.8: a name problem is said once the member typed in the Name, left the field, or tried to save.
        const nameErr = showErrors || touched.has(f.id) ? nameProblem(cat, draftPlan, f.id) : null
        const open = list?.id === f.id
        const placed = open && place?.id === f.id ? place : null
        const ok = r.ok && compiled.get(f.id)?.ok && compiled.get(f.id).compiled.canonical === storedNow
        const c = ok ? r.compiled : null
        const options = ok ? measureOptions.filter((o) => o.formula === f.id) : []
        const key = `${FORMULA_PREFIX}${f.id}`
        const canSplit = !!c && c.kind === 'row' && (c.type === 'text' || c.type === 'bool')
        const splitOn = plan.split?.by === key
        const errPos = !r.ok ? boxPosOf(d.box, r.pos, d.box, fields)
          : serverShown ? boxPosOf(serverShown.sent, serverShown.pos, d.box, fields) : null
        const fmtList = formats.some((x) => x.key === f.format) ? formats : [...formats, { key: f.format, label: f.format }]
        return (
          <div key={f.id} className={styles.field} role="group" aria-label={shownName || `Field ${index + 1}`}
            data-testid="formula-field"
            onBlur={(e) => { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) touch(f.id) }}>
            <label className={b.field}>
              <span className={b.fieldLabel}>Name</span>
              <input className={styles.input} value={d.name} ref={(el) => { if (el) names.current.set(f.id, el); else names.current.delete(f.id) }}
                aria-invalid={nameErr ? 'true' : undefined} aria-describedby={nameErr ? nameErrId : undefined}
                autoComplete="off" onChange={(e) => { touch(f.id); change(f, 'name', e.target.value) }} />
            </label>
            {nameErr && <p className={styles.error} id={nameErrId}>{nameErr}</p>}
            <div className={b.field}>
              <label className={b.fieldLabel} htmlFor={`${id}-box`}>Formula</label>
              <div className={styles.boxWrap}>
                <textarea id={`${id}-box`} className={styles.box} rows={2} value={d.box} spellCheck={false}
                  autoComplete="off" autoCapitalize="off" autoCorrect="off"
                  ref={(el) => { if (el) boxes.current.set(f.id, el); else boxes.current.delete(f.id) }}
                  aria-describedby={resultId} aria-invalid={!r.ok || serverShown ? 'true' : undefined}
                  aria-autocomplete="list" aria-controls={open ? listId : undefined}
                  aria-activedescendant={open ? `${listId}-${list.active}` : undefined}
                  onChange={(e) => onBoxChange(f, e)} onKeyDown={(e) => onBoxKey(f, e)}
                  onFocus={() => { focused.current = f.id; fit(f.id) }}
                  onBlur={() => {
                    if (focused.current === f.id) focused.current = null
                    setList((l) => (l?.id === f.id ? null : l))
                  }} />
                {open && (
                  <ul className={`${styles.list} ${placed?.side === 'above' ? styles.listAbove : ''}`} role="listbox"
                    id={listId} aria-label="Suggestions" data-side={placed?.side || 'below'}
                    style={placed ? { maxHeight: placed.maxHeight } : undefined}>
                    {list.items.map((item, i) => (
                      <li key={`${item.kind}-${item.label}-${item.insert}`} id={`${listId}-${i}`} role="option"
                        aria-selected={i === list.active} data-label={item.label}
                        className={`${styles.option} ${i === list.active ? styles.optionActive : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); insert(f, item) }}>
                        <span className={styles.optionLabel}>{item.label}</span>
                        {item.kind === 'function' && USAGE.has(item.label) && (
                          <span className={styles.optionMeta}>{USAGE.get(item.label)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div id={resultId} className={styles.result}>
                {!r.ok && <p className={styles.error} data-pos={errPos ?? undefined}>{r.sentence}</p>}
                {r.ok && serverShown && (
                  <p className={styles.error} data-pos={errPos ?? undefined}>{serverShown.sentence}</p>
                )}
                {firstLine && <p className={styles.first}>{firstLine}</p>}
                {probeShown && probeShown.notice && <p className={b.coverage}>{probeShown.notice}</p>}
              </div>
            </div>
            <label className={b.field}>
              <span className={b.fieldLabel}>Format</span>
              <select className={styles.input} value={f.format} onChange={(e) => onEdit(f.id, { format: e.target.value })}>
                {fmtList.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </label>
            {c && (
              <div className={styles.offers}>
                {c.kind === 'aggregate' && options.map((o) => (
                  <OfferButton key={measureId(o)} label={o.offer} on={measured.has(measureId(o))} full={measuresFull}
                    only={plan.measures.length <= 1} cat={cat} onClick={() => onMeasure(o)} />
                ))}
                {c.kind === 'row' && options.length > 0 && (
                  <div className={styles.offerGroup} role="group" aria-label="Add as a measure">
                    <span className={b.fieldLabel} aria-hidden="true">Add as a measure</span>
                    {options.map((o) => (
                      <OfferButton key={measureId(o)} label={o.offer} on={measured.has(measureId(o))} full={measuresFull}
                        only={plan.measures.length <= 1} cat={cat} onClick={() => onMeasure(o)} />
                    ))}
                  </div>
                )}
                {canSplit && (
                  <button type="button" className={styles.offer} aria-pressed={splitOn}
                    onClick={(e) => onSplit(key, e.currentTarget)}>
                    Split by this
                  </button>
                )}
                {c.kind === 'row' && (
                  <FilterButton cat={cat} full={filtersFull} onClick={(el) => onFilter(key, el)} />
                )}
              </div>
            )}
            <button type="button" className={styles.remove}
              aria-label={shownName ? `Remove field: ${shownName}` : 'Remove field'}
              onClick={(e) => onRemove(f.id, e.currentTarget)}>
              <UIcon name="x" size={14} gold={false} aria-hidden="true" />
              <span>Remove</span>
            </button>
          </div>
        )
      })}
      <button type="button" className={`${b.addBtn} ${full ? styles.held : ''}`} aria-disabled={full || undefined}
        aria-describedby={full ? capId : undefined}
        onClick={() => {
          if (full) return
          focusNew.current = true
          onAdd(formats[0]?.key || 'number')
        }}>
        <UIcon name="plus" size={14} gold={false} aria-hidden="true" />
        <span>Add your own field</span>
      </button>
      {full && <p className={b.reason} id={capId}>{S_FIELD_CAP}</p>}
    </Section>
  )
}

/** One "Add as a measure" choice: pressed when the widget already measures it (pressing again takes it out); held,
 *  with the engine's sentence, at the measure cap or when it is the widget's only measure. */
function OfferButton({ label, on, full, only, cat, onClick }) {
  const why = useId()
  const reason = on ? (only ? reasonOf(cat, 'no_measure') : null) : (full ? reasonOf(cat, 'too_many_measures') : null)
  return (
    <>
      <button type="button" className={styles.offer} aria-pressed={on} aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? why : undefined} onClick={() => { if (!reason) onClick() }}>
        {label}
      </button>
      {reason && <span className={b.srOnly} id={why}>{reason}</span>}
    </>
  )
}

/** "Filter by this": held, with the engine's sentence, when the widget has all the filters it may. */
function FilterButton({ cat, full, onClick }) {
  const why = useId()
  return (
    <>
      <button type="button" className={styles.offer} aria-disabled={full || undefined}
        aria-describedby={full ? why : undefined} onClick={(e) => { if (!full) onClick(e.currentTarget) }}>
        Filter by this
      </button>
      {full && <span className={b.srOnly} id={why}>{reasonOf(cat, 'too_many_filters')}</span>}
    </>
  )
}
