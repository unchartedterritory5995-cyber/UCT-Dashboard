import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 9800 + Math.floor(Math.random() * 100)
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'econp-'))}`, 'about:blank'], { stdio: 'ignore' })
let wsu
for (let i = 0; i < 50 && !wsu; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsu = (l.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl } catch {} await sleep(200) }
const ws = new WebSocket(wsu); await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0; const pend = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((res) => { id++; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value
await send('Page.enable'); await send('Runtime.enable')
for (const sc of process.argv.slice(2)) {
  await send('Page.navigate', { url: `http://127.0.0.1:${process.env.VPORT||5191}/econ-harness.html?scenario=${sc}&src=api` })
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev('!!(window.__econ && window.__econ.ready)')) break } catch {} }
  const r = await ev(`(() => { const b = window.__econ.binder.bindings().find((x) => x.instanceId === 'e' + ${sc === 'overlay-fhfa-d' ? 2 : 0});
    const ss = [b.series, ...(b.runSeries || [])];
    return ss.map((s, i) => { const d = s.data(); const w = d.filter((p) => { const t = typeof p.time === 'string' ? p.time : (p.time.year ? p.time.year+'-'+String(p.time.month).padStart(2,'0')+'-'+String(p.time.day).padStart(2,'0') : String(p.time)); return t >= '2026-01-26' && t <= '2026-02-16' });
      return { run: i, n: d.length, finite: d.filter((p) => Number.isFinite(p.value)).length, window: w.map((p) => [p.time, p.value, p.color || null]) } }) })()`)
  console.log(sc, JSON.stringify(r))
}
ws.close(); chrome.kill(); process.exit(0)
