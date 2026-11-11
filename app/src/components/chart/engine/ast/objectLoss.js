// app/src/components/chart/engine/ast/objectLoss.js
//
// ─── ⭐⭐ WHAT A SCRIPT'S OBJECT PROGRAM LOST, AND WHICH LOSSES MAY BE DRAWN ──
//
// Owner ruling 2026-09-27 (option b). Program rule: no silent approximations — a
// partial loss is worse than a loud refusal.
//
//   1. A script whose object program lost anything that REMOVES a drawing — a
//      delete, a table clear, or anything whose loss leaves an object on screen
//      that Pine would have removed — does not get its drawing drawn. Refused by
//      name when the drawing is all it has; plots-only, with a sentence, when it
//      also plots.
//   2. Any other loss is drawn WITH a disclosure: "N of M drawing elements in
//      this script aren't supported yet", counted with the object pass's own
//      counters.
//   3. A clean object program, and a plot-only script, are unchanged.
//
// ⛔⛔ WHY THIS EXISTS. Measured 2026-09-27 on the committed corpus: with the
// objects-only flag ON the member door attached 37 partial object programs and
// said nothing; `poor-man's-volume-profile` kept 47 ops and dropped 199. In 9 of
// the scripts the flag added, the lost ops included DELETES, so the chart kept
// objects TradingView would have removed — not a smaller picture, a WRONG one.
//
// ⭐ THE CLASS COMES FROM THE KEYS THE OBJECT PASS ACTUALLY EMITS. Every
// `dropped(...)` call in `pine.js::buildObjectProgram` is listed below with the
// reason it sits where it does; `objectLoss.test.js` READS those call sites out
// of `pine.js` and fails by name on a key this table does not classify. An
// unclassified key is REFUSED, never guessed — the fail-closed direction is the
// loud one.
//
// ⭐ THIS MODULE CLASSIFIES AND WORDS; IT DOES NOT DECIDE. `paneGate.js` owns the
// decision (`paneObjectsGate`), for the reason its header gives: one place, not
// four slightly different `if`s.

import { ENUM_NA_SENTENCE } from '../enumNaRule.js'
import { MERGED_HEAD_REWRITE_SENTENCE } from '../objectCells.js'

/** The five answers a lost operation can have. */
export const LOSS = Object.freeze({
  /** Its loss leaves on screen something Pine removed. Never drawn around. */
  REMOVES: 'removes',
  /** A change to an object LIST. Lists are how a script finds the object it
   *  later deletes, so a lost push/set/remove aims that delete at the wrong
   *  handle, or at none — REMOVES when the script deletes anything, PARTIAL
   *  otherwise (a list nothing deletes from cannot un-delete anything). */
  LIST: 'list',
  /** A loop dropped before its body was converted. Classified by what the body
   *  held (`objectDiagnostics.unconvertedLoopOps`), since no other counter sees
   *  those ops. */
  LOOP: 'loop',
  /** A call to a drawing function of the script's own that the reader refused
   *  (`objectFnInline.js`), so its body was never converted. Classified by what
   *  that body held (`objectDiagnostics.lostRemovals` / `unconvertedFnOps`), the
   *  same question LOOP asks of a loop body. */
  BODY: 'body',
  /** A drawing missing or mis-drawn — never an extra one. Drawn, disclosed. */
  PARTIAL: 'partial',
})

const C = (cls, why) => Object.freeze({ cls, why })

/** ⭐⭐ EVERY EXACT KEY `pine.js::buildObjectProgram` EMITS, CLASSIFIED. */
export const DROP_KEYS = Object.freeze({
  'delete:target': C(LOSS.REMOVES,
    'a `*.delete` whose target handle this chart cannot read — the object Pine deletes stays'),
  'clear:target': C(LOSS.REMOVES,
    'a `table.clear` whose table cannot be read — the cells Pine wipes keep last bar\'s text'),
  'clear:range': C(LOSS.REMOVES,
    'a `table.clear` whose rectangle cannot be read — the cells Pine wipes keep last bar\'s text'),
  'merge:target': C(LOSS.PARTIAL,
    'a `table.merge_cells` whose table cannot be read — cells drawn unmerged, never an extra object'),
  'merge:range': C(LOSS.PARTIAL,
    'a `table.merge_cells` whose rectangle cannot be read — cells drawn unmerged, never an extra object'),
  'loop:bounds': C(LOSS.LOOP,
    'a loop whose range cannot be read; its body is never converted, so its class is its body\'s'),
  'loop:empty': C(LOSS.PARTIAL,
    'a loop every body op of which was dropped — each of those is counted and classified under its own key, so this adds nothing'),
  'update:target': C(LOSS.PARTIAL,
    'a setter whose target cannot be read — the object is drawn where/how it was, never kept past its deletion'),
  'update:props': C(LOSS.PARTIAL,
    'a setter whose value cannot be read — a stale position or style, not an extra object'),
  // ⭐ 2026-09-28 (C8) — an object whose TEXT a lost setter wrote is withheld,
  // never drawn with the text it was created with (an empty label where
  // TradingView shows `####`). The create is `content:lost`; every step that
  // would then act on the withheld object is `content:withheld`. Both are a
  // MISSING object, never an extra one — a delete of an object that was never
  // drawn leaves nothing on screen.
  'content:lost': C(LOSS.PARTIAL,
    'an object whose text a lost setter writes — withheld, never drawn with its creation text'),
  'content:withheld': C(LOSS.PARTIAL,
    'a step on an object withheld because its text was lost — it acts on nothing drawn'),
  // ⭐ C25 — the same for GEOMETRY: an object of a list whose handle a lost copy
  // read (`b = array.get(bs, i)`) and a lost step then moved (`box.set_left(b, …)`)
  // stays where it was made, which TradingView does not draw. Missing, never extra.
  'geometry:lost': C(LOSS.PARTIAL,
    'an object a lost step would have moved (its handle read out of a list this chart could not follow) — withheld, never drawn where it was made'),
  'geometry:withheld': C(LOSS.PARTIAL,
    'a step on an object withheld because a lost step would have moved it — it acts on nothing drawn'),
  // ⭐ C14 (2026-09-29) — a step that reads a drawing's state (`label.get_y(l)`)
  // which this program cannot carry (a lost setter, create or handle): withheld,
  // never drawn off the value this chart happens to hold. A missing object or a
  // stale one, never an extra one…
  'state:lost': C(LOSS.PARTIAL,
    "a step reading a drawing's state this chart cannot carry — withheld, never drawn off a different value"),
  // ⭐ C33 — a step under a guard one of whose `and` terms this chart cannot read
  // (`pine.js::partialAndGuard`). It is CARRIED: known not to run wherever a read
  // term is false, and on every other bar withheld by the object runtime, which
  // marks whatever it would have written, moved or deleted so that object is
  // held rather than drawn (C17) — never an extra object on screen.
  'guard:partial': C(LOSS.PARTIAL,
    'a step whose condition has a term this chart cannot read — carried, and withheld on every bar its readable terms hold'),
  // …except a DELETE withheld that way: the object Pine deletes stays.
  'state:removal': C(LOSS.REMOVES,
    "a delete whose condition reads a drawing's state this chart cannot carry — the object Pine deletes stays"),
  // ⭐ C18 — a drawing whose values the runtime lane answers, one of whose
  // properties could not be read: dropped whole (`pine.js::rtHeldProp`).
  // ⛔ HONESTY-SWEEP item 1 (2026-11-07) — a drawing (or a setter, or a cell) whose `style` /
  // `size` / `position` can be `na`: what TradingView draws for that is not captured (Q-HS1),
  // so it is withheld (`pine.js`, `ENUM_NA_SENTENCE`). A missing object, never an extra one.
  'enum:na': C(LOSS.PARTIAL,
    'a drawing whose style, size or position can be `na` — withheld, never drawn with a default style'),
  // ⛔ HONESTY-SWEEP r1 (review N1) — the same word computed by a helper called with a named
  // argument, which this door does not read (Q-HS7). Missing, never extra.
  'enum:named-call': C(LOSS.PARTIAL,
    'a drawing whose style, size or position a helper computes from a named argument — withheld, never drawn with a default style'),
  'runtime:prop': C(LOSS.PARTIAL,
    'a drawing the runtime lane would feed, with a property this chart cannot read — dropped whole, never drawn in a default colour'),
  'cell:target': C(LOSS.PARTIAL, 'a table cell write that addresses no readable table — a missing cell'),
  'cell:address': C(LOSS.PARTIAL, 'a table cell write whose row/column cannot be read — a missing cell'),
  'cell:text': C(LOSS.PARTIAL,
    'a table cell whose text cannot be read — dropped whole, never written blank, so a missing cell'),
  'cellpatch:target': C(LOSS.PARTIAL, 'a cell setter that addresses no readable table — a missing style'),
  'cellpatch:address': C(LOSS.PARTIAL, 'a cell setter whose row/column cannot be read — a missing style'),
  'coll:unknown': C(LOSS.LIST, 'a change to an object list this chart does not know'),
  'coll:push': C(LOSS.LIST, 'an object never entered into the list a later delete reads'),
  'coll:unshift': C(LOSS.LIST, 'an object never entered at the front of the list a later delete reads'),
  'coll:set': C(LOSS.LIST, 'a list slot never overwritten, so a later delete reads the old handle'),
  'coll:remove': C(LOSS.LIST, 'a handle never taken out of the list, so a later delete hits it twice'),
  // ⭐ C16 (2026-09-29) — a READ of an object list that lost a change (its
  // `array.size`, a slot, a handle copied out of one): our list is no longer
  // TradingView's, so the step is withheld. A LIST loss like the others — a
  // withheld delete is also on `lostRemovals`, which is what refuses the drawing.
  'coll:diverged': C(LOSS.LIST,
    'a step that reads an object list which lost a change, so it would act on a handle TradingView\'s list does not hold there'),
  // ⭐ 2026-09-27 — the call-site inliner (`objectFnInline.js`). `x := f(…)`
  // copies the handle an inlined body returned into the caller's register; when
  // that copy cannot be read, the register keeps what it held before, so a later
  // `line.delete(x)` removes the OLD object and leaves the new one. The same
  // failure as a list slot never overwritten.
  'copy:source': C(LOSS.LIST,
    "a function's returned handle never stored in the caller's variable, so a later delete of that variable removes the previous object"),
  // ⭐ 2026-09-27 — `b := box(na)`: the variable forgets its object. Lost, the
  // variable keeps the OLD object, so a later setter or delete of it hits an
  // object Pine had let go of — the same failure as a handle never overwritten.
  'reset:target': C(LOSS.LIST,
    "a variable emptied with `x := box(na)` that this chart cannot address, so a later delete of that variable removes the object Pine had let go of"),
})

/** `guard:<op kind>` — the op's CONDITION could not be read, so the op is
 *  dropped whole. Its class is the class of the op it would have been. The kinds
 *  are the reader's (`pineObjects.js::collectObjectOps`). */
export const GUARD_KINDS = Object.freeze({
  loop: C(LOSS.LOOP, 'a loop whose condition cannot be read; classified by its body'),
  create: C(LOSS.PARTIAL, 'a create whose condition cannot be read — a missing object'),
  update: C(LOSS.PARTIAL, 'a setter whose condition cannot be read — a stale object'),
  delete: C(LOSS.REMOVES, 'a delete whose condition cannot be read — the object Pine deletes stays'),
  cell: C(LOSS.PARTIAL, 'a cell write whose condition cannot be read — a missing cell'),
  cellpatch: C(LOSS.PARTIAL, 'a cell setter whose condition cannot be read — a missing style'),
  merge: C(LOSS.PARTIAL, 'a cell merge whose condition cannot be read — cells drawn unmerged'),
  clear: C(LOSS.REMOVES,
    'a `table.clear` whose condition cannot be read — the cells Pine wipes keep last bar\'s text'),
  coll_push: C(LOSS.LIST, 'a list push whose condition cannot be read'),
  coll_unshift: C(LOSS.LIST, 'a list unshift whose condition cannot be read'),
  coll_set: C(LOSS.LIST, 'a list set whose condition cannot be read'),
  coll_remove: C(LOSS.LIST, 'a list remove whose condition cannot be read'),
  coll_pop: C(LOSS.LIST, 'a list pop whose condition cannot be read'),
  coll_shift: C(LOSS.LIST, 'a list shift whose condition cannot be read'),
  coll_clear: C(LOSS.LIST, 'a list clear whose condition cannot be read'),
  copy: C(LOSS.LIST,
    "a returned handle whose condition cannot be read — the caller's variable keeps the previous object for a later delete"),
  reset: C(LOSS.LIST,
    "a `x := box(na)` whose condition cannot be read — the variable keeps the object Pine let go of, for a later delete"),
  // ⭐ C14 — a number read off a drawing into a scalar. It is never dropped as
  // an op (a scalar whose write cannot be carried makes its READERS refuse),
  // so this entry exists to keep the roster total, not because it fires.
  getnum: C(LOSS.PARTIAL,
    'a number read off a drawing whose condition cannot be read — every step that reads it is refused'),
})

/** `fn:<why>` — a call to a drawing function of the script's own that the reader
 *  REFUSED (`pineObjects.js::refuseCall`, `objectFnInline.js` for the Pine
 *  semantics). Every exact `why` is listed, with the reason it sits where it
 *  does; `objectLoss.test.js` reads the `why`s out of the reader's source and
 *  fails by name on one this table does not classify.
 *
 *  Every refusal but one is made BEFORE the body is walked, so nothing it would
 *  have drawn, changed or removed reached the program: those are BODY, and the
 *  door classifies them by what the body held. `return-type` is made AFTER the
 *  body was inlined — only the returned handle is lost, which is `copy:source`'s
 *  failure. */
const BODY_REFUSED = (why) => C(LOSS.BODY,
  `a call to a drawing function the chart refused (${why}), so nothing in its body is drawn; classified by what that body would have removed`)
export const FN_REFUSALS = Object.freeze({
  method: BODY_REFUSED("a drawing METHOD — its receiver's type decides which body runs"),
  'var-init': BODY_REFUSED('`var x = f()` runs once, on the first bar'),
  'in-expression': BODY_REFUSED('the call sits inside an expression whose order is not modelled'),
  unknown: BODY_REFUSED("the function's definition could not be found"),
  loop: BODY_REFUSED('the call sits in a loop this chart cannot run'),
  depth: BODY_REFUSED('helpers call helpers deeper than any real script'),
  arity: BODY_REFUSED('the arguments do not match the parameters'),
  'conditional-history': BODY_REFUSED('a conditional call whose body reads history'),
  receiver: BODY_REFUSED('a receiver parameter bound to something that is not a name'),
  'return-type': C(LOSS.LIST,
    "a function's returned handle is a different kind than the variable it is stored in, so a later delete of that variable removes the previous object"),
})

/** The TEMPLATED keys: `create:<family>`, `cellpatch:<property>`, `coll:<method>`.
 *  Checked AFTER the exact table, so `cellpatch:target` is never read as a
 *  property named "target". */
export const DROP_KEY_FAMILIES = Object.freeze([
  Object.freeze({ prefix: 'create:', ...C(LOSS.PARTIAL,
    'a `*.new` this chart cannot read — a missing object, never an extra one') }),
  Object.freeze({ prefix: 'cellpatch:', ...C(LOSS.PARTIAL,
    'a cell setter whose value cannot be read — a missing style') }),
  Object.freeze({ prefix: 'coll:', ...C(LOSS.LIST,
    'a list method this chart does not carry (e.g. `array.pop`)') }),
])

const UNCLASSIFIED = C(LOSS.REMOVES,
  'a drop reason this door has not classified — refused rather than guessed')

/** @returns {{cls: string, why: string}} */
export function classifyDropKey(key) {
  const k = String(key || '')
  if (Object.prototype.hasOwnProperty.call(DROP_KEYS, k)) return DROP_KEYS[k]
  if (k.startsWith('guard:')) {
    const kind = k.slice('guard:'.length)
    return Object.prototype.hasOwnProperty.call(GUARD_KINDS, kind) ? GUARD_KINDS[kind] : UNCLASSIFIED
  }
  // ⛔ W9-OQ-N2 — `strategy:<op kind>`: a drawing step a broker value reaches, withheld BY NAME
  // (`guardRefusals` carries `pine:strategy-call` and the word). Its class is the class of the op
  // it would have been, exactly as for `guard:<kind>`: a withheld create is a missing object, a
  // withheld delete (only one RUN under a tainted condition) leaves the object Pine deletes.
  if (k.startsWith('strategy:')) {
    const kind = k.slice('strategy:'.length)
    return Object.prototype.hasOwnProperty.call(GUARD_KINDS, kind)
      ? { cls: GUARD_KINDS[kind].cls, why: `a drawing step a \`strategy.*\` value reaches (${kind}), withheld by name: the broker is not simulated` }
      : UNCLASSIFIED
  }
  if (k.startsWith('fn:')) {
    const why = k.slice('fn:'.length)
    return Object.prototype.hasOwnProperty.call(FN_REFUSALS, why) ? FN_REFUSALS[why] : UNCLASSIFIED
  }
  for (const f of DROP_KEY_FAMILIES) if (k.startsWith(f.prefix)) return { cls: f.cls, why: f.why }
  return UNCLASSIFIED
}

/** ⭐ A LOSS THE READER COUNTS BEFORE THE CONVERTER EVER SEES AN OP.
 *  `loopBlockedCalls`, `unsupported` and `outOfScope` name calls that never
 *  became an op at all, so they are in no drop count — and a `box.delete` inside
 *  a loop this reader cannot run (`sonarlab-order-blocks`) removes exactly as
 *  much as a dropped one. Classified by the call's NAME. */
export function classifyReaderName(name) {
  const n = String(name || '')
  if (/\.delete$/.test(n) || n === 'table.clear') {
    return C(LOSS.REMOVES, `\`${n}\` is never carried — what it removes stays on screen`)
  }
  if (n.startsWith('array.')) return C(LOSS.LIST, `\`${n}\` on an object list is never carried`)
  return C(LOSS.PARTIAL, `\`${n}\` is never carried — a missing or unstyled drawing`)
}

/** Op kinds a converted program carries, and the families it CREATES, loop
 *  bodies included. */
function carriedKinds(program) {
  const out = {}
  const families = new Set()
  const walk = (ops) => {
    for (const op of ops || []) {
      if (!op || !op.k) continue
      out[op.k] = (out[op.k] || 0) + 1
      if (op.k === 'create' && op.family) families.add(op.family)
      if (op.k === 'loop') walk(op.body)
    }
  }
  walk(program && program.ops)
  return { kinds: out, families }
}

const uniq = (xs) => [...new Set(xs.filter((x) => typeof x === 'string' && x))]

/**
 * What this translation's object program lost, and whether any of it removes.
 *
 * ⛔ THE COUNTS ARE THE OBJECT PASS'S OWN — `droppedOps` and `attemptedOps` —
 * never a recount here. They are the same unit by construction (see the note on
 * `attemptedOps` in `pine.js`).
 *
 * @param {object|null} t a `translatePine` result
 * @returns {{verdict: 'clean'|'partial'|'removes', dropped: number, attempted: number,
 *   removes: {what: string, key: string, why: string}[], readerNames: string[]}}
 */
export function assessObjectLoss(t) {
  const d = (t && t.objectDiagnostics) || {}
  const dropped = Number.isInteger(d.droppedOps) ? d.droppedOps : 0
  const attempted = Number.isInteger(d.attemptedOps) ? d.attemptedOps : 0
  const reasons = (d.dropReasons && typeof d.dropReasons === 'object') ? d.dropReasons : {}
  const readerNames = uniq([
    ...(d.loopBlockedCalls || []),
    ...(d.unsupported || []),
    ...(d.outOfScope || []).map((ns) => `${ns}.*`),
  ]).sort()
  const unconv = (d.unconvertedLoopOps && typeof d.unconvertedLoopOps === 'object')
    ? d.unconvertedLoopOps : {}
  const loopLists = Object.keys(unconv).some((k) => k.startsWith('coll_'))
  const unconvFn = (d.unconvertedFnOps && typeof d.unconvertedFnOps === 'object')
    ? d.unconvertedFnOps : {}
  const fnLists = Object.keys(unconvFn).some((k) => k.startsWith('coll_'))
  // ⭐ `lostRemovals` is the pass's own record of every lost `*.delete` /
  // `table.clear` and whether its target could hold anything DRAWN. A key with no
  // record at all is read as reaching — a translation from before the record
  // existed, or a key this door did not expect, is never waved through.
  const lost = Array.isArray(d.lostRemovals) ? d.lostRemovals : null
  const reaches = (key) => {
    if (!lost) return true
    const mine = lost.filter((r) => r && r.via === key)
    return mine.length === 0 ? null : mine.some((r) => r.reaches !== false)
  }

  const found = [] // {cls, key, why, what}
  for (const key of Object.keys(reasons).sort()) {
    if (!(reasons[key] > 0)) continue
    let { cls, why } = classifyDropKey(key)
    if (cls === LOSS.LOOP || cls === LOSS.BODY) {
      // A loop dropped whole, or a refused call to a drawing function, is
      // classified by what its body would have removed. ⛔ A missing record reads
      // as reaching (see `reaches`), so a translation from before the record
      // existed is never waved through.
      const r = reaches(key)
      if (r === true) {
        cls = LOSS.REMOVES
        why = `${why} — and that body deletes or clears something this chart draws`
      } else {
        const lists = cls === LOSS.LOOP ? loopLists : fnLists
        cls = lists ? LOSS.LIST : LOSS.PARTIAL
      }
    } else if (cls === LOSS.REMOVES && classifyDropKey(key) !== UNCLASSIFIED
               && reaches(key) === false) {
      // ⛔ A LOST REMOVAL OF SOMETHING NEVER DRAWN LEAVES NOTHING EXTRA ON SCREEN.
      // The program draws nothing of the family it would remove, so the picture
      // is smaller, not wrong — PARTIAL, and said so.
      cls = LOSS.PARTIAL
      why = `${why}, except that nothing of that kind is drawn here at all`
    }
    found.push({ cls, key, why, what: whatOf(key, cls) })
  }
  const carried = carriedKinds(t && t.objects)
  for (const name of readerNames) {
    let { cls, why } = classifyReaderName(name)
    // ⭐ THE SAME FAMILY TEST THE PASS APPLIES TO ITS OWN LOST REMOVALS: a
    // `box.delete` the reader never carried removes nothing from a program that
    // draws no box.
    // ⛔ `object.<m>` NAMES NO FAMILY — the tokens could not say which (a
    // chained `(c ? a : b).delete()`, a loop body's handle-form removal). An
    // unnamed family reaches, the same fail-closed rule as `lostRemovals`'
    // `reaches: !family`; "no `object` is drawn" would be true of every chart.
    const fam = name.split('.')[0]
    if (cls === LOSS.REMOVES && fam !== 'object' && !carried.families.has(fam)) {
      cls = LOSS.PARTIAL
      why = `${why}, except that no ${fam} is drawn here at all`
    }
    found.push({ cls, key: name, why, what: whatOf(name, cls) })
  }
  const scriptRemoves = !!(carried.kinds.delete || carried.kinds.clearcells || carried.kinds.clear)
    || found.some((f) => f.cls === LOSS.REMOVES)
  const removes = []
  for (const f of found) {
    if (f.cls === LOSS.REMOVES || (f.cls === LOSS.LIST && scriptRemoves)) {
      removes.push({ what: f.cls === LOSS.LIST ? 'list' : f.what, key: f.key, why: f.why })
    }
  }
  // ⭐ W9 D8 ("show the refusal") — how many of the dropped steps were withheld because a
  // `strategy.*` value reaches them (`strategy:<kind>`), so the note can say WHY instead of
  // "aren't supported yet". Never more than `dropped`: one unit, the pass's own counts.
  const strategyDropped = Math.min(dropped, Object.keys(reasons)
    .filter((k) => k.startsWith('strategy:') && reasons[k] > 0)
    .reduce((n, k) => n + reasons[k], 0))
  const strategyRemoves = removes.some((r) => r.key.startsWith('strategy:'))
  // ⭐ r2 — A FAMILY WITHHELD WHOLE: one the script keeps in a list this chart
  // cannot follow (`removalWithheldFamilies`, `fieldCreateFamilies`) and of which
  // NOTHING is drawn. The note names it, rather than leaving the member to infer
  // it from a list of call names.
  const hiddenFamilies = uniq([...(d.removalWithheldFamilies || []), ...(d.fieldCreateFamilies || [])])
    .filter((f) => !carried.families.has(f)).sort()
  const lossy = dropped > 0 || readerNames.length > 0
  return {
    verdict: removes.length ? 'removes' : lossy ? 'partial' : 'clean',
    dropped,
    attempted,
    removes,
    readerNames,
    ...(strategyDropped > 0 ? { strategyDropped } : {}),
    ...(strategyRemoves ? { strategyRemoves } : {}),
    ...(hiddenFamilies.length ? { hiddenFamilies } : {}),
  }
}

function whatOf(key, cls) {
  if (cls !== LOSS.REMOVES) return 'list'
  if (/clear/.test(key)) return 'clear'
  if (/loop/.test(key)) return 'loop'
  if (/^fn:/.test(key)) return 'fn'
  return 'delete'
}

/** The member's words for what was lost that removes. */
const WHAT_WORDS = Object.freeze({
  delete: 'a delete',
  clear: 'a table clear',
  loop: 'a loop that deletes',
  fn: 'a function of its own that deletes',
  list: 'a change to the list it deletes from',
})

function whatPhrase(loss) {
  const kinds = uniq((loss.removes || []).map((r) => r.what))
  const order = ['delete', 'clear', 'loop', 'fn', 'list']
  const words = order.filter((k) => kinds.includes(k)).map((k) => WHAT_WORDS[k])
  if (!words.length) return 'a step that removes drawings'
  if (words.length === 1) return words[0]
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** ⭐ W9 D8 — the member's words for what a `strategy.*` value is. Plain English, no
 *  guard name. ⛔ STRAT-NOTE r1 (B1, coordinator ruling): NOT "the strategy's results" — the
 *  taint source (`strategyTaint.js::isStrategyStateWord`) also covers settings and helpers that
 *  are not results (`strategy.initial_capital`, `strategy.convert_to_account/_symbol`,
 *  `strategy.default_entry_qty`), so the words name where the value comes from instead. */
export const STRATEGY_VALUES_WORDS = "values from the strategy's backtest (such as its position, trades, equity or settings)"
/** …and why none of them has a value here: the backtest is not run on this chart. */
const STRATEGY_NOT_RUN = "which this chart doesn't run yet"

/** ⭐ W9 D8 — said after a removal sentence when a removal it lost is one a strategy value
 *  decides (`strategy:delete` / `strategy:clear`), so the member reads the reason. */
export const STRATEGY_REMOVAL_SENTENCE = "Some of what it removes is decided by values from the strategy's "
  + `backtest, ${STRATEGY_NOT_RUN}.`

const withStrategyRemoval = (sentence, loss) => (loss && loss.strategyRemoves
  ? `${sentence} ${STRATEGY_REMOVAL_SENTENCE}` : sentence)

/** ⛔ THE GUARD A REFUSAL FOR A LOST REMOVAL CARRIES. */
export const OBJECT_REMOVAL_GUARD = 'pine:object-removal-lost'

/** The refusal a script gets when its drawing is ALL it has and that drawing
 *  lost a removal. */
export function objectRemovalRefusal(loss) {
  return withStrategyRemoval('This script\'s drawing can\'t be shown yet. It removes drawings as it runs, '
    + `and this chart can't follow part of that (${whatPhrase(loss)}), so drawing the rest `
    + 'would leave lines, labels, boxes or table cells on screen that TradingView would '
    + 'have removed.', loss)
}

/** The name every drawing disclosure is listed under. */
export const DRAWING_NOTE_NAME = 'Drawings'

/**
 * ⭐⭐ P2b — THE DRAWING NOTE WITH WHAT THIS CHART COULD NOT PLACE COUNTED IN IT.
 *
 * `objectLossNote` counts what the translation lost; the render state can drop an
 * object the program holds (a coordinate naming no bar on this chart, a text the run
 * withheld — `objectRenderNotice.js`). Both are drawing the member does not see, so
 * both are in ONE note: the translation's sentence, with this chart's count added,
 * or — where the translation lost nothing — a sentence of its own, so a drawing is
 * never "clean" while the chart draws less than the program holds.
 *
 * @param {{name: string, note: string}|null} note the document's drawing note, if any
 * @param {{dropped: number, held: number}|null} drops this chart's render drops
 * @returns {{name: string, note: string}|null}
 */
export function withRenderDrops(note, drops) {
  const n = drops && Number.isInteger(drops.dropped) ? drops.dropped : 0
  const fams = drops && Array.isArray(drops.families) ? drops.families : []
  const all = drops && Array.isArray(drops.familiesAll) ? drops.familiesAll : []
  // ⭐ DIV-3 r2 — a family the run withheld whole by a named guard, with its own sentence
  // ⭐ OZ — several families can share one sentence (`notShownSentence` names them
  // all), so a sentence is said once.
  const why = drops && drops.why && typeof drops.why === 'object'
    ? [...new Set(Object.keys(drops.why).sort().map((f) => drops.why[f]).filter((t) => typeof t === 'string' && t))] : []
  if (n <= 0 && !fams.length && !all.length && !why.length) return note || null
  const parts = note ? [note.note] : []
  if (n > 0) {
    const of = drops.held >= n ? drops.held : n
    const sentence = `${n} of the ${of} drawings this script holds on this chart could not be placed `
      + '(a coordinate with no bar on this chart, or a text this chart could not compute), so '
      + (note ? 'they are not drawn either.' : 'what it draws is incomplete.')
    parts.push(note ? `On this chart, ${sentence}` : sentence)
  }
  // ⭐ W-C22-DEL — a family withheld whole, by name (`collectorFamiliesSentence`).
  if (all.length) parts.push(collectorFamiliesSentence(all, { whole: true }))
  if (fams.length) parts.push(collectorFamiliesSentence(fams))
  for (const t of why) parts.push(t)
  return { name: (note && note.name) || DRAWING_NOTE_NAME, note: parts.join(' ') }
}

/** ⭐⭐ W-C22-DEL — the member's sentence for a family the run withheld WHOLE because
 *  TradingView's object limit may have removed some of it (`objectRuntime.js`,
 *  `withheldBy['objects:collector']`): this chart could not tell whether the script
 *  drew on some bars, so it cannot know how many TradingView made, nor which old
 *  ones TradingView has since removed to stay under the script's limit. */
export function collectorFamiliesSentence(families, { whole = false } = {}) {
  const plural = (f) => (f === 'linefill' ? 'fills between lines' : f === 'box' ? 'boxes' : `${f}s`)
  const join = (fs) => (fs.length === 1 ? fs[0] : `${fs.slice(0, -1).join(', ')} and ${fs[fs.length - 1]}`)
  const list = join((families || []).map(plural))
  if (whole) {
    return `No ${list} are shown on this chart: the script draws some that this chart can't follow, `
      + "so it can't know which ones TradingView has already removed to stay within the script's limit."
  }
  return `Older ${list} are held back on this chart: on some bars this chart can't tell whether the `
    + "script drew one, so it can't know which older ones TradingView has already removed to "
    + "stay within the script's limit. The newest ones are drawn."
}

/**
 * The disclosure a member sees in the pane, or `null` for a clean program.
 *
 * @param {ReturnType<typeof assessObjectLoss>} loss
 * @param {{withheld?: boolean}} [opts] `withheld`: the drawing was not drawn at all
 *   (a plotting script whose object program lost a removal).
 * @returns {{name: string, note: string}|null}  ⛔ the SAME shape every other
 *   disclosure has, so `meta.disclosures` round-trips it unchanged.
 */
export function objectLossNote(loss, opts = {}) {
  if (!loss || loss.verdict === 'clean') return null
  if (opts.withheld) {
    return {
      name: DRAWING_NOTE_NAME,
      note: withStrategyRemoval('This script\'s plots are shown, but its drawings are not. It removes drawings '
        + `as it runs, and this chart can't follow part of that (${whatPhrase(loss)}), so `
        + 'showing them would leave lines, labels, boxes or table cells on screen that '
        + 'TradingView would have removed.', loss),
    }
  }
  const parts = []
  if (loss.dropped > 0) {
    // ⛔ THE OWNER'S SENTENCE, WITH BOTH COUNTS IN ONE UNIT: `droppedOps` of
    // `attemptedOps`, and what M is, said in the same note.
    // ⭐ W9 D8 — when EVERY lost step was withheld because a strategy value reaches it, the
    // sentence gives that reason in place of "aren't supported yet"; when only some were, the
    // count sentence stands and one clause says how many of those are withheld for that reason.
    const s = Number.isInteger(loss.strategyDropped) ? Math.min(loss.strategyDropped, loss.dropped) : 0
    const why = s === loss.dropped
      ? `${s === 1 ? 'reads' : 'read'} ${STRATEGY_VALUES_WORDS}, ${STRATEGY_NOT_RUN}`
      : "aren't supported yet"
    parts.push(`${loss.dropped} of ${loss.attempted} drawing elements in this script ${why}, `
      + 'so what it draws is incomplete. (The '
      + `${loss.attempted} are every drawing step this chart tried to carry: each line, label, `
      + 'box or table created, changed or written to, each change to a list of them, '
      + 'each loop, and each call to a drawing function of the script\'s own that could '
      + 'not be followed.)')
    if (s > 0 && s < loss.dropped) {
      parts.push(`${s} of those ${s === 1 ? 'is withheld because it reads' : 'are withheld because they read'} `
        + `${STRATEGY_VALUES_WORDS}, ${STRATEGY_NOT_RUN}.`)
    }
  }
  if (loss.readerNames.length) {
    const names = loss.readerNames.map((n) => `\`${n}\``).join(', ')
    parts.push(loss.dropped > 0
      ? `It also uses ${names}, which this chart doesn't draw yet.`
      : `This script uses ${names}, which this chart doesn't draw yet, so what it draws is incomplete.`)
  }
  if (loss.hiddenFamilies && loss.hiddenFamilies.length) parts.push(hiddenFamiliesSentence(loss.hiddenFamilies))
  return { name: DRAWING_NOTE_NAME, note: parts.join(' ') }
}

/** ⭐ r2 — the member's sentence for a family withheld whole: `No box or line is
 *  shown: …`. One clause, the families in the reader's words. Wording: coordinator
 *  ruling 2026-11-08 (it fires for objects outside lists and for user-type fields
 *  too, and implies no removal). */
export function hiddenFamiliesSentence(families) {
  const fs = (families || []).map((f) => (f === 'linefill' ? 'fill between lines' : f === 'table' ? 'table' : f))
  const list = fs.length === 1 ? fs[0] : `${fs.slice(0, -1).join(', ')} or ${fs[fs.length - 1]}`
  return `No ${list} is shown: the script keeps some of them where this chart can't follow yet `
    + '(in a list or in a field of its own type), so which ones TradingView would show, and where, '
    + "can't be known."
}

/** ⭐⭐ OZ — WHY A FAMILY THIS CHART DREW NONE OF IS EMPTY, WHEN THE REASON IS THE
 *  ENGINE'S OWN. A drawing that comes out empty with no word reads as "the script
 *  draws nothing here", which is a confident claim the engine cannot make when it
 *  dropped or withheld the very steps that make those drawings.
 *  The causes, each named by a guard on the run (`withheldBy`):
 *    · `objects:not-carried`    — the translation lost a create of the family
 *                                 (`program.lostCreates`, host lane);
 *    · `objects:not-computable` — every create of it this run reached was withheld,
 *                                 or every object it made carries a value it could
 *                                 not compute (C17, host lane);
 *    · `objects:unmeasured`     — the run withheld the family whole by a rule of its
 *                                 own whose TradingView result is not measured
 *                                 (`runtime/objectStore.js` `withhold`, runtime lane). */
export const NOT_SHOWN = Object.freeze({
  NOT_CARRIED: 'objects:not-carried',
  NOT_COMPUTABLE: 'objects:not-computable',
  UNMEASURED: 'objects:unmeasured',
  // r1 — the runtime store's own two named reasons, each with its own sentence
  ENUM_NA: 'objects:enum-na',
  COLLECTOR_HELD: 'objects:collector-held',
  // C22 merge — a BOX in an array IS collected (witnessed, sonarlab-order-blocks-spy-1d,
  // `objectPool.js` C7); only a map, a matrix or a field of the script's own type is not
  COLLECTOR_HELD_BOX: 'objects:collector-held-box',
})

const NOT_SHOWN_BECAUSE = Object.freeze({
  [NOT_SHOWN.NOT_CARRIED]: "the script makes them in steps this chart can't follow yet, so none are "
    + 'drawn here, though TradingView may draw some.',
  [NOT_SHOWN.NOT_COMPUTABLE]: "whether and where the script draws them depends on values this chart can't "
    + 'work out here, so none are drawn rather than a guess.',
  [NOT_SHOWN.UNMEASURED]: 'the script handles them in a way whose result on TradingView has not been '
    + 'measured yet, so none are drawn rather than a guess.',
  [NOT_SHOWN.ENUM_NA]: "the script can leave a drawing's style, size or position empty, and how TradingView "
    + 'draws that has not been measured yet, so none are drawn rather than a guess.',
  [NOT_SHOWN.COLLECTOR_HELD]: 'TradingView removes the oldest ones once the script holds more than its limit, '
    + 'and which ones it spares when the script keeps them in an array, a map, a matrix or a field of its own '
    + 'type has not been measured yet, so none are drawn rather than a guess.',
  [NOT_SHOWN.COLLECTOR_HELD_BOX]: 'TradingView removes the oldest ones once the script holds more than its limit, '
    + 'and which ones it spares when the script keeps them in a map, a matrix or a field of its own type has '
    + 'not been measured yet, so none are drawn rather than a guess.',
})

/** The member's sentence for families shown as NONE for one engine-side cause. */
export function notShownSentence(families, cause) {
  const because = NOT_SHOWN_BECAUSE[cause]
  if (!because || !Array.isArray(families) || !families.length) return null
  const fs = families.map((f) => (f === 'linefill' ? 'fill between lines' : f))
  const list = fs.length === 1 ? fs[0] : `${fs.slice(0, -1).join(', ')} or ${fs[fs.length - 1]}`
  return `No ${list} is shown on this chart: ${because}`
}

/** ⭐⭐ OZ — THE RUNTIME LANE'S WITHHELD FAMILIES, AS THE MEMBER'S SENTENCES. The run
 *  (`runtime/objectStore.js`) withholds a family WHOLE by name (`withheld`: family →
 *  the engine's reason) and draws none of it; until now that name stopped at the
 *  layer and the member saw the family vanish. Each reason the store gives is said
 *  in plain words of its own (r1, review): the merged-head rewrite in the same words
 *  the host lane says, an `na` style/size/position (`ENUM_NA_SENTENCE`) and the
 *  collector reaching an object held in a list as their own sentences, any other in
 *  ONE sentence (`NOT_SHOWN.UNMEASURED`). Families sharing a reason share a sentence.
 *  Answers family → sentence, the binder's `why`. */
export function runtimeWithheldWhy(withheld) {
  if (!withheld || typeof withheld !== 'object') return null
  const out = {}
  const byCause = new Map()
  for (const fam of Object.keys(withheld).sort()) {
    const why = withheld[fam]
    if (why === MERGED_HEAD_REWRITE_SENTENCE) { out[fam] = why; continue }
    const cause = runtimeWithheldCause(why, fam)
    if (!byCause.has(cause)) byCause.set(cause, [])
    byCause.get(cause).push(fam)
  }
  for (const [cause, fams] of byCause) {
    const t = notShownSentence(fams, cause)
    for (const fam of fams) out[fam] = t
  }
  return Object.keys(out).length ? out : null
}

/** The guard a runtime store reason is said under (`NOT_SHOWN`); the merged-head
 *  rewrite keeps the host's own guard. */
export function runtimeWithheldCause(why, fam = null) {
  if (why === MERGED_HEAD_REWRITE_SENTENCE) return 'table:merged-head-rewrite'
  if (why === ENUM_NA_SENTENCE) return NOT_SHOWN.ENUM_NA
  // ⭐ C22 merge — the store withholds a box only for a map / matrix / UDT holder
  // (`runtime/objectStore.js::collect`): its sentence never says "an array"
  if (typeof why === 'string' && COLLECTOR_HELD_RE.test(why)) {
    return fam === 'box' ? NOT_SHOWN.COLLECTOR_HELD_BOX : NOT_SHOWN.COLLECTOR_HELD
  }
  return NOT_SHOWN.UNMEASURED
}

/** The runtime store's collector reason (`runtime/objectStore.js::collect`). */
export const COLLECTOR_HELD_RE = /^TradingView's collector deletes the oldest /

/** ⭐⭐ OZ r1 — A RUN THAT STOPPED DRAWS NOTHING, AND SAYS WHY. The host run stops on
 *  a Pine runtime error it models (C9: TradingView stops the script and draws none);
 *  the runtime run stops on a step no capture settles (C40, `OBJECT_UNWITNESSED`) or
 *  withholds its drawings whole (`WITHHELD`). Each keeps its own reason; here it is
 *  said to the member, with the code marks taken out. `kind`: `error` | `unmeasured`
 *  | `withheld`. Keyed `*` in the binder's `why` (every family). */
export const STOPPED_KEY = '*'

/** ⭐ OZ r2 (N-e) — a stop reason in the member's words: no code marks, no em dash, no
 *  "captured" (said as "measured"), and a bar NUMBER only on a chart that starts at the
 *  symbol's listing: elsewhere `bar_index` is this chart's count, not TradingView's, so
 *  the bar is "a bar of this chart". Pine call names stay: they are the script's own. */
export function plainStopReason(reason, fromListing = false) {
  let t = String(reason || '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
  t = t.replace(/\s+[—–]\s+/g, ', ')
  t = t.replace(/\bis not captured\b/g, 'has not been measured yet')
    .replace(/\bnot (yet )?captured\b/g, 'not measured yet')
  if (!fromListing) t = t.replace(/\bon bar \d+\b/g, 'on a bar of this chart')
  return t.replace(/[.\s]+$/, '')
}
export function stoppedRunSentence(reason, kind, { fromListing = false } = {}) {
  const plain = plainStopReason(reason, fromListing)
  if (!plain) return null
  if (kind === 'error') {
    return `None of this script's drawings are shown on this chart: it stops with an error here (${plain}), `
      + 'and TradingView draws none of them then either.'
  }
  if (kind === 'unmeasured') {
    return "None of this script's drawings are shown on this chart: it reaches a step whose result on "
      + `TradingView has not been measured yet (${plain}), so none are drawn rather than a guess.`
  }
  return `None of this script's drawings are shown on this chart: ${plain}.`
}
