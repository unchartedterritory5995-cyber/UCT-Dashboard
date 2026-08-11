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

/** ⭐ ONE DROPDOWN, TWO ROW SHAPES. A member does not care that `>` is an
 *  operator and `crossOver` is a function — both are *the relation between the
 *  two sides of this row*, so both live in the same control and picking one
 *  switches the row's shape underneath. The list and every label are the
 *  vocabulary's; nothing here is typed, so a bool function the manifest declares
 *  tomorrow arrives in this dropdown with no edit. */
const RELATION_OPTIONS = Object.freeze([
  ...[...VOCAB.comparators].map((name) => ({ value: name, label: name, kind: 'row' })),
  ...[...VOCAB.crossings].map(([name, spec]) => ({ value: name, label: spec.label, kind: 'cross' })),
])
const RELATION_BY_VALUE = new Map(RELATION_OPTIONS.map((o) => [o.value, o]))
const CMP_OPTIONS = Object.freeze(RELATION_OPTIONS.filter((o) => o.kind === 'row').map((o) => o.value))

/** ⭐ THE THIRD ROW SHAPE — a name that answers yes-or-no ON ITS OWN. It has no
 *  relation and no second side, so it cannot ride the dropdown above: its row is
 *  ONE control. ⛔ The list and every label are the vocabulary's, read off
 *  `yields`, so a boolean scalar the manifest declares tomorrow arrives here
 *  with no edit — and if the manifest ever declares NONE, this is empty and the
 *  control that offers it is not rendered at all rather than rendered blank. */
const FLAG_OPTIONS = Object.freeze([...VOCAB.flags].map(([name, spec]) => ({ value: name, label: spec.label })))

/** The value the relation control shows for a row of either shape. */
const relationOf = (row) => (row.kind === 'cross' ? row.fn : row.cmp)

/** Re-shape a row around a newly-picked relation, KEEPING BOTH TERMS. The two
 *  shapes have the same operands, so switching between them must not throw the
 *  member's left and right sides away. */
function withRelation(row, value) {
  const rel = RELATION_BY_VALUE.get(value)
  const kind = rel ? rel.kind : 'row'
  const base = { left: row.left, right: row.right }
  return kind === 'cross'
    ? { kind: 'cross', ...base, fn: value }
    : { kind: 'row', ...base, cmp: value }
}

/** The sentinel the term dropdown uses for "a plain number". It cannot collide
 *  with a manifest name — every declared name is an identifier and this is not
 *  one — and `CriteriaPicker.test.jsx` asserts that rather than assuming it. */
export const NUMBER_OPTION = '(number)'

const firstName = () => NAME_OPTIONS[0]

/** ⚰️ THE FIRST ROW USED TO READ `open > high`, WHICH CAN NEVER BE TRUE.
 *
 *  It was not a chosen default — it was `NAME_OPTIONS[0]` and `[1]`, and the
 *  manifest happens to declare `open` then `high`. So the first thing a member saw
 *  after clicking "Add condition" was a condition that matches nothing, on a
 *  surface whose whole job is to teach them what a condition looks like.
 *
 *  ⛔ THE PAIR IS PREFERRED, NOT HARD-CODED. `NAME_OPTIONS` comes off the manifest;
 *  if `close`/`open` ever stop being declared this falls back to the old
 *  first-two behaviour rather than emitting a name the table cannot read. */
const preferredName = (want, fallbackIndex) =>
  (NAME_OPTIONS.includes(want) ? want : (NAME_OPTIONS[fallbackIndex] || NAME_OPTIONS[0]))

const defaultRow = () => ({
  kind: 'row',
  left: { t: 'name', name: preferredName('close', 0) },
  cmp: CMP_OPTIONS[0],
  right: { t: 'name', name: preferredName('open', 1) },
})

/** The source text a freshly-added condition emits.
 *
 *  ⛔ EXPORTED SO TESTS COMPOSE WITH IT INSTEAD OF RESTATING IT. `CriteriaPicker
 *  .test.jsx` used to spell `(open > high)` into an expectation whose real claim
 *  was about a nested group's JOIN — so changing the seed row broke a test that
 *  was not about the seed row at all. A test that retypes a value the source owns
 *  is this repo's most repeated defect; it is the reason this export exists. */
export const defaultConditionSource = () =>
  `${preferredName('close', 0)} ${CMP_OPTIONS[0]} ${preferredName('open', 1)}`

const defaultFlag = () => ({ kind: 'flag', name: FLAG_OPTIONS[0].value })

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

/** ⭐ THE FOURTH SHAPE IS A WRAPPER, SO THE UI UNWRAPS IT AND PUTS IT BACK. A
 *  negation is not a row sitting beside the others — it is the condition itself,
 *  said the other way round — so it is rendered as a TOGGLE on whatever it wraps
 *  rather than as a container around it. These three are the whole translation
 *  between the model's wrapper and the control's checkbox.
 *
 *  ⛔ ONE LEVEL, BY CONSTRUCTION. `withNegated` replaces the wrapper rather than
 *  adding one, so no sequence of clicks can build `!!x` — which `criteria.js`
 *  refuses on both of its sides, because collapsing it would hand back a
 *  different tree than the member typed. */
const isNegated = (node) => node.kind === 'not'
const bareOf = (node) => (node.kind === 'not' ? node.child : node)
const withNegated = (node, on) => (on ? { kind: 'not', child: bareOf(node) } : bareOf(node))

/** Replace child `i`, and PRUNE a group that just lost its last row. Without the
 *  prune an empty nested group reaches `canonicalPicker`, which refuses it — a
 *  shape the UI can reach and the model cannot spell.
 *
 *  ⚠️ AND IT LOOKS THROUGH A NEGATION TO DECIDE. An emptied group that happens
 *  to be negated is still an emptied group; a prune that only recognised the
 *  bare shape would leave `!(<nothing>)` in the tree, and the refusal would
 *  surface as a throw out of `emit` rather than as a row quietly disappearing. */
function withChild(group, i, next) {
  const bare = next ? bareOf(next) : next
  const gone = bare && bare.kind === 'group' && (bare.children || []).length === 0
  return {
    ...group,
    children: gone
      ? group.children.filter((_, j) => j !== i)
      : group.children.map((c, j) => (j === i ? next : c)),
  }
}

/** ⚠️ `allowNegative` IS NOT A STYLE CHOICE, IT IS THE TWO SLOTS BEING DIFFERENT
 *  KINDS. A row's TERM is a magnitude and the firm's own starter screens on a
 *  negative one (`pct_vs_ema20 >= -2`); a function's `int` argument is a
 *  LOOKBACK — the manifest says so with `lookback: "arg1"` — and a negative
 *  window is not a formula the parser accepts. `criteria.leafSource` refuses a
 *  negative literal inside a call for exactly that reason, so a control that
 *  offered one here would build source the picker could not read back. */
function NumberField({ value, label, onChange, allowNegative = false }) {
  return (
    <input
      type="number"
      className={styles.pickerNum}
      aria-label={label}
      {...(allowNegative ? {} : { min: '0' })}
      step="any"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (!Number.isFinite(n)) { onChange(0); return }
        onChange(allowNegative || n >= 0 ? n : 0)
      }}
    />
  )
}

/** The negate control, and it is the SAME control on a row, on a flag and on a
 *  group — because to the model they are one thing: a condition, wrapped.
 *
 *  ⚠️ THE WORD IS THIS COMPONENT'S, AND THAT IS THE SAME DECISION THE JOIN
 *  LABELS ALREADY MADE. `closedTable.json` declares no `sentence` for any
 *  operator, so there is no manifest string to read here — exactly as there is
 *  none for "all of these" / "any of these" below. What is derived is the only
 *  thing the manifest owns: WHICH operator this writes, which `criteria.js`
 *  measures off the interpreter and this component never sees. */
function NegateToggle({ on, label, onChange }) {
  return (
    <label className={styles.pickerNot}>
      <input
        type="checkbox"
        aria-label={label}
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
      not
    </label>
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
          allowNegative
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

/** ONE EDITOR FOR BOTH ROW SHAPES. A comparison and a crossing are the same
 *  sentence — two terms and a relation — so they are the same control, the same
 *  `data-testid`, the same aria labels and the same remove button. Rendering a
 *  separate "crossing row" would put a second layout on screen for a difference
 *  that is the grammar's, not the member's. */
function RowEditor({ row, where, negated, onNegate, onChange, onRemove }) {
  return (
    <div
      className={styles.pickerRow}
      data-testid="picker-row"
      data-kind={row.kind}
      data-negated={negated ? 'true' : 'false'}
    >
      <NegateToggle on={negated} label={`Negate condition ${where}`} onChange={onNegate} />
      <TermEditor
        term={row.left}
        label={`Condition ${where} left side`}
        onChange={(t) => onChange({ ...row, left: t })}
      />
      <select
        className={`${styles.pickerSelect} ${styles.pickerCmp}`}
        aria-label={`Condition ${where} comparison`}
        value={relationOf(row)}
        onChange={(e) => onChange(withRelation(row, e.target.value))}
      >
        {RELATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

/** ⭐ THE THIRD SHAPE, AND IT IS THE SAME ROW. Same `data-testid`, same remove
 *  button, same class — because to a member this is a condition sitting beside
 *  the others, not a different kind of thing. What it is NOT is a comparison
 *  with an empty right-hand side: there is one control, and its options carry
 *  the manifest's own sentence, so the row reads as the sentence it will save. */
function FlagEditor({ row, where, negated, onNegate, onChange, onRemove }) {
  return (
    <div
      className={styles.pickerRow}
      data-testid="picker-row"
      data-kind={row.kind}
      data-negated={negated ? 'true' : 'false'}
    >
      <NegateToggle on={negated} label={`Negate condition ${where}`} onChange={onNegate} />
      <select
        className={styles.pickerSelect}
        aria-label={`Condition ${where} fact`}
        value={row.name}
        onChange={(e) => onChange({ kind: 'flag', name: e.target.value })}
      >
        {FLAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button
        type="button"
        className={styles.pickerIconBtn}
        aria-label={`Remove condition ${where}`}
        onClick={onRemove}
      ><UIcon name="trash" size={14} /></button>
    </div>
  )
}

function GroupEditor({ group, path, negated = false, onNegate = null, onChange, onRemove }) {
  const where = path.length ? path.join('-') : 'top'
  const otherJoin = group.join === 'and' ? 'or' : 'and'
  return (
    <div
      className={`${styles.pickerGroup} ${path.length ? styles.pickerGroupNested : ''}`}
      data-testid="picker-group"
      data-join={group.join}
      data-negated={negated ? 'true' : 'false'}
    >
      <div className={styles.pickerJoinRow}>
        {/* ⛔ NOT ON THE ROOT, for the same reason it has no remove button: the
            root group is the WHOLE formula's frame, and `fromAst` hands a
            top-level negation back as a one-child group wrapping it — so a
            negated root is a shape the model has no spelling for. A member who
            wants one adds a group and negates THAT, and a typed `!(a && b)`
            still opens, as the nested case it already is. */}
        {onNegate && (
          <NegateToggle on={negated} label={`Negate group ${where}`} onChange={onNegate} />
        )}
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

      {group.children.map((child, i) => {
        // ⭐ THE WRAPPER IS UNWRAPPED HERE AND PUT BACK ON EVERY EDIT. What gets
        // rendered is the condition; whether it is negated is a property OF that
        // condition's own controls, so every editor below sees the shape it
        // knows and none of them has a case for `not`.
        const bare = bareOf(child)
        const neg = isNegated(child)
        const replace = (nextBare) => onChange(withChild(group, i, neg ? { kind: 'not', child: nextBare } : nextBare))
        const negate = (on) => onChange(withChild(group, i, withNegated(child, on)))
        if (bare.kind === 'group') {
          return (
            <GroupEditor
              key={`g${i}`}
              group={bare}
              path={[...path, i]}
              negated={neg}
              onNegate={negate}
              onChange={replace}
              onRemove={() => onChange(withChild(group, i, { kind: 'group', join: bare.join, children: [] }))}
            />
          )
        }
        // ⛔ ONE EDITOR PER ROW SHAPE, CHOSEN BY THE SHAPE'S OWN `kind`. A
        // default that fell through to `RowEditor` would render a flag as a
        // comparison with no terms — the picker showing a member something
        // their formula does not say.
        const Editor = bare.kind === 'flag' ? FlagEditor : RowEditor
        return (
          <Editor
            key={`r${i}`}
            row={bare}
            where={[...path, i].join('-')}
            negated={neg}
            onNegate={negate}
            onChange={replace}
            onRemove={() => onChange({ ...group, children: group.children.filter((_, j) => j !== i) })}
          />
        )
      })}

      <div className={styles.pickerJoinRow}>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => onChange({ ...group, children: [...group.children, defaultRow()] })}
        ><UIcon name="plus" size={14} />{path.length ? `Add condition to group ${where}` : 'Add condition'}</button>
        {/* ⛔ RENDERED ONLY WHEN THE MANIFEST HAS ONE. A control offering an
            empty list is a door onto nothing, and `defaultFlag` would have no
            first option to reach for. */}
        {FLAG_OPTIONS.length > 0 && (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => onChange({ ...group, children: [...group.children, defaultFlag()] })}
          >
            <UIcon name="plus" size={14} />
            {path.length ? `Add a yes-or-no fact to group ${where}` : 'Add a yes-or-no fact'}
          </button>
        )}
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => onChange({
            ...group,
            // ⛔ THE OTHER JOIN, ALWAYS. A nested group carrying its parent's
            // join is not a canonical picker — `canonicalPicker` flattens it —
            // so offering one would let the UI build a shape that reads back as
            // a DIFFERENT picker than the user assembled.
            //
            // ⛔⛔ AND IT IS SEEDED WITH **TWO** ROWS, WHICH IS WHAT MAKES THE
            // BUTTON WORK AT ALL.
            //
            // ⚰️ MEASURED IN THE LIVE BUILDER 2026-08-11: clicking "Add an any-of
            // group" produced a row that looked exactly like an AND sibling — same
            // indent, no nested Match control, labelled `Condition 1` — and the
            // group was simply GONE. The picker's state is rebuilt from the SOURCE
            // TEXT on every edit, and a one-child group serialises to `(close >
            // open)`: textually identical to a bare condition. So it could not
            // survive the round trip, and a member could never add a second row to
            // a group that no longer existed. The whole any-of feature was
            // unreachable through the UI.
            //
            // Measured both ways: `(a && (b))` reads back as two rows; `(a && (b
            // || c))` reads back as a row and a group. Two rows is also what "any
            // of these" MEANS — one alternative is not an alternative.
            children: [...group.children, {
              kind: 'group', join: otherJoin, children: [defaultRow(), defaultRow()],
            }],
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
