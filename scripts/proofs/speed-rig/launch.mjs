// Starts Chrome with only a debugging port, in a throwaway profile, and signs in over plain DevTools protocol
// (ported from the owner-PC rig's launch.mjs, 2026-11-28, for the cloud speed rig; the PC copy stays the reference).
// Playwright is not used: its launch switches and focus emulation would falsify popup, background and load timings.
//
// ⛔ CREDENTIALS. BENCH_EMAIL / BENCH_PASSWORD come from the environment and are NEVER printed, logged or written:
// they ride one Runtime.evaluate that is not echoed, and nothing below reads a cookie or a response header of the
// sign-in. The repo is PUBLIC and its Actions logs are public.
// ⛔ A RUN THAT SIGNS IN SIGNS OUT (the 2026-11-17 incident class: 301 live sessions left on the smoke account).
//
// Chrome: UCT_CHROME names the binary (the cloud rig's pinned Chrome for Testing); the installed Chrome otherwise.
// UCT_PROOF_BASE points a proof at another origin (a local sandbox); production otherwise.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const BASE = process.env.UCT_PROOF_BASE || 'https://uctintelligence.com'
export const MENU = '[data-guide="workspace.layoutsMenuBtn"]'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WIN = process.platform === 'win32'
const COMMAND_TIMEOUT_MS = 300000

export function chromeBinary() {
  if (process.env.UCT_CHROME) return process.env.UCT_CHROME
  return WIN ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome'
}

// A leftover browser on this port would answer in place of the one this run starts.
async function refuseBusyPort(port) {
  const answered = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false)
  if (answered) throw new Error(`port ${port} is already in use`)
}

export function connect(url) {
  return new Promise((ok, no) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    const listeners = []
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (!p) return   // a reply can outlive its request (2026-11-12: one crashed a 6-hour soak)
        if (m.error) p.no(new Error(m.error.message))
        else p.ok(m.result)
      } else listeners.forEach((l) => l(m))
    }
    ws.onerror = () => no(new Error('debug socket failed'))
    ws.onclose = () => {
      for (const p of pending.values()) p.no(new Error('debug socket closed'))
      pending.clear()
    }
    ws.onopen = () =>
      ok({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const callId = ++id
            const timer = setTimeout(() => { pending.delete(callId); rej(new Error(`${method} timed out`)) }, COMMAND_TIMEOUT_MS)
            const settle = (fn) => (v) => { clearTimeout(timer); fn(v) }
            pending.set(callId, { ok: settle(res), no: settle(rej) })
            ws.send(JSON.stringify({ id: callId, method, params }))
          }),
        on: (l) => listeners.push(l),
      })
  })
}

/** The browser's own version line (/json/version): the label every result carries. */
export async function browserVersion(port) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    return { product: v.Browser || null, protocol: v['Protocol-Version'] || null }
  } catch { return { product: null } }
}

export async function startApp(target, port, extraArgs = [], options = {}) {
  if (target !== 'chrome') throw new Error('the speed rig drives Chrome only')
  await refuseBusyPort(port)
  const profile = options.profile ?? mkdtempSync(join(tmpdir(), 'uct-clean-chrome-'))
  const signIn = options.signIn ?? true
  let signOut = null
  const exe = chromeBinary()
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, ...extraArgs,
    `--app=${BASE}/`, '--window-size=1500,950', '--no-first-run', '--no-default-browser-check']
  // POSIX: its own process group, so the teardown kills this browser and every child it started, nothing else
  const child = spawn(exe, args, { stdio: 'ignore', detached: !WIN })
  let exit = null
  child.on('exit', (code, signal) => { exit = { code, signal, at: new Date().toISOString() } })

  function cleanup() {
    if (WIN) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
      return
    }
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* already gone */ } }
  }

  async function findPage() {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const hit = list.find((t) => t.type === 'page' && t.url.startsWith(BASE))
        if (hit) return hit
      } catch { /* not up yet */ }
      if (exit) throw new Error(`the browser exited before its page appeared: ${JSON.stringify(exit)}`)
      await sleep(500)
    }
    throw new Error('app page did not appear')
  }

  // graceful: Browser.close first, so the browser writes what it holds before the forced kill. SIGN OUT FIRST.
  const close = async ({ keepProfile = false, graceful = false } = {}) => {
    if (signOut && exit === null) {
      const so = signOut
      signOut = null
      const st = await Promise.race([so(), sleep(8000).then(() => 'timeout')])
      console.log(`sign-out status ${st}`)
    }
    if (graceful && exit === null) {
      try {
        const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
        const ws = new WebSocket(v.webSocketDebuggerUrl)
        await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j) })
        ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
        for (let t = 0; t < 15000 && exit === null; t += 250) await sleep(250)
      } catch { /* fall through to the kill */ }
    }
    cleanup()
    await sleep(2500)
    if (keepProfile || options.profile) return
    for (let i = 0; i < 10; i++) {
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* still held: retry */ }
      if (!existsSync(profile)) break
      await sleep(1500)
    }
    console.log(`profile ${existsSync(profile) ? 'LEFT IN TEMP' : 'removed'}`)
  }

  async function boot() {
    const pageTarget = await findPage()
    const c = await connect(pageTarget.webSocketDebuggerUrl)
    await c.send('Runtime.enable')
    await c.send('Page.enable')
    await c.send('Network.enable')
    const run = async (expression, gesture = false) => {
      const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    }
    const waitFor = async (expression, ms) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        try { if (await run(expression)) return } catch { /* mid navigation */ }
        await sleep(500)
      }
      throw new Error(`timed out waiting for ${expression.slice(0, 200)}`)
    }
    const charts = async () => {
      await c.send('Page.navigate', { url: `${BASE}/charts` })
      await sleep(1500)
      await waitFor(`!!document.querySelector('${MENU}')`, 60000)
    }
    await waitFor(`location.origin === '${BASE}' && document.readyState !== 'loading'`, 60000)
    if (signIn) {
      const email = process.env.PROOF_EMAIL || process.env.BENCH_EMAIL
      const password = process.env.PROOF_PASSWORD || process.env.BENCH_PASSWORD
      if (!email || !password) throw new Error('BENCH_EMAIL / BENCH_PASSWORD are not set')
      const creds = JSON.stringify({ email, password })
      // the status only: the answer's body and its cookies are never read here, and the expression is never echoed
      // 429 = the login limit (5/minute per client IP, api/routers/auth.py): runners that share an egress address
      // can meet it, so a 429 waits out the minute and asks again, twice at most
      let login
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          login = await run(`fetch('/api/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(creds)}}).then(r=>r.status)`)
        } catch { login = 'threw' }
        if (login !== 429) break
        console.log('sign-in status 429 (the per-IP login limit): waiting 65 s')
        await sleep(65000)
      }
      console.log(`sign-in status ${login}`)
      if (login !== 200) throw new Error(`sign-in refused (${login})`)
      signOut = async () => {
        try { return await run(`fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(r=>r.status)`) } catch (e) { return `failed: ${String(e?.message || e).slice(0, 80)}` }
      }
    }
    return { c, run, waitFor, charts }
  }

  try {
    return { child, close, exited: () => exit, placeMainWindow: () => 0, ...(await boot()) }
  } catch (e) {
    await close()
    throw e
  }
}
