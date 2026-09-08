/* The AUTHENTICATED auto-driving device harness.
 *
 * ⛔ WHY THIS EXISTS, IN ONE SENTENCE. BrowserStack gives this account SIXTY
 * SECONDS per device, so the minute cannot be spent driving a phone by hand —
 * it has to be spent by a program that authenticates, boots the real app,
 * drives real flows, and computes every verdict on-page.
 *
 * ⛔ IT IS NOT AN AUTH BYPASS. It POSTs the same `/api/auth/login` every browser
 * posts, same-origin, with a DISPOSABLE sandbox credential that arrives at
 * runtime from `./uct-r1.cred.js` — a file this module never contains and the
 * launcher deletes. Production auth is untouched. No token in a URL.
 *
 * ⛔ AND A FAILED PREREQUISITE MUST NEVER READ AS PASS. Every step declares what
 * it `needs`; if a prerequisite did not PASS, the step is BLOCKED and its body
 * never runs. That is the whole reason this file has a state machine instead of
 * a list of assertions — this program has already shipped four instruments that
 * reported success while measuring nothing:
 *   · a suite that passed because a `-t` filter matched no tests,
 *   · a landscape readout that had stopped polling and reported portrait,
 *   · a crosshair rail that sampled the frame before the one it needed,
 *   · a device step that called an un-tapped chart a FAIL.
 * A harness whose failure mode is silence is worse than no harness.
 *
 * ⛔ NO FIXED SLEEP AS PRIMARY SYNCHRONISATION. Everything waits on a SEMANTIC
 * condition through `until()`, which throws BY NAME when the condition never
 * arrives. Bounded delays exist only inside `settle()`, whose job is the
 * opposite: proving a value has STOPPED changing.
 */

export const STATE = {
  TRANSPORT_READY: 'TRANSPORT_READY',
  AUTH_READY: 'AUTH_READY',
  APP_READY: 'APP_READY',
  FLOW_READY: 'FLOW_READY',
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
}

/** Poll until `fn` returns something truthy; throw BY NAME if it never does. */
export async function until(what, fn, { timeout = 12000, gap = 120 } = {}) {
  const t0 = Date.now()
  let last
  for (;;) {
    try { last = await fn() } catch (e) { last = undefined }
    if (last) return last
    if (Date.now() - t0 > timeout) {
      throw new Error(`never arrived: ${what} (waited ${Date.now() - t0}ms)`)
    }
    await new Promise((r) => setTimeout(r, gap))
  }
}

/** Poll until `read()` returns the SAME value twice — a value that stopped moving.
 *
 * ⭐ This is the lesson `settledLegend` and `r1_toolbar_probe.py` both encode, and
 * the one the first R1 harness omitted: a computed style or layout box read on a
 * single frame is a sample, not a measurement. */
export async function settle(what, read, { timeout = 8000, gap = 150 } = {}) {
  const t0 = Date.now()
  let prev = JSON.stringify(await read())
  for (;;) {
    await new Promise((r) => setTimeout(r, gap))
    const now = await read()
    const s = JSON.stringify(now)
    if (s === prev) return now
    prev = s
    if (Date.now() - t0 > timeout) throw new Error(`never settled: ${what}`)
  }
}

/** A step's declared shape. `needs` is what makes BLOCKED possible. */
export function step(id, tier, title, needs, run) {
  return { id, tier, title, needs, run }
}

/**
 * Run steps in order, honouring prerequisites.
 *
 * ⛔ `needs` IS ENFORCED, NOT DOCUMENTED. A step whose prerequisite is anything
 * other than PASS does not execute — it is recorded BLOCKED with the id that
 * blocked it. Without this a broken login produces a screen full of green
 * "PASS" rows for flows that never ran, which is precisely the false-positive
 * the owner asked to be made impossible.
 */
export async function runSteps(steps, ctx, onProgress) {
  const results = []
  const byId = new Map()
  for (const s of steps) {
    const missing = (s.needs || []).filter((n) => (byId.get(n) || {}).state !== STATE.PASS)
    if (missing.length) {
      const r = { id: s.id, tier: s.tier, title: s.title, state: STATE.BLOCKED,
                  note: `blocked by ${missing.join(', ')}`, ms: 0, at: new Date().toISOString() }
      results.push(r); byId.set(s.id, r); onProgress && onProgress(results)
      continue
    }
    const t0 = Date.now()
    let r
    try {
      const out = await s.run(ctx)
      r = { id: s.id, tier: s.tier, title: s.title, state: STATE.PASS,
            observed: (out && out.observed) ?? null, expected: (out && out.expected) ?? null,
            note: (out && out.note) || '', ms: Date.now() - t0, at: new Date().toISOString() }
    } catch (e) {
      r = { id: s.id, tier: s.tier, title: s.title, state: STATE.FAIL,
            note: String((e && e.message) || e), ms: Date.now() - t0, at: new Date().toISOString() }
    }
    results.push(r); byId.set(s.id, r); onProgress && onProgress(results)
  }
  return results
}

/** Assert, with the observed value carried into the record either way. */
export function expect(observed, ok, expected, note) {
  if (!ok) {
    const e = new Error(`expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}${note ? ' — ' + note : ''}`)
    e.observed = observed
    throw e
  }
  return { observed, expected, note: note || '' }
}

// ─── reading the app, which lives in a same-origin iframe ────────────────────

export function appDoc(frame) {
  try { return frame.contentDocument } catch { return null }
}

/** The app's own answer to "what am I showing?", read from what a user sees. */
export function appState(frame) {
  const d = appDoc(frame)
  if (!d || !d.body) return { reachable: false }
  const txt = (el) => (el && (el.textContent || '').trim()) || ''
  const strip = d.querySelector('[class*="symStrip" i]')
  const sym = txt(strip).match(/[A-Z]{2,6}/)
  return {
    reachable: true,
    path: (() => { try { return frame.contentWindow.location.pathname } catch { return '?' } })(),
    shell: !!d.documentElement.getAttribute('data-mobile-chart-shell'),
    symbol: sym ? sym[0] : '',
    tf: txt(d.querySelector('[class*="tbTf" i]')),
    canvases: d.querySelectorAll('.tv-lightweight-charts').length,
  }
}

/** Dismiss the intro takeover with its OWN control — never a sleep. */
export function skipIntro(frame) {
  const d = appDoc(frame)
  const b = d && d.querySelector('[aria-label="Skip intro"]')
  if (b) { try { b.click(); return true } catch { /* ignore */ } }
  return false
}

/** Load the app and wait for a chart that is actually drawn. */
export async function bootApp(frame, path = '/charts') {
  frame.src = path
  await until('the app document', () => {
    skipIntro(frame)
    const d = appDoc(frame)
    return d && d.body && d.body.childElementCount > 0
  }, { timeout: 20000 })
  const st = await until('a drawn chart canvas', () => {
    skipIntro(frame)
    const s = appState(frame)
    return s.reachable && s.canvases > 0 && s.symbol ? s : null
  }, { timeout: 25000 })
  return st
}

// ─── the server, exercised FROM THE DEVICE ──────────────────────────────────

const J = { 'Content-Type': 'application/json' }
export const api = {
  async me() { const r = await fetch('/api/auth/me', { credentials: 'include' }); return r.ok ? r.json() : null },
  async login(cred) {
    const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: J, body: JSON.stringify(cred) })
    if (!r.ok) throw new Error('login HTTP ' + r.status)
    return true
  },
  async prefs() { const r = await fetch('/api/auth/preferences', { credentials: 'include' }); if (!r.ok) throw new Error('prefs HTTP ' + r.status); return r.json() },
  async setPref(key, value) {
    const r = await fetch('/api/auth/preferences', { method: 'POST', credentials: 'include', headers: J, body: JSON.stringify({ key, value }) })
    if (!r.ok) throw new Error('setPref HTTP ' + r.status)
    return r.json()
  },
  /** ⛔ `{global, mine}` — NOT an array and NOT `{layouts}`. Asserting the wrong
   *  shape here is the exact instrument defect that made the first device run
   *  report `rows 0→undefined`, a green call carrying a meaningless assertion. */
  async layouts() { const r = await fetch('/api/charts/layouts', { credentials: 'include' }); if (!r.ok) throw new Error('layouts HTTP ' + r.status); return r.json() },
  async saveLayout(name, layout) {
    const r = await fetch('/api/charts/layouts', { method: 'POST', credentials: 'include', headers: J, body: JSON.stringify({ name, layout, scope: 'user' }) })
    if (!r.ok) throw new Error('saveLayout HTTP ' + r.status)
    return r.json()
  },
  async deleteLayout(id) { await fetch('/api/charts/layouts/' + id, { method: 'DELETE', credentials: 'include' }) },
}

export const mineNames = (d) => ((d && d.mine) || []).map((r) => r && r.name)
export const findMine = (d, name) => ((d && d.mine) || []).find((r) => r && r.name === name)

// ─── the flows ──────────────────────────────────────────────────────────────

export const WS_KEY = 'charts_workspace_layout'
export const TEST_LAYOUT = '__r1_device__'

/** Isolated marker written INTO the workspace blob — never a real board. */
export const marker = (runId) => ({ __r1_device_marker__: runId })

export function buildSteps({ frame, cred, runId }) {
  return [
    step('transport', 1, 'the sandbox is reachable from this device', [], async () => {
      const r = await fetch('/api/health', { credentials: 'include' })
      return expect(r.status, r.ok, 200, 'the tunnel reaches the sandbox')
    }),

    step('auth', 1, 'a REAL login through the real endpoint', ['transport'], async () => {
      let me = await api.me()
      if (!me) { await api.login(cred); me = await api.me() }
      const email = me && me.user && me.user.email
      return expect(email, !!email, 'an authenticated identity')
    }),

    step('app', 1, 'the authenticated app boots on this phone', ['auth'], async () => {
      const st = await bootApp(frame, '/charts')
      return expect(`${st.symbol} canvas=${st.canvases} shell=${st.shell ? 'phone' : 'no'}`,
        st.canvases > 0 && !!st.symbol, 'a drawn chart with a symbol')
    }),

    // ── TIER 1 · the MOB-08 gate ────────────────────────────────────────────
    step('ws-read', 1, 'the workspace record reads back from the device', ['app'], async () => {
      const p = await api.prefs()
      return expect(typeof p, p && typeof p === 'object', 'object', 'baseline preferences read')
    }),

    step('ws-write', 1, 'the phone WRITES the workspace record', ['ws-read'], async () => {
      const prev = await api.prefs()
      const base = (() => { try { return JSON.parse(prev[WS_KEY] || '{}') } catch { return {} } })()
      const next = { ...base, ...marker(runId) }
      await api.setPref(WS_KEY, JSON.stringify(next))
      return expect('written', true, 'written')
    }),

    step('ws-readback', 1, 'and READS IT BACK from the device — not from the host', ['ws-write'], async () => {
      const got = await until('the marker in the workspace record', async () => {
        const p = await api.prefs()
        try { return JSON.parse(p[WS_KEY] || '{}').__r1_device_marker__ === runId ? runId : null } catch { return null }
      })
      return expect(got, got === runId, runId, 'device write → device read-back')
    }),

    step('ws-reload', 1, 'it SURVIVES a reload, and the board is not blank', ['ws-readback'], async () => {
      const before = appState(frame)
      const st = await bootApp(frame, '/charts')          // a genuine re-entry
      const p = await api.prefs()
      const held = (() => { try { return JSON.parse(p[WS_KEY] || '{}').__r1_device_marker__ === runId } catch { return false } })()
      // ⛔ BLANK-BOARD DETECTION IS THE POINT OF THIS STEP. A persistence-shape
      // change that half-migrates leaves a board that mounts and draws nothing;
      // "the marker survived" alone would call that a PASS.
      return expect(`marker=${held} canvas=${st.canvases} symbol=${st.symbol} (was ${before.symbol})`,
        held && st.canvases > 0 && !!st.symbol,
        'marker held AND a drawn chart AND a symbol')
    }),

    step('ws-nosymloss', 1, 'the symbol survived the write — no unintended loss', ['ws-reload'], async () => {
      // ⚰️ THIS STEP READ A BARE `appState()` AND FAILED ON ITS FIRST LOCAL RUN,
      // one line after its predecessor had observed the very same symbol. The
      // app re-renders the strip after boot, so a single read lands on an empty
      // frame — the SAME sample-instead-of-settle defect as the crosshair rail
      // and the portrait toolbar. Caught locally, before a device minute, which
      // is exactly what local validation is for.
      const st = await until('a symbol and a canvas after the reload',
        () => { const a = appState(frame); return a.symbol && a.canvases > 0 ? a : null })
      return expect(`${st.symbol} canvas=${st.canvases}`, true, 'a symbol and a canvas')
    }),

    step('layout-rt', 1, 'a NAMED layout round-trips from the device', ['ws-readback'], async () => {
      await api.saveLayout(TEST_LAYOUT, { kind: 'multichart', widgets: [] })
      const got = await until('the named layout in `mine`', async () => {
        const d = await api.layouts()
        return findMine(d, TEST_LAYOUT) || null
      })
      return expect(mineNames(await api.layouts()).join(','), !!got, `contains ${TEST_LAYOUT}`)
    }),

    // ── TIER 2 · rotation ───────────────────────────────────────────────────
    step('rot-baseline', 2, 'record symbol/timeframe before rotating', ['app'], async () => {
      const st = await settle('the app state', () => appState(frame))
      return expect(`${st.symbol}/${st.tf}`, !!st.symbol, 'a symbol to compare against')
    }),

    step('rot-gate', 2, 'the landscape MODE gate answers for this orientation', ['rot-baseline'], async () => {
      const land = matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches
      const isLand = innerWidth > innerHeight
      return expect(`gate=${land} orientation=${isLand ? 'landscape' : 'portrait'}`,
        land === isLand || !isLand, 'the gate matches the orientation')
    }),

    // ── TIER 3 · the critical mobile flows, cheapest-first ──────────────────
    step('scales', 3, 'all four price scales are reachable from the phone', ['app'], async () => {
      // ⛔ NOT "does a menu exist" — the four scale rows BY ID. The pre-MOB-06′
      // defect was a row that ticked and wrote a value nothing read, so the
      // roster is what has to be asserted, not the door.
      const d = appDoc(frame), w = frame.contentWindow
      const lw = d.querySelector('.tv-lightweight-charts')
      if (!lw) throw new Error('no chart container')
      const el = lw.parentElement
      const got = []
      const onCtx = (e) => got.push(e.detail)
      w.addEventListener('uct:chart-contextmenu', onCtx)
      try {
        const r = el.getBoundingClientRect()
        const x = Math.round(r.right - 10)
        for (let y = Math.round(r.top + 8); y < r.bottom - 4 && !got.length; y += 6) {
          el.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y }))
        }
        const region = got.map((g) => (g.sections || []).find((sx) => sx.id === 'region')).find(Boolean)
        const ids = region ? (region.items || []).map((i) => i && i.id).filter(Boolean) : []
        const want = ['p-arith', 'p-log', 'p-pct', 'p-auto']
        return expect(ids.join(','), want.every((k) => ids.includes(k)), want.join(','))
      } finally { w.removeEventListener('uct:chart-contextmenu', onCtx) }
    }),

    step('tools', 3, 'the Tools door opens', ['app'], async () => {
      const d = appDoc(frame)
      const more = d && d.querySelector('[aria-label="More tools"]')
      if (!more) throw new Error('no More tools button')
      more.click()
      const sheet = await until('the Tools sheet', () => appDoc(frame).querySelector('[aria-label="Chart tools"]'))
      try { appDoc(frame).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) } catch {}
      return expect(!!sheet, !!sheet, 'the Tools sheet opens')
    }),

    step('chart-type', 3, 'the chart-type catalogue opens', ['app'], async () => {
      const d = appDoc(frame)
      const b = d && d.querySelector('[aria-label="Chart type"]')
      if (!b) throw new Error('no Chart type door')
      b.click()
      const sheet = await until('the chart-type sheet', () => {
        const dd = appDoc(frame)
        return [...dd.querySelectorAll('*')].some((n) => /heikin/i.test(n.textContent || '')) ? 'catalogue' : null
      })
      try { appDoc(frame).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) } catch {}
      return expect(sheet, !!sheet, 'a catalogue naming Heikin Ashi')
    }),
  ]
}

/** Remove everything this run created. Cleanup is a step, not an afterthought. */
export async function cleanup(runId) {
  const out = []
  try {
    const d = await api.layouts()
    const row = findMine(d, TEST_LAYOUT)
    if (row && row.id != null) { await api.deleteLayout(row.id); out.push('layout deleted') }
  } catch (e) { out.push('layout cleanup failed: ' + e.message) }
  try {
    const p = await api.prefs()
    const blob = (() => { try { return JSON.parse(p[WS_KEY] || '{}') } catch { return {} } })()
    if (blob.__r1_device_marker__) {
      delete blob.__r1_device_marker__
      await api.setPref(WS_KEY, JSON.stringify(blob))
      out.push('marker removed')
    }
  } catch (e) { out.push('marker cleanup failed: ' + e.message) }
  return out
}

export function summarise(results) {
  const c = (s) => results.filter((r) => r.state === s).length
  const t1 = results.filter((r) => r.tier === 1)
  return {
    pass: c(STATE.PASS), fail: c(STATE.FAIL), blocked: c(STATE.BLOCKED), total: results.length,
    tier1Pass: t1.every((r) => r.state === STATE.PASS),
    deviceWorkspaceRoundTrip: (() => {
      const need = ['ws-write', 'ws-readback', 'ws-reload', 'ws-nosymloss']
      const rows = need.map((id) => results.find((r) => r.id === id)).filter(Boolean)
      if (rows.length !== need.length) return STATE.BLOCKED
      if (rows.every((r) => r.state === STATE.PASS)) return STATE.PASS
      if (rows.some((r) => r.state === STATE.FAIL)) return STATE.FAIL
      return STATE.BLOCKED
    })(),
  }
}
