// app/src/components/chart/builder/CriteriaPicker.jsx
//
// ─── THE SECOND DOOR ONTO ONE OBJECT (spec §6, Phase E task E-4) ────────────
//
// ⛔ ITS ONLY OUTPUT IS A SOURCE STRING. It does not parse, lint, budget, read
// back, validate or save — those are `FormulaField`'s and the sheet's, and they
// are the SAME ones a typed formula goes through. A picker with its own save
// path would be a second set of gates to keep in step, which is the seam this
// task exists to close: in TC2000 you can build a condition in the UI or write
// the PCF, and the two are different products that disagree.
//
// ⛔ AND IT IS DERIVED FROM THE TREE, NEVER STORED. `criteria.fromAst` rebuilds
// the rows from `compute.ast` every time this mounts. A persisted picker shape
// would be a THIRD artifact beside `compute.source` and `compute.ast` — which
// `defSchema.validateCompute` already ties together BY HASH — and the three
// would drift with nothing to say so.
//
// ⛔ A FORMULA IT CANNOT SHOW IS REPORTED, NOT APPROXIMATED, AND THE BOX IS LEFT
// ALONE. `onUnrepresentable` carries the refusal up; the picker renders zero
// rows and emits NOTHING, so switching to this mode can never overwrite the
// user's text with a lossy reconstruction of it.
//
// ⛔ NO NEW CHROME (spec §1.5). Every glyph is a `UIcon`, every control is at
// least `--tap-min`, the styles are `BuilderSheet.module.css`'s, and the only
// two breakpoints touched are 640 and 1024. Layout responds in CSS, never
// through `useMediaQuery` — that hook seeds at MOUNT and only updates on a
// `change` event, so on a phone whose viewport never changes it renders the
// desktop arrangement at first paint and never corrects it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../ui/UIcon'
import { TABLE } from '../engine/ast/parse'
import { vocabulary, fromAst, toSource, canonicalPicker } from './criteria'
import styles from './BuilderSheet.module.css'

/** ⛔ THE OPTION LISTS ARE THE MANIFEST'S, IN ITS OWN ORDER. A curated list here
 *  would be a fourth place a scalar has to be added, and `rs_rank` reaching the
 *  picker the day E-1 declares it is the entire point of the scalar work. */
const VOCAB = vocabulary(TABLE)
const NAME_OPTIONS = Object.freeze([...VOCAB.series, ...VOCAB.scalars])
const FN_OPTIONS = Object.freeze([...VOCAB.functions.keys()])
const CMP_OPTIONS = Object.freeze([...VOCAB.comparators])

/** The sentinel the term dropdown uses for "a plain number". It cannot collide
 *  with a manifest name — every declared name is an identifier and this is not
 *  one — and `CriteriaPicker.test.jsx` asserts that rather than assuming it. */
export const NUMBER_OPTION = '(number)'

const firstName = () => NAME_OPTIONS[0]

const defaultRow = () => ({
  kind: 'row',
  left: { t: 'name', name: NAME_OPTIONS[0] },
  cmp: CMP_OPTIONS[0],
  right: { t: 'name', name: NAME_OPTIONS[1] || NAME_OPTIONS[0] },
})

function defaultTermFor(kind) {
  if (kind === NUMBER_OPTION) return { t: 'num', value: 0 }
  if (VOCAB.functions.has(kind)) {
    return {
      t: 'call',
      name: kind,
      args: VOCAB.functions.get(kind).args.map((argKind) => (argKind === 'int'
        ? { t: 'num', value: 20 }
        : { t: 'name', name: firstName() })),
    }
  }
  return { t: 'name', name: kind }
}

const termKey = (t) => {
  if (!t) return NAME_OPTIONS[0]
  if (t.t === 'num') return NUMBER_OPTION
  return t.name
}

/** Replace child `i`, and PRUNE a group that just lost its last row. Without the
 *  prune an empty nested group reaches `canonicalPicker`, which refuses it — a
 *  shape the UI can reach and the model cannot spell. */
function withChild(group, i, next) {
  const gone = next && next.kind === 'group' && (next.children || []).length === 0
  return {
    ...group,
    children: gone
      ? group.children.filter((_, j) => j !== i)
      : group.children.map((c, j) => (j === i ? next : c)),
  }
}

function NumberField({ value, label, onChange }) {
  return (
    <input
      type="number"
      className={styles.pickerNum}
      aria-label={label}
      min="0"
      step="any"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const n = Number(e.target.value)
        onChange(Number.isFinite(n) && n >= 0 ? n : 0)
      }}
    />
  )
}

function TermEditor({ term, label, onChange }) {
  return (
    <span className={styles.pickerArgs}>
      <select
        className={styles.pickerSelect}
        aria-label={label}
        value={termKey(term)}
        onChange={(e) => onChange(defaultTermFor(e.target.value))}
      >
        <option value={NUMBER_OPTION}>a number</option>
        {NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
        {FN_OPTIONS.map((n) => <option key={n} value={n}>{`${n}(…)`}</option>)}
      </select>
      {term.t === 'num' && (
        <NumberField
          value={term.value}
          label={`${label} value`}
          onChange={(v) => onChange({ t: 'num', value: v })}
        />
      )}
      {/* ⛔ ONE LEVEL. A function's argument is a NAME or a NUMBER, never another
          call — `criteria.fromAst` refuses the nested form at `picker:term`, so
          offering one here would build a condition the picker could not read
          back, and that asymmetry IS the seam this task closes. */}
      {term.t === 'call' && term.args.map((arg, i) => (arg.t === 'num' ? (
        <NumberField
          key={`${term.name}-${i}`}
          value={arg.value}
          label={`${label} ${term.name} argument ${i + 1}`}
          onChange={(v) => onChange({
            ...term, args: term.args.map((a, j) => (j === i ? { t: 'num', value: v } : a)),
          })}
        />
      ) : (
        <select
          key={`${term.name}-${i}`}
          className={styles.pickerSelect}
          aria-label={`${label} ${term.name} argument ${i + 1}`}
          value={arg.name}
          onChange={(e) => onChange({
            ...term, args: term.args.map((a, j) => (j === i ? { t: 'name', name: e.target.value } : a)),
          })}
        >
          {NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )))}
    </span>
  )
}

function RowEditor({ row, where, onChange, onRemove }) {
  return (
    <div className={styles.pickerRow} data-testid="picker-row">
      <TermEditor
        term={row.left}
        label={`Condition ${where} left side`}
        onChange={(t) => onChange({ ...row, left: t })}
      />
      <select
        className={`${styles.pickerSelect} ${styles.pickerCmp}`}
        aria-label={`Condition ${where} comparison`}
        value={row.cmp}
        onChange={(e) => onChange({ ...row, cmp: e.target.value })}
      >
        {CMP_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <TermEditor
        term={row.right}
        label={`Condition ${where} right side`}
        onChange={(t) => onChange({ ...row, right: t })}
      />
      <button
        type="button"
        className={styles.pickerIconBtn}
        aria-label={`Remove condition ${where}`}
        onClick={onRemove}
      ><UIcon name="trash" size={14} /></button>
    </div>
  )
}

function GroupEditor({ group, path, onChange, onRemove }) {
  const where = path.length ? path.join('-') : 'top'
  const otherJoin = group.join === 'and' ? 'or' : 'and'
  return (
    <div
      className={`${styles.pickerGroup} ${path.length ? styles.pickerGroupNested : ''}`}
      data-testid="picker-group"
      data-join={group.join}
    >
      <div className={styles.pickerJoinRow}>
        <span className={styles.pickerJoinLabel}>Match</span>
        <select
          className={`${styles.pickerSelect} ${styles.pickerCmp}`}
          aria-label={`Group ${where} match`}
          value={group.join}
          onChange={(e) => onChange({ ...group, join: e.target.value })}
        >
          <option value="and">all of these</option>
          <option value="or">any of these</option>
        </select>
        {onRemove && (
          <button
            type="button"
            className={styles.pickerIconBtn}
            aria-label={`Remove group ${where}`}
            onClick={onRemove}
          ><UIcon name="trash" size={14} /></button>
        )}
      </div>

      {group.children.map((child, i) => (child.kind === 'group' ? (
        <GroupEditor
          key={`g${i}`}
          group={child}
          path={[...path, i]}
          onChange={(next) => onChange(withChild(group, i, next))}
          onRemove={() => onChange(withChild(group, i, { kind: 'group', join: child.join, children: [] }))}
        />
      ) : (
        <RowEditor
          key={`r${i}`}
          row={child}
          where={[...path, i].join('-')}
          onChange={(next) => onChange(withChild(group, i, next))}
          onRemove={() => onChange({ ...group, children: group.children.filter((_, j) => j !== i) })}
        />
      )))}

      <div className={styles.pickerJoinRow}>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => onChange({ ...group, children: [...group.children, defaultRow()] })}
        ><UIcon name="plus" size={14} />{path.length ? `Add condition to group ${where}` : 'Add condition'}</button>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => onChange({
            ...group,
            // ⛔ THE OTHER JOIN, ALWAYS. A nested group carrying its parent's
            // join is not a canonical picker — `canonicalPicker` flattens it —
            // so offering one would let the UI build a shape that reads back as
            // a DIFFERENT picker than the user assembled.
            children: [...group.children, { kind: 'group', join: otherJoin, children: [defaultRow()] }],
          })}
        >
          <UIcon name="plus" size={14} />
          {otherJoin === 'or' ? 'Add an any-of group' : 'Add an all-of group'}
        </button>
      </div>
    </div>
  )
}

/**
 * @param {object|null} ast              the tree the formula box currently holds
 * @param {Function}    onSourceChange   (source) => void — the ONLY output
 * @param {Function}    [onUnrepresentable] ({guard, reason}) => void
 */
export default function CriteriaPicker({ ast, onSourceChange, onUnrepresentable = null }) {
  const read = useMemo(() => (ast ? fromAst(ast, VOCAB) : null), [ast])
  const [group, setGroup] = useState(() => (read && read.ok ? read.group : null))

  const reportRef = useRef(onUnrepresentable)
  reportRef.current = onUnrepresentable

  // ⛔ THE DERIVATION NEVER EMITS. If this effect called `onSourceChange`, simply
  // SWITCHING to the picker would rewrite the text box with the picker's own
  // spelling of the user's formula — a silent edit of the artifact, and exactly
  // the "the UI helpfully rewrote your work" defect a round trip exists to make
  // impossible. Source leaves this component on a user EDIT and nowhere else.
  useEffect(() => {
    if (!read) { setGroup(null); return }
    if (read.ok) { setGroup(read.group); return }
    setGroup(null)
    reportRef.current?.({ guard: read.guard, reason: read.reason })
  }, [read])

  const emit = useCallback((next) => {
    const rows = next && Array.isArray(next.children) ? next.children.length : 0
    const canonical = rows ? canonicalPicker(next) : null
    setGroup(canonical)
    // An emptied picker emits the EMPTY STRING rather than nothing: "I deleted
    // every condition" is an edit, and leaving the box holding a formula the
    // picker no longer shows is the divergence this whole task is about.
    onSourceChange?.(canonical ? toSource(canonical, VOCAB) : '')
  }, [onSourceChange])

  const start = useCallback(() => {
    emit({ kind: 'group', join: 'and', children: [defaultRow()] })
  }, [emit])

  return (
    <div className={styles.pickerWrap} data-testid="criteria-picker">
      {group ? (
        <GroupEditor group={group} path={[]} onChange={emit} onRemove={null} />
      ) : (
        <button type="button" className={styles.ghostBtn} onClick={start}>
          <UIcon name="plus" size={14} />Add condition
        </button>
      )}
    </div>
  )
}
