// tools/c4_vm_feasibility_probe.mjs
//
// C4 PHASE 1 — IS A BAR-BY-BAR PINE RUNTIME FAST ENOUGH? The architecture
// decision turns partly on a number nobody in this program has measured: what
// does it cost to step a bounded instruction loop over history, per symbol,
// versus the columnar evaluator we have?
//
// ⛔ THIS IS A FEASIBILITY PROBE, NOT A VM. It executes a representative
// instruction mix through the three shapes a real runtime could take, so the
// COST MODEL is measured rather than guessed. It does not implement Pine, does
// not typecheck, and its numbers are a floor: a real runtime adds na-handling,
// bounds checks and object emission on top.
//
// ⚠️ THE CONTROL IS THE POINT. Every shape computes the SAME series and the
// probe asserts the three agree to 1e-9 before printing a single timing —
// otherwise a shape that skipped the work would look like the fast one.
//
//   node tools/c4_vm_feasibility_probe.mjs [--bars N] [--ops N] [--reps N]

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt
}
const BARS = arg('--bars', 5000)
const OPS = arg('--ops', 120)
const REPS = arg('--reps', 5)

// ── synthetic bars ──────────────────────────────────────────────────────────
const close = new Float64Array(BARS)
const high = new Float64Array(BARS)
const low = new Float64Array(BARS)
let p = 100
for (let i = 0; i < BARS; i += 1) {
  p += Math.sin(i / 7) * 0.4 + Math.cos(i / 13) * 0.2
  close[i] = p
  high[i] = p + 0.5
  low[i] = p - 0.5
}

// ⚠️ THE PROGRAM IS DECLARED ONCE AND ALL THREE SHAPES RUN IT. The first draft
// let the columnar shape apply its own fixed op pair while the other two
// alternated, and the agreement control caught it — which is the only reason
// the timings below mean anything.
const OP_MUL = 0, OP_ADDSPREAD = 1
const prog = []
for (let k = 0; k < OPS; k += 1) prog.push(k % 2 === 0 ? OP_MUL : OP_ADDSPREAD)

// ── SHAPE 1: columnar — what the engine does today ──────────────────────────
// Each node is a whole-series pass. OPS nodes = OPS passes over the array.
function columnar() {
  let cur = close
  for (let k = 0; k < prog.length; k += 1) {
    const next = new Float64Array(BARS)
    if (prog[k] === OP_MUL) {
      for (let i = 0; i < BARS; i += 1) next[i] = cur[i] * 1.0001
    } else {
      for (let i = 0; i < BARS; i += 1) next[i] = cur[i] + (high[i] - low[i]) * 0.5
    }
    cur = next
  }
  const acc = new Float64Array(BARS)
  for (let i = 0; i < BARS; i += 1) acc[i] = cur[i]
  return acc
}

// ── SHAPE 1b: columnar with REUSED BUFFERS — the fair control ───────────────
// ⚠️ WITHOUT THIS THE PROBE MEASURES ALLOCATION, NOT ARCHITECTURE. Shape 1
// mints a Float64Array per node, so a bytecode loop could look faster purely by
// not allocating. This ping-pongs two buffers: same passes, same memory
// traffic, no per-node allocation. It is the honest columnar upper bound.
const _pingA = new Float64Array(BARS)
const _pingB = new Float64Array(BARS)
function columnarReused() {
  let cur = close
  let dst = _pingA
  let other = _pingB
  for (let k = 0; k < prog.length; k += 1) {
    if (prog[k] === OP_MUL) {
      for (let i = 0; i < BARS; i += 1) dst[i] = cur[i] * 1.0001
    } else {
      for (let i = 0; i < BARS; i += 1) dst[i] = cur[i] + (high[i] - low[i]) * 0.5
    }
    cur = dst
    dst = other
    other = cur
  }
  return cur
}

// ── SHAPE 2: bar-by-bar TREE WALK — the naive VM ────────────────────────────
// A per-bar walk of an OPS-node expression tree, closure-dispatched.

function barByBarTree() {
  const out = new Float64Array(BARS)
  const nodes = prog.map((op) => (op === OP_MUL
    ? (v, i) => v * 1.0001
    : (v, i) => v + (high[i] - low[i]) * 0.5))
  for (let i = 0; i < BARS; i += 1) {
    let v = close[i]
    for (let k = 0; k < nodes.length; k += 1) v = nodes[k](v, i)
    out[i] = v
  }
  return out
}

// ── SHAPE 3: bar-by-bar BYTECODE — a flat dispatch loop with a register file ─
// The shape a real bounded Pine VM would take: linear instruction array,
// switch dispatch, explicit step budget.
function barByBarBytecode(budgetPerBar) {
  const out = new Float64Array(BARS)
  const code = new Uint8Array(prog)
  const reg = new Float64Array(8)
  let steps = 0
  for (let i = 0; i < BARS; i += 1) {
    reg[0] = close[i]
    const spread = (high[i] - low[i]) * 0.5
    for (let pc = 0; pc < code.length; pc += 1) {
      switch (code[pc]) {
        case OP_MUL: reg[0] = reg[0] * 1.0001; break
        case OP_ADDSPREAD: reg[0] = reg[0] + spread; break
        default: throw new Error('bad opcode')
      }
      steps += 1
      if (steps > budgetPerBar * BARS) throw new Error('budget exceeded')
    }
    out[i] = reg[0]
  }
  return { out, steps }
}

// ── agreement control — run BEFORE any timing is printed ────────────────────
const a = columnar()
const a2 = columnarReused()
const b = barByBarTree()
const c = barByBarBytecode(OPS * 4).out
let maxdiff = 0
for (let i = 0; i < BARS; i += 1) {
  maxdiff = Math.max(maxdiff, Math.abs(a[i] - b[i]), Math.abs(a[i] - c[i]), Math.abs(a[i] - a2[i]))
}
if (!(maxdiff < 1e-9)) {
  console.error('AGREEMENT CONTROL FAILED — the four shapes do not compute the same series')
  console.error('max abs diff ' + maxdiff)
  process.exit(1)
}
console.log('AGREEMENT CONTROL OK — four shapes agree to ' + maxdiff.toExponential(2))

// ── timing ──────────────────────────────────────────────────────────────────
function time(label, fn) {
  fn() // warm
  const t = []
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now()
    fn()
    t.push(performance.now() - t0)
  }
  t.sort((x, y) => x - y)
  const med = t[Math.floor(t.length / 2)]
  console.log('  ' + label.padEnd(30) + med.toFixed(2).padStart(8) + ' ms   (min ' + t[0].toFixed(2) + ')')
  return med
}

console.log('\nBARS ' + BARS + ' · OPS/bar ' + OPS + ' · reps ' + REPS + '\n')
const tCol = time('columnar (today, allocating)', columnar)
const tColR = time('columnar (reused buffers)', columnarReused)
const tTree = time('bar-by-bar tree walk', barByBarTree)
const tBc = time('bar-by-bar bytecode', () => barByBarBytecode(OPS * 4))

// ⛔ THE FAIR COMPARISON IS AGAINST THE REUSED-BUFFER COLUMNAR SHAPE. Measured
// against the allocating one the bytecode loop looks FASTER, and that reading is
// an artefact of allocation, not an architectural fact.
console.log('\n  bytecode vs columnar (allocating) ' + (tBc / tCol).toFixed(2) + 'x')
console.log('  bytecode vs columnar (reused)     ' + (tBc / tColR).toFixed(2) + 'x   <- THE FAIR ONE')
console.log('  tree-walk vs columnar (reused)    ' + (tTree / tColR).toFixed(2) + 'x')
const perBarNs = (tBc * 1e6) / BARS
console.log('  bytecode per bar       ' + perBarNs.toFixed(0) + ' ns  (' + (perBarNs / OPS).toFixed(1) + ' ns/instruction)')

// ── screener extrapolation ──────────────────────────────────────────────────
// Whole-market scan: the screener does not need 5,000 bars of history, it needs
// enough for warm-up plus the evaluated window.
for (const [symbols, bars] of [[5000, 300], [5000, 500], [8000, 300]]) {
  const ms = (tBc / BARS) * bars * symbols
  console.log('  scan ' + symbols + ' symbols x ' + bars + ' bars: ' + (ms / 1000).toFixed(1)
    + ' s single-threaded  (' + (ms / symbols).toFixed(2) + ' ms/symbol)')
}
