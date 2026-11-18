// W9-T4-F1 — THE MINIMUM CONTRACT'S LOCK: nothing but the witnessed table can state it.
//
// The broker floors a cash / percent-of-equity size to whole units only when `ctx.minContract === 1`
// (W9-T4 Q-S1a). A product path that could SET that value — a caller's ctx literal, a wire field, a
// route — would let an unwitnessed symbol be floored as though it traded in whole shares. So the value
// has ONE writer: `runtimeColumns.js`, which derives it from the symbol through the same
// `bind.js::symbolConstants` map a script's `syminfo.mincontract` folds from (the
// `symbolScope.json::min_contract` table, each row backed by a TradingView capture). This file proves
// every other door is shut, by reading the files (the pattern of `brokerPinsLock.test.js`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const RT = path.resolve(here, '..')
const SRC = path.resolve(here, '../../../../..') // app/src
const REPO = path.resolve(SRC, '../..')
const read = (f) => fs.readFileSync(f, 'utf8')
const WORD = /\bminContract\b/g

/** Every non-test source file under `dir` whose text names `minContract`, with its count. */
function namedIn(dir, exts) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) {
        if (!['node_modules', '__tests__', 'test', 'tests', 'dist', '.git'].includes(e.name)) walk(f)
        continue
      }
      if (!exts.test(e.name) || /\.test\./.test(e.name)) continue
      const n = (read(f).match(WORD) || []).length
      if (n) out[path.relative(REPO, f).replace(/\\/g, '/')] = n
    }
  }
  walk(dir)
  return out
}

describe('W9-T4-F1 lock: one writer of ctx.minContract, derived from the symbol', () => {
  it('app/src names `minContract` in broker.js, vm.js and runtimeColumns.js only (non-vacuity: the walk sees them)', () => {
    const hits = namedIn(SRC, /\.(jsx?|mjs)$/)
    expect(Object.keys(hits).sort()).toEqual([
      'app/src/components/chart/engine/runtime/broker.js',
      'app/src/components/chart/engine/runtime/runtimeColumns.js',
      'app/src/components/chart/engine/runtime/vm.js',
    ])
  })
  it('runtimeColumns.js names it ONCE, as the derived value, and never reads it from a caller', () => {
    const src = read(path.join(RT, 'runtimeColumns.js'))
    expect((src.match(WORD) || []).length).toBe(1)
    expect(src).toMatch(/\n\s*minContract: minContractOf\(symbolConstants\(symbol\)\),\r?\n/)
    expect(src).not.toMatch(/ctx\.minContract/)
    expect(src).toMatch(/import \{ symbolConstants, minContractOf \} from '\.\.\/ast\/bind\.js'/)
  })
  it('vm.js only forwards the run context to the broker; broker.js only reads it', () => {
    const vm = read(path.join(RT, 'vm.js'))
    expect(vm.match(/[^\n]*\bminContract\b[^\n]*/g).filter((l) => !/^\s*\/\//.test(l)))
      .toEqual([expect.stringMatching(/minContract: ctx\.minContract,/)])
    const broker = read(path.join(RT, 'broker.js'))
    expect(broker).toMatch(/const minContract = data\.minContract\r?\n/)
    expect((broker.match(/\bminContract\s*=[^=]/g) || []).length).toBe(1)
  })
  it('no server or service code can state it: api/, services/ and tools/ never name it', () => {
    for (const d of ['api', 'services', 'tools']) {
      const dir = path.join(REPO, d)
      expect(fs.existsSync(dir), d).toBe(true)
      expect(namedIn(dir, /\.(py|mjs|js|cjs)$/), d).toEqual({})
    }
    // and the service's wire ctx is a CLOSED set without it (`protocol.mjs` refuses any other key)
    const proto = read(path.join(REPO, 'services/pine_runtime/protocol.mjs'))
    const closedCtx = proto.match(/closed\(v\.ctx, [^\n]+/)
    expect(closedCtx && closedCtx[0]).toMatch(/\['newestBarIsForming', 'historyFromListing'\], \['runtimeInputs', 'historyWindowBars'\]/)
  })
  it('the source is a witness table: bind.js serves a row only with value, witnesses, captured, how AND captures', () => {
    const bind = read(path.join(SRC, 'components/chart/engine/ast/bind.js'))
    for (const field of ['value', 'witnesses', 'captures', 'captured', 'how']) {
      expect(bind).toMatch(new RegExp(`const minContractRowOk = [\\s\\S]*?v\\.${field}\\b[\\s\\S]*?\\nexport const minContractTable`))
    }
    expect(bind).toMatch(/export const SYMBOL_MIN_CONTRACT = minContractTable\(SYMBOL_SCOPE && SYMBOL_SCOPE\.min_contract\)/)
    // one settle site (from `minContracts`) and the reader's two reads: no other table supplies the field
    expect(bind.match(/'syminfo\.mincontract'/g).length).toBe(3)
    expect(bind).toMatch(/out\['syminfo\.mincontract'\] = minContracts\[stored\]/)
  })
})
