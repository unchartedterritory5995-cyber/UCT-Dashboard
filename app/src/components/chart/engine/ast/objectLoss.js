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
  'cell:target': C(LOSS.PARTIAL, 'a table cell write that addresses no readable table — a missing cell'),
  'cell:address': C(LOSS.PARTIAL, 'a table cell write whose row/column cannot be read — a missing cell'),
  'cell:text': C(LOSS.PARTIAL,
    'a table cell whose text cannot be read — dropped whole, never written blank, so a missing cell'),
  'cellpatch:target': C(LOSS.PARTIAL, 'a cell setter that addresses no readable table — a missing style'),
  'cellpatch:address': C(LOSS.PARTIAL, 'a cell setter whose row/column cannot be read — a missing style'),
  'coll:unknown': C(LOSS.LIST, 'a change to an object list this chart does not know'),
  'coll:push': C(LOSS.LIST, 'an object never entered into the list a later delete reads'),
  'coll:set': C(LOSS.LIST, 'a list slot never overwritten, so a later delete reads the old handle'),
  'coll:remove': C(LOSS.LIST, 'a handle never taken out of the list, so a later delete hits it twice'),
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
  coll_set: C(LOSS.LIST, 'a list set whose condition cannot be read'),
  coll_remove: C(LOSS.LIST, 'a list remove whose condition cannot be read'),
  coll_pop: C(LOSS.LIST, 'a list pop whose condition cannot be read'),
  coll_shift: C(LOSS.LIST, 'a list shift whose condition cannot be read'),
  coll_clear: C(LOSS.LIST, 'a list clear whose condition cannot be read'),
  copy: C(LOSS.LIST,
    "a returned handle whose condition cannot be read — the caller's variable keeps the previous object for a later delete"),
  reset: C(LOSS.LIST,
    "a `x := box(na)` whose condition cannot be read — the variable keeps the object Pine let go of, for a later delete"),
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
    const fam = name.split('.')[0]
    if (cls === LOSS.REMOVES && !carried.families.has(fam)) {
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
  const lossy = dropped > 0 || readerNames.length > 0
  return {
    verdict: removes.length ? 'removes' : lossy ? 'partial' : 'clean',
    dropped,
    attempted,
    removes,
    readerNames,
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

/** ⛔ THE GUARD A REFUSAL FOR A LOST REMOVAL CARRIES. */
export const OBJECT_REMOVAL_GUARD = 'pine:object-removal-lost'

/** The refusal a script gets when its drawing is ALL it has and that drawing
 *  lost a removal. */
export function objectRemovalRefusal(loss) {
  return 'This script\'s drawing can\'t be shown yet. It removes drawings as it runs, '
    + `and this chart can't follow part of that (${whatPhrase(loss)}), so drawing the rest `
    + 'would leave lines, labels, boxes or table cells on screen that TradingView would '
    + 'have removed.'
}

/** The name every drawing disclosure is listed under. */
export const DRAWING_NOTE_NAME = 'Drawings'

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
      note: 'This script\'s plots are shown, but its drawings are not. It removes drawings '
        + `as it runs, and this chart can't follow part of that (${whatPhrase(loss)}), so `
        + 'showing them would leave lines, labels, boxes or table cells on screen that '
        + 'TradingView would have removed.',
    }
  }
  const parts = []
  if (loss.dropped > 0) {
    // ⛔ THE OWNER'S SENTENCE, WITH BOTH COUNTS IN ONE UNIT: `droppedOps` of
    // `attemptedOps`, and what M is, said in the same note.
    parts.push(`${loss.dropped} of ${loss.attempted} drawing elements in this script aren't `
      + 'supported yet, so what it draws is incomplete. (The '
      + `${loss.attempted} are every drawing step this chart tried to carry: each line, label, `
      + 'box or table created, changed or written to, each change to a list of them, '
      + 'each loop, and each call to a drawing function of the script\'s own that could '
      + 'not be followed.)')
  }
  if (loss.readerNames.length) {
    const names = loss.readerNames.map((n) => `\`${n}\``).join(', ')
    parts.push(loss.dropped > 0
      ? `It also uses ${names}, which this chart doesn't draw yet.`
      : `This script uses ${names}, which this chart doesn't draw yet, so what it draws is incomplete.`)
  }
  return { name: DRAWING_NOTE_NAME, note: parts.join(' ') }
}
