// NLM-1 HELD-OUT ROUTING SCORER (Track B, independent acceptance; agent/qa/nlm1-heldout — NOT merged, NOT shown to the
// NLM-1 implementer until its D1 is frozen).
//
// For every held-out phrasing (routing.heldout.json): does the routed request carry EVERY capability it needs?
//   recall          items whose routed manifest contains all `needs` / all items (and per capability, per kind)
//   ownWords        items whose needed groups are named by the message's OWN words (not reached by the budget fill)
//   budget          routed actions vs the per-request budget (MANIFEST_CONTRACT.routingThreshold), groups selected,
//                   and how often the message was unrecognised (the fallback fill)
// Router under test: NLM1_ROUTER=v1 (default: master's routing.js through the production request, capreg testing/route.js).
// NLM-1 wires its own router here (`ROUTERS.v2`) when it lands — the ITEMS and the scoring never change.
//
// Runs only with NLM1_HELDOUT=1 (a measurement, not a gate):
//   NLM1_HELDOUT=1 [NLM1_ROUTER=v1] [NLM1_REPORT=<path.json>] npx vitest run src/agent/qa/nlm1-heldout/heldout.score.test.js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { registerCatalog } from '../capabilityRegression/testing/registry'
import { routedNames } from '../capabilityRegression/testing/route'
import { panelHost } from '../capabilityRegression/testing/harness'
import { groupOfAction, wordsSelect, selectGroups } from '../../routing'
import { MANIFEST_CONTRACT, getCapability } from '../../capabilities'
import heldout from './routing.heldout.json'

const ENABLED = globalThis.process?.env?.NLM1_HELDOUT === '1'
const ROUTER = globalThis.process?.env?.NLM1_ROUTER || 'v1'
const ROUTERS = {
  v1: (text, host) => { const r = routedNames(text, { host }); return { names: r.names, selected: r.routing?.selected || null, matched: selectGroups(text).matched } },
}

describe.skipIf(!ENABLED)('NLM-1 held-out routing (score, not a gate)', () => {
  it(`scores ${heldout.items.length} held-out phrasings on router ${ROUTER}`, async () => {
    await registerCatalog()
    const route = ROUTERS[ROUTER]
    expect(route, `unknown NLM1_ROUTER ${ROUTER}`).toBeTruthy()
    const host = panelHost('ONE')
    const budget = MANIFEST_CONTRACT.routingThreshold
    const rows = heldout.items.map(it => {
      for (const n of it.needs) expect(getCapability(n), `${n} is a registered capability`).toBeTruthy()
      const r = route(it.text, host)
      const missing = it.needs.filter(n => !r.names.includes(n))
      const own = [...new Set(it.needs.map(groupOfAction).filter(Boolean))].every(g => wordsSelect(g, it.text))
      return { ...it, ok: !missing.length, missing, ownWords: own, routed: r.names.length, groups: r.selected ? r.selected.length : null, fallback: !r.matched }
    })
    const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null)
    const by = (key) => Object.fromEntries([...new Set(rows.flatMap(r => [].concat(r[key])))].sort().map(k => {
      const sub = rows.filter(r => [].concat(r[key]).includes(k))
      return [k, { n: sub.length, recall: pct(sub.filter(r => r.ok).length, sub.length) }]
    }))
    const report = {
      router: ROUTER, items: rows.length, budget,
      recall: pct(rows.filter(r => r.ok).length, rows.length),
      ownWordsRecall: pct(rows.filter(r => r.ok && r.ownWords).length, rows.length),
      fallbackRate: pct(rows.filter(r => r.fallback).length, rows.length),
      meanRoutedActions: Math.round(rows.reduce((a, r) => a + r.routed, 0) / rows.length * 10) / 10,
      overBudget: rows.filter(r => r.routed > budget).length,
      meanGroups: Math.round(rows.filter(r => r.groups != null).reduce((a, r) => a + r.groups, 0) / Math.max(1, rows.filter(r => r.groups != null).length) * 10) / 10,
      byKind: by('kind'), byCapability: by('needs'),
      misses: rows.filter(r => !r.ok).map(r => ({ text: r.text, kind: r.kind, missing: r.missing, fallback: r.fallback })),
    }
    console.log(JSON.stringify({ router: report.router, items: report.items, recall: report.recall, ownWordsRecall: report.ownWordsRecall, fallbackRate: report.fallbackRate, meanRoutedActions: report.meanRoutedActions, meanGroups: report.meanGroups, overBudget: report.overBudget, byKind: report.byKind }))
    const out = globalThis.process?.env?.NLM1_REPORT
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n')
    expect(report.items).toBeGreaterThanOrEqual(300)
  }, 120000)
})
