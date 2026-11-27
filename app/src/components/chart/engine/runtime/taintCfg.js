// app/src/components/chart/engine/runtime/taintCfg.js
//
// ─── ⭐⭐ START-TAINT, PART 1 — WHERE A BRANCH JOINS, AND EVERYTHING EITHER ARM MAY WRITE ─────────────────────────────
//
// `docs/pine/START-TAINT.md` (approved 2026-11-27): an off-listing run serves a value only where it cannot depend on
// the run's first bar. A value can depend on the start without ever reading a tainted value directly: when a branch's
// CONDITION is tainted, which arm ran is itself start-dependent, so every slot, drawing, output and built-in state
// EITHER arm may write is tainted, the arm that did not run included (implicit flow). This module answers, once per
// lowered program, the two static facts that needs, for every conditional branch:
//
//   · its JOIN: the first instruction every path from the branch must reach (the immediate post-dominator of the
//     branch in its region's control-flow graph; `-1` when the paths only meet at the region's exit);
//   · its WRITE SET: every effect an instruction between the branch and its join may have (both arms, loop bodies,
//     and the functions called there, through their call sites' bases).
//
// ⛔ A PURE MODULE: it reads the program and returns frozen data. It imports only the opcode table, never the VM, and
// changes nothing any run computes. The VM's tags (PART 2) read it.
//
// THE CODE. `program.code` is a flat `[op, a, b]` triple array. Its regions each start at an entry: the main program
// at 0 (it ends at `HALT`), each user function at `functions[i].entry` (it ends at `RET`), each `request.*`
// expression at `requests[i].entry` (it ends at `HALT`). Control transfers are `JUMP a`, `JUMP_IF_FALSE a` (falls
// through when true) and `JUMP_IF_INIT a, b` (to `b` when slot `a` is initialised, else falls through into the
// initialiser). `CALL a, b` runs function `a` through call site `b` and comes back to the next instruction.
//
// ADDRESSING. Inside a function body every per-invocation store is FRAME-RELATIVE (`STORE_PERSIST a` writes
// `persist[persistBase + a]`, `WINDOW a` steps `windowBase + a`, ...); the bases come from the CALL SITE
// (`callSites[b]`, absolute). So a region's write set is reported in its own frame's terms, and every call inside it
// is reported by its site, whose own (absolute) effects `siteWrites` resolves: the callee's stores rebased by the site,
// its history hand-off cells (`historyBase + k`, written at `RET`, re-committed when the site is SKIPPED), and every
// nested call site's effects, transitively. A function's locals are its frame's temporaries and are not state.

import { OP } from './program.js'

/** The effect kinds of a write set (each a sorted list of indices, or of call-site / op indices). */
export const WRITE_KINDS = Object.freeze([
  'locals', 'persist', 'outputs', 'iters', 'windows', 'carried', 'carried2', 'held',
  'arrayOps', 'fieldSets', 'objectOps', 'brokerOps', 'requests', 'calls',
])

/** The branch opcodes whose condition can be start-dependent. */
const BRANCHES = new Set([OP.JUMP_IF_FALSE, OP.JUMP_IF_INIT])

/** Successors of the instruction at `pc` (`-1`: the region's exit). */
export function successors(code, pc) {
  const op = code[pc * 3]
  const a = code[pc * 3 + 1]
  const b = code[pc * 3 + 2]
  switch (op) {
    case OP.JUMP: return [a]
    case OP.JUMP_IF_FALSE: return [pc + 1, a]
    case OP.JUMP_IF_INIT: return [pc + 1, b]
    case OP.RET:
    case OP.HALT: return [-1]
    default: return [pc + 1]
  }
}

/** The instructions reachable from `entry` without leaving its region (its exit is `RET` / `HALT`). */
function regionOf(code, entry) {
  const n = code.length / 3
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const pc = stack.pop()
    if (pc < 0 || seen.has(pc)) continue
    if (pc >= n) throw new Error(`taintCfg: control reaches pc ${pc}, past the code (${n} instructions)`)
    seen.add(pc)
    for (const s of successors(code, pc)) if (s >= 0 && !seen.has(s)) stack.push(s)
  }
  return [...seen].sort((x, y) => x - y)
}

/** Immediate post-dominators over one region: `pc -> ipdom pc` (`-1`: the exit). The iterative data-flow form over a
 *  reverse post-order of the reverse graph (Cooper, Harvey and Kennedy, "A Simple, Fast Dominance Algorithm"). */
function postDominators(code, nodes) {
  const EXIT = -1
  const succ = new Map(nodes.map((pc) => [pc, successors(code, pc)]))
  const preds = new Map(nodes.map((pc) => [pc, []]))
  preds.set(EXIT, [])
  for (const pc of nodes) for (const s of succ.get(pc)) preds.get(s).push(pc)
  // reverse post-order of the REVERSE graph, from the exit
  const order = []
  const seen = new Set([EXIT])
  const walk = [[EXIT, 0]]
  while (walk.length) {
    const top = walk[walk.length - 1]
    const ps = preds.get(top[0])
    if (top[1] < ps.length) {
      const p = ps[top[1]]
      top[1] += 1
      if (!seen.has(p)) { seen.add(p); walk.push([p, 0]) }
    } else {
      order.push(top[0])
      walk.pop()
    }
  }
  order.reverse()
  const rank = new Map(order.map((pc, i) => [pc, i]))
  const ipdom = new Map([[EXIT, EXIT]])
  const meet = (x, y) => {
    while (x !== y) {
      while (rank.get(x) > rank.get(y)) x = ipdom.get(x)
      while (rank.get(y) > rank.get(x)) y = ipdom.get(y)
    }
    return x
  }
  for (let changed = true; changed;) {
    changed = false
    for (const pc of order) {
      if (pc === EXIT) continue
      let best
      for (const s of succ.get(pc)) {
        if (!ipdom.has(s)) continue
        best = best === undefined ? s : meet(best, s)
      }
      if (best !== undefined && ipdom.get(pc) !== best) { ipdom.set(pc, best); changed = true }
    }
  }
  // an instruction that cannot reach the exit (an endless loop the budget stops) has no post-dominator: its
  // branches are answered as joining only at the exit, so their write sets run to the end of the region
  for (const pc of nodes) if (!ipdom.has(pc)) ipdom.set(pc, EXIT)
  return ipdom
}

const emptySets = () => Object.fromEntries(WRITE_KINDS.map((k) => [k, new Set()]))

/** The direct effect of one instruction, added to `sets` (frame-relative indices). */
function addEffect(sets, program, code, pc) {
  const op = code[pc * 3]
  const a = code[pc * 3 + 1]
  const b = code[pc * 3 + 2]
  switch (op) {
    case OP.STORE_LOCAL: sets.locals.add(a); break
    case OP.STORE_PERSIST: sets.persist.add(a); break
    case OP.EMIT: sets.outputs.add(a); break
    case OP.EMIT_ITER: sets.iters.add(a); break
    case OP.WINDOW: sets.windows.add(a); break
    case OP.CARRIED: sets.carried.add(a); break
    case OP.CARRIED2: sets.carried2.add(a); break
    case OP.ARRAY: sets.arrayOps.add(a); break
    case OP.FIELD_SET: sets.fieldSets.add(a); break
    case OP.OBJECT: sets.objectOps.add(a); break
    case OP.BROKER: sets.brokerOps.add(a); break
    case OP.REQUEST: sets.requests.add(a); break
    case OP.CALL: sets.calls.add(b); break
    default: break
  }
}

const frozenSets = (sets) => Object.freeze(Object.fromEntries(WRITE_KINDS.map((k) =>
  [k, Object.freeze([...sets[k]].sort((x, y) => x - y))])))

/** The instructions on some path from `branch` to `join` (exclusive of both; `join === -1`: to the region's exit). */
function between(code, branch, join) {
  const seen = new Set()
  const stack = successors(code, branch).filter((s) => s >= 0 && s !== join)
  while (stack.length) {
    const pc = stack.pop()
    if (seen.has(pc) || pc === join || pc === branch) continue
    seen.add(pc)
    for (const s of successors(code, pc)) if (s >= 0 && s !== join && !seen.has(s)) stack.push(s)
  }
  // a loop whose head is the branch itself: its body comes back to the branch, which is part of the region's writes
  // only through the instructions already collected
  return [...seen].sort((x, y) => x - y)
}

/**
 * The static facts START-TAINT's implicit flow reads, for one lowered program (`lowerIr.js::lowerIrProgram`).
 *
 * @returns {{
 *   branches: Map<number, {join: number, region: string, writes: object}>,   // per JUMP_IF_FALSE / JUMP_IF_INIT pc
 *   siteWrites: object[],                                                    // per call site: ABSOLUTE effects
 *   regions: {name: string, entry: number, pcs: number[]}[],
 * }}
 *   `writes` is frame-relative to the region's frame (the main program's and a request's are absolute) and lists the
 *   call sites it reaches in `calls`; `siteWrites[s]` is everything a call through site `s` may write, absolute, its
 *   nested calls folded in (their `calls` listed too, for the reader that wants the path).
 */
export function taintCfg(program) {
  if (!program || !program.code || program.code.length % 3 !== 0) throw new Error('taintCfg: not a lowered program')
  const code = program.code
  const functions = program.functions || []
  const sites = program.callSites || []
  const regions = [{ name: 'main', entry: 0 }]
  functions.forEach((f, i) => regions.push({ name: `function ${i}${f && f.name ? ` (${f.name})` : ''}`, entry: f.entry, fn: i }))
  ;(program.requests || []).forEach((r, i) => regions.push({ name: `request ${i}`, entry: r.entry }))
  const branches = new Map()
  const regionPcs = []
  // a function's own direct effects, frame-relative (its whole body), for the site summaries
  const fnDirect = functions.map(() => emptySets())
  for (const reg of regions) {
    const pcs = regionOf(code, reg.entry)
    regionPcs.push(Object.freeze({ name: reg.name, entry: reg.entry, pcs: Object.freeze(pcs) }))
    if (reg.fn !== undefined) for (const pc of pcs) addEffect(fnDirect[reg.fn], program, code, pc)
    const ipdom = postDominators(code, pcs)
    for (const pc of pcs) {
      if (!BRANCHES.has(code[pc * 3])) continue
      const join = ipdom.get(pc)
      const sets = emptySets()
      for (const q of between(code, pc, join)) addEffect(sets, program, code, q)
      branches.set(pc, Object.freeze({ join, region: reg.name, writes: frozenSets(sets) }))
    }
  }
  // ── call sites: absolute effects, transitively ──
  const siteMemo = new Array(sites.length).fill(null)
  const resolving = new Set()
  const siteWritesOf = (s) => {
    if (siteMemo[s]) return siteMemo[s]
    if (resolving.has(s)) throw new Error(`taintCfg: call site ${s} reaches itself (a recursive call)`)
    const site = sites[s]
    const fi = site ? site.fn : undefined
    if (!Number.isInteger(fi) || !functions[fi]) throw new Error(`taintCfg: call site ${s} names no function`)
    resolving.add(s)
    const f = functions[fi]
    const d = fnDirect[fi]
    const out = emptySets()
    const pb = site.persistBase || 0
    for (const x of d.persist) out.persist.add(pb + x)
    for (const x of d.windows) out.windows.add((site.windowBase || 0) + x)
    for (const x of d.carried) out.carried.add((site.carriedBase || 0) + x)
    for (const x of d.carried2) out.carried2.add((site.carried2Base || 0) + x)
    for (let k = 0; k < (f.historyCount || 0); k += 1) out.held.add((site.historyBase || 0) + k)
    for (const kind of ['outputs', 'iters', 'arrayOps', 'fieldSets', 'objectOps', 'brokerOps', 'requests']) {
      for (const x of d[kind]) out[kind].add(x)
    }
    for (const t of d.calls) {
      out.calls.add(t)
      const inner = siteWritesOf(t)
      for (const kind of WRITE_KINDS) if (kind !== 'locals') for (const x of inner[kind]) out[kind].add(x)
    }
    resolving.delete(s)
    siteMemo[s] = frozenSets(out)
    return siteMemo[s]
  }
  const siteWrites = Object.freeze(sites.map((_, s) => siteWritesOf(s)))
  return Object.freeze({ branches, siteWrites, regions: Object.freeze(regionPcs) })
}
