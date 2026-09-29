// Dev-only driver: headless Chrome over CDP -> every econ harness scenario ->
// PNG + audit JSON into docs/economic-data/harness/.
//
//   node src/econHarness/captureScenarios.mjs [baseUrl] [src]
//   baseUrl default http://127.0.0.1:5187 ; src = fixtures | api
//
// ⛔ LOCAL ONLY: refuses any base URL whose host is not 127.0.0.1 / localhost.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] || 'http://127.0.0.1:5187'
const SRC = process.argv[3] || 'fixtures'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`refusing non-local base ${BASE}`)
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/economic-data/harness')
mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333 + Math.floor(Math.random() * 400)
const SCENARIOS = ['cpi', 'fedfunds', 'crude', 'claims', 'gdp', 'overlay-d', 'overlay-w', 'overlay-5']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), 'econ-cdp-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1320,780', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await sleep(200)
  }
  throw new Error('chrome did not come up')
}

const ws = new WebSocket(await target())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result && r.result.result ? r.result.result.value : undefined
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 780, deviceScaleFactor: 1, mobile: false })
const summary = {}
for (const sc of SCENARIOS) {
  const url = `${BASE}/econ-harness.html?scenario=${sc}&src=${SRC}`
  await send('Page.navigate', { url })
  let ready = false
  for (let i = 0; i < 150 && !ready; i++) {
    await sleep(200)
    try { ready = await evaluate('!!(window.__econ && window.__econ.ready)') } catch { ready = false }
  }
  if (!ready) { summary[sc] = { error: 'not ready' }; continue }
  const audit = await evaluate('window.__econ.audit()')
  const nav = await evaluate('window.__econ.navTest()')
  await sleep(150)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${sc}${SRC === 'api' ? '.api' : ''}.png`), Buffer.from(shot.result.data, 'base64'))
  summary[sc] = { audit, nav }
  process.stdout.write(`${sc}: bindings=${audit.bindings.length} drawnThroughGaps=${audit.drawnThroughGapsTotal} nav.ok=${nav.ok}\n`)
}
writeFileSync(join(OUT, `audit${SRC === 'api' ? '.api' : ''}.json`), JSON.stringify(summary, null, 2))
ws.close()
chrome.kill()
