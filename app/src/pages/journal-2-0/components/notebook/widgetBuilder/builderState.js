// Notebook widgets phase 2 (wave 8, Task 8.15): the builder's state, with undo and redo.
//
// ⛔ PURE. The reducer knows nothing of the catalog, the network or the clock: every action carries what it sets
// (the sheet decides, from the catalog, which measures a new "What to look at" starts with). That keeps undo and
// redo a matter of swapping whole plans, and every test a plain function call.
//
// State: `{plan, past, future, nameTouched, autoName, dirty, base, lastType}`.
//   * `plan` is the widget plan the server validates (widget_engine/plan.py validate_plan).
//   * `past` / `future` hold earlier and undone `{plan, nameTouched}` snapshots, at most HISTORY_CAP each.
//   * The NAME is `plan.display.title` once the member types one (`nameTouched`); until then it FOLLOWS the
//     latest preview's `defaultName` (`autoName`, never in history: it is the server's reading of the plan, so
//     undoing an edit brings the plan back and the next preview brings its name back). Clearing the name hands it
//     back to the plan.
//   * `dirty` is "differs from what the builder opened with", so undoing every edit is clean again.
//   * Consecutive name keystrokes are ONE history step (undo removes the word, not its last letter).
//   * Wave 10 (Task 10.16): "Your own fields" are `plan.formulas` (`{id, name, expr, format}`, the expression stored
//     CANONICAL, ruling W10-R2), written ONLY when the plan has one (W10-R3), and a plan that has one is format 3. A
//     formula measure is `{formula, agg?}`; a filter or split on a row formula names it `formula:<id>`. Each settled
//     edit of a field (the box debounces, as the preview does) is one history step.

export const HISTORY_CAP = 100
/** The newest plan format the builder writes (be plan.PLAN_VERSION, wave 10). A plan is written as the format it
 *  NEEDS (`neededVersion`), so a widget that uses no formula is the dict it was in wave 9. */
export const PLAN_VERSION = 3
/** be plan.MAX_FORMULAS and plan._FORMULA_ID_RE. */
export const FORMULA_CAP = 5
export const FORMULA_IDS = Object.freeze(['f1', 'f2', 'f3', 'f4', 'f5'])
export const DEFAULT_RANGE = Object.freeze({ token: 'last_90d' })

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isRef = (v) => typeof v === 'string' && v !== ''
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** The display block every plan carries (plan.py fills the same defaults). */
export function displayOf(plan) {
  const d = isRecord(plan?.display) ? plan.display : {}
  return {
    title: typeof d.title === 'string' ? d.title : '',
    titleAuto: d.titleAuto !== false,
    subtitle: typeof d.subtitle === 'string' ? d.subtitle : '',
    accent: typeof d.accent === 'string' && d.accent ? d.accent : 'gold',
    showN: d.showN !== false,
    target: typeof d.target === 'number' && Number.isFinite(d.target) ? d.target : null,
  }
}

/** One measure: a catalog measure `{key}` (wave 10: a property sum carries the property it adds up, `{key, prop}`) or
 *  a formula measure `{formula, agg?}` (be plan._check_measure). A bare string is a catalog key. */
export function toMeasure(m) {
  if (typeof m === 'string') return { key: m }
  if (!isRecord(m)) return null
  if (typeof m.formula === 'string' && m.formula) {
    return { formula: m.formula, ...(typeof m.agg === 'string' && m.agg ? { agg: m.agg } : {}) }
  }
  return typeof m.key === 'string' ? { key: m.key, ...(isRef(m.prop) ? { prop: m.prop } : {}) } : null
}

/** The plan's formula entries, each `{id, name, expr, format}`, in order. */
function formulasIn(p) {
  if (!Array.isArray(p.formulas)) return []
  return p.formulas.filter((f) => isRecord(f) && typeof f.id === 'string').map((f) => ({
    id: f.id, name: typeof f.name === 'string' ? f.name : '', expr: typeof f.expr === 'string' ? f.expr : '',
    format: typeof f.format === 'string' && f.format ? f.format : 'number',
  }))
}

/** A plan with every part present, so the sections never test for a missing key. */
export function normalizePlan(raw) {
  const p = isRecord(raw) ? clone(raw) : {}
  const formulas = formulasIn(p)
  const plan = {
    source: typeof p.source === 'string' && p.source ? p.source : 'closed_trades',
    accounts: isRecord(p.accounts) && typeof p.accounts.id === 'string' ? { id: p.accounts.id } : 'all',
    range: isRecord(p.range) ? p.range : { ...DEFAULT_RANGE },
    filters: Array.isArray(p.filters) ? p.filters.filter(isRecord).map((f) => ({
      field: f.field, op: f.op, values: Array.isArray(f.values) ? f.values : [], overridable: f.overridable === true,
      // Wave 9: the routine or tracker a filter on a `refKind` field reads (plan.py `_check_ref`).
      ...(isRef(f.ref) ? { ref: f.ref } : {}),
      // Wave 10: the note property a property filter reads (plan.py `_check_prop`).
      ...(isRef(f.prop) ? { prop: f.prop } : {}),
    })) : [],
    measures: Array.isArray(p.measures) ? p.measures.map(toMeasure).filter(Boolean) : [],
    split: isRecord(p.split) && typeof p.split.by === 'string'
      ? {
        by: p.split.by, then: typeof p.split.then === 'string' ? p.split.then : null,
        // `ref` names the routine or tracker of `by`, `ref2` the one of `then` (be Task 9.8).
        ...(isRef(p.split.ref) ? { ref: p.split.ref } : {}),
        ...(isRef(p.split.ref2) && typeof p.split.then === 'string' ? { ref2: p.split.ref2 } : {}),
      } : null,
    view: isRecord(p.view) && typeof p.view.type === 'string'
      ? { type: p.view.type, auto: p.view.auto !== false } : { type: 'number', auto: true },
    sort: isRecord(p.sort) ? { measure: p.sort.measure ?? 0, dir: p.sort.dir || 'desc', top: p.sort.top ?? 10 } : null,
    compare: isRecord(p.compare) ? p.compare : null,
    display: displayOf(p),
    // W10-R3: written only when the plan has one.
    ...(formulas.length ? { formulas } : {}),
  }
  return { v: neededVersion(plan), ...plan }
}

/** The sources whose rows are routine or tracker days (be plan.TOOL_SOURCES). */
const TOOL_SOURCE_KEYS = new Set(['routine_history', 'tracker_history'])

/**
 * The plan format a plan needs, as the server decides it (be plan.needed_version; the server writes this whatever the
 * sender wrote, W9-R3 / W10-R3): 3 with a formula, 2 when it reads a routine or tracker source or names one (`ref`),
 * else 1. ⚠️ The other wave 10 reasons for 3 (two sources, four display options) are the server's alone until the
 * tasks that build them extend this.
 */
export function neededVersion(plan) {
  if (Array.isArray(plan?.formulas) && plan.formulas.length) return PLAN_VERSION
  const refs = (plan?.filters || []).some((f) => isRef(f?.ref)) || isRef(plan?.split?.ref) || isRef(plan?.split?.ref2)
  return TOOL_SOURCE_KEYS.has(plan?.source) || refs ? 2 : 1
}

/** The plan's formulas (never missing). */
export const formulasOfPlan = (plan) => (Array.isArray(plan?.formulas) ? plan.formulas : [])

/** `plan` with `formulas` as given: the key, and format 3, only while there is one (W10-R3). */
function withFormulas(plan, formulas) {
  const next = { ...plan }
  delete next.formulas
  if (formulas.length) next.formulas = formulas
  return { ...next, v: neededVersion(next) }
}

/** A new widget: Net P&L of closed trades in the last 90 days. */
export function blankPlan() {
  return normalizePlan({ v: 1, source: 'closed_trades', measures: [{ key: 'net_pnl' }] })
}

/** True when the member has named the widget (the plan's title is theirs, not the automatic one). */
export const nameIsTouched = (plan) => displayOf(plan).titleAuto === false && displayOf(plan).title.trim() !== ''

const snapshotKey = (plan, nameTouched) => JSON.stringify([plan, !!nameTouched])

export function initState(plan, { autoName = '' } = {}) {
  const p = normalizePlan(plan)
  const nameTouched = nameIsTouched(p)
  return {
    plan: p, past: [], future: [], nameTouched, autoName, dirty: false,
    base: snapshotKey(p, nameTouched), lastType: null,
  }
}

/** The name the member sees: theirs once typed, else the plan's automatic one. */
export const nameOf = (state) => (state.nameTouched ? state.plan.display.title : state.autoName)

const capped = (list) => (list.length > HISTORY_CAP ? list.slice(list.length - HISTORY_CAP) : list)

/** Apply a plan change as one undoable step (or none, when nothing changed). */
function commit(state, edited, { nameTouched = state.nameTouched, type, coalesce = false } = {}) {
  // The format follows what the plan now needs (a routine source, a formula), never what it was opened as.
  const nextPlan = { ...edited, v: neededVersion(edited) }
  const key = snapshotKey(nextPlan, nameTouched)
  if (key === snapshotKey(state.plan, state.nameTouched)) return state
  const extend = coalesce && state.lastType === type && state.past.length > 0
  const past = extend ? state.past : capped([...state.past, { plan: state.plan, nameTouched: state.nameTouched }])
  return {
    ...state, plan: nextPlan, nameTouched, past, future: [], dirty: key !== state.base, lastType: type,
  }
}

/** The plan after `patch`, plus the view, comparison and order the sheet fitted to it (`builderCatalog.fitView`),
 *  so a change and the view it forces are ONE undo step. */
const withPlan = (state, patch, a = {}) => ({
  ...state.plan, ...patch,
  ...(a.view ? { view: a.view } : {}),
  ...(a.compare !== undefined ? { compare: a.compare } : {}),
  ...(a.sort !== undefined ? { sort: a.sort } : {}),
})

export function reducer(state, action) {
  const a = action || {}
  switch (a.type) {
    case 'setSource': {
      if (a.source === state.plan.source && !a.measures) return state
      // Another kind of row has other fields: its filters, split and order do not carry over. The sheet may also
      // reset the accounts and the range the new source cannot take (wave 9: a routine or tracker source), in the
      // same undo step.
      // Its own fields read the old fields too (Task 10.16): they go with them, in the same step (undo brings them back).
      return commit(state, withPlan({ ...state, plan: withFormulas(state.plan, []) }, {
        source: a.source,
        measures: Array.isArray(a.measures) ? a.measures.map(toMeasure).filter(Boolean) : state.plan.measures,
        filters: [], split: null, sort: null, compare: null, view: { type: 'number', auto: true },
        ...(a.accounts !== undefined ? { accounts: isRecord(a.accounts) ? { id: a.accounts.id } : 'all' } : {}),
        ...(isRecord(a.range) ? { range: a.range } : {}),
      }, a), { type: a.type })
    }
    case 'setAccounts':
      return commit(state, withPlan(state, { accounts: isRecord(a.accounts) ? { id: a.accounts.id } : 'all' }),
        { type: a.type })
    case 'setRange':
      return commit(state, withPlan(state, { range: a.range }, a), { type: a.type })
    case 'addFilter':
      return commit(state, withPlan(state, { filters: [...state.plan.filters, a.filter] }), { type: a.type })
    case 'editFilter': {
      if (!(a.index >= 0 && a.index < state.plan.filters.length)) return state
      const filters = state.plan.filters.map((f, i) => (i === a.index ? a.filter : f))
      return commit(state, withPlan(state, { filters }), { type: a.type })
    }
    case 'removeFilter': {
      if (!(a.index >= 0 && a.index < state.plan.filters.length)) return state
      return commit(state, withPlan(state, { filters: state.plan.filters.filter((_, i) => i !== a.index) }),
        { type: a.type })
    }
    case 'setMeasures':
      return commit(state, withPlan(state, { measures: a.measures.map(toMeasure).filter(Boolean) }, a), { type: a.type })
    case 'formula/add': {
      // The lowest free id, f1 to f5; at the cap, nothing.
      const list = formulasOfPlan(state.plan)
      const used = new Set(list.map((f) => f.id))
      const id = FORMULA_IDS.find((x) => !used.has(x))
      if (!id || list.length >= FORMULA_CAP) return state
      const f = isRecord(a.formula) ? a.formula : {}
      const entry = {
        id, name: typeof f.name === 'string' ? f.name : '', expr: typeof f.expr === 'string' ? f.expr : '',
        format: typeof f.format === 'string' && f.format ? f.format : 'number',
      }
      return commit(state, withFormulas(state.plan, [...list, entry]), { type: a.type })
    }
    case 'formula/edit': {
      // One settled edit of one field (its name, its box or its format): one step.
      const list = formulasOfPlan(state.plan)
      if (!list.some((f) => f.id === a.id) || !isRecord(a.patch)) return state
      const patch = {}
      for (const k of ['name', 'expr', 'format']) if (typeof a.patch[k] === 'string') patch[k] = a.patch[k]
      return commit(state, withFormulas(state.plan, list.map((f) => (f.id === a.id ? { ...f, ...patch } : f))),
        { type: a.type })
    }
    case 'formula/remove': {
      // The field and everything that reads it (its measures, a split by it, filters on it) in ONE step; the sheet
      // passes what the plan falls back to (`measures`, when none would be left) and the view it fits.
      const list = formulasOfPlan(state.plan)
      if (!list.some((f) => f.id === a.id)) return state
      const key = `formula:${a.id}`
      let measures = state.plan.measures.filter((m) => m.formula !== a.id)
      if (!measures.length && Array.isArray(a.measures)) measures = a.measures.map(toMeasure).filter(Boolean)
      if (!measures.length) return state
      const filters = state.plan.filters.filter((f) => f.field !== key)
      let split = state.plan.split
      if (split && split.by === key) split = null
      else if (split && split.then === key) {
        split = { ...split, then: null }
        delete split.ref2
      }
      const sort = split && state.plan.sort && state.plan.sort.measure < measures.length ? state.plan.sort : null
      const base = withFormulas(state.plan, list.filter((f) => f.id !== a.id))
      return commit(state, withPlan({ ...state, plan: base }, { measures, filters, split, sort }, a), { type: a.type })
    }
    case 'setSplit':
      return commit(state, withPlan(state, { split: a.split }, a), { type: a.type })
    case 'setSort':
      return commit(state, withPlan(state, { sort: a.sort }), { type: a.type })
    case 'setView':
      return commit(state, withPlan(state, {}, a), { type: a.type })
    case 'setName': {
      const name = typeof a.name === 'string' ? a.name : ''
      const touched = name.trim() !== ''
      const display = { ...state.plan.display, title: touched ? name : '', titleAuto: !touched }
      return commit(state, withPlan(state, { display }), { nameTouched: touched, type: a.type, coalesce: true })
    }
    case 'setDisplay': {
      // Typing a target or a subtitle is ONE undo step, like typing the name.
      const keys = Object.keys(a.display || {})
      const typed = keys.length === 1 && (keys[0] === 'target' || keys[0] === 'subtitle')
      return commit(state, withPlan(state, { display: { ...state.plan.display, ...a.display } }, a),
        { type: typed ? `setDisplay:${keys[0]}` : a.type, coalesce: typed })
    }
    case 'followName':
      // The latest preview's automatic name. Not a member edit: no history, no dirt.
      return typeof a.name === 'string' && a.name !== state.autoName ? { ...state, autoName: a.name } : state
    case 'undo': {
      if (!state.past.length) return state
      const prev = state.past[state.past.length - 1]
      return {
        ...state, plan: prev.plan, nameTouched: prev.nameTouched, past: state.past.slice(0, -1),
        future: capped([...state.future, { plan: state.plan, nameTouched: state.nameTouched }]),
        dirty: snapshotKey(prev.plan, prev.nameTouched) !== state.base, lastType: 'undo',
      }
    }
    case 'redo': {
      if (!state.future.length) return state
      const next = state.future[state.future.length - 1]
      return {
        ...state, plan: next.plan, nameTouched: next.nameTouched, future: state.future.slice(0, -1),
        past: capped([...state.past, { plan: state.plan, nameTouched: state.nameTouched }]),
        dirty: snapshotKey(next.plan, next.nameTouched) !== state.base, lastType: 'redo',
      }
    }
    case 'loadPlan': {
      // A fresh start (an opened widget, a resumed draft): history empties. `dirty` says whether the loaded plan
      // already differs from what was opened (a resumed draft does).
      const fresh = initState(a.plan, { autoName: a.autoName ?? state.autoName })
      if (a.keepBase) {
        return { ...fresh, base: state.base, dirty: snapshotKey(fresh.plan, fresh.nameTouched) !== state.base }
      }
      return fresh
    }
    default:
      return state
  }
}

/** The kinds of change a save is about (spec 5.2: a title- or colour-only change defaults to "Update all"). */
export function changeKind(before, after) {
  const a = normalizePlan(before)
  const b = normalizePlan(after)
  const strip = (p) => JSON.stringify({ ...p, display: null })
  return strip(a) === strip(b) ? 'display' : 'content'
}
