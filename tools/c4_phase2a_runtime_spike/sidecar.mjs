// tools/c4_phase2a_runtime_spike/sidecar.mjs
//
// Candidate A's backend half: ONE long-lived Node process the Python screener
// talks to over a pipe. Node 20 is ALREADY in the production image (nixpacks
// `nodePackages`/`nodejs_20`, needed to build the SPA), so this candidate adds
// no new toolchain, no new service and no new deployment topology.
//
// ⛔ MEASUREMENT INSTRUMENT. Framing is length-prefixed binary on stdin/stdout:
// a 4-byte little-endian length then that many bytes of JSON. Line-delimited
// JSON would have made the measurement a measurement of newline scanning.
//
// Two request shapes, because they answer different questions:
//   {op:'compile', program}        — ship the program ONCE per scan
//   {op:'run', bars, symbols}      — bars SYNTHESISED IN-PROCESS: isolates
//                                    dispatch cost from pipe cost
//   {op:'run_with_bars', series}   — bars shipped over the pipe: measures what
//                                    a real screener would actually pay

import { run, synthBars } from './vm.mjs'

let program = null
const chunks = []
let want = -1

process.stdin.on('data', (buf) => {
  chunks.push(buf)
  for (;;) {
    const all = Buffer.concat(chunks)
    if (want < 0) {
      if (all.length < 4) { chunks.length = 0; chunks.push(all); return }
      want = all.readUInt32LE(0)
      chunks.length = 0
      chunks.push(all.subarray(4))
      continue
    }
    const cur = Buffer.concat(chunks)
    if (cur.length < want) { chunks.length = 0; chunks.push(cur); return }
    const body = cur.subarray(0, want)
    const rest = cur.subarray(want)
    want = -1
    chunks.length = 0
    chunks.push(rest)
    handle(JSON.parse(body.toString('utf8')))
    if (rest.length === 0) return
  }
})

function reply(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  const head = Buffer.allocUnsafe(4)
  head.writeUInt32LE(body.length, 0)
  process.stdout.write(Buffer.concat([head, body]))
}

function handle(req) {
  if (req.op === 'ping') return reply({ ok: true, t: Date.now() })
  if (req.op === 'compile') { program = req.program; return reply({ ok: true, instructions: program.code.length / 3 }) }
  if (req.op === 'run') {
    const series = synthBars(req.bars)
    let checksum = 0
    const t0 = performance.now()
    for (let s = 0; s < req.symbols; s += 1) checksum += run(program, series, req.bars, {}).out[req.bars - 1]
    return reply({ ok: true, computeMs: performance.now() - t0, checksum })
  }
  if (req.op === 'run_with_bars') {
    const series = req.series.map((a) => Float64Array.from(a))
    const bars = series[0].length
    const t0 = performance.now()
    const r = run(program, series, bars, {})
    return reply({ ok: true, computeMs: performance.now() - t0, last: r.out[bars - 1] })
  }
  return reply({ ok: false, error: 'unknown op ' + req.op })
}
