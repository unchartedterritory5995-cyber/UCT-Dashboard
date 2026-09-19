// tools/c4_phase2a_runtime_spike/vm.mjs — the JS dispatch loop.
//
// ⛔ MEASUREMENT INSTRUMENT. See isa.md. Not a Pine runtime.

import fs from 'node:fs'

const PUSH_CONST = 0, PUSH_SERIES = 1, PUSH_HIST = 2,
  ADD = 3, SUB = 4, MUL = 5, DIV = 6, LT = 7,
  LOAD_LOCAL = 8, STORE_LOCAL = 9, LOAD_PERSIST = 10, STORE_PERSIST = 11,
  JUMP_IF_FALSE = 12, JUMP = 13,
  ARR_PUSH = 14, ARR_GET = 15, ARR_SIZE = 16,
  EMIT = 17, POP = 18, HALT = 19

export function run(program, series, bars, limits) {
  const code = program.code
  const consts = program.consts
  const stack = new Float64Array(64)
  const locals = new Float64Array(program.locals)
  const persist = new Float64Array(program.persists)
  const arrays = []
  for (let i = 0; i < program.arrays; i += 1) arrays.push([])
  const out = new Float64Array(bars)
  const maxSteps = limits && limits.maxSteps ? limits.maxSteps : Infinity
  let steps = 0

  for (let bar = 0; bar < bars; bar += 1) {
    let sp = 0
    let pc = 0
    for (;;) {
      const op = code[pc * 3]
      const a = code[pc * 3 + 1]
      const b = code[pc * 3 + 2]
      pc += 1
      steps += 1
      if (steps > maxSteps) throw new Error('INSTRUCTION_LIMIT_EXCEEDED')
      switch (op) {
        case PUSH_CONST: stack[sp++] = consts[a]; break
        case PUSH_SERIES: stack[sp++] = series[a][bar]; break
        case PUSH_HIST: {
          const off = b === -1 ? stack[--sp] : b
          const idx = bar - off
          stack[sp++] = (idx >= 0 && idx <= bar) ? series[a][idx] : NaN
          break
        }
        case ADD: { const y = stack[--sp], x = stack[--sp]; stack[sp++] = (x !== x || y !== y) ? NaN : x + y; break }
        case SUB: { const y = stack[--sp], x = stack[--sp]; stack[sp++] = (x !== x || y !== y) ? NaN : x - y; break }
        case MUL: { const y = stack[--sp], x = stack[--sp]; stack[sp++] = (x !== x || y !== y) ? NaN : x * y; break }
        case DIV: { const y = stack[--sp], x = stack[--sp]; stack[sp++] = (x !== x || y !== y || y === 0) ? NaN : x / y; break }
        case LT: { const y = stack[--sp], x = stack[--sp]; stack[sp++] = (x !== x || y !== y) ? NaN : (x < y ? 1 : 0); break }
        case LOAD_LOCAL: stack[sp++] = locals[a]; break
        case STORE_LOCAL: locals[a] = stack[--sp]; break
        case LOAD_PERSIST: stack[sp++] = persist[a]; break
        case STORE_PERSIST: persist[a] = stack[--sp]; break
        case JUMP_IF_FALSE: { const t = stack[--sp]; if (t !== t || t === 0) pc = a; break }
        case JUMP: pc = a; break
        case ARR_PUSH: arrays[a].push(stack[--sp]); break
        case ARR_GET: { const i = stack[--sp] | 0; const arr = arrays[a]; stack[sp++] = (i >= 0 && i < arr.length) ? arr[i] : NaN; break }
        case ARR_SIZE: stack[sp++] = arrays[a].length; break
        case EMIT: out[bar] = stack[--sp]; break
        case POP: sp -= 1; break
        case HALT: break
        default: throw new Error('bad opcode ' + op)
      }
      if (op === HALT) break
    }
  }
  return { out, steps }
}

export function synthBars(n) {
  const close = new Float64Array(n)
  const open = new Float64Array(n)
  const high = new Float64Array(n)
  const low = new Float64Array(n)
  let p = 100
  for (let i = 0; i < n; i += 1) {
    p += Math.sin(i / 7) * 0.4 + Math.cos(i / 13) * 0.2
    close[i] = p; open[i] = p - 0.1; high[i] = p + 0.5; low[i] = p - 0.5
  }
  return [open, high, low, close]
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('vm.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }
  const program = JSON.parse(fs.readFileSync(arg('--program', 'program.json'), 'utf8'))
  const bars = Number(arg('--bars', 300))
  const reps = Number(arg('--reps', 5))
  const symbols = Number(arg('--symbols', 1))
  const series = synthBars(bars)

  const t0 = performance.now()
  let checksum = 0
  let steps = 0
  for (let s = 0; s < symbols; s += 1) {
    const r = run(program, series, bars, {})
    steps = r.steps
    checksum += r.out[bars - 1]
  }
  const first = performance.now() - t0

  const times = []
  for (let r = 0; r < reps; r += 1) {
    const a = performance.now()
    for (let s = 0; s < symbols; s += 1) run(program, series, bars, {})
    times.push(performance.now() - a)
  }
  times.sort((x, y) => x - y)
  const r0 = run(program, series, bars, {})
  process.stdout.write(JSON.stringify({
    host: 'node ' + process.version,
    bars, symbols, steps,
    firstRunMs: first,
    medianMs: times[Math.floor(times.length / 2)],
    minMs: times[0],
    checksum,
    head: Array.from(r0.out.slice(0, 5)),
    tail: Array.from(r0.out.slice(-3)),
  }))
}
