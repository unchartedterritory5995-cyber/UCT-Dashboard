// UCT Agent BROWSER ACCEPTANCE: the rig. Dev-only, never bundled (nothing imports it).
//
// One isolated headless Chrome (temp profile, loopback only) on agent-harness.html: the REAL ChartsWorkspace,
// the REAL AgentPanel, fixture lists, synthetic bars. Requests are typed into the real composer with real
// CDP input; results are read back from the real components (DOM and canvas pixels), not from receipts.
//
// THE MODEL IS SCRIPTED. `?live=<port>` points the Agent's /api/agent/turn at a loopback relay in this
// process, which answers with the plan a test wrote. No key, no paid call. A pass proves the plan EXECUTES;
// it says nothing about whether the real model would pick that plan.
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { launch, sleep } from '../../../econHarness/cdp.mjs'
export { sleep }

export const BASE = process.env.BA_BASE || 'http://127.0.0.1:5986'
const q = (s) => JSON.stringify(s)

// the scripted model, at the network boundary
export const env = (disposition, ops = [], reply = '', question = null, cat = null) =>
  ({ disposition, reply, question, ops, unsupported_category: cat })

/** "$charts[0]" / "$workspace" / "$drawings[0]" to the ref the panel really sent; "$ctx:a.0.b" to a live value. */
export function resolveTarget(t, body) {
  const m = /^\$([A-Za-z]+)(?:\[(\d+)\])?$/.exec(String(t || ''))
  if (!m) return t
  const list = body?.context?.[m[1]]
  return Array.isArray(list) && list[Number(m[2] || 0)] ? list[Number(m[2] || 0)].ref : `missing:${t}`
}
const resolveArg = (v, body) => (typeof v === 'string' && v.startsWith('$ctx:')
  ? v.slice(5).split('.').reduce((a, k) => a?.[k], body?.context) ?? `missing:${v}`
  : Array.isArray(v) ? v.map(x => resolveArg(x, body)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveArg(x, body)])) : v)
export const ops = (list, body) => list.map(o => ({ ...o, target: resolveTarget(o.target, body), args: resolveArg(o.args || {}, body) }))

export function startRelay({ groupOfAction }) {
  const R = { turns: [], records: [], queue: [], port: 0, ask(plan) { R.queue.push(plan) } }
  const plan = (body) => {
    const p = R.queue[0]
    if (!p) return env('answer', [], 'the script had no plan for this turn')
    const out = typeof p === 'function' ? p(body) : p
    const list = out.ops || []
    const have = new Set((body.capabilities || []).map(c => c.name))
    const missing = list.map(o => o.action).filter(a => !have.has(a))
    if (missing.length && !body.reroute && body.routing) return { ...env('answer'), need_groups: [...new Set(missing.map(groupOfAction).filter(Boolean))] }
    R.queue.shift()
    if (missing.length) return env('answer', [], `the model was not given: ${missing.join(', ')}`)
    return env(out.disposition || 'apply', ops(list, body), out.reply || '', out.question || null, out.unsupported_category || null)
  }
  const server = createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', () => {
      const path = req.url.split('?')[0]
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* */ }
      const send = (o, s = 200) => { res.writeHead(s, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (path === '/api/agent/turn') {
        R.turns.push({ message: body.message, reroute: !!body.reroute, at: Date.now(), context: body.context, capabilities: (body.capabilities || []).map(c => c.name) })
        setTimeout(() => send({ conversationId: body.conversationId || 'ac_ba', turnId: R.turns.length, envelope: plan(body), usage: { citations: [] } }), 350)
      } else if (path === '/api/agent/record') { R.records.push(body); send({ conversationId: body.conversationId || 'ac_ba' }) } else send({ detail: 'relay: not scripted' }, 404)
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => { R.port = server.address().port; R.close = () => server.close(); r(R) }))
}

// the page side: fixture bars that DIFFER by symbol and timeframe, so pixels can prove the redraw.
// Installed before the harness runs. The harness keeps every lock it has: this wraps its fetch from outside.
function pageInit(cfg) {
  const BA = (window.__ba = { cfg, bars: [], api: [], status: [], written: {}, fixtures: cfg.fixtures || {} })
  const native = window.fetch
  let inner = null
  const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 9973; return h }
  const shape = (bars, sym, tf) => {
    const k = 0.6 + (hash(sym) % 90) / 30, w = 3 + hash(sym) % 7
    const scaled = bars.map((b, i) => {
      const f = k * (1 + Math.sin(i / w) * 0.08)
      return { ...b, o: +(b.o * f).toFixed(2), h: +(b.h * f).toFixed(2), l: +(b.l * f).toFixed(2), c: +(b.c * f).toFixed(2) }
    })
    // intraday bars carry unix seconds, as the real route does: consecutive regular-session bars ending on the fixture's last day
    // (`dateShaped`: the bad payload behind #842, date strings on an intraday request)
    const mins = /^\d+$/.test(tf) && !cfg.dateShaped ? Number(tf) : null
    if (mins) {
      const perDay = Math.max(1, Math.floor(390 / mins))
      const last = Date.UTC(2025, 9, 8, 13, 30) / 1000
      return scaled.map((b, i) => {
        const back = scaled.length - 1 - i
        const day = Math.floor(back / perDay)
        return { ...b, t: last - day * 86400 + (perDay - 1 - (back % perDay)) * mins * 60 }
      })
    }
    if (tf !== 'W' && tf !== '1W') return scaled
    const out = []
    for (let i = 0; i < scaled.length; i += 5) {
      const s = scaled.slice(i, i + 5)
      out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map(x => x.h)), l: Math.min(...s.map(x => x.l)), c: s[s.length - 1].c, v: s.reduce((a, x) => a + x.v, 0) })
    }
    return out
  }
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  const wrapped = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const p0 = path.split('?')[0]
    if (method !== 'GET' && p0.startsWith('/api/')) BA.api.push({ method, path, body: (init && typeof init.body === 'string') ? init.body.slice(0, 4000) : null, at: Date.now() })
    if (p0 === '/api/auth/preferences' && method !== 'GET') { try { const b = JSON.parse(init.body); if (b && typeof b.key === 'string') { BA.written[b.key] = b.value } } catch { /* */ } }
    // price alerts: the same route and semantics as api/routers/watchlist_alerts.py, in this page only
    if (p0.startsWith('/api/watchlist-alerts')) {
      const A = (BA.alerts = BA.alerts || [])
      if (method === 'GET') return json(A)
      if (method === 'POST' && p0 === '/api/watchlist-alerts') {
        const b = JSON.parse(init.body)
        const row = { id: A.length + 1, sym: b.sym, target_price: b.target_price, direction: b.direction, is_active: 1, created_at: '2025-10-08T12:00:00Z', alert_type: b.alert_type || 'price', drawing_id: b.drawing_id || null, triggered_at: null }
        A.unshift(row)
        return json(row)
      }
      if (method === 'DELETE') { const id = Number(p0.split('/').pop()); BA.alerts = A.filter(a => a.id !== id); return json({ ok: true }) }
      return json({ ok: true })
    }
    // indicator alerts: the router's own shapes (api/routers/indicator_alerts.py), in this page only
    if (p0.startsWith('/api/indicator-alerts')) {
      const I = (BA.ialerts = BA.ialerts || [])
      if (p0 === '/api/indicator-alerts/catalog') return json({ catalog: cfg.iaCatalog || [], refusals: [] })
      if (method === 'GET') return json({ alerts: I })
      if (method === 'POST' && p0 === '/api/indicator-alerts') {
        const b = JSON.parse(init.body)
        const row = { id: 100 + I.length + 1, user_id: 1, sym: b.sym, indicator: b.indicator, condition: b.condition ?? null, threshold: b.threshold ?? null, tf: b.tf, params_json: b.params ?? null, active: true, instance_id: b.instance_id ?? null, scope: b.scope ?? null, state: 'armed', created_at: 1 }
        I.push(row)
        return json({ id: row.id })
      }
      return json({ ok: true })
    }
    for (const f of BA.fixtures.routes || []) {
      if (new RegExp(f.match).test(`${method} ${path}`)) return json(f.body, f.status || 200)
    }
    const res = await inner(input, init)
    if (p0.startsWith('/api/bars/') || p0.startsWith('/api/bars-history/')) {
      const u = new URL(url, location.origin)
      const sym = decodeURIComponent(p0.split('/')[3] || '').toUpperCase()
      const tf = u.searchParams.get('tf') || u.searchParams.get('timeframe') || 'D'
      BA.bars.push({ sym, tf, kind: p0.split('/')[2], url: path, at: Date.now() })
      const j = await res.clone().json().catch(() => null)
      if (j && Array.isArray(j.bars)) return json({ ...j, bars: shape(j.bars, sym, tf) })
    }
    if (p0 === '/api/auth/preferences' && method === 'GET' && cfg.prefs) {
      const j = await res.clone().json().catch(() => null)
      if (j) { const o = { ...j }; for (const [k, v] of Object.entries(cfg.prefs)) if (!(k in BA.written)) o[k] = v; return json(o) }
    }
    return res
  }
  Object.defineProperty(window, 'fetch', { configurable: true, get() { return inner ? wrapped : native }, set(v) { inner = v } })
  // what the chart really wrote to its canvases (axes, watermark): the text of each canvas's newest paint
  let frame = 0
  const tick = () => { frame++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const ft = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    const c = this.canvas
    if (c.__baF !== frame) { c.__baF = frame; c.__baT = [] }
    c.__baT.push(String(text))
    return ft.call(this, text, ...rest)
  }
  // the panel's status, as a transition log driven by the DOM itself (no timer: it cannot invent a state)
  const now = () => {
    const panel = document.querySelector('[data-testid="agent-panel"]')
    if (!panel) return null
    const head = panel.querySelector('[class*="typingNow"]') ? 'typing' : panel.querySelector('[class*="onlineWord"]')?.textContent || panel.querySelector('[class*="working"]')?.textContent || ''
    const line = panel.querySelector('[data-testid="agent-typing"]')?.textContent || ''
    return `${head} | ${line}`
  }
  const log = () => { const s = now(); if (s && BA.status.at(-1)?.s !== s) BA.status.push({ s, at: Date.now() }) }
  addEventListener('DOMContentLoaded', () => new MutationObserver(log).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] }))
}

// reading the real components. In-page. Everything here reads what is on screen; nothing asks the Agent.
const READ = `(() => {
  const fnv = (d) => { let h = 2166136261; for (let i = 0; i < d.length; i += 4) { h ^= d[i] ^ (d[i+1] << 8) ^ (d[i+2] << 16); h = Math.imul(h, 16777619) } return (h >>> 0).toString(16) }
  const chartHash = (el) => {
    const parts = []
    for (const c of el.querySelectorAll('canvas')) {
      if (c.width < 60 || c.height < 40) continue
      try { parts.push(fnv(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)) } catch { parts.push('x') }
    }
    return parts.join('.')
  }
  window.__baRead = (id) => {
    const out = []
    for (const e of document.querySelectorAll('[data-widget-id]')) {
      if (id && e.dataset.widgetId !== id) continue
      const r = e.getBoundingClientRect()
      const row = { id: e.dataset.widgetId, type: e.dataset.widgetType || (e.dataset.gridCellId ? 'chart' : undefined), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      if (row.type === 'chart') {
        row.sym = e.querySelector('[data-testid="sym-label"]')?.textContent?.trim() || null
        row.tf = [...e.querySelectorAll('[data-guide="chart.timeframe"] button')].filter(b => /tfBtnActive/.test(b.className)).map(b => b.textContent.trim()).join(',')
        row.pixels = chartHash(e)
        const on = (sel) => [...e.querySelectorAll(sel)].filter(b => /[Aa]ctive|[Oo]n_|Selected/.test(b.className) || b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim())
        row.scale = on('[class*="scaleToggleBtn"]').join(',')
        row.range = on('[class*="rangeBtn"]').join(',')
        row.session = on('[class*="sessionBtn"]').join(',')
        row.volume = !!e.querySelector('[class*="volLegend"]')
        row.chips = [...e.querySelectorAll('[class*="studyStack"] [class*="_chip_"]')].map(x => x.textContent.trim())
        row.chipClass = [...e.querySelectorAll('[class*="studyStack"] [class*="_chip_"]')].map(x => String(x.className).replace(/_[a-z0-9]+_d+/g, ''))
        row.panes = [...e.querySelectorAll('.tv-lightweight-charts table tr')].map(tr => Math.round(tr.getBoundingClientRect().height)).filter(h => h > 8)
        row.text = [...e.querySelectorAll('canvas')].flatMap(c => c.__baT || []).filter(t => String(t).trim()).slice(0, 120)
        row.canvases = e.querySelectorAll('canvas').length
      }
      out.push(row)
    }
    return out
  }
})()`

export async function open(R, { query = '', prefs = null, fixtures = null, iaCatalog = null, width = 1500, height = 900, ls = null, dateShaped = false } = {}) {
  const b = await launch({ width, height })
  const cfg = { prefs, fixtures, iaCatalog, dateShaped }
  const init = `(${pageInit.toString()})(${JSON.stringify(cfg)});` + (ls ? Object.entries(ls).map(([k, v]) => `try{localStorage.setItem(${q(k)},${q(v)})}catch{}`).join(';') : '')
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: init })
  await b.open(`${BASE}/agent-harness.html?watchlists=1&bars=ramp&theme=dark&live=${R.port}&${query}`)
  const ready = await b.waitFor(`!!document.querySelector('[data-testid="agent-launch"]') || !!document.querySelector('[aria-label="Message UCT Agent"]')`, { timeout: 60000 })
  if (!ready) { const t = await b.evaluate('document.body.innerText.slice(0,200)').catch(() => ''); b.close(); throw new Error(`harness did not load: ${t}`) }
  await b.evaluate(READ)
  return mkPage(b, R)
}

function mkPage(b, R) {
  const box = (sel) => b.evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
  const P = {
    b,
    R,
    box,
    read: (id) => b.evaluate(`window.__baRead(${id ? q(id) : ''})`),
    charts: async () => (await P.read()).filter(w => w.type === 'chart'),
    /** Wait until the charts have stopped repainting. */
    settle: async (ms = 1000, max = 12000) => {
      const t0 = Date.now(); let last = null, since = Date.now()
      while (Date.now() - t0 < max) {
        const s = JSON.stringify((await P.charts()).map(c => [c.sym, c.pixels]))
        if (s !== last) { last = s; since = Date.now() } else if (Date.now() - since >= ms) return true
        await sleep(200)
      }
      return false
    },
    openPanel: async () => {
      const has = await box('[aria-label="Message UCT Agent"]')
      if (has) return
      const p = await box('[data-testid="agent-launch"]')
      await b.click(p.x, p.y)
      await b.waitFor(`!!document.querySelector('[aria-label="Message UCT Agent"]')`, { timeout: 30000 })
      await sleep(1000)        // the greeting's own "typing" ends
    },
    /** Click a chart's canvas: the real way a chart becomes "this chart". */
    select: async (id) => {
      const p = await b.evaluate(`(() => { const e = document.querySelector('[data-widget-id=${q(id)}]'); const c = [...e.querySelectorAll('canvas')].sort((a, z) => z.width * z.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
      await b.click(p.x, p.y)
      await b.hover(2, 2)      // the crosshair leaves, so "before" pictures hold no cursor
      await sleep(300)
    },
    /** Real input: click the composer, type, press Enter. */
    say: async (text, plan) => {
      if (plan) R.ask(plan)
      const c = await box('[aria-label="Message UCT Agent"]')
      await b.click(c.x, c.y)
      await b.type(text)
      await b.key('Enter')
    },
    idle: async (timeout = 15000) => {
      await sleep(150)
      const ok = await b.waitFor(`!document.querySelector('[data-testid="agent-typing"]')`, { timeout })
      await sleep(250)
      return !!ok
    },
    receipt: () => b.evaluate(`(() => { const a = [...document.querySelectorAll('[data-testid="agent-receipt"]')].at(-1); return a ? { text: a.textContent.trim(), undoable: a.getAttribute('data-undoable'), status: a.getAttribute('data-status') } : null })()`),
    receipts: () => b.evaluate(`document.querySelectorAll('[data-testid="agent-receipt"]').length`),
    proposal: () => b.evaluate(`(() => { const a = [...document.querySelectorAll('[data-testid="agent-proposal"]')].filter(e => e.getAttribute('data-status') === 'pending').at(-1); return a ? a.textContent.trim() : null })()`),
    transcript: () => b.evaluate(`document.querySelector('[data-testid="agent-transcript"]')?.innerText || ''`),
    last: () => b.evaluate(`(() => { const t = document.querySelector('[data-testid="agent-transcript"]'); const k = t ? [...t.children] : []; return k.slice(-2).map(x => x.innerText).join(' // ') })()`),
    button: async (name, scope = '[data-testid="agent-transcript"]') => {
      const p = await b.evaluate(`(() => { const e = [...document.querySelectorAll(${q(scope + ' button')})].filter(x => x.textContent.trim() === ${q(name)}).at(-1); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
      if (!p) return false
      await b.click(p.x, p.y)
      return true
    },
    status: () => b.evaluate('window.__ba.status.slice()'),
    bars: () => b.evaluate('window.__ba.bars.slice()'),
    api: () => b.evaluate('window.__ba.api.slice()'),
    written: () => b.evaluate('window.__ba.written'),
    H: (expr) => b.evaluate(`(() => { const H = window.__agentHarness; return ${expr} })()`),
    ls: (key) => b.evaluate(`localStorage.getItem(${q(key)})`),
    errors: () => b.consoleErrors.slice(),
    shot: async (path) => writeFileSync(path, await b.shot()),
    close: () => b.close(),
  }
  return P
}
