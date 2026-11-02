import { it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const RDDT = JSON.parse(fs.readFileSync(path.join(DIR, 'vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
const H = '//@version=6\nindicator("P", overlay = true)\n'
const B = toProductBars(RDDT)
const n = B.length

function run(label, body, truth) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const door = enterMemberDoor(`${H}${body}`)
  let out
  if (!door.def) {
    out = { refused: door.refusal }
  } else {
    try {
      const cols = registry.computeFor(door.def, B, undefined, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true })
      const errs = registry.columnErrors(cols) || {}
      const row = door.built.translation.outputs[0]
      const v = cols.value ? cols.value[n - 1] : null
      out = { drew: v, truth, match: v != null && Math.abs(v - truth) < 1e-6, err: errs.value && (errs.value.guard + ' ' + String(errs.value.message).slice(0, 160)), rowRefusal: row.refusal && (row.refusal.guard + ' ' + String(row.refusal.message).slice(0, 200)) }
    } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
  }
  console.log(`REVD ${label}: ${JSON.stringify(out)}`)
}

it('probes', () => {
  const ups = B.filter((b) => b.c > b.o)
  // P1: f() => s[1], s written after f's declaration: TV = close[1]
  run('P1 f=>s[1] after write', 'var float s = na\nf() => s[1]\ns := close\nplot(f())\n', B[n - 2].c)
  run('P1b f=>nz(s[1]) after write', 'var float s = na\nf() => nz(s[1])\ns := close\nplot(f())\n', B[n - 2].c)
  // P3: ta.sma(close, 1) in a skipping block: TV = last up close
  run('P3 sma1', 'var float s = na\nif close > open\n    s := ta.sma(close, 1)\nplot(s)\n', ups[ups.length - 1].c)
  // P6: var := if-expression with ta.sma in an arm
  const k = ups.length
  const m3 = (ups[k - 1].c + ups[k - 2].c + ups[k - 3].c) / 3
  run('P6 s := if c sma else s', 'var float s = na\ns := if close > open\n    ta.sma(close, 3)\nelse\n    s\nplot(s)\n', B[n - 1].c > B[n - 1].o ? m3 : NaN)
  // P7: var := c ? sma : s (ternary lane, not this branch)
  run('P7 ternary', 'var float s = na\ns := close > open ? ta.sma(close, 3) : s\nplot(s)\n', m3)
  // P8: colour-only read of gated var: value close is exact
  run('P8 colour', 'var float s = na\nif close > open\n    s := ta.sma(close, 3)\nplot(close, color = close > s ? color.green : color.red)\n', B[n - 1].c)
  // P9: math.* in a skipping block: not history-dependent
  run('P9 math', 'var float s = na\nif close > open\n    s := math.max(close, open)\nplot(s)\n', ups[k - 1].c)
  // P10: sma via a non-history UDF
  run('P10 udf sma', 'var float s = na\ng(x) => ta.sma(x, 3)\nif close > open\n    s := g(close)\nplot(s)\n', m3)
  // P11: written through a block local
  run('P11 local', 'var float s = na\nif close > open\n    t = ta.sma(close, 3)\n    s := t\nplot(s)\n', m3)
  // P12: += form
  run('P12 +=', 'var float s = 0\nif close > open\n    s += ta.sma(close, 3) * 0\nplot(s)\n', 0)
  // P13: f reads s, written in an `if` later, called later
  run('P13 f after if write', 'var float s = na\nf() => s\nif close > open\n    s := close\nplot(f())\n', ups[k - 1].c)
})
