// ⭐ ALERT COVERAGE (2026-10-11, the follow-up recorded by UIE Phase 6) — EVERY saved-indicator SHAPE
// the repository holds, through the BROWSER alert preflight (`evaluability`, lane alert), per plot.
// Opt-in: UIE_ALERT_COVERAGE=1, UIE_ALERT_COVERAGE_OUT=<file>. The server half
// (tests/test_alert_coverage_audit.py) reads the same file, saves each formula document through the
// real save path, admits it on the real 579-bar tape and arms every plot — so the two lanes are
// compared on the SAME documents, and a valid plot refused because of a SIBLING is found by measurement.
//
// Sources (all committed): the Batch 2 authoring outputs, every fixture file holding a formula document,
// the Pine corpus through the member door (`memberPaneDefinition`), the thinkScript corpus and the
// TC2000 PCF corpus (each output as the single-tree document the import door saves).
import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { evaluability, LANES } from '../evaluability'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { translateThinkScript } from '../ast/thinkscript'
import { readFormulaSource } from '../ast/pcf'
import { hydrateGraphDocument, reduceIfOversized } from '../ast/graphDocument'
import { astHash } from '../ast/parse'

const ON = globalThis.process?.env?.UIE_ALERT_COVERAGE === '1'
const OUT = globalThis.process?.env?.UIE_ALERT_COVERAGE_OUT
const REPO = path.resolve(globalThis.process?.cwd() || '.', '..')
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every formula document (compute.kind === 'ast' with plots) anywhere inside a JSON value. */
function docsIn(value, at, out) {
  if (Array.isArray(value)) { value.forEach((v, i) => docsIn(v, `${at}[${i}]`, out)); return }
  if (!isObj(value)) return
  if (isObj(value.compute) && value.compute.kind === 'ast' && Array.isArray(value.plots) && value.plots.length) {
    out.push({ at, definition: value })
    return
  }
  for (const [k, v] of Object.entries(value)) docsIn(v, `${at}.${k}`, out)
}
const astOf = (o) => (isObj(o) ? (o.ast || o.tree || (isObj(o.compute) ? o.compute.ast : null)) : null)
// the single-tree document an import saves (BuilderSheet: `fn: astHash(ast)`)
const single = (id, name, tree) => ({ id, name, version: 1, plots: [{ key: 'value', style: 'line' }], compute: { kind: 'ast', fn: astHash(tree), ast: tree } })

it.skipIf(!ON)('alert coverage: every saved-indicator shape, per plot, browser preflight', () => {
  const shapes = []
  // a stored shared-graph document reaches every consumer HYDRATED (`useUserDefinitions`), so it is
  // measured hydrated — the compact wire form is never what evaluability sees in the product
  const add = (source, name, definition) => shapes.push({ source, name,
    definition: isObj(definition.compute) && definition.compute.graph ? hydrateGraphDocument(definition) : definition })

  // 1 · committed fixture documents (Batch 2 authoring outputs and every other formula document)
  const roots = [path.join(REPO, 'tests', 'fixtures')]
  while (roots.length) {
    const dir = roots.pop()
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { roots.push(p); continue }
      if (!e.name.endsWith('.json') || /p1_evaluability_alert/.test(e.name)) continue
      let j
      try { j = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
      const found = []
      docsIn(j, '', found)
      for (const f of found) add(`fixture:${path.relative(REPO, p).replace(/\\/g, '/')}`, f.at || '(root)', f.definition)
    }
  }
  // 2 · Pine corpus through the member door (formula lane only — runtime documents are refused `lane`)
  const PINE = path.join(REPO, 'corpus', 'committed')
  let n = 0
  for (const f of fs.readdirSync(PINE).filter((x) => x.endsWith('.pine')).sort()) {
    let built
    try { built = memberPaneDefinition({ source: fs.readFileSync(path.join(PINE, f), 'utf8'), id: `u_cov${String(n++).padStart(7, '0')}`, name: f }) } catch { built = null }
    if (built && built.ok && built.definition && built.definition.compute && built.definition.compute.kind === 'ast') add('pine', f, built.definition)
  }
  // 3 · thinkScript corpus: every translated output as the single-tree document the import saves
  const TSDIR = path.join(REPO, 'tests', 'fixtures', 'thinkscript')
  for (const f of fs.readdirSync(TSDIR).filter((x) => x.endsWith('.ts')).sort()) {
    let r
    try { r = translateThinkScript(fs.readFileSync(path.join(TSDIR, f), 'utf8')) } catch { r = null }
    ;((r && r.outputs) || []).forEach((o, i) => {
      if (o.refusal || !o.ast) return
      add('thinkscript', `${f}#${o.title || i}`, single(`u_cts${String(n++).padStart(7, '0')}`, f, o.ast))
    })
  }
  // 4 · TC2000 PCF corpus (accepted formulas)
  const PCF = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/ast/pcf_corpus.json'), 'utf8'))
  for (const c of PCF.accepted || []) {
    let r
    try { r = readFormulaSource(c.source, 'pcf') } catch { r = null }
    const t = r && (astOf(r.result) || astOf(r))
    if (t) add('pcf', c.id, single(`u_cpc${String(n++).padStart(7, '0')}`, c.id, t))
  }

  // browser verdicts, per plot; and the form the save hook POSTS (`useUserDefinitions` stores an
  // oversized document as its shared graph — `reduceIfOversized`), which the server half saves
  for (const s of shapes) {
    try { s.saveForm = reduceIfOversized(s.definition) } catch { s.saveForm = s.definition }
    s.browser = {}
    for (const p of s.definition.plots) {
      const key = isObj(p) ? p.key : p
      let a
      try { a = evaluability(s.definition, key, LANES.ALERT) } catch (e) { a = { status: 'throw', reason: String(e.message) } }
      s.browser[key] = { status: a.status, gate: a.gate || null, reason: String(a.reason || '').slice(0, 220), style: isObj(p) ? p.style : null }
    }
  }
  const bySource = {}
  for (const s of shapes) bySource[s.source.split(':')[0]] = (bySource[s.source.split(':')[0]] || 0) + 1
  console.log('ALERT-COVERAGE shapes', shapes.length, JSON.stringify(bySource))
  expect(shapes.length).toBeGreaterThan(50)
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(shapes))
}, 300000)
