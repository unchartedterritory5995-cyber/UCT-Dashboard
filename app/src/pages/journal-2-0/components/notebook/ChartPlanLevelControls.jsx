/**
 * ChartPlanLevelControls -- the keyboard and screen-reader door to a chart plan's levels
 * (lane FIN-A11Y, review R4 finding I-6). Rendered by ChartPlanPanel, and only there.
 *
 * Before this file a plan level could only be made or moved by drawing on the chart canvas
 * with a pointer, and everything downstream (R:R, size, alerts, the Setups board) needs a
 * level. A horizontal line at a price does not depend on the path of a pointer, so it gets a
 * typed door (WCAG 2.1.1):
 *
 *   RoleRadios        the Entry / Stop / Target radios as ONE Tab stop. Arrow keys move and
 *                     select, as a radio group does; Home and End jump to the ends. The
 *                     selected role carries a check mark as well as its fill.
 *   LevelPriceField   a level's price as a number field. Type and press Enter (or leave the
 *                     field) to move the line; ArrowUp / ArrowDown step one tick and
 *                     PageUp / PageDown ten, writing at once so the line moves as you step.
 *                     Escape puts back the price the line is at.
 *   AddLevelForm      "Add a level at price": a number, a role, a button.
 *
 * ⛔ These are controls only. They compute nothing about the plan and write nothing
 * themselves: the panel owns the write (`moveLevel` / `addLevel` in lib/chartPlan.js, then the
 * member's own `updateAttributes`). Nothing here touches StockChart or the drawing overlay.
 */
import { useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { PRICE_ROLES } from '../../lib/planLevels'
import { levelStep, roundToStep } from '../../lib/chartPlan'
import useToolbarRoving from '../../lib/useToolbarRoving'
import styles from './ChartPlanPanel.module.css'

const ROLE_LABEL = { entry: 'Entry', stop: 'Stop', target: 'Target' }
const ROLE_VALUES = ['', ...PRICE_ROLES]

/** A price as the number field shows it (two places from a dollar up). */
const fieldPrice = (p) => (Number.isFinite(p) ? (p >= 1 ? p.toFixed(2) : String(p)) : '')

const validPrice = (raw) => {
  if (raw === '' || raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function RoleRadios({ role, label, onChange }) {
  const refs = useRef([])
  const at = Math.max(0, ROLE_VALUES.indexOf(role))
  const go = (i) => {
    const n = ROLE_VALUES.length
    const next = ((i % n) + n) % n
    onChange(ROLE_VALUES[next])
    refs.current[next]?.focus()
  }
  const onKeyDown = (e) => {
    const from = refs.current.indexOf(e.target)
    if (from < 0) return
    let to = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = from + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = from - 1
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = ROLE_VALUES.length - 1
    if (to == null) return
    e.preventDefault()
    go(to)
  }
  return (
    // The key handler serves the radio buttons inside (the radiogroup pattern).
    <div className={styles.roles} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {ROLE_VALUES.map((r, i) => (
        <button
          key={r || 'none'}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={role === r}
          tabIndex={i === at ? 0 : -1}
          className={`${styles.roleBtn} ${role === r ? styles.roleOn : ''}`}
          data-role={r || 'none'}
          onClick={() => onChange(r)}
        >
          {role === r && <UIcon name="check" size={11} gold={false} />}
          {r ? ROLE_LABEL[r] : 'None'}
        </button>
      ))}
    </div>
  )
}

export function LevelPriceField({ price, label, onCommit, onInvalid }) {
  const shown = fieldPrice(price)
  const [draft, setDraft] = useState(shown)
  useEffect(() => { setDraft(shown) }, [shown])
  const step = levelStep(price)

  const commit = (raw, viaStep = false) => {
    const n = validPrice(raw)
    if (n == null) {
      setDraft(shown)
      onInvalid?.()
      return
    }
    const next = roundToStep(n, step)
    if (next === price) { setDraft(shown); return }
    setDraft(fieldPrice(next))
    onCommit(next, viaStep)
  }

  const onKeyDown = (e) => {
    const steps = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key]
    if (steps) {
      e.preventDefault()
      const base = validPrice(draft) ?? price
      const next = roundToStep(base + steps * step, step)
      if (next > 0) commit(String(next), true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Escape' && draft !== shown) {
      e.stopPropagation()
      setDraft(shown)
    }
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      className={styles.priceInput}
      aria-label={label}
      min="0"
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => { if (draft !== shown) commit(draft) }}
      data-level-price=""
    />
  )
}

/**
 * Lane KEYS3 (Q20): a level row's alert controls (the direction select, where one is offered,
 * and the Arm button) as ONE Tab stop. Left and Right move between them; Up and Down stay the
 * select's own. A row with only the button is unchanged in effect: one control, one stop.
 */
export function AlertCell({ children }) {
  const roving = useToolbarRoving()
  return (
    <div className={styles.alertCell} ref={roving.ref} onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
      {children}
    </div>
  )
}

export function AddLevelForm({ onAdd, onInvalid }) {
  const id = useId()
  const inputRef = useRef(null)
  const [price, setPrice] = useState('')
  const [role, setRole] = useState('')
  const submit = (e) => {
    e.preventDefault()
    const n = validPrice(price)
    if (n == null) {
      onInvalid?.()
      inputRef.current?.focus()
      return
    }
    onAdd(roundToStep(n, levelStep(n)), role || null)
    setPrice('')
    setRole('')
  }
  return (
    <form className={styles.addLevel} onSubmit={submit} noValidate data-add-level="">
      <label className={styles.addLabel} htmlFor={`${id}price`}>Add a level at price</label>
      <input
        ref={inputRef}
        id={`${id}price`}
        type="number"
        inputMode="decimal"
        className={styles.priceInput}
        min="0"
        step="0.01"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <select
        className={styles.dirSelect}
        aria-label="Role of the new level"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        // Lane KEYS3 (Q20): Enter here adds the level, as it already does in the price field.
        // A select does not submit its form by itself, so a keyboard member had to Tab on to
        // the button for every level. Nothing else about the select's keys changes.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
          e.preventDefault()
          e.currentTarget.form?.requestSubmit()
        }}
      >
        <option value="">No role yet</option>
        {PRICE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <button type="submit" className={styles.saveBtn}>Add level</button>
      <span className={styles.hint}>Enter adds it.</span>
    </form>
  )
}
