// W2-C1 — the SURFACES rail: /charts is byte-identical (the golden manifest holds it — agentContracts.test.js);
// queries that read UCT's own data are offered on every page; a WRITE names its page; a page's own
// capabilities never reach another page; the fast path claims no phrase of a capability not offered here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { manifestFor, getCapability, allCapabilityNames, onSurface } from './capabilities'
import { fastParse } from './fastPath'
import { quickReplies } from './quickReplies'

registerBuiltins()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN = JSON.parse(fs.readFileSync(path.join(HERE, 'contract', 'manifest.golden.json'), 'utf8'))
const names = (surface) => manifestFor({ surface, createIndicator: true }).map(c => c.name)

const PAGES = ['screener', 'breadth', 'calendar', 'journal']
// the query families the brief names: everywhere the Agent is mounted
const EVERYWHERE = ['stock.profile', 'stock.earnings', 'stock.compare', 'news.latest', 'news.catalysts', 'breadth.show', 'breadth.history', 'guide.explain', 'guide.show', 'agent.capabilities', 'app.open',
  'screener.run', 'screener.runSaved', 'screener.state', 'screener.listSaved']
// each page's OWN writes (and the saved-screen writes the Screener page shares with /charts)
const PAGE_WRITES = {
  screener: ['screener.openSaved', 'screener.saveAs', 'screener.renameSaved', 'screener.duplicateSaved', 'screener.deleteSaved'],
  journal: ['journal.createNote'],
}

describe('surfaces (W2-C1)', () => {
  it('/charts is unchanged: the manifest equals the golden (the Charts surface sends exactly what it sent)', () => {
    expect(manifestFor({ surface: 'charts', createIndicator: true })).toEqual(GOLDEN.capabilities)
    // and none of the pages\' own capabilities reached it
    const charts = names('charts')
    for (const n of ['screener.page', 'screener.openSaved', 'breadth.page', 'calendar.nextReport', 'journal.listNotes', 'journal.createNote']) expect(charts).not.toContain(n)
  })

  it('queries that read UCT\'s own data are offered on every page', () => {
    for (const n of EVERYWHERE) {
      const c = getCapability(n)
      expect(c, n).toBeTruthy()
      expect(c.surfaces, n).toEqual(['*'])
      for (const s of PAGES) expect(names(s), `${n} on ${s}`).toContain(n)
    }
  })

  it('a write names its page and is offered nowhere else', () => {
    for (const [page, list] of Object.entries(PAGE_WRITES)) {
      for (const n of list) {
        const c = getCapability(n)
        expect(c.surfaces, n).not.toContain('*')
        expect(c.surfaces, n).toContain(page)
        for (const s of PAGES) expect(names(s).includes(n), `${n} on ${s}`).toBe(c.surfaces.includes(s))
      }
    }
    // every registered WRITE declares explicit pages (never the wildcard)
    for (const n of allCapabilityNames()) {
      const c = getCapability(n)
      if (!c.query && n !== 'app.open') expect(c.surfaces?.includes('*'), n).toBe(false)
    }
  })

  it('chart, widget, layout, drawing and indicator controls stay on /charts', () => {
    for (const s of PAGES) {
      const off = names(s).filter(n => /^(chart|widget|layout|drawing|indicator|board|watchlist|alert|volume)\./.test(n))
      expect(off, s).toEqual([])
    }
  })

  it('the fast path claims no phrase of a capability not offered on the host\'s surface', () => {
    const chartsHost = { charts: { list: () => [{ ref: 'w1', label: 'Chart (SPY)', symbol: 'SPY', tf: 'D' }], read: () => null } }
    expect(fastParse('switch to weekly', { host: chartsHost })).toBeTruthy()                 // the Charts host: as before
    const screenerHost = { surface: 'screener', charts: chartsHost.charts }
    expect(fastParse('switch to weekly', { host: screenerHost })).toBeNull()                  // not offered here
    expect(onSurface(getCapability('chart.setTimeframe'), 'screener')).toBe(false)
    expect(onSurface(getCapability('stock.profile'), 'screener')).toBe(true)
    expect(onSurface(getCapability('stock.profile'), undefined)).toBe(true)
  })

  it('quick replies fit the page; the Charts list is untouched', () => {
    expect(quickReplies([{ symbol: 'NVDA', tf: 'D', cs: {} }])).toEqual(['Switch this chart to weekly bars', 'Why is NVDA moving today?', 'Build an indicator that flags volume spikes'])
    expect(quickReplies([], 'screener')[0]).toMatch(/screen/)
    expect(quickReplies([], 'journal')).toContain('List my recent notes')
  })
})
