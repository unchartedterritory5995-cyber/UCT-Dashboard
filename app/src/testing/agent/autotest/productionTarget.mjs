// UCT Agent AUTOTEST: REAL-MODEL against production, through one DISPOSABLE test layout. ⛔ NEVER RUN in the task that built
// it. It needs the owner's authorization file naming target "production" and the exact production_ack sentence; without
// that `runProduction` throws before a browser exists. The owner signs in by hand to an isolated Chrome with a temp profile
// (no password or cookie reaches a Claude session); it is never the owner's own browser.
//
// ⛔ MUST NEVER BE TOUCHED: the UCT Default layout, the Main Trading layout, every other layout of the owner, every watchlist,
// every price and indicator alert, every drawing, every saved template, screen or indicator definition, every preference
// outside WORKSPACE_PREFS, the broker, the journal. Only artifacts named AUTOTEST-* are created, and every one is removed.
//
// Four rails, all fail closed:
//   1. Request filter (`prodSafe`): chart-surface and indicator requests on the test layout. Anything that writes outside
//      that one layout (drawings are per-symbol and shared, alerts, watchlists, layouts, app settings, global chart prefs) is
//      not sent at all.
//   2. Write guard (`writeVerdict`, CDP Fetch interception): every non-GET from the page is checked; anything not named here
//      is failed at the network and stops the run.
//   3. Fingerprints: sha256 of the protected lists before and after, compared; a difference is a STOP and is reported.
//   4. Restore, in `finally`: the workspace preferences are written back, the test layout is deleted, and rail 3 re-runs.
// Real market data: outputs are value-free (no axis text, no widget faces, no screenshots, no panel text printed).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { launch, sleep } from '../../../econHarness/cdp.mjs'
import { attach } from '../acceptance/lib.mjs'
import { isGranted } from './realGuard.mjs'
import { BOARDS } from './boards.mjs'
import { rowOf, say, finish } from './report.mjs'
import { runRequest } from './driver.mjs'
import { wrongTargetOf } from './prodReport.mjs'

export const PROD_ORIGIN = 'https://www.uctintelligence.com'
export const TEST_PREFIX = 'AUTOTEST-'
export const SETTLE_DELAY_MS = 10000
const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../tools/agent_autotest_gate.py')
export const WORKSPACE_PREFS = ['charts_workspace_layout', 'charts_workspace_groups', 'charts_active_template']
export const PROD_FAMILIES = new Set(['symbol', 'timeframe', 'chart-type', 'session', 'scale', 'view', 'compare', 'chart-settings', 'volume', 'indicator-add', 'indicator-edit', 'indicator-style', 'indicator-visibility', 'undo-conversation', 'howto', 'explain'])
const WRITES_OUTSIDE_LAYOUT = new Set(['chart.addCustomTimeframe', 'chartSetup.favoriteTimeframe', 'chartSetup.removeTimeframe', 'chartSetup.saveTemplate', 'chartSetup.deleteTemplate', 'chart.applyThemeAll', 'chart.resetDefaults', 'settings.setAppTheme', 'settings.setDefaultTimeframe', 'settings.setAlertSound', 'settings.setWatchlistDigest', 'indicatorTemplate.save', 'indicatorTemplate.delete', 'app.open'])
const GLOBAL_SETTINGS = /^(volume\.paneHeightPct)$/

/** May this request run on production at all? */
export function prodSafe(req) {
  if (!PROD_FAMILIES.has(req.family) || req.board !== 'TWO' || req.oracle.persist?.length) return false
  for (const t of req.turns) {
    for (const o of t.plan?.ops || []) {
      if (WRITES_OUTSIDE_LAYOUT.has(o.action) || /^(drawing|alert|indicatorAlert|watchlist|layout|definition|screener\.save|widget\.(add|remove))/.test(o.action)) return false
      if (o.action === 'chart.setSetting' && GLOBAL_SETTINGS.test(o.args?.setting || '')) return false
    }
  }
  return true
}

/** One page write: { allow, why }. Anything not named is refused. */
export function writeVerdict({ method, path, body }, { testLayoutId = null } = {}) {
  const p = String(path).split('?')[0]
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { allow: true }
  if (/^\/api\/agent\/(turn|turn\/stream|turn\/step|turn\/resume|record|data)$/.test(p)) return { allow: true }
  if (p === '/api/auth/preferences') {
    let k = null
    try { k = JSON.parse(body || '{}').key } catch { /* */ }
    return WORKSPACE_PREFS.includes(k) ? { allow: true } : { allow: false, why: `preference ${k} is not a workspace preference` }
  }
  if (testLayoutId != null && p === `/api/charts/layouts/${testLayoutId}`) return { allow: true }
  if (p === '/api/charts/layouts' && method === 'POST') {
    let n = ''
    try { n = JSON.parse(body || '{}').name } catch { /* */ }
    return String(n).startsWith(TEST_PREFIX) ? { allow: true } : { allow: false, why: 'a layout not named AUTOTEST-*' }
  }
  return { allow: false, why: `${method} ${p} is not on the production allow list` }
}

const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex')
/** Protected state as hashes. `lists`: the parsed JSON of each protected GET, minus AUTOTEST-* rows. */
export function fingerprints(lists) { return Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, sha(v)])) }
export const fingerprintDiff = (a, b) => Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k])
const dropTest = (o) => {
  const strip = (r) => (Array.isArray(r) ? r.filter(x => !String(x?.name ?? '').startsWith(TEST_PREFIX)) : r)
  return Array.isArray(o) ? strip(o) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, strip(v)])) : o
}

async function protectedState(b) {
  const get = (u) => b.evaluate(`fetch(${JSON.stringify(u)}, { credentials: 'include' }).then(r => r.json()).catch(() => ({ unreadable: true }))`)
  const prefs = await get('/api/auth/preferences')
  const { charts_workspace_layout: _a, charts_workspace_groups: _b, charts_active_template: _c, ...others } = prefs || {}
  void _a; void _b; void _c
  return { layouts: dropTest(await get('/api/charts/layouts')), watchlists: await get('/api/watchlists'), alerts: await get('/api/watchlist-alerts'), indicatorAlerts: await get('/api/indicator-alerts'), otherPrefs: others }
}

const gate = (args) => spawnSync('python', [GATE, ...args], { encoding: 'utf8', timeout: 60000 })

export async function runProduction({ authorization, list, dir, known }) {
  if (!isGranted(authorization) || authorization.target !== 'production') throw new Error('REAL-MODEL production: no grant from the authorization file; refused')
  const MODE = 'REAL-MODEL'
  const run = `${TEST_PREFIX}${Date.now()}`
  const requests = list.filter(prodSafe)
  say(MODE, `production target: ${requests.length} of ${list.length} requests are safe to send; test layout ${run}`)
  mkdirSync(dir, { recursive: true })
  const b = await launch({ width: 1500, height: 900, headless: false })
  let testLayoutId = null, saved = null, violation = null, prints = null, budgetStart = null
  const rows = []
  try {
    await b.send('Page.navigate', { url: `${PROD_ORIGIN}/charts` })
    say(MODE, 'sign in to the isolated Chrome window by hand (5 minutes)')
    const in_ = await b.waitFor(`fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(j => j && j.user && j.user.role === 'admin').catch(() => false)`, { timeout: 300000, step: 2000 })
    if (!in_) throw new Error('no admin sign-in in the isolated window')
    prints = fingerprints(await protectedState(b))
    budgetStart = await spentToday(b)          // the server's own Agent budget, for the report's side-by-side spend
    const prefs = await b.evaluate(`fetch('/api/auth/preferences', { credentials: 'include' }).then(r => r.json())`)
    saved = Object.fromEntries(WORKSPACE_PREFS.map(k => [k, prefs?.[k] ?? null]))
    writeFileSync(join(dir, 'prod-restore-point.json'), JSON.stringify({ MODE, run, workspacePrefs: saved }))     // for a crash: stays on this machine
    await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] })
    b.on('Fetch.requestPaused', async ({ requestId, request }) => {
      const path = request.url.replace(/^https?:\/\/[^/]+/, '')
      const v = writeVerdict({ method: request.method, path, body: request.postData }, { testLayoutId })
      if (v.allow) { await b.send('Fetch.continueRequest', { requestId }); return }
      violation = v.why
      await b.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
    })
    const layout = JSON.parse(BOARDS.TWO.browser.prefs.charts_workspace_layout)
    const made = await b.evaluate(`fetch('/api/charts/layouts', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: ${JSON.stringify(run)}, scope: 'user', layout: ${JSON.stringify(layout)}, create_only: true }) }).then(r => r.json())`)
    testLayoutId = made?.id
    if (testLayoutId == null) throw new Error('the test layout was not created')
    const openFn = async (R) => prodPage(b, R, { layout: BOARDS.TWO.browser.prefs, run, testLayoutId })
    for (const req of requests) {
      // one production turn is capped at $0.25 by the server (budget.turn_cap_usd); a request may send several turns
      const r = gate(['reserve', '--stage', authorization.stage, '--usd', String(0.25 * Math.max(1, req.turns?.length || 1))])
      if (r.status !== 0) { say(MODE, `STOP: the ledger refused: ${r.stdout.trim().slice(0, 200)}`); break }
      const reservation = JSON.parse(r.stdout).id
      const R = { turns: [], queue: [], ask() {}, port: 0 }
      const b0 = await spentToday(b)
      const { evidence, result } = await runRequest({ R, mock: false, openFn, turnTimeoutMs: 60000, valueFree: true }, req)
      const b1 = await spentToday(b)
      // AUDIT F2: the server may make ONE more call of this request AFTER the reply is sent (the background chat-naming
      // call, api/routers/uct_agent.py `background.add_task(_name_unnamed, ...)`; inside the same request's $0.25 turn cap
      // and 2-call ceiling). Read the budget again after it has had time to reserve, and settle at the larger delta.
      await sleep(SETTLE_DELAY_MS)
      const b2 = await spentToday(b)
      // unknown, or a fall (the server's day rolled over between the reads): settle at the worst case, never at 0
      // a crash or a turn timeout: the server may still be spending on that turn, so the delta could miss it -> worst case
      const usd = !evidence?.crash && b0 != null && b1 != null && b2 != null && b1 >= b0 && b2 >= b1 ? Math.max(b1 - b0, b2 - b0) : null
      const s = gate(['settle', '--id', String(reservation), ...(usd == null ? [] : ['--usd', String(usd)])])
      const row = rowOf(req, { ...evidence, usd }, result, { mode: MODE, known })
      // value-free: check names and tags, the wrong-target kind with role names, per-turn booleans; never a detail or a reply
      const turnsLite = (evidence.turns || []).map(t => ({ card: !!t.card, heldUntilApply: t.heldUntilApply ?? null, receipt: !!t.newReceipt, undoable: t.undoable ?? null, ms: t.ms }))
      rows.push({ ...row, wt: wrongTargetOf(row, req), turnsCount: req.turns?.length || 1, turnsLite, failed: row.failed?.map(f => ({ name: f.name, tag: f.tag })), say: undefined })
      say(MODE, `${row.pass ? 'PASS' : 'FAIL'} ${req.id} ${usd == null ? 'usd unknown, settled at the worst case' : `$${usd.toFixed(4)}`}`)
      finish(dir, MODE, rows, { target: 'production', partial: true })
      if (violation) { say(MODE, `STOP: a write outside the allow list: ${violation}`); break }
      if (s.status !== 0) { say(MODE, `STOP: ${s.stdout.trim().slice(0, 200)}`); break }
    }
  } finally {
    const restored = await restore(b, saved, testLayoutId).catch((e) => `restore failed: ${e.message}`)
    const after = prints ? fingerprints(await protectedState(b).catch(() => ({}))) : null
    const diff = prints && after ? fingerprintDiff(prints, after) : ['never fingerprinted']
    const budgetEnd = await spentToday(b).catch(() => null)
    finish(dir, MODE, rows, { target: 'production', restored, protectedChanged: diff, violation, budgetStart, budgetEnd })
    say(MODE, `restore: ${restored}; protected state changed: ${diff.length ? diff.join(', ') : 'none'}`)
    if (diff.length) gate(['stop', '--why', `production protected state changed: ${diff.join(',')}`])
    await b.close()
  }
  return 0
}

const spentToday = (b) => b.evaluate(`fetch('/api/agent/budget', { credentials: 'include' }).then(r => r.json()).then(j => Number(j.committed_usd)).then(n => Number.isFinite(n) ? n : null).catch(() => null)`)

async function restore(b, saved, testLayoutId) {
  if (!saved) return 'nothing to restore: the run never started'
  await b.evaluate(`(async () => { const s = ${JSON.stringify(saved)}; for (const [key, value] of Object.entries(s)) await fetch('/api/auth/preferences', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) }) })()`)
  if (testLayoutId != null) await b.evaluate(`fetch('/api/charts/layouts/${testLayoutId}', { method: 'DELETE', credentials: 'include' })`)
  return 'workspace preferences written back; test layout deleted'
}

async function prodPage(b, R, { layout, testLayoutId, run }) {
  // a fresh board for every request: the test layout, reloaded
  await b.evaluate(`(async () => { const s = ${JSON.stringify({ ...layout, charts_active_template: JSON.stringify({ id: testLayoutId, name: run, scope: 'user' }) })}; for (const [key, value] of Object.entries(s)) await fetch('/api/auth/preferences', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) }) })()`)
  await b.send('Page.navigate', { url: `${PROD_ORIGIN}/charts` })
  await sleep(4000)
  const p = await attach(b, R)
  p.close = () => {}       // one window for the whole run: the finally block closes it
  return p
}

