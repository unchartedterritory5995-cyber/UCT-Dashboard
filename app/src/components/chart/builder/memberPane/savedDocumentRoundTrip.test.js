// app/src/components/chart/builder/memberPane/savedDocumentRoundTrip.test.js
//
// ─── C46 — A DOCUMENT SAVED UNDER THE OLD ASSIGNMENT STILL ROUND-TRIPS ───────
//
// The parameter-id rule changed from "the N-th input the walk resolved" to "the
// input call's place in the source, with the corpus's old ids frozen". A member
// document saved before that change addresses its inputs by the OLD ids. This
// file loads such documents — built by the member-pane door at base `e4e24524ef`
// and committed under `tests/fixtures/pine_param_ids/` — and requires that the
// door, as it translates today, hands back the same ids for the same inputs at
// the same places, so the values a member saved land on the inputs they moved.
//
// ⛔ THE FIXTURES ARE NOT REGENERATED. They are a record of what the old
// assignment produced; rebuilding them from today's translator would turn this
// file into a test that the translator agrees with itself.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { memberPaneDefinition } from './memberPaneDefinition.js'
import { applyParamEdit, reconcileParams } from '../paramEdit.js'
import { treesHash } from '../../engine/ast/trees.js'
import { validateDefinition } from '../../engine/defSchema.js'
import { installUserDefinitions, uninstallUserDefinition } from '../../engine/nativeRegistry.js'
import { PINE_CALL_SHAPES, printFormula, __v6BoolHistoryForTests } from '../../engine/ast/pine.js'
import { CALL_EXPANSIONS } from '../../engine/ast/callExpansions.js'
import { supertrendTreesEngine56 } from '../../engine/ast/__fixtures__/supertrendTreesEngine56.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const DIR = path.join(REPO, 'tests/fixtures/pine_param_ids')
const SAVED = JSON.parse(fs.readFileSync(path.join(DIR, 'saved-documents-pre-c46.json'), 'utf8'))
const VOLUME = JSON.parse(fs.readFileSync(path.join(DIR, 'saved-document-volume-v2-pre-c46.json'), 'utf8'))
const VOLUME_SCRIPT = 'tests/fixtures/member/uncharted-volume-v2.pine'

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)
/** Keys sorted at every level — the digest the fixture's locator lists were taken with. */
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
const valuesOf = (definition) => {
  const state = reconcileParams(definition)
  return Object.fromEntries(Object.keys(state).map((id) => [id, state[id].value]))
}
const build = (script) => {
  // ⭐ WITHOUT the enum knobs (`enumInputs: false`): an `input.string(…, options)`
  // the door now carries LIVE (`pine.js::enumCompare`) is a capability this document
  // never had — like a minted id, an append — and its trees read `kind == 1` where
  // the saved ones hold the default's branch. A document saved before keeps its
  // trees and draws what it drew; this rail asks that everything ELSE still lands.
  const built = memberPaneDefinition({
    source: fs.readFileSync(path.join(REPO, script), 'utf8'), id: 'u_member-pane-c46', enumInputs: false,
  })
  if (built.ok) {
    MINTED.set(built.definition, new Set((built.rows || []).filter((r) => r && typeof r.conditionFor === 'string').map((r) => r.key)))
  }
  return built
}

/** ⭐ B1 — A PAINT'S COLOUR COLUMN IS AN APPEND (the manifest's own rule, C46 ruling 3 /
 *  R-P, applied to the computation). A `bgcolor` / `barcolor` the door now carries adds a
 *  hidden condition column that ONLY the paint reads; the document a member saved is the
 *  rest of today's computation, byte for byte. So the comparison takes those columns out —
 *  and only those: a column a plot or a fill also reads existed before and stays. */
const paintOnlyKeys = (definition) => {
  const used = new Set()
  for (const p of definition.plots || []) {
    if (typeof p.colorMode === 'string' && p.colorMode.startsWith('column:')) used.add(p.colorMode.slice(7))
    if (p.fill && typeof p.fill.colorMode === 'string') used.add(p.fill.colorMode.slice(7))
  }
  const out = new Set((definition.paints || [])
    .map((p) => (typeof p.colorMode === 'string' ? p.colorMode.slice(7) : null))
    .filter((k) => k && !used.has(k)))
  // ⭐ …AND A COLUMN ONLY AN ALPHA-ONLY CONDITIONAL FILL READS — one colour, two
  // transparencies (`cond ? color.new(c, 85) : color.new(c, 95)`). The door used to
  // DECLINE that band (one alpha field, two alphas); it carries it now, each branch
  // baked as `#RRGGBBAA` (`pine.js::colourConditional`), so its condition column is
  // an append exactly as a paint's is. Only such a column, and only when nothing
  // else reads it.
  const otherReads = new Set()
  for (const p of definition.plots || []) {
    if (typeof p.colorMode === 'string' && p.colorMode.startsWith('column:')) otherReads.add(p.colorMode.slice(7))
  }
  for (const p of definition.plots || []) {
    const f = p && p.fill
    if (!f || typeof f.colorMode !== 'string' || typeof f.colorUp !== 'string' || typeof f.colorDown !== 'string') continue
    const alphaOnly = /^#[0-9a-f]{8}$/i.test(f.colorUp) && /^#[0-9a-f]{8}$/i.test(f.colorDown)
      && f.colorUp.slice(0, 7).toLowerCase() === f.colorDown.slice(0, 7).toLowerCase()
    const k = f.colorMode.slice(7)
    if (alphaOnly && !otherReads.has(k)) out.add(k)
  }
  return out
}
const computeBeforePaints = (definition) => {
  const keys = paintOnlyKeys(definition)
  if (!keys.size) return definition.compute
  const c = JSON.parse(JSON.stringify(definition.compute))
  for (const k of keys) {
    delete c.trees[k]
    if (c.sources) delete c.sources[k]
  }
  c.treesHash = treesHash(c.trees)
  return c
}

/** ⭐⭐ A CONDITION COLUMN'S LOCATORS ARE AN APPEND TOO (2026-10-29, the fill-alpha fix).
 *  A conditional colour's hidden column reads the same parameters its plot does
 *  (`isBullish = fastMA > slowMA` reads both of Uncharted Clouds' lengths), and the door
 *  now places those parameters THERE as well — before, an edit moved the lines and left
 *  the colour deciding on the OLD lengths (TradingView set E3/E4). A saved document
 *  never held such a locator, so the comparison takes exactly those out: a locator in a
 *  hidden column a plot's or a fill's `colorMode` names. Every other place must match. */
/** The condition columns the DOOR minted (`rows[].conditionFor`), per built document —
 *  never an author's own hidden row, whose locators were always there. */
const MINTED = new WeakMap()
const conditionColumnKeys = (definition) => MINTED.get(definition) || new Set()
const savedLocators = (definition, locators) => {
  const keys = conditionColumnKeys(definition)
  return (locators || []).filter((l) => !keys.has(l.treeIndex))
}
/** ⭐⭐ …AND AN EDIT'S HANDLE NOW MOVES WITH ITS TREE. `applyParamEdit` used to leave
 *  `compute.fn` at the UNEDITED tree's hash when it rewrote the scan tree, and
 *  `defSchema` refuses exactly that (`compute.fn` must be `astHash(compute.ast)`) — so
 *  the edited documents this fixture recorded were never installable (railed below).
 *  The comparison restores the stale handle the old edit left and the condition
 *  columns it failed to move (below) — those two, and nothing else. */
const asSaved = (definition, staleFn, unedited) => {
  const keysOf = unedited || definition
  let d = definition
  if (unedited && definition.compute.trees && conditionColumnKeys(keysOf).size) {
    // ⭐ THE EDIT AS THE OLD DOOR MADE IT: the condition columns did NOT follow the
    // edit (no locator reached them), so they are put back to the unedited tree —
    // the ONE other thing today's edit changes, and the defect it fixes.
    const keys = conditionColumnKeys(keysOf)
    const trees = { ...definition.compute.trees }
    const sources = { ...(definition.compute.sources || {}) }
    for (const k of keys) {
      if (unedited.compute.trees && k in unedited.compute.trees) trees[k] = unedited.compute.trees[k]
      if (unedited.compute.sources && k in unedited.compute.sources) sources[k] = unedited.compute.sources[k]
    }
    const compute = { ...definition.compute, trees, ...(definition.compute.sources ? { sources } : {}) }
    if (definition.compute.treesHash !== undefined) compute.treesHash = treesHash(trees)
    d = { ...definition, compute }
  }
  const c0 = computeBeforePaints(d)
  const manifest = c0.paramManifest
    ? Object.fromEntries(Object.entries(c0.paramManifest).map(([id, e]) => [id, { ...e, locators: savedLocators(keysOf, e.locators) }]))
    : c0.paramManifest
  const c = { ...c0, paramManifest: manifest }
  return staleFn ? { ...c, fn: staleFn } : c
}

/** ⛔ A DOCUMENT THAT NEVER INSTALLED IS NOT A DOCUMENT A MEMBER HOLDS. Each entry
 *  names the script, why its saved computation could not be drawn, and the change that
 *  made it drawable — the one kind of move this rail lets through, and only by name.
 *  The rail below proves each one installs TODAY, so the exemption cannot outlive it. */
const NEVER_INSTALLED = Object.freeze({
  // Pine coverage Phase 1 (2026-10-30): `highestbars(mb)` / `lowestbars(mb)` carried
  // the length as an unfolded `lb + rb + 1`, which the install door refused
  // (`resolve:window`, measured in the coverage census at base `0935116352`). The
  // namespaced door now folds that length as the table path folds a window, so `rb`
  // — read ONLY inside it — is no longer a knob, and the computation changes.
  'corpus/committed/pivot-high-low-points__hoTsDQRY3L.pine': 'the length of ta.highestbars was unfolded (resolve:window at install)',
})

/** ⭐⭐ ENGINE 55 — A COMPUTATION AN ENGINE CHANGE MOVED ON PURPOSE, by name. The script's
 *  MANIFEST (ids, inputs, places) and the values replayed by id are still held exactly; only the
 *  saved computation's digest is not, because the translator now writes a different — correct —
 *  tree, and a bumped `SCRIPT_ENGINE_VERSION` re-translates the member's saved copy from its script. */
const MOVED_BY_ENGINE = Object.freeze({
  'corpus/committed/support-and-resistance-multi-time-frame__Ph230jpfC9.pine': {
    why: 'engine 56 (built as 55; #1326 took 55): request.security(…, "W"|"M") with look-ahead off is tf_merge (TradingView\'s merge), no longer tf',
    undo: 'tf_merge',
  },
  'corpus/committed/multicator-table__486858895c.pine': {
    // its ta.stoch feeds only tables and votes, never a saved plot tree, so the digest moves by the supertrend
    why: 'engine 57: ta.supertrend is the new tree (undone together with ta.stoch back on the house stoch, engine 57\'s two table changes)',
    undo: 'engine57',
  },
  // ⭐ LANDING TRAIN 1 — engine 56-v2's two moves (its builder never ran this file on its final head;
  // attributed by building both scripts at every merge of the train: equal to the saved documents up
  // to the engine-57 merge, moved at the engine-56-v2 merge, unchanged by the three merges after it).
  'tests/fixtures/pine_oos/high_engagement__09-on-balance-volume-everget.pine': {
    why: 'engine 56-v2 (ruling a, re-review 6): a v1-v5 `and` reads an `na` operand as false, so `crossover(obv, signal) and highlightCrossovers` carries the cast `crossOver(…) != 0` (the crossing is `na` on the warm-up)',
    undo: 'engine56',
  },
  'corpus/committed/opening-range-initial-balance-opening-price__4a7416ab01.pine': {
    why: 'engine 56-v2 (P12b): a `bool` that can be `na` keeps its operator, so `show_mid and timeframe.isintraday` is no longer folded to its right side and `show_mid` (input default true) is a knob the document gains (an append)',
    undo: 'engine56',
  },
  // ⭐⭐ Q-BH0 (engine 92) — the one saved document whose script reads a v6 bool's history
  'corpus/committed/ema-ribbon-trend-filter-strixedge__737f5c58ad.pine': {
    why: 'Q-BH0: a Pine v6 bool\'s history before history begins reads false (captures vw-v6-bool-history-bar0-{spy,rddt}), so `not isBullish[1]`, `isSqueeze[1]` and the like are `na(close[1]) ? 0 : x[1]` (`pine.js::v6BoolHistory`); the inputs inside sit one `?:` deeper',
    undo: 'qbh0',
  },
})
const movedKind = (script) => (Object.prototype.hasOwnProperty.call(MOVED_BY_ENGINE, script) ? MOVED_BY_ENGINE[script].undo : null)

/** ⭐⭐ ENGINE 57 — THE CLAIMED MOVE UNDONE BY REBUILDING: `fn` runs with the two table entries engine 57
 *  changed put back as engine 56 had them (`ta.stoch` on the house `stoch`; `ta.supertrend` on the
 *  verbatim engine-56 expansion, `__fixtures__/supertrendTreesEngine56.js`), restored in `finally`.
 *  A document built inside must EQUAL the saved one, so the move can carry nothing else. */
const withEngine57Undone = (fn) => {
  const stoch = PINE_CALL_SHAPES.stoch
  const st = CALL_EXPANSIONS.supertrend
  const sd = CALL_EXPANSIONS.supertrendDirection
  const was = [stoch.table, st.build, sd.build]
  stoch.table = 'stoch'
  st.build = (a) => { const t = supertrendTreesEngine56(a[0], a[1]); return t ? t.value : null }
  sd.build = (a) => { const t = supertrendTreesEngine56(a[0], a[1]); return t ? t.direction : null }
  try {
    return fn()
  } finally {
    [stoch.table, st.build, sd.build] = was
  }
}

/** The test Q-BH0 writes before a v6 bool's one-bar history (`na(close[1])`), as a tree. */
const QBH0_PROBE = '"name":"na","args":[{"type":"offset","value":1,"args":[{"type":"series","name":"close"}]}]'
/** ⭐⭐ Q-BH0 — THE CLAIMED MOVE UNDONE BY REBUILDING: `fn` runs with the rule off (`__v6BoolHistoryForTests`, a
 *  v6 bool's history read as before Q-BH0), restored in `finally`. A document built inside must EQUAL the saved one,
 *  so the move can carry nothing else. */
const withQbh0Undone = (fn) => {
  __v6BoolHistoryForTests(false)
  try {
    return fn()
  } finally {
    __v6BoolHistoryForTests(true)
  }
}

/** ⭐⭐ ENGINE 55 (review M2) — TODAY'S DOCUMENT WITH THE ONE CLAIMED MOVE UNDONE: every
 *  `tf_merge` node back to `tf`, every `tf_merge(` in a source back to `tf(`, and the trees'
 *  hash re-taken over the restored trees. Its digest must EQUAL the saved one, so a move
 *  listed in `MOVED_BY_ENGINE` can carry nothing else with it. */
const undoTfMerge = (definition) => {
  const back = (v) => {
    if (Array.isArray(v)) return v.map(back)
    if (!v || typeof v !== 'object') return typeof v === 'string' ? v.split('tf_merge(').join('tf(') : v
    const o = {}
    for (const k of Object.keys(v)) o[k] = k === 'type' && v[k] === 'tf_merge' ? 'tf' : back(v[k])
    return o
  }
  const compute = back(definition.compute)
  if (compute.treesHash !== undefined && compute.trees) compute.treesHash = treesHash(compute.trees)
  return { ...definition, compute }
}

/** ⭐⭐ LANDING TRAIN 1 — ENGINE 56-v2'S TWO CLAIMED MOVES UNDONE ON TODAY'S DOCUMENT, and nothing else:
 *    1. the operand cast: under `&&` / `||` / `!`, `crossOver(…) != 0` / `crossUnder(…) != 0` back to
 *       the bare crossing;
 *    2. the kept identity: `P && X`, where `P` is the literal of an input the SAVED document never
 *       held (`savedIds`), back to `X`, and that gained input dropped from the manifest.
 *  Every other locator is re-addressed past the nodes that vanish, each changed tree's source is
 *  printed again and the trees' hash re-taken. Its digest must EQUAL the saved one, so a move
 *  listed as `engine56` can carry nothing else with it. */
const undoEngine56 = (definition, savedIds) => {
  const compute = JSON.parse(JSON.stringify(definition.compute))
  const manifest = compute.paramManifest || {}
  const gained = Object.keys(manifest).filter((id) => !Object.prototype.hasOwnProperty.call(savedIds, id))
  const follow = (n, p) => {
    for (let i = 0; i < p.length;) {
      if (p[i] === 'args') { n = n.args[p[i + 1]]; i += 2 } else { n = n[p[i]]; i += 1 }
    }
    return n
  }
  const gainedLiterals = new Set()
  for (const id of gained) for (const l of manifest[id].locators || []) gainedLiterals.add(follow(compute.trees[l.treeIndex], l.astPath))
  const isCast = (n) => !!n && n.type === 'op' && n.name === '!=' && n.args.length === 2
    && n.args[1].type === 'num' && n.args[1].value === 0
    && n.args[0].type === 'call' && (n.args[0].name === 'crossOver' || n.args[0].name === 'crossUnder')
  const LOGIC = new Set(['&&', '||', '!'])
  /** The child a vanishing node is replaced by, or -1. */
  const kept = (n, parentOp) => (isCast(n) && LOGIC.has(parentOp) ? 0
    : (!!n && n.type === 'op' && n.name === '&&' && gainedLiterals.has(n.args[0])) ? 1 : -1)
  const opOf = (n) => (n && n.type === 'op' ? n.name : null)
  const mapPath = (tree, q) => {
    const out = []
    let n = tree
    let parent = null
    for (let i = 0; i < q.length;) {
      if (q[i] !== 'args') { out.push(q[i]); i += 1; continue }
      const k = kept(n, parent)
      if (k >= 0 && q[i + 1] === k) { n = n.args[k]; i += 2; continue }
      out.push('args', q[i + 1]); parent = opOf(n); n = n.args[q[i + 1]]; i += 2
    }
    return out
  }
  for (const id of Object.keys(manifest)) {
    if (gained.includes(id)) continue
    manifest[id].locators = (manifest[id].locators || []).map((l) => ({ ...l, astPath: mapPath(compute.trees[l.treeIndex], l.astPath) }))
  }
  for (const id of gained) {
    // ⛔ a gained input is dropped only when every place it holds is an identity this undo removes
    for (const l of manifest[id].locators || []) {
      const p = l.astPath
      const parent = follow(compute.trees[l.treeIndex], p.slice(0, -2))
      if (!(p[p.length - 2] === 'args' && p[p.length - 1] === 0 && parent.type === 'op' && parent.name === '&&')) {
        throw new Error(`undoEngine56: ${id} sits somewhere other than a kept \`P && X\` identity`)
      }
    }
    delete manifest[id]
  }
  const rw = (n, parentOp = null) => {
    if (!n || typeof n !== 'object') return n
    const k = kept(n, parentOp)
    if (k >= 0) return rw(n.args[k], parentOp)
    return Array.isArray(n.args) ? { ...n, args: n.args.map((x) => rw(x, opOf(n))) } : n
  }
  for (const key of Object.keys(compute.trees)) {
    const back = rw(compute.trees[key])
    if (JSON.stringify(back) === JSON.stringify(compute.trees[key])) continue
    compute.trees[key] = back
    if (compute.sources && key in compute.sources) compute.sources[key] = printFormula(back)
  }
  if (compute.treesHash !== undefined) compute.treesHash = treesHash(compute.trees)
  const undone = { ...definition, compute }
  if (MINTED.has(definition)) MINTED.set(undone, MINTED.get(definition))
  return undone
}

const scripts = Object.keys(SAVED).filter((k) => k !== '_about' && fs.existsSync(path.join(REPO, k))
  && !Object.prototype.hasOwnProperty.call(NEVER_INSTALLED, k))

describe('C46 — the documents that never installed are exempt only while they install now', () => {
  it.each(Object.keys(NEVER_INSTALLED))('%s builds AND installs today', (script) => {
    expect(SAVED[script], `${script} is not in the saved fixture — drop it from NEVER_INSTALLED`).toBeTruthy()
    const built = build(script)
    expect(built.ok, built.reason).toBe(true)
    const { installed, errors } = installUserDefinitions([built.definition])
    try {
      expect(errors, 'the install door still refuses it').toEqual([])
      expect(installed.length).toBe(1)
    } finally {
      for (const d of installed) uninstallUserDefinition(d.id)
    }
  })
})

describe('ENGINE 55 / 56-v2 / 57 — a computation moved on purpose is named, and the move is the one claimed', () => {
  it.each(Object.keys(MOVED_BY_ENGINE))('%s: its saved digest differs, and with the claimed move undone it is EQUAL', (script) => {
    expect(SAVED[script], `${script} is not in the saved fixture — drop it from MOVED_BY_ENGINE`).toBeTruthy()
    const built = build(script)
    expect(built.ok, built.reason).toBe(true)
    expect(sha(JSON.stringify(asSaved(built.definition)))).not.toBe(SAVED[script].computeSha)
    // review M2 — the move is EXACTLY the one claimed: undo it, and the saved document returns
    if (movedKind(script) === 'tf_merge') {
      expect(JSON.stringify(built.definition.compute)).toContain('"tf_merge"')
      expect(sha(JSON.stringify(asSaved(undoTfMerge(built.definition))))).toBe(SAVED[script].computeSha)
    } else if (movedKind(script) === 'engine56') {
      const undone = undoEngine56(built.definition, SAVED[script].params)
      expect(JSON.stringify(undone.compute)).not.toBe(JSON.stringify(built.definition.compute))
      expect(sha(JSON.stringify(asSaved(undone)))).toBe(SAVED[script].computeSha)
    } else if (movedKind(script) === 'qbh0') {
      expect(JSON.stringify(built.definition.compute)).toContain(QBH0_PROBE)
      const undone = withQbh0Undone(() => build(script))
      expect(undone.ok, undone.reason).toBe(true)
      expect(JSON.stringify(undone.definition.compute)).not.toContain(QBH0_PROBE)
      expect(sha(JSON.stringify(asSaved(undone.definition)))).toBe(SAVED[script].computeSha)
      // and the rule is back on: a plain build after it is today's document again
      expect(sha(JSON.stringify(asSaved(build(script).definition)))).toBe(sha(JSON.stringify(asSaved(built.definition))))
    } else {
      expect(movedKind(script)).toBe('engine57')
      const undone = withEngine57Undone(() => build(script))
      expect(undone.ok, undone.reason).toBe(true)
      expect(JSON.stringify(undone.definition.compute)).not.toContain('"stochPine"')
      expect(sha(JSON.stringify(asSaved(undone.definition)))).toBe(SAVED[script].computeSha)
      // and the swap was undone: a plain build after it is today's document again
      expect(sha(JSON.stringify(asSaved(build(script).definition)))).toBe(sha(JSON.stringify(asSaved(built.definition))))
    }
  })
})

describe('C46 — documents saved under the walk-order ids', () => {
  it('NON-VACUITY — the saved documents are here, and they hold the OLD small-number ids', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(35)
    const ids = scripts.flatMap((s) => Object.keys(SAVED[s].params))
    expect(ids.length).toBeGreaterThanOrEqual(85)
    expect(ids.every((id) => /^__uct_param_\d{1,2}$/.test(id))).toBe(true)
  })

  // ⭐ DOOR ROBUSTNESS (2026-11-16) — two of these documents NEVER INSTALLED and STILL DO NOT: the
  // install door (`validateUserDefinitions` -> `compute.budget`) refused each one, so no chart ever drew
  // it and a stored copy is refused at every load. The member door now says so when it builds them,
  // under the budget's own guard, instead of handing back a document that installs nothing (the
  // opposite case to NEVER_INSTALLED above, which installs now). ⛔ A DECISION, NOT A DIFF: a script
  // joins this list only with the guard the door names; any other refusal is still a move.
  const INSTALL_REFUSED = {
    'corpus/committed/volume-spikes-growing-volume-signals-with-alerts-scanner__8e706f448f.pine': 'budget:lookback',
    'tests/fixtures/pine_oos/mid_engagement__16-ict-smc-guide.pine': 'budget:nodes',
  }

  it('⛔⛔ every saved document: the door still builds the same manifest — same ids, same inputs, same places', () => {
    const moved = []
    const refusedAsPinned = []
    for (const script of scripts) {
      const was = SAVED[script]
      const built = build(script)
      if (!built.ok && INSTALL_REFUSED[script] && built.guard === INSTALL_REFUSED[script]) { refusedAsPinned.push(script); continue }
      if (!built.ok) { moved.push({ script, problem: `the door no longer builds it: ${built.reason}` }); continue }
      // ⭐ landing train 1 — engine 56-v2's moves re-address a locator (a node appears on its path), so
      // the manifest is read off the document with that claimed move undone, as its digest is below
      // (and Q-BH0's: an input inside a v6 bool's history read sits one `?:` deeper, so its locator moves with the
      // claimed move, and is read off the document rebuilt with that move undone)
      const held = movedKind(script) === 'engine56' ? undoEngine56(built.definition, was.params)
        : movedKind(script) === 'qbh0' ? withQbh0Undone(() => build(script)).definition : built.definition
      const manifest = held.compute.paramManifest || {}
      for (const id of new Set([...Object.keys(was.params), ...Object.keys(manifest)])) {
        const a = was.params[id]
        const b0 = manifest[id]
        const b = b0 ? { ...b0, locators: savedLocators(held, b0.locators) } : b0
        // ⭐ A GAIN IS AN APPEND (C46 ruling 3; R-P 2026-10-01): an id the saved document never
        // held, minted because the door now carries more of the script, moves nothing a member
        // saved. Only an id the saved document HELD and the door no longer builds is a move.
        if (!a && b) continue
        if (!b) { moved.push({ script, id, was: a.sourceName, now: '(absent)' }); continue }
        const same = a.sourceName === b.sourceName && a.title === b.title && a.type === b.type
          && a.default === b.default && a.locators === (b.locators || []).length
          && a.locatorsSha === sha(stable(b.locators))
        if (!same) moved.push({ script, id, was: a.sourceName, now: b.sourceName, locators: [a.locators, (b.locators || []).length] })
      }
      // …and the document around the manifest is the same document.
      // ⭐ review M2 — a document an engine moved on purpose is compared with that move undone
      const kind = movedKind(script)
      const compared = kind === 'tf_merge' ? undoTfMerge(built.definition)
        : kind === 'engine56' || kind === 'qbh0' ? held
          : kind === 'engine57' ? withEngine57Undone(() => build(script)).definition : built.definition
      if (sha(JSON.stringify(asSaved(compared))) !== was.computeSha) {
        moved.push({ script, problem: 'the saved computation changed' })
      }
    }
    expect(moved, `saved documents no longer round-trip:\n${JSON.stringify(moved, null, 2)}`).toEqual([])
    // every pinned install refusal is still refused by that guard (one the door builds again leaves the list)
    expect(refusedAsPinned.sort()).toEqual(Object.keys(INSTALL_REFUSED).sort())
  }, 900000)

  it('⛔⛔ every saved document: the values a member saved, replayed BY ID, land on the same inputs', () => {
    const wrong = []
    for (const script of scripts) {
      const was = SAVED[script]
      const built = build(script)
      if (!built.ok) continue
      let doc = built.definition
      for (const id of Object.keys(was.values)) {
        const applied = applyParamEdit(doc, id, was.values[id])
        if (!applied.ok) { wrong.push({ script, id, problem: applied.error }); continue }
        doc = applied.definition
      }
      // every input the member saved holds the value they saved; an input the door gained
      // since (an append) holds its default and is not part of what was saved
      const nowValues = valuesOf(doc)
      const savedKeys = Object.keys(was.editedState)
      if (JSON.stringify(Object.fromEntries(savedKeys.map((k) => [k, nowValues[k]]))) !== JSON.stringify(was.editedState)) {
        wrong.push({ script, was: was.editedState, now: valuesOf(doc) })
      }
      // the edited document is byte-for-byte the one the old assignment saved
      const kind = movedKind(script)
      let [docNow, unedited] = [doc, built.definition]
      if (kind === 'tf_merge') [docNow, unedited] = [undoTfMerge(doc), undoTfMerge(built.definition)]
      if (kind === 'engine56') [docNow, unedited] = [undoEngine56(doc, was.params), undoEngine56(built.definition, was.params)]
      if (kind === 'engine57' || kind === 'qbh0') {
        // rebuild AND replay inside the undo: an edit may re-translate
        [docNow, unedited] = (kind === 'qbh0' ? withQbh0Undone : withEngine57Undone)(() => {
          const b = build(script).definition
          let d = b
          for (const id of Object.keys(was.values)) {
            const applied = applyParamEdit(d, id, was.values[id])
            if (applied.ok) d = applied.definition
          }
          return [d, b]
        })
      }
      if (sha(JSON.stringify(asSaved(docNow, built.definition.compute.fn, unedited))) !== was.editedComputeSha) {
        wrong.push({ script, problem: 'the edited document differs' })
      }
    }
    expect(wrong, `saved values landed elsewhere:\n${JSON.stringify(wrong, null, 2)}`).toEqual([])
  }, 900000)

  it('⛔⛔ VOLUME v2, the whole saved document: loaded, read by id, replayed onto today\'s translation', () => {
    // A real pre-C46 document with both lengths moved off their defaults.
    const saved = VOLUME.definition
    const savedValues = valuesOf(saved)
    expect(savedValues).toEqual({ __uct_param_1: 51, __uct_param_2: 51 })
    expect(Object.fromEntries(Object.entries(saved.compute.paramManifest).map(([id, e]) => [id, e.sourceName])))
      .toEqual({ __uct_param_1: 'lenWeekly', __uct_param_2: 'lenDaily' })

    const fresh = build(VOLUME_SCRIPT)
    expect(fresh.ok).toBe(true)
    // the fresh translation still holds the author's defaults…
    expect(valuesOf(fresh.definition)).toEqual({ __uct_param_1: 50, __uct_param_2: 50 })
    // …and the saved values, replayed by the SAVED ids, rebuild the saved document.
    let doc = fresh.definition
    for (const id of Object.keys(savedValues)) {
      const applied = applyParamEdit(doc, id, savedValues[id])
      expect(applied.ok, applied.error).toBe(true)
      doc = applied.definition
    }
    expect(doc.compute).toEqual(saved.compute)
  }, 120000)

  it('⭐ B1 — the paint-column rule is LOAD-BEARING and NARROW: without it a paint script differs; with it, it is the saved document', () => {
    // atr-support-and-resistance carries a `barcolor` the door now draws; its colour column
    // is an append. Without taking it out the computation differs (the rule is not vacuous)…
    const script = 'corpus/committed/atr-support-and-resistance__3e9ddb38c4.pine'
    const built = build(script)
    expect(built.ok).toBe(true)
    expect(paintOnlyKeys(built.definition).size).toBeGreaterThan(0)
    expect(sha(JSON.stringify(built.definition.compute))).not.toBe(SAVED[script].computeSha)
    // …and with it out, the computation is the saved one exactly.
    expect(sha(JSON.stringify(asSaved(built.definition)))).toBe(SAVED[script].computeSha)
    // a script that writes no paint takes the identity path: nothing is taken out.
    const plain = build('tests/fixtures/member/uncharted-volume-v2.pine')
    expect(plain.ok).toBe(true)
    expect(computeBeforePaints(plain.definition)).toBe(plain.definition.compute)
  }, 120000)

  it('⛔⛔ the stale handle is a DEFECT, not a shape: the old edit was refused, today\'s installs', () => {
    // Uncharted Clouds, the saved edit replayed: with the handle the old `applyParamEdit`
    // left, `defSchema` refuses the document; with today's, it validates.
    const script = 'tests/fixtures/member/uncharted-clouds.pine'
    const was = SAVED[script]
    const built = build(script)
    expect(built.ok).toBe(true)
    let doc = built.definition
    for (const id of Object.keys(was.values)) {
      const applied = applyParamEdit(doc, id, was.values[id])
      expect(applied.ok, applied.error).toBe(true)
      doc = applied.definition
    }
    expect(doc.compute.fn, 'NON-VACUITY: this edit moves the scan tree').not.toBe(built.definition.compute.fn)
    const stale = { ...doc, compute: { ...doc.compute, fn: built.definition.compute.fn } }
    expect(validateDefinition(stale).ok).toBe(false)
    expect(validateDefinition(stale).errors.join(' ')).toMatch(/compute handle IS its astHash/)
    expect(validateDefinition(doc).ok, (validateDefinition(doc).errors || []).join(' ')).toBe(true)
  }, 120000)

  it('⛔ a value moved on ONE id reaches that input only', () => {
    // The cheap way for an id to "round-trip" while pointing at the wrong input
    // is for both inputs to have been moved to the same value. Move one.
    const fresh = build(VOLUME_SCRIPT)
    const applied = applyParamEdit(fresh.definition, '__uct_param_2', 77)
    expect(applied.ok, applied.error).toBe(true)
    expect(valuesOf(applied.definition)).toEqual({ __uct_param_1: 50, __uct_param_2: 77 })
    const manifest = applied.definition.compute.paramManifest
    expect(manifest.__uct_param_2.sourceName).toBe('lenDaily')
  }, 120000)
})
