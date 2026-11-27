// app/scripts/gen-vm-taint.mjs
//
// ─── ⭐⭐ START-TAINT PART 2 — THE TAINT LOOP IS GENERATED FROM THE VM'S OWN LOOP ────────────────────────────────────
//
// `docs/pine/START-TAINT.md`: an off-listing run carries a tag (C / O / T) beside every value, and the listing run
// (the one members are served) must not pay for it. So the taint run is a SEPARATE function, chosen once per run,
// never a flag tested per opcode. A hand-written second copy of `vm.js::execute` (about 1,600 lines) would drift from
// it the first time somebody fixed a value rule in one and not the other, and the taint run would then compute a
// DIFFERENT value from the run it is meant to vouch for.
//
// So the copy is MADE, not written: this script reads `vm.js`, takes `execute` as it stands, renames it
// `executeTainted`, and inserts tag statements at fixed places:
//   * after EVERY `case N /* OP.X */:` label, the opcode's tag rule from `TAG_RULES` below (run before the value code,
//     so it sees the operands where the value code will find them). ⛔ A case with no rule is a generation error:
//     a new opcode cannot reach the taint loop without somebody deciding its tag. A rule for no case is one too.
//   * at five anchors (`ANCHORS`): the tag arrays before the bar loop, the per-bar reset, the implicit-flow region
//     pop at each fetch, the history rings' tag commit, and the tags in the result. Each anchor must occur EXACTLY
//     once in `execute`, or generation stops by name.
// The tag ALGEBRA (`tAdd`, `tCmp`, ...) is hand-written and railed in `runtime/taintTags.js`; the rules here only say
// which opcode applies which.
//
// ⛔ `vmTaintGenerated.test.js` regenerates in memory and requires `runtime/vmTaint.js` to equal it: a change to
// `vm.js` lands with its regenerated twin, in the same commit. Regenerate:
//     node app/scripts/gen-vm-taint.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const VM_PATH = path.resolve(HERE, '../src/components/chart/engine/runtime/vm.js')
export const OUT_PATH = path.resolve(HERE, '../src/components/chart/engine/runtime/vmTaint.js')

/** Each opcode's tag statement(s), keyed by the name in the case label. In scope: the value loop's own variables
 *  (`sp` and `pc` as the case finds them, `a`, `b`, `bar`, the frame bases, `depth`, `committed`, `stack`, ...) and
 *  the tag state the setup anchor declares (`ts` stack, `tl` locals, `tp` persist, `th` rings, `theld` held cells,
 *  `outT` outputs, `iterT` iteration buffers, `colTag`, `rTop` the implicit-flow depth, `TS` the state `taintBranch` is handed). Tags are
 *  C 0, O 1, T 2. Every multi-statement rule is braced, so its names never meet the case's own. */
export const TAG_RULES = Object.freeze({
  // ── sources: constants, the bar's own prices and clock are clean ──
  CONST: 'ts[sp] = 0;',
  READ_SERIES: 'ts[sp] = 0;',
  READ_CLOCK: 'ts[sp] = 0;',
  SESSION: 'ts[sp] = 0;',
  READ_COLUMN: 'ts[sp] = colTag[a];',
  // ── source 2: a history read before the run's first bar is T (another start holds that bar) ──
  READ_SERIES_HIST: 'ts[sp] = bar - b >= 0 ? 0 : 2;',
  READ_HIST: 'ts[sp] = bar - b >= 0 ? colTag[a] : 2;',
  // a dynamic offset: an O or T offset is T (`close[bar_index]` reaches the run's first bar); a C offset reads as
  // the value code does (`na` offset = this bar; a negative or fractional one is a deterministic `na`)
  READ_HIST_DYN: '{ const _r = stack[sp - 1]; const _n = Number.isNaN(_r) ? 0 : _r; '
    + 'ts[sp - 1] = ts[sp - 1] !== 0 ? 2 : !(Number.isInteger(_n) && _n >= 0) ? 0 : bar - _n >= 0 ? colTag[a] : 2 }',
  READ_SERIES_HIST_DYN: '{ const _r = stack[sp - 1]; const _n = Number.isNaN(_r) ? 0 : _r; '
    + 'ts[sp - 1] = ts[sp - 1] !== 0 ? 2 : !(Number.isInteger(_n) && _n >= 0) ? 0 : bar - _n >= 0 ? 0 : 2 }',
  READ_HIST_SLOT: 'ts[sp] = b > committed ? 2 : th[histOffset[historyBase + a] + ((committed - b) % histPlan[historyBase + a].depth)];',
  READ_HIST_SLOT_DYN: '{ const _r = stack[sp - 1]; const _n = Number.isNaN(_r) ? 0 : _r; let _g; '
    + 'if (!Number.isInteger(_n) || _n < 0) _g = 0; else if (_n === 0) _g = ts[sp - 2]; else if (_n > committed) _g = 2; '
    + 'else { const _hi = historyBase + a; const _d = histPlan[_hi].depth; _g = _n > _d ? 2 : th[histOffset[_hi] + ((committed - _n) % _d)] } '
    + 'ts[sp - 2] = ts[sp - 1] !== 0 ? 2 : _g }',
  // ── arithmetic: the O rules (`taintTags.js`) ──
  ADD: 'ts[sp - 2] = tAdd(ts[sp - 2], ts[sp - 1]);',
  SUB: 'ts[sp - 2] = tSub(ts[sp - 2], ts[sp - 1]);',
  MUL: 'ts[sp - 2] = tStrict(ts[sp - 2], ts[sp - 1]);',
  DIV: 'ts[sp - 2] = tStrict(ts[sp - 2], ts[sp - 1]);',
  NEG: 'ts[sp - 1] = tVal(ts[sp - 1]);',
  CONCAT: 'ts[sp - 2] = tStrict(ts[sp - 2], ts[sp - 1]);',
  LT: 'ts[sp - 2] = tCmp(ts[sp - 2], ts[sp - 1]);',
  GT: 'ts[sp - 2] = tCmp(ts[sp - 2], ts[sp - 1]);',
  LE: 'ts[sp - 2] = tCmp(ts[sp - 2], ts[sp - 1]);',
  GE: 'ts[sp - 2] = tCmp(ts[sp - 2], ts[sp - 1]);',
  EQ: 'ts[sp - 2] = tCmp(ts[sp - 2], ts[sp - 1]);',
  NE: 'ts[sp - 2] = tCmp(ts[sp - 2], ts[sp - 1]);',
  AND: 'ts[sp - 2] = tStrict(ts[sp - 2], ts[sp - 1]);',
  OR: 'ts[sp - 2] = tStrict(ts[sp - 2], ts[sp - 1]);',
  NOT: 'ts[sp - 1] = tVal(ts[sp - 1]);',
  // the picked arm's tag, picked by the value code's own TERNARY; a non-clean condition is T
  SELECT: '{ const _p = TERNARY(stack[sp - 3], 1, 2); '
    + 'ts[sp - 3] = ts[sp - 3] !== 0 ? 2 : _p === 1 ? ts[sp - 2] : _p === 2 ? ts[sp - 1] : 0 }',
  // ── moves: a load copies the slot's tag; a STORE OVERWRITES it (T under a tainted branch) ──
  LOAD_LOCAL: 'ts[sp] = tl[localsBase + a];',
  STORE_LOCAL: 'tl[localsBase + a] = rTop > 0 ? 2 : ts[sp - 1];',
  LOAD_PERSIST: 'ts[sp] = tp[persistBase + a];',
  STORE_PERSIST: 'tp[persistBase + a] = rTop > 0 ? 2 : ts[sp - 1];',
  LOAD_GLOBAL_LOCAL: 'ts[sp] = tl[a];',
  LOAD_GLOBAL_PERSIST: 'ts[sp] = tp[a];',
  // ── control: a T condition taints the branch's whole write set and opens a region until its join ──
  JUMP: '',
  JUMP_IF_FALSE: 'if (ts[sp - 1] !== 0) { rTop = taintBranch(TS, pc - 1, localsBase, persistBase, bar, depth, rTop); rJT = rTop > 0 ? rJoin[rTop - 1] : -3 }',
  // source 1: whether a `var` initialiser runs here is start-dependent (another start ran it on ITS first bar)
  JUMP_IF_INIT: 'if (!initialised[persistBase + a]) { rTop = taintBranch(TS, pc - 1, localsBase, persistBase, bar, depth, rTop); rJT = rTop > 0 ? rJoin[rTop - 1] : -3 }',
  CALL: '{ const _f = program.functions[a]; const _nb = localsTop; '
    + 'for (let _k = 0; _k < _f.params; _k += 1) tl[_nb + _k] = ts[sp - _f.params + _k]; '
    + 'tl.fill(0, _nb + _f.params, _nb + _f.frameSize) }',
  // the frame's own regions end here; the site's held cells take the slots' tags (T if the CALL itself was steered)
  RET: '{ while (rTop > 0 && rDepth[rTop - 1] >= depth) rTop -= 1; rJT = rTop > 0 ? rJoin[rTop - 1] : -3; const _rf = program.functions[frFn[depth - 1]]; '
    + 'for (let _k = 0; _k < _rf.historyCount; _k += 1) theld[historyBase + _k] = rTop > 0 ? 2 '
    + ': (_rf.historyPersist[_k] ? tp[persistBase + _rf.historySlots[_k]] : tl[localsBase + _rf.historySlots[_k]]) }',
  // ── calls over values: clean only over clean values (a drawing asked `na(h)` of is the store's state: T) ──
  POINTWISE: '{ let _g = tRange(ts, sp - b, sp); if (_g === 0 && store && b === 1 && typeof stack[sp - 1] === \'object\') _g = 2; '
    + 'ts[sp - b] = _g }',
  COLOUR: 'ts[sp - b] = tRange(ts, sp - b, sp);',
  TEXT: 'ts[sp - b] = tRange(ts, sp - b, sp);',
  // ── fail closed until their own parts: drawings (4), the broker (5), collections and records (4), built-in state
  // (3), requests (5) answer T ──
  OBJECT: 'if (objectOps[a].returns !== \'void\') ts[sp - b] = 2;',
  BROKER: 'if (brokerOps[a].returns !== \'void\') ts[sp - b] = 2;',
  ARRAY: 'if (ARRAY_FNS[program.arrayOps[a].fn].returns !== \'void\') ts[sp - b] = 2;',
  RECORD: 'ts[sp - b] = 2;',
  FIELD_GET: 'ts[sp - 1] = 2;',
  FIELD_SET: '',
  WINDOW: 'ts[sp - (winPlan[windowBase + a].dynamic === true ? 2 : 1)] = 2;',
  CARRIED: 'ts[sp - 1] = 2;',
  CARRIED2: 'ts[sp - (car2Spec[carried2Base + a].inputs === 3 ? 3 : 2)] = 2;',
  REQUEST: 'for (let _k = 0; _k < b; _k += 1) ts[sp - 1 + _k] = 2;',
  // ── outputs: an O plotted is T (ruling 2); an emit under a tainted branch taints that bar ──
  EMIT: 'outT[a][bar] = rTop > 0 ? 2 : tVal(ts[sp - 1]);',
  // an iteration buffer keeps O (a drawing's x, part 4); a tainted index may have written any slot
  EMIT_ITER: '{ const _ix = stack[sp - 2]; if (ts[sp - 2] !== 0) iterT[a].fill(2); '
    + 'else if (typeof _ix === \'number\' && Number.isInteger(_ix) && _ix >= 0 && _ix < ITER_SLOTS) '
    + 'iterT[a][_ix] = rTop > 0 ? 2 : ts[sp - 1] }',
  LOOP_TICK: '',
  WHILE_BOUND: '',
  DROP: '',
  HALT: 'rTop = 0; rJT = -3;',
})

const SETUP = `  // ─── START-TAINT (generated, \`app/scripts/gen-vm-taint.mjs\`) — THE TAGS, one byte beside every value ───
  const TG = opts && opts.taint && typeof opts.taint === 'object' ? opts.taint : {}
  // a column's tag (part 2: one per column, from \`taintTags.js::columnTagsOf\`); unnamed: T (fail closed)
  const colTag = new Uint8Array(columns.length).fill(2)
  if (TG.columnTags !== undefined) {
    if (!TG.columnTags || TG.columnTags.length !== columns.length) {
      throw new VmError(\`runtime:taint — \${columns.length} columns and \${TG.columnTags ? TG.columnTags.length : 0} column tags\`)
    }
    for (let i = 0; i < columns.length; i += 1) { const t = TG.columnTags[i]; colTag[i] = t === 0 || t === 1 ? t : 2 }
  }
  const tTab = branchTableOf(program)
  const brJoin = tTab.brJoin
  const brW = tTab.brW
  const siteW = tTab.siteWrites
  const ts = new Uint8Array(stack.length)
  const tl = new Uint8Array(locals.length)
  // ⛔ ONE GUARD EACH, no second copy that a mutant could not tell apart: a slot is tainted by its initialiser's T branch
  // (JUMP_IF_INIT, source 1) and a ring cell is read only past the reads' own \`committed\` guards (source 2), so
  // neither array needs a starting tag; a HELD cell does: a call site that has not run on this chart commits it every
  // bar, and another start may have run that site before our first bar
  const tp = new Uint8Array(persist.length)
  const th = new Uint8Array(histTotal)
  const theld = new Uint8Array(held.length).fill(2)
  const outT = outputs.map((o) => new Uint8Array(o.length))
  const iterT = iters.map(() => new Uint8Array(ITER_SLOTS))
  // the implicit-flow regions open now: [branch pc, its join, the call depth it was taken at]
  const rBr = []
  const rJoin = []
  const rDepth = []
  let rTop = 0
  // ⭐ PERF: the innermost region's join in one scalar: each fetch is ONE compare (\`pc === rJT\`); the region arrays (and
  // the call depth) are read only when control reaches a join
  let rJT = -3
  // ⭐ PERF: the implicit-flow work lives in \`taintTags.js::taintBranch\` and is handed this state, so no closure here
  // captures a tag array or \`rTop\`: the loop keeps them in registers, not context slots loaded per instruction
  const TS = { tl, tp, theld, outT, iterT, brW, brJoin, siteW, rBr, rJoin, rDepth }
`

const PROLOGUE = `  // ⛔ START-TAINT — the taint run is a top-level run from this chart's first bar, nothing resumed, probed or live
  if (opts && (opts.resume || opts.probe || opts.realtime || Number.isInteger(opts.checkpointAt) || opts.entry !== undefined)) {
    throw new VmError('runtime:taint — a taint run is a whole top-level run (no resume, probe, checkpoint, realtime or request entry)')
  }
  if (program.broker && !(opts && opts.brokerDisarmed === true)) {
    throw new VmError('runtime:taint — a taint run does not trade a broker (the broker is part 5)')
  }
`

/** [what to find (exactly once in \`execute\`), what to put there] */
export const ANCHORS = Object.freeze([
  // the tags, allocated once, after every store they shadow exists
  ['  for (let bar = startBar; bar < runBars; bar += 1) {\n', (m) => SETUP + m],
  // the main frame's locals are `na` again each bar (clean); no region outlives its bar
  ['    locals.fill(NaN, 0, program.locals)\n', (m) => `${m}    tl.fill(0, 0, program.locals)\n    rTop = 0\n    rJT = -3\n`],
  // a region closes when control reaches its join in the frame that opened it
  ['      const b = code[base + 2]\n',
    (m) => `${m}      if (pc === rJT) {\n        while (rTop > 0 && rJoin[rTop - 1] === pc && rDepth[rTop - 1] === depth) rTop -= 1\n        rJT = rTop > 0 ? rJoin[rTop - 1] : -3\n      }\n`],
  // the rings' tags commit with their values (same cell, same source)
  ['    committed += 1\n', (m) => '    if (nHist) {\n      for (let i = 0; i < nHist; i += 1) {\n'
    + '        const plan = histPlan[i]\n        th[histOffset[i] + (committed % plan.depth)] = plan.site === null\n'
    + '          ? (plan.persist ? tp[plan.slot] : tl[plan.slot])\n          : theld[i]\n      }\n    }\n' + m],
  // the result carries the tags: per output per bar, the slots' final tags, the iteration buffers'
  ['  return { outputs, iters, budget, requested: Array.from(requested).sort(), objects: store,\n',
    (m) => `${m}    taint: { outputs: outT, persist: tp, iters: iterT },\n`],
])

/** The tag algebra's functions the rules call (`taintTags.js`), bound to locals once per run (see `generateVmTaint`). */
const TAINT_FNS = ['tStrict', 'tAdd', 'tSub', 'tCmp', 'tVal', 'tRange', 'branchTableOf', 'taintBranch']

const SIGNATURE = 'export function execute(program, ctx, limits, opts) {\n'
const CASE = /case (\d+) \/\* OP\.([A-Z0-9_]+) \*\/:/g

/** `vm.js`'s own top-level names: `[name, declaredWithExport, 'const' | 'let' | 'function' | 'class']`. */
function topLevelNamesOf(src) {
  const names = []
  const re = /^(export )?(const|let|function|class) ([A-Za-z_$][\w$]*)(.*)$/gm
  for (let m; (m = re.exec(src));) {
    names.push([m[3], !!m[1], m[2]])
    // `const A = x, B = y` on one line
    if (m[2] === 'const') for (const more of m[4].matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=/g)) names.push([more[1], !!m[1], m[2]])
  }
  return names
}

/** The import declarations of `vm.js`, verbatim (single- and multi-line). */
function importsOf(src) {
  const out = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('import ')) continue
    let j = i
    while (!/ from '[^']+'$/.test(lines[j]) && !/^import '[^']+'$/.test(lines[j])) {
      j += 1
      if (j >= lines.length) throw new Error(`gen-vm-taint: an import at line ${i + 1} has no \`from\``)
    }
    out.push(lines.slice(i, j + 1).join('\n'))
    i = j
  }
  return out
}

/** The `export { ... }` list `vm.js` keeps for this file (`// ⭐ START-TAINT: for vmTaint.js`). */
function exportListOf(src) {
  const m = /\/\/ ⭐ START-TAINT: for vmTaint\.js[^\n]*\n(?:\/\/[^\n]*\n)*export \{([^}]*)\}/.exec(src)
  if (!m) throw new Error('gen-vm-taint: vm.js has no `// ⭐ START-TAINT: for vmTaint.js` export list')
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}

const countOf = (hay, needle) => hay.split(needle).length - 1

/** The generated `vmTaint.js` for this `vm.js` source. Throws by name on anything it cannot place. */
export function generateVmTaint(vmSource) {
  const src = vmSource.replace(/\r\n/g, '\n')
  const start = src.indexOf(SIGNATURE)
  if (start < 0 || countOf(src, SIGNATURE) !== 1) throw new Error('gen-vm-taint: `export function execute(program, ctx, limits, opts) {` must occur once')
  const end = src.indexOf('\n}\n', start)
  if (end < 0) throw new Error('gen-vm-taint: `execute` has no closing brace at column 0')
  let body = src.slice(start + SIGNATURE.length, end + 1)
  // whole-line comments go (the generated file points at vm.js for every why); code lines are kept verbatim
  body = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

  // the ARMED broker's setup is not copied: the taint run refuses an armed broker before it (PROLOGUE), and the
  // broker's context (`minContract`, the test-only pin predicate) keeps ONE writer, `execute` (the W9 single-writer
  // rails: `minContractLock`, `w9T1Broker`, `w9T4Sizing`). `broker` stays `null`, as in a disarmed run.
  {
    const head = '  if (program.broker && !disarmed && !(opts && opts.entry !== undefined)) {\n'
    if (countOf(body, head) !== 1) throw new Error('gen-vm-taint: the armed-broker block of execute moved (its `if` must occur once)')
    const from = body.indexOf(head)
    const to = body.indexOf('\n  }\n', from)
    if (to < 0) throw new Error('gen-vm-taint: the armed-broker block of execute has no closing brace at its indent')
    body = `${body.slice(0, from)}  // (generated) the armed broker's setup is not copied: refused above\n${body.slice(to + '\n  }\n'.length)}`
  }

  for (const [needle, put] of ANCHORS) {
    const k = countOf(body, needle)
    if (k !== 1) throw new Error(`gen-vm-taint: anchor ${JSON.stringify(needle.trim())} occurs ${k} times in execute (once required)`)
    body = body.replace(needle, () => put(needle))
  }
  const used = new Set()
  body = body.replace(CASE, (label, num, name) => {
    if (!Object.prototype.hasOwnProperty.call(TAG_RULES, name)) {
      throw new Error(`gen-vm-taint: \`case ${num} /* OP.${name} */\` has no tag rule (TAG_RULES in app/scripts/gen-vm-taint.mjs)`)
    }
    if (used.has(name)) throw new Error(`gen-vm-taint: OP.${name} has two case labels`)
    used.add(name)
    const rule = TAG_RULES[name]
    return rule ? `${label} ${rule}` : label
  })
  const stale = Object.keys(TAG_RULES).filter((k) => !used.has(k))
  if (stale.length) throw new Error(`gen-vm-taint: tag rules for no case in execute: ${stale.join(', ')}`)

  // what execute reads from vm.js's top level comes by import: each must be exported by vm.js (declared `export`, or
  // in its export list for this file)
  const listed = exportListOf(src)
  const top = topLevelNamesOf(src.slice(0, start)).filter(([name]) => name !== 'execute')
  const needed = top.filter(([name]) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(body))
  const missing = needed.filter(([name, exp]) => !exp && !listed.includes(name)).map(([name]) => name)
  if (missing.length) {
    throw new Error(`gen-vm-taint: execute reads ${missing.join(', ')} from vm.js, and vm.js's export list for vmTaint.js does not name it`)
  }
  const fromVm = [...new Set(needed.map(([name]) => name))].sort()
  // ⭐ PERF (e105): what `execute` reads as a MODULE-LOCAL constant (`ADD`, `LT`, `PW`, ... declared in `vm.js`) this
  // file can only IMPORT, and an import is not a local everywhere it runs: under vitest every read of an imported name
  // is a property read on the module's namespace object (an accessor; a Proxy when a test mocks `vm.js`), once per
  // arithmetic opcode. Measured (GitHub runner, 44 scripts, 5,000 bars): the loop with NO tag rules at all ran 6.5x
  // `execute` when its `ADD` went through a mocked namespace. So each such name, and each function the tag rules
  // call, is imported under an alias and bound ONCE per run to a local of its own name at the top of
  // `executeTainted`: the loop reads a register, as `execute` does. A `let` (a live binding a test helper flips:
  // `_regionScopeOff`) stays an import, read live.
  const kindOf = new Map(top.map(([name, , kind]) => [name, kind]))
  const constFromVm = fromVm.filter((name) => kindOf.get(name) !== 'let')
  const liveFromVm = fromVm.filter((name) => kindOf.get(name) === 'let')
  const LOCALS = `  const ${[...constFromVm, ...TAINT_FNS].map((n) => `${n} = ${n}$`).join(', ')}\n`

  return [
    '// app/src/components/chart/engine/runtime/vmTaint.js',
    '//',
    '// ⛔⛔ GENERATED by `app/scripts/gen-vm-taint.mjs` from `vm.js::execute`. DO NOT EDIT THIS FILE: edit `vm.js` (or the',
    '// generator\'s tag table) and run `node app/scripts/gen-vm-taint.mjs`. `vmTaintGenerated.test.js` fails when this',
    '// file is not what the generator makes of the `vm.js` beside it.',
    '//',
    '// START-TAINT PART 2 (`docs/pine/START-TAINT.md`): `executeTainted` is `execute` with a tag (C 0 / O 1 / T 2) carried',
    '// beside every value, for an OFF-LISTING run only: the listing run keeps `execute`, untouched, so the served path',
    '// pays nothing. Every value it computes is `execute`\'s (railed bit for bit over the runtime corpus,',
    '// `taintDifferential.test.js`); `result.taint.outputs[k][bar]` is output k\'s tag on that bar. The comments that',
    '// explain the value code are in `vm.js`, line for line.',
    '/* eslint-disable */',
    ...importsOf(src),
    `import { TAG, ${TAINT_FNS.map((n) => `${n} as ${n}$`).join(', ')} } from './taintTags.js'`,
    `import { ${[...constFromVm.map((n) => `${n} as ${n}$`), ...liveFromVm].join(', ')} } from './vm.js'`,
    '',
    'export { TAG }',
    '',
    `export function executeTainted(program, ctx, limits, opts) {\n${LOCALS}${PROLOGUE}${body}}`,
    '',
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = generateVmTaint(fs.readFileSync(VM_PATH, 'utf8'))
  fs.writeFileSync(OUT_PATH, out)
  console.log(`gen-vm-taint: wrote ${path.relative(process.cwd(), OUT_PATH)} (${out.split('\n').length} lines)`)
}
