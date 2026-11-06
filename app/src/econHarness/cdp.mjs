// Dev-only: a minimal headless-Chrome CDP session (no dependency) for the economic
// UI acceptance drivers. ⛔ LOCAL ONLY — `open()` refuses any non-loopback URL.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// Each temp profile is about 0.13 GB. Every profile THIS process made goes on close, and on exit, signal or crash; a profile
// it did not make is never touched. A multi-page run takes one `runProfile()` and passes it to each launch.
const ours = new Set()
const live = new Set()
// Windows: killing the main process leaves its renderers and crash handler holding the profile, so the whole tree goes, and rm retries the locks
const killTree = (c) => {
  try { if (process.platform === 'win32' && c.pid) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); else c.kill() } catch { /* */ }
}
const removeProfile = (dir) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }); ours.delete(dir) } catch { /* still locked: the exit sweep retries */ } }
const sweep = () => {
  for (const c of live) killTree(c)
  for (const d of [...ours]) removeProfile(d)
}
let armed = false
const arm = () => {
  if (armed) return
  armed = true
  process.on('exit', sweep)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(sig, () => { sweep(); process.exit(130) })
  for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { console.error(e); sweep(); process.exit(1) })
}
/** A rig that spawns Chrome itself: its profile and its process join the same sweep. */
export function tempProfile(prefix) {
  arm()
  const d = mkdtempSync(join(tmpdir(), prefix))
  ours.add(d)
  return d
}
export function trackChrome(chrome) {
  live.add(chrome)
  chrome.once('exit', () => live.delete(chrome))
  // the rig's own chrome.kill() must take the whole tree too, or the renderers keep the profile locked
  if (process.platform === 'win32') chrome.kill = () => { spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); return true }
  return chrome
}

/** One profile for a whole run. Removed when the process ends. The caller clears site data between pages (the rig's `open`). */
export function runProfile() {
  arm()
  const d = mkdtempSync(join(tmpdir(), 'uct-cdp-run-'))
  ours.add(d)
  return d
}

export async function launch({ width = 1400, height = 800, profile: shared = null } = {}) {
  arm()
  const port = 9333 + Math.floor(Math.random() * 500)
  const profile = shared || mkdtempSync(join(tmpdir(), 'econ-ui-cdp-'))
  if (!shared) ours.add(profile)
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  live.add(chrome)
  const close = () => new Promise((res) => {
    let finished = false
    const done = () => { if (finished) return; finished = true; live.delete(chrome); if (!shared) removeProfile(profile); res() }
    try { ws?.close() } catch { /* */ }
    if (chrome.exitCode !== null || chrome.signalCode) { done(); return }
    chrome.once('exit', () => setTimeout(done, 150))
    killTree(chrome)
    setTimeout(done, 5000).unref?.()
  })
  let ws = null
  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) wsUrl = page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(200)
  }
  if (!wsUrl) { await close(); throw new Error('chrome did not come up') }
  ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  const consoleErrors = []
  const network = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 400))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400))
    }
    if (m.method === 'Network.requestWillBeSent') network.push({ url: m.params.request.url, method: m.params.request.method })
  })
  const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600))
    return r.result && r.result.result ? r.result.result.value : undefined
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const open = async (url) => {
    const h = new URL(url).hostname
    if (!['127.0.0.1', 'localhost'].includes(h)) throw new Error(`refusing non-local ${url}`)
    await send('Page.navigate', { url })
  }
  const waitFor = async (expr, { timeout = 20000, step = 150 } = {}) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { const v = await evaluate(expr); if (v) return v } catch { /* page not ready */ }
      await sleep(step)
    }
    return null
  }
  const shot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')
  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  const hover = async (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  const click = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y) }
  const type = async (text) => send('Input.insertText', { text })
  const key = async (k) => {
    const codes = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: codes[k] || 0 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: codes[k] || 0 })
  }
  return { send, evaluate, open, waitFor, shot, click, hover, type, key, close, consoleErrors, network }
}
