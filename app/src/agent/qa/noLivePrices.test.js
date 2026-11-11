// W1-C C-04 rail (builder-c, 2026-11-02): no Agent module reads `/api/live-prices`.
//
// That route (api/routers/live_prices.py → services/live_prices.py) runs the member's watchlist alert checker
// (`run_alert_check`) on a cache miss, so an Agent price read through it could fire an alert. MD-1 §4.1 makes the
// gateway `quote` / `quotes` kinds the only Agent price door (quotes.py reads the Massive snapshot directly and is
// railed server-side never to import that route). Audit E-security-cost.md §6.1 recorded the two legacy browser
// readers (capabilities/stock.js `liveQuote`, capabilities/alert.js `quotesFor`); both now read the gateway, and this
// rail keeps every file under app/src/agent/** (source modules: tests and fixtures may still MOCK the route, to prove
// it is not called) off the route for good.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')   // app/src/agent
const ROUTE = '/api/live-prices'

function sourceFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__fixtures__' || e.name === 'testing') continue
      sourceFiles(p, acc)
    } else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) acc.push(p)
  }
  return acc
}

/** The source files that name the route, as `agent/<relative path>:<line>`. */
export function liveReferences(files = sourceFiles(AGENT)) {
  const out = []
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // a comment that NAMES the route to say it is forbidden is not a reference; a string or template that could
      // be fetched is. Tested on the first non-space characters of the line.
      const code = line.trim()
      if (!code.includes(ROUTE)) return
      if (/^(\/\/|\*|\/\*)/.test(code)) return
      out.push(`agent/${path.relative(AGENT, f).split(path.sep).join('/')}:${i + 1}`)
    })
  }
  return out
}

describe('W1-C C-04: no Agent source module references /api/live-prices', () => {
  it('every non-test module under app/src/agent is clean (the gateway `quote`/`quotes` kinds are the only price door)', () => {
    const files = sourceFiles(AGENT)
    expect(files.length).toBeGreaterThan(80)                         // non-vacuity: the walk reached the Agent
    expect(files.some(f => f.endsWith(path.join('capabilities', 'stock.js')))).toBe(true)
    expect(files.some(f => f.endsWith(path.join('capabilities', 'alert.js')))).toBe(true)
    const bad = liveReferences(files)
    expect(bad, bad.join('\n')).toEqual([])
  })
  it('the detector sees a reference when one exists (control)', () => {
    const tmp = path.join(AGENT, '__qa_control__.js')
    fs.writeFileSync(tmp, "// never fetch it\nexport const u = () => fetch('/api/live-prices?tickers=NVDA')\n")
    try {
      expect(liveReferences([tmp])).toEqual(['agent/__qa_control__.js:2'])
    } finally { fs.unlinkSync(tmp) }
  })
  it('the two legacy readers now read the gateway kinds, by name', () => {
    const stock = fs.readFileSync(path.join(AGENT, 'capabilities', 'stock.js'), 'utf8')
    const alert = fs.readFileSync(path.join(AGENT, 'capabilities', 'alert.js'), 'utf8')
    expect(stock).toMatch(/readQuoteRow/)
    expect(alert).toMatch(/readQuoteMap/)
    const facts = fs.readFileSync(path.join(AGENT, 'capabilities', 'marketDataFacts.js'), 'utf8')
    expect(facts).toMatch(/readData\('quote',/)
    expect(facts).toMatch(/readData\('quotes',/)
  })
})
