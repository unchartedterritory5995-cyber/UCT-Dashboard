import { useMemo, useState } from 'react'
import {
  conditionsOf, addCondition, removeCondition, renameCondition, setConditionEnabled,
  setConditionFormula, moveCondition, addAction, removeAction, setActionSettings, usedChannels,
  setConditionBinding, BINDING_KEYS,
} from './engine/conditionControls'
import { sourceOptions, parseSource } from './engine/sourceRef'
import { validateConditionFormula } from './engine/conditions'
import { MARKER_SHAPES, MARKER_POSITIONS, ACTION_CHANNEL } from './engine/conditionActions'
import UIcon from '../ui/UIcon'
import styles from './ChartSettingsModal.module.css'

// ─── CONDITIONS — ONE LIST, EACH ROW A RULE THAT DRAWS ──────────────────────
//
// ⭐ A CONDITION IS UNDERSTANDABLE AT A GLANCE, and nothing here exposes the
// implementation's words. A member sees a NAME, how many things it draws, and an
// on/off switch; opened, a FORMULA and a list of ACTIONS. "Boolean column",
// "consumer" and "binding key" appear nowhere on this surface.
//
// ⭐ THE ORDER ON SCREEN IS THE PRIORITY, and it says so. First matching enabled
// rule wins a candle and wins a background; markers stack. A member reorders
// priority by reordering the list they are looking at, which is the only
// formulation that needs no explanation.

/** The starters a member can drop in with one click, so the first condition is
 *  not a blank box. Each is a real, complete formula in the chart's own grammar.
 *
 *  ⛔ NOTHING PROPRIETARY IS INVENTED HERE. "Slingshot" is the firm's OWN
 *  TC2000 column, translated clause for clause — it lives in
 *  `engine/ast/pcf.slingshot.test.js` as the owner's verbatim three rows and is
 *  pinned there against bars that slingshot and bars that miss by one clause. */
const STARTERS = Object.freeze([
  {
    name: 'Inside Bar',
    formula: 'high < high[1] && low > low[1]',
    hint: 'The whole bar sits inside the previous one.',
  },
  {
    name: 'Slingshot',
    formula: 'close > ema(high, 4) && close[1] < ema(high, 4)[1] '
      + '&& close[2] < ema(high, 4)[2] && close[3] < ema(high, 4)[3] '
      + '&& close > 5 && lowest(volume, 3)[1] > 700000 '
      + '&& close / close[1] > 1.04 && volume > volume[1]',
    hint: 'The firm’s own TC2000 column: a reclaim of the 4-EMA of the highs, on expansion.',
  },
  {
    name: 'Trend up',
    formula: 'ema(close, 9) > ema(close, 20)',
    hint: 'The fast average is above the slow one.',
  },
])

/** The starters' formulas, by name — exported so a test can hold the Slingshot
 *  translation against the owner's verbatim TC2000 rows
 *  (`engine/ast/pcf.slingshot.test.js`). A translation nobody checks is a claim
 *  about somebody's setup that the product then draws on their chart. */
export const STARTER_FORMULAS = Object.freeze(
  Object.fromEntries(STARTERS.map((s) => [s.name, s.formula])),
)

const ACTION_LABEL = { candleColor: 'Candle colour', marker: 'Marker', background: 'Background' }
const SHAPE_LABEL = {
  dot: 'Dot', circle: 'Circle', triangleUp: 'Triangle up',
  triangleDown: 'Triangle down', square: 'Square', diamond: 'Diamond',
}
const POSITION_LABEL = { aboveBar: 'Above bar', belowBar: 'Below bar' }

export default function ChartSettingsConditions({
  settings, onChange, conditionErrors = null, registry = null, onBuild = null,
}) {
  const list = useMemo(() => conditionsOf(settings), [settings])
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState({})

  const commit = (next) => { if (next !== settings) onChange?.(next) }

  /** The formula box is UNCONTROLLED until it is valid — a member typing
   *  `close >` must be able to keep typing, and a writer that refuses would
   *  otherwise snap the box back on every keystroke. */
  const formulaValue = (c) => (draft[c.id] !== undefined ? draft[c.id] : c.formula)
  const formulaProblem = (c) => {
    const text = formulaValue(c)
    if (text === c.formula) return null
    const check = validateConditionFormula(text, c.bindings)
    return check.ok ? null : check.reason
  }

  const renderAction = (c, a) => {
    const set = (patch) => commit(setActionSettings(settings, c.id, a.id, patch))
    return (
      <div key={a.id} className={styles.indRow}>
        <span className={styles.indLabel}>{ACTION_LABEL[a.type] || a.type}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {a.type === 'marker' && (
            <>
              <select
                className={styles.indSelect}
                aria-label={`${c.name} marker shape`}
                value={MARKER_SHAPES.includes(a.shape) ? a.shape : 'dot'}
                onChange={(e) => set({ shape: e.target.value })}
              >
                {MARKER_SHAPES.map((s) => <option key={s} value={s}>{SHAPE_LABEL[s]}</option>)}
              </select>
              <select
                className={styles.indSelect}
                aria-label={`${c.name} marker position`}
                value={MARKER_POSITIONS.includes(a.position) ? a.position : 'belowBar'}
                onChange={(e) => set({ position: e.target.value })}
              >
                {MARKER_POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABEL[p]}</option>)}
              </select>
            </>
          )}
          {/* ⭐ THE COLOUR CARRIES ITS OWN ALPHA for a background, which is why
              there is no separate opacity control: one source of truth, and no
              way for the swatch and the paint to disagree. */}
          <input
            type="text"
            className={styles.indNum}
            style={{ width: a.type === 'background' ? 148 : 92 }}
            aria-label={`${c.name} ${ACTION_LABEL[a.type]} colour`}
            value={a.color || ''}
            onChange={(e) => set({ color: e.target.value })}
          />
          <button
            type="button" role="switch" aria-checked={a.enabled !== false}
            aria-label={`${c.name} ${ACTION_LABEL[a.type]} enabled`}
            className={`${styles.toggle} ${a.enabled !== false ? styles.toggleOn : ''}`}
            onClick={() => set({ enabled: a.enabled === false })}
          ><span className={styles.toggleKnob} /></button>
          <button
            type="button" className={styles.actRowRemove}
            aria-label={`Remove ${ACTION_LABEL[a.type]} from ${c.name}`}
            onClick={() => commit(removeAction(settings, c.id, a.id))}
          ><UIcon name="close" size={12} /></button>
        </span>
      </div>
    )
  }

  /** What this chart offers a condition to read. `sourceOptions` excludes the
   *  asker, which is meaningless for a condition — it is not an instance — so any
   *  id that cannot collide is fine here. */
  const bindable = useMemo(() => {
    if (!registry || typeof registry.getDefinition !== 'function') return []
    try {
      return sourceOptions(settings, (id) => registry.getDefinition(id), '__condition__')
        .filter((g) => g.label !== 'Price data')
    } catch { return [] }
  }, [settings, registry])

  /**
   * Why this condition draws nothing — derived HERE, from the settings blob.
   *
   * ⭐ THE SAME ANSWER THE ENGINE REACHES, ASKED OF THE SAME DATA. The binder
   * knows too (`binder.conditions().errors`), and plumbing that back through the
   * modal would be a second authority arriving one render late. A binding whose
   * instance is no longer in the list is unresolvable no matter who asks, and a
   * formula that does not read back is unresolvable before any bar exists.
   *
   * ⛔ AND IT NEVER REWRITES ANYTHING. The stored binding stays exactly as the
   * member left it, so re-adding the source resolves it again — the alternative,
   * silently falling back to `close`, is the defect this whole shape exists to
   * avoid.
   */
  const problemOf = (c) => {
    const instances = Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : []
    for (const [key, ref] of Object.entries(c.bindings || {})) {
      const parsed = parseSource(ref)
      if (!parsed) return `Series ${key} cannot be read`
      if (parsed.kind !== 'instance') continue
      const live = instances.some((i) => i && i.instanceId === parsed.instanceId && !i.deleted)
      if (!live) return 'Source unavailable'
    }
    const check = validateConditionFormula(c.formula, c.bindings)
    return check.ok ? null : check.reason
  }

  const renderRow = (c, i) => {
    const isOpen = openId === c.id
    const err = (conditionErrors && conditionErrors.get ? conditionErrors.get(c.id) : null)
      || problemOf(c)
    const used = usedChannels(c)
    const problem = formulaProblem(c)
    return (
      <div
        key={c.id}
        className={`${styles.actBlock} ${isOpen ? styles.actBlockOpen : ''} ${c.enabled ? '' : styles.actBlockOff}`}
        data-condition-id={c.id}
      >
        <div className={styles.actHead}>
          <button
            type="button" role="switch" aria-checked={c.enabled}
            aria-label={`Toggle ${c.name}`}
            className={`${styles.toggle} ${styles.actToggle} ${c.enabled ? styles.toggleOn : ''}`}
            onClick={() => commit(setConditionEnabled(settings, c.id, !c.enabled))}
          ><span className={styles.toggleKnob} /></button>
          <button
            type="button"
            className={styles.actName}
            aria-expanded={isOpen}
            onClick={() => setOpenId(isOpen ? null : c.id)}
          >
            <span className={styles.actLabel}>{c.name}</span>
            {/* ⭐ "2 actions", not "2 consumers". */}
            <span className={styles.actBadge}>
              {err
                ? err
                : `${c.actions.length} action${c.actions.length === 1 ? '' : 's'}`}
            </span>
          </button>
          <button
            type="button" className={styles.actRowRemove} aria-label={`Move ${c.name} up`}
            disabled={i === 0}
            onClick={() => commit(moveCondition(settings, c.id, -1))}
          >↑</button>
          <button
            type="button" className={styles.actRowRemove} aria-label={`Move ${c.name} down`}
            disabled={i === list.length - 1}
            onClick={() => commit(moveCondition(settings, c.id, 1))}
          >↓</button>
          <button
            type="button" className={styles.actRowRemove} aria-label={`Remove ${c.name}`}
            onClick={() => commit(removeCondition(settings, c.id))}
          ><UIcon name="close" size={12} /></button>
        </div>

        {isOpen && (
          <>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Name</span>
              <input
                type="text" className={styles.indNum} style={{ width: 180 }}
                aria-label={`${c.name} name`}
                value={c.name}
                onChange={(e) => commit(renameCondition(settings, c.id, e.target.value))}
              />
            </div>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Formula</span>
              <input
                type="text" className={styles.indNum} style={{ width: 260 }}
                aria-label={`${c.name} formula`}
                value={formulaValue(c)}
                onChange={(e) => {
                  const text = e.target.value
                  setDraft((d) => ({ ...d, [c.id]: text }))
                  commit(setConditionFormula(settings, c.id, text))
                }}
              />
            </div>
            {problem && (
              <div className={styles.indRow}>
                <span className={styles.indLabel} />
                <span role="alert" style={{ fontSize: 11, opacity: 0.8 }}>{problem}</span>
              </div>
            )}

            {/* ── BOUND SERIES — the one reference language, again ──────────
                ⭐ THE SAME GROUPED SELECTOR THE MOVING AVERAGE'S SOURCE USES, built
                by `sourceRef.sourceOptions` from the instances on THIS chart. A
                bound name becomes a word the formula can use — `a > b` — and the
                dependency edge, the compute order and the invalidation all come
                with it because the VALUE is the same `'@id::plot'` string.
                ⚠️ Only offered when something is on the chart to bind to; a
                self-contained formula (`close > open`) needs none of this. */}
            {bindable.length > 0 && BINDING_KEYS.map((key) => {
              const cur = c.bindings[key] || ''
              // Slots are offered in order and one at a time: `b` appears once `a`
              // is filled, so an empty condition shows ONE row rather than three.
              const idx = BINDING_KEYS.indexOf(key)
              const prev = idx === 0 ? true : !!c.bindings[BINDING_KEYS[idx - 1]]
              if (!prev) return null
              return (
                <div key={key} className={styles.indRow}>
                  <span className={styles.indLabel}>{`Series ${key}`}</span>
                  <select
                    className={styles.indSelect}
                    aria-label={`${c.name} series ${key}`}
                    value={cur}
                    onChange={(e) => commit(setConditionBinding(settings, c.id, key, e.target.value))}
                  >
                    <option value="">— none —</option>
                    {bindable.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )
            })}

            {c.actions.map((a) => renderAction(c, a))}

            <div className={styles.indRow}>
              <span className={styles.indLabel}>Add action</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {['candleColor', 'marker', 'background'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={styles.chip}
                    // ⭐ ONE PER EXCLUSIVE CHANNEL. A second candle colour on ONE
                    // condition could never win against its own sibling, so it is
                    // not offered — the ambiguity is prevented rather than
                    // resolved. Markers stack, so they are always offered.
                    disabled={ACTION_CHANNEL[t] !== 'marker' && used.has(ACTION_CHANNEL[t])}
                    aria-label={`Add ${ACTION_LABEL[t]} to ${c.name}`}
                    onClick={() => commit(addAction(settings, c.id, t))}
                  >{ACTION_LABEL[t]}</button>
                ))}
              </span>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={styles.sectionLabel}>
        CONDITIONS {list.length ? <span className={styles.indCount}>{list.length}</span> : null}
      </div>
      {list.length === 0 && (
        <div className={styles.indRow}>
          <span style={{ fontSize: 11, opacity: 0.75 }}>
            A condition asks one question of every bar — is this true? — and what it
            draws is up to you. Start from one of these, then add an action.
          </span>
        </div>
      )}
      {list.map(renderRow)}

      <div className={styles.sectionLabel}>ADD</div>
      {/* ⭐⭐ THE UNIFIED BUILDER, OPENED FOR A CONDITION. The same six doors an
          indicator is authored through — plain English, the firm's Library, the
          criteria picker, a Pine/ThinkScript/PCF import, a screenshot, the formula
          box — with the screener's snapshot columns hidden, because on a chart they
          are NaN. A member learns ONE authoring surface, not three. */}
      {onBuild && (
        <button
          type="button"
          className={styles.chip}
          aria-label="Build a condition"
          onClick={() => onBuild({})}
        >⊕ Build a condition…</button>
      )}
      {STARTERS.map((s) => (
        <div key={s.name} className={styles.indRow}>
          <span className={styles.indLabel}>{s.name}</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{s.hint}</span>
            <button
              type="button"
              className={styles.chip}
              aria-label={`Add ${s.name} condition`}
              onClick={() => {
                const next = addCondition(settings, { name: s.name, formula: s.formula })
                commit(next)
              }}
            >＋ Add</button>
          </span>
        </div>
      ))}
    </>
  )
}
