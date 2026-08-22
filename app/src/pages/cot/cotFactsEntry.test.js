// @vitest-environment node
//
// End-to-end proof of the `cot-facts.cjs` CLI contract: the bundle is BUILT
// here (the same way `npm run build` builds it), then driven through a real
// child process exactly as the Python backend will drive it.
//
// Pinned to the node environment: esbuild refuses to run under jsdom, whose
// TextEncoder hands back a Uint8Array from another realm and trips esbuild's
// startup invariant. Nothing here needs a DOM.
/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCotFacts } from '../../../scripts/build-cot-facts.mjs'
import { PRICE_PROXY, proxyFor } from './cotProxies'

// ── fixtures ──────────────────────────────────────────────────────────────────

function mkRows(n, fn = () => ({})) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2020, 0, 7 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: 0,
      large_spec_net: 0,
      small_spec_net: 0,
      open_interest: 1_000_000,
      ...fn(i),
    })
  }
  return out
}

// Friday bars, one per row week, price +1 a week.
function mkBars(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2020, 0, 10 + i * 7))
    const c = 100 + i
    out.push({ t: d.toISOString().slice(0, 10), o: c, h: c, l: c, c, v: 1000 })
  }
  return out
}

// Trend crowd and OI growing, hedgers selling: 'trend-confirmed' is the one
// divergence that fires, which proves bars crossed the process boundary.
const ROWS = mkRows(200, i => ({
  commercial_net: -i * 10,
  large_spec_net: i * 10,
  open_interest: 1_000_000 + i * 100,
}))
const BARS = mkBars(200)
const FIXTURE = { symbol: 'ES', name: 'S&P 500 E-mini', rows: ROWS, bars: BARS }

// ── harness ───────────────────────────────────────────────────────────────────

const NODE = process.execPath
const canSpawn = (() => {
  try { return spawnSync(NODE, ['--version'], { encoding: 'utf8' }).status === 0 } catch { return false }
})()
const itNode = canSpawn ? it : (name, fn) => it.skip(`${name} — skipped: node could not be spawned`, fn)

let dir, outfile
const run = (args, input) =>
  spawnSync(NODE, [outfile, ...args], { input, encoding: 'utf8', timeout: 20_000 })

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cot-facts-'))
  outfile = join(dir, 'cot-facts.cjs')
  await buildCotFacts({ outfile, logLevel: 'warning' })
}, 60_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// ── bundle ────────────────────────────────────────────────────────────────────

describe('build-cot-facts', () => {
  it('emits a self-contained CJS bundle at the requested path', () => {
    expect(existsSync(outfile)).toBe(true)
    expect(statSync(outfile).size).toBeGreaterThan(1000)
    const src = readFileSync(outfile, 'utf8')
    // Pure analytics only: nothing from React or the DOM may be pulled in.
    expect(src).not.toMatch(/require\(["']react/)
    expect(src).not.toMatch(/\bdocument\./)
    // Bundled, not externalised: the COT modules are inlined.
    expect(src).not.toMatch(/require\(["']\.\/cot/)
  })
})

// ── proxies ───────────────────────────────────────────────────────────────────

describe('cot-facts.cjs proxies', () => {
  itNode('resolves every PRICE_PROXY symbol when called with no list', () => {
    const r = run(['proxies'])
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    const out = JSON.parse(r.stdout)
    expect(Object.keys(out).sort()).toEqual(Object.keys(PRICE_PROXY).sort())
    expect(out.ES).toEqual({ ticker: 'SPY', note: 'via SPY' })
    expect(out.CL).toEqual({ ticker: 'USO', note: 'via USO (ETF proxy — roll drag)' })
  })

  itNode('resolves an explicit comma list, unknown symbols → null', () => {
    // Expected values are DERIVED from the proxy module, never restated here:
    // the map changes (VI gained a VIX mapping mid-flight) and the CLI must
    // simply agree with it. ZZZ is the one symbol guaranteed unknown.
    const r = run(['proxies', 'ES,VI,ZZZ'])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out).toEqual({ ES: proxyFor('ES'), VI: proxyFor('VI'), ZZZ: null })
    expect(out.ES.ticker).toBe('SPY')
    expect(out.ZZZ).toBeNull()
  })

  itNode('writes compact JSON and a single trailing newline', () => {
    const r = run(['proxies', 'ES'])
    expect(r.stdout).toBe('{"ES":{"ticker":"SPY","note":"via SPY"}}\n')
  })
})

// ── facts ─────────────────────────────────────────────────────────────────────

describe('cot-facts.cjs facts', () => {
  itNode('computes the latest week from stdin JSON', () => {
    const r = run(['facts'], JSON.stringify(FIXTURE))
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout.endsWith('\n')).toBe(true)
    expect(r.stdout.trim().includes('\n')).toBe(false) // one compact line
    const out = JSON.parse(r.stdout)
    expect(Object.keys(out).sort()).toEqual(['facts', 'read', 'report_date'])
    expect(out.report_date).toBe(ROWS[199].date)
    expect(out.facts.report_date).toBe(ROWS[199].date)
    expect(out.facts.symbol).toBe('ES')
    expect(out.facts.name).toBe('S&P 500 E-mini')
    expect(typeof out.facts.groups.commercials.index_3y).toBe('number')
    expect(out.facts.groups.commercials.index_3y).toBe(0)
    // bars crossed the boundary: the price check fired.
    expect(out.facts.price_check).toEqual(['Trend confirmed'])
    // the proxy was resolved in-process, not by the caller.
    expect(out.facts.precedents === null || out.facts.precedents.proxy === 'SPY').toBe(true)
  })

  itNode('returns the read fields the backend stores alongside the facts', () => {
    const { read } = JSON.parse(run(['facts'], JSON.stringify(FIXTURE)).stdout)
    expect(Object.keys(read).sort()).toEqual(['bias', 'crowding', 'headline', 'watch'])
    expect(typeof read.headline).toBe('string')
    expect(read.headline.length).toBeGreaterThan(0)
    expect(read.bias).toEqual({ label: 'Contrarian Bearish', strength: 'strong', tone: 'bear' })
    expect(Object.keys(read.crowding).sort()).toEqual(['index', 'label'])
    expect(typeof read.crowding.label).toBe('string')
    expect(typeof read.crowding.index).toBe('number')
    expect(typeof read.watch).toBe('string')
    expect(read.watch.length).toBeGreaterThan(0)
  })

  itNode('accepts bars: null (no price → no price check)', () => {
    const r = run(['facts'], JSON.stringify({ ...FIXTURE, bars: null }))
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.report_date).toBe(ROWS[199].date)
    expect(out.facts.price_check).toEqual([])
  })

  itNode('bad stdin → exit 2, message on stderr, nothing on stdout', () => {
    const r = run(['facts'], 'not json')
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/JSON/i)
  })

  itNode('no stdin at all → exit 2, nothing on stdout', () => {
    const r = run(['facts'])
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })

  itNode('empty rows → exit 2, nothing on stdout', () => {
    const r = run(['facts'], JSON.stringify({ ...FIXTURE, rows: [] }))
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/rows/i)
  })

  itNode('missing rows → exit 2, nothing on stdout', () => {
    const r = run(['facts'], JSON.stringify({ symbol: 'ES' }))
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })
})

// ── usage ─────────────────────────────────────────────────────────────────────

describe('cot-facts.cjs usage', () => {
  itNode('unknown command → exit 2, usage on stderr, nothing on stdout', () => {
    const r = run(['bogus'])
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/bogus/)
    expect(r.stderr).toMatch(/proxies/)
    expect(r.stderr).toMatch(/facts/)
  })

  itNode('no command → exit 2, nothing on stdout', () => {
    const r = run([])
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
  })
})
