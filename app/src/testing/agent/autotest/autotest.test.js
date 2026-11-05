// UCT Agent AUTOTEST: the rig's own unit tests. Free: no browser, no model, no network. Runs in CI with the Agent suites.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grade, checkOne } from './oracle.mjs'
import { classify, dedupe, LAYERS } from './classify.mjs'
import { refusalOf, authorize, MAX_AUTHORIZED_USD, PRODUCTION_ACK, isGranted } from './realGuard.mjs'
import { STAGES, stageList } from './stages.mjs'
import { publicRequests, setHash } from './requests.mjs'
import { lint, schemaErrors } from './lint.mjs'
import { seal, redact } from './heldout.mjs'
import { resolveToken } from './plan.mjs'
import { rowOf } from './report.mjs'
import { prodSafe, writeVerdict, fingerprintDiff, fingerprints, TEST_PREFIX } from './productionTarget.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const snap = (o = {}) => ({ charts: { A: { sym: 'SPY', tf: 'D', chips: ['EMA 9'], pixels: 'p1' }, B: { sym: 'AAPL', tf: 'D', chips: [], pixels: 'p2' } }, widgets: [], wl: {}, drawings: {}, alerts: [], ialerts: [], layouts: [], ...o })
const moved = (a) => snap({ charts: { ...snap().charts, A: { ...snap().charts.A, ...a } } })
const turn = (x = {}) => ({ say: 'x', newReceipt: true, modelCalls: 1, last: 'done', ...x })
const req = (oracle, extra = {}) => ({ id: 'r', family: 'f', kind: 'phrasing', board: 'TWO', turns: [{ say: 'x', plan: { ops: [{ action: 'chart.setTimeframe' }] } }], oracle, ...extra })

describe('the oracle reads state, not words', () => {
  const o = { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'W']] }
  it('passes on the state', () => { expect(grade(req(o), { before: snap(), after: moved({ tf: 'W' }), turns: [turn()] }).pass).toBe(true) })
  it('a receipt with no state change fails, whatever it says', () => {
    const r = grade(req(o), { before: snap(), after: snap(), turns: [turn({ last: 'Switched to weekly' })] })
    expect(r.pass).toBe(false)
    expect(r.checks.some(c => c.tag === 'readback' && c.pass === false)).toBe(true)
  })
  it('the wrong chart moving fails as target', () => {
    const after = snap(); after.charts = { A: { ...after.charts.A, tf: 'W' }, B: { ...after.charts.B, tf: 'W' } }
    const r = grade(req(o), { before: snap(), after, turns: [turn()] })
    expect(r.checks.find(c => c.tag === 'target')?.pass).toBe(false)
  })
  it('a refusal must leave everything alone and show no receipt', () => {
    expect(grade(req({ outcome: 'refuse' }), { before: snap(), after: moved({ tf: 'W' }), turns: [turn()] }).pass).toBe(false)
    expect(grade(req({ outcome: 'refuse' }), { before: snap(), after: snap(), turns: [turn({ newReceipt: true })] }).pass).toBe(false)
    expect(grade(req({ outcome: 'refuse' }), { before: snap(), after: snap(), turns: [turn({ newReceipt: false })] }).pass).toBe(true)
  })
  it('Undo compares state, and fails when the state did not come back', () => {
    const u = { ...o, undo: true }
    expect(grade(req(u), { before: snap(), after: moved({ tf: 'W' }), turns: [turn()], undo: { after: moved({ pixels: 'x' }) } }).pass).toBe(true)
    expect(grade(req(u), { before: snap(), after: moved({ tf: 'W' }), turns: [turn()], undo: { after: moved({ tf: 'W' }) } }).pass).toBe(false)
  })
  it('a check this mode cannot read grades n/a, and a request with nothing graded cannot pass', () => {
    const before = snap({ unreadable: ['axis'] }), after = snap({ unreadable: ['axis'] })
    expect(checkOne(['A.axis', 'changed'], before, after).na).toBe(true)
    expect(grade(req({ outcome: 'change', expect: [['A.axis', 'changed']], receipt: false }), { before, after, turns: [turn({ newReceipt: false })] }).pass).toBe(false)
  })
  it('a confirmed change must have shown a card and held the board until Apply', () => {
    const c = { ...o, confirm: true }
    expect(grade(req(c), { before: snap(), after: moved({ tf: 'W' }), turns: [turn()] }).pass).toBe(false)
    expect(grade(req(c), { before: snap(), after: moved({ tf: 'W' }), turns: [turn({ card: 'x', heldUntilApply: false })] }).pass).toBe(false)
    expect(grade(req(c), { before: snap(), after: moved({ tf: 'W' }), turns: [turn({ card: 'x', heldUntilApply: true })] }).pass).toBe(true)
  })
})

describe('tutorial grading', () => {
  const r = req({ outcome: 'walkthrough', guide: { steps: [{ target: 'x', text: 'y' }] } })
  const base = { before: snap(), after: snap(), turns: [turn({ newReceipt: false })] }
  const good = { started: true, finished: true, clean: true, steps: [{ index: 0, target: 'x', text: 'y', textOk: true, ringOk: true, acted: true }] }
  it('needs the ring on the real control, the right words and the run to the end', () => {
    expect(grade(r, { ...base, guide: good }).pass).toBe(true)
    expect(grade(r, { ...base, guide: { ...good, steps: [{ ...good.steps[0], ringOk: false }] } }).pass).toBe(false)
    expect(grade(r, { ...base, guide: { ...good, steps: [{ ...good.steps[0], textOk: false }] } }).pass).toBe(false)
    expect(grade(r, { ...base, guide: { ...good, finished: false } }).pass).toBe(false)
    expect(grade(r, { ...base, guide: null }).pass).toBe(false)
  })
})

describe('root-cause layers and families', () => {
  const failing = (checks, ev, request = req({ outcome: 'change', expect: [] }), mode = 'REAL-MODEL') => classify(request, ev, { checks }, { mode, known: new Set(['chart.setTimeframe']) }).layer
  const c = (tag) => [{ name: 'n', pass: false, tag }]
  const t = (x) => ({ turns: [turn(x)] })
  const twoOps = { turns: [{ say: 'x', plan: { ops: [{ action: 'chart.setTimeframe' }, { action: 'chart.setTimeframe' }] } }] }
  const one = { ops: [{ action: 'chart.setTimeframe' }] }
  it('every layer is reachable', () => {
    const got = new Set([
      failing(c('state'), t({}), req({ outcome: 'change', expect: [] }, { turns: [{ say: 'x', plan: { ops: [{ action: 'chart.nope' }] } }] })),
      failing(c('state'), t({ last: 'the model was not given: x' })),
      failing(c('state'), t({ unreadable: true })),
      failing(c('state'), t({ envelope: { ops: [{ action: 'chart.setScale' }] } })),
      failing(c('target'), t({ envelope: one })),
      failing(c('state'), t({ envelope: { ops: twoOps.turns[0].plan.ops } }), req({ outcome: 'change', expect: [] }, twoOps)),
      failing([{ name: 'A.tf eq W', pass: false, tag: 'state' }], t({ envelope: one })),
      failing(c('state'), t({ newReceipt: false, last: "I didn't change anything", envelope: one })),
      failing([{ name: 'wl.x has y', pass: false, tag: 'state' }], t({ envelope: one })),
      failing(c('guide'), t({})),
      failing(c('state'), t({ newReceipt: false, last: 'no bars for that', envelope: one })),
      failing(c('readback'), t({ envelope: one })),
      failing(c('state'), t({ modelCalls: 1, newReceipt: false, last: "I can't do that", envelope: { ops: [] } })),
    ])
    for (const l of LAYERS) expect(got.has(l), l).toBe(true)
  })
  it('a crash is the harness, never a product layer', () => { expect(failing(c('crash'), { turns: [], crash: 'boom' })).toBe('harness') })
  it('dedupes by layer, action and the shape of the check', () => {
    const fam = dedupe([{ id: 'a', layer: 'target', expectedActions: ['chart.setSymbol'], firstCheck: 'B untouched' }, { id: 'b', layer: 'target', expectedActions: ['chart.setSymbol'], firstCheck: 'A untouched' }, { id: 'c', layer: 'primitive', expectedActions: ['chart.setSymbol'], firstCheck: 'A.sym eq NVDA' }, { id: 'd', layer: 'primitive', expectedActions: ['chart.setSymbol'], firstCheck: 'A.sym eq TSLA' }])
    expect(fam.map(f => f.count)).toEqual([2, 2])
  })
})

describe('REAL-MODEL guard', () => {
  const pub = 'a'.repeat(64), held = 'b'.repeat(64)
  const good = { approved_by: 'owner', max_usd: 8, expires: '2099-01-01', targets: ['local'], stages: ['canary'], public_set_sha256: pub, heldout_sha256: held }
  const ctx = { target: 'local', stage: 'canary', setHashes: { public: pub, heldout: held }, now: new Date('2026-11-05T12:00:00Z') }
  it('the limit is $8', () => { expect(MAX_AUTHORIZED_USD).toBe(8) })
  it('a good file passes the rules', () => { expect(refusalOf(good, ctx)).toBe(null) })
  it.each([
    ['not owner', { approved_by: 'claude' }], ['over the limit', { max_usd: 8.01 }], ['zero', { max_usd: 0 }], ['a string', { max_usd: '8' }], ['NaN', { max_usd: NaN }],
    ['expired', { expires: '2026-11-04' }], ['no date', { expires: 'soon' }], ['wrong target', { targets: ['production'] }], ['wrong stage', { stages: ['broad'] }], ['another set', { public_set_sha256: 'c'.repeat(64) }], ['another held-out', { heldout_sha256: 'c'.repeat(64) }],
  ])('refuses: %s', (_n, patch) => { expect(refusalOf({ ...good, ...patch }, ctx)).toBeTruthy() })
  it('production needs its target and the exact sentence', () => {
    const c = { ...ctx, target: 'production' }
    expect(refusalOf({ ...good, targets: ['production'] }, c)).toMatch(/production_ack/)
    expect(refusalOf({ ...good, targets: ['production'], production_ack: PRODUCTION_ACK }, c)).toBe(null)
  })
  it('no file: refused, and nothing is granted', () => {
    const v = authorize({ target: 'local', stage: 'canary', setHashes: {}, path: join(tmpdir(), 'no-such-autotest-auth.json') })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/no authorization file/)
    expect(authorize.last).toBe(null)
  })
  it('only authorize grants', async () => {
    expect(isGranted({ maxUsd: 8, target: 'local', stage: 'canary' })).toBe(false)
    const { startRealRelay } = await import('./realRelay.mjs')
    await expect(startRealRelay({ maxUsd: 8, target: 'local', stage: 'canary' })).rejects.toThrow(/no grant/)
  })
  it('the production target refuses without a grant, before a browser', async () => {
    const { runProduction } = await import('./productionTarget.mjs')
    await expect(runProduction({ authorization: { target: 'production' }, list: [], dir: tmpdir(), known: new Set() })).rejects.toThrow(/no grant/)
  })
  it('no REAL-MODEL path reads the environment for permission', () => {
    for (const f of ['realGuard.mjs', 'realRelay.mjs', 'productionTarget.mjs', 'run.mjs']) expect(readFileSync(join(here, f), 'utf8')).not.toMatch(/process.env.(?!BA_ROUTING)/)
  })
})

describe('the production rails', () => {
  const pub = publicRequests()
  it('nothing that writes outside the test layout is ever sent', () => {
    const safe = pub.filter(prodSafe)
    expect(safe.length).toBeGreaterThan(40)
    for (const r of safe) {
      expect(r.board).toBe('TWO')
      for (const t of r.turns) for (const o of t.plan?.ops || []) expect(o.action).not.toMatch(/^(drawing|alert|indicatorAlert|watchlist|layout|settings)/)
    }
  })
  it('the write guard refuses everything it does not name', () => {
    const pref = (key) => JSON.stringify({ key, value: 'x' })
    expect(writeVerdict({ method: 'GET', path: '/api/watchlists' }).allow).toBe(true)
    expect(writeVerdict({ method: 'POST', path: '/api/agent/turn' }).allow).toBe(true)
    expect(writeVerdict({ method: 'POST', path: '/api/auth/preferences', body: pref('charts_workspace_layout') }).allow).toBe(true)
    expect(writeVerdict({ method: 'POST', path: '/api/auth/preferences', body: pref('theme') }).allow).toBe(false)
    expect(writeVerdict({ method: 'POST', path: '/api/watchlists', body: '{}' }).allow).toBe(false)
    expect(writeVerdict({ method: 'POST', path: '/api/watchlist-alerts', body: '{}' }).allow).toBe(false)
    expect(writeVerdict({ method: 'DELETE', path: '/api/charts/layouts/16' }, { testLayoutId: 99 }).allow).toBe(false)
    expect(writeVerdict({ method: 'PATCH', path: '/api/charts/layouts/16', body: '{"name":"Main Trading"}' }, { testLayoutId: 99 }).allow).toBe(false)
    expect(writeVerdict({ method: 'DELETE', path: '/api/charts/layouts/99' }, { testLayoutId: 99 }).allow).toBe(true)
    expect(writeVerdict({ method: 'POST', path: '/api/charts/layouts', body: '{"name":"Main Trading"}' }).allow).toBe(false)
    expect(writeVerdict({ method: 'POST', path: '/api/charts/layouts', body: JSON.stringify({ name: `${TEST_PREFIX}1` }) }).allow).toBe(true)
  })
  it('a fingerprint difference is named', () => {
    expect(fingerprintDiff(fingerprints({ a: [1], b: [2] }), fingerprints({ a: [1], b: [3] }))).toEqual(['b'])
  })
})

describe('stages', () => {
  const pub = publicRequests()
  it('the same table as the gate, and it stays under the limit', () => {
    const py = readFileSync(resolve(here, '../../../../../tools/agent_autotest_gate.py'), 'utf8')
    const m = /STAGES = \{([^}]*)\}/.exec(py)[1]
    expect(Object.fromEntries([...m.matchAll(/"(\w+)": ([\d.]+)/g)].map(x => [x[1], Number(x[2])]))).toEqual(STAGES)
    expect(Object.values(STAGES).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_AUTHORIZED_USD)
  })
  it('public stages do not overlap and cover the set', () => {
    const ids = ['canary', 'sample', 'broad'].flatMap(s => stageList(s, pub).map(r => r.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(pub.length)
  })
})

describe('the request set', () => {
  it('lints clean, with an identity', () => {
    const pub = publicRequests()
    expect(lint(pub)).toEqual([])
    expect(setHash(pub)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('the arg check catches a typo', () => {
    expect(schemaErrors({ tf: 'W' }, { type: 'object', properties: { timeframe: { type: 'string' } }, required: ['timeframe'], additionalProperties: false })).toHaveLength(2)
  })
  it('a token the request cannot satisfy stays visibly missing', () => {
    expect(resolveToken('$chart:A', { context: { charts: [] } }, 'TWO')).toBe('missing:$chart:A')
    expect(resolveToken('$chart:B', { context: { charts: [{ ref: 'c2', position: 'right' }] } }, 'TWO')).toBe('c2')
  })
})

describe('held-out requests stay held out', () => {
  const secret = { id: 'HO-1', set: 'heldout', family: 'f', kind: 'phrasing', board: 'TWO', turns: [{ say: 'a very secret sentence' }], oracle: { outcome: 'answer' } }
  it('the sealed blob has counts and no words', () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-'))
    const b = seal([secret], Buffer.alloc(32, 7))
    writeFileSync(join(dir, 'b.json'), JSON.stringify(b))
    expect(readFileSync(join(dir, 'b.json'), 'utf8')).not.toMatch(/secret/)
    expect(b.count).toBe(1)
  })
  it('a held-out row leaves with no words, plan or checks', () => {
    const row = rowOf(secret, { turns: [turn({ say: 'a very secret sentence', last: 'secret reply' })] }, { pass: false, checks: [{ name: 'secret check', pass: false, tag: 'state' }] }, { mode: 'REAL-MODEL' })
    expect(JSON.stringify(redact(row))).not.toMatch(/secret/)
  })
})
