/* The on-device script: real interactions against the real phone shell.
 *
 * Every step below is something the previous sprint could NOT verify on
 * hardware, because the authenticated app put a login form in front of the
 * phone. None of them needs a login — they are all frontend behaviour — so all
 * of them are answerable here.
 */
import { run, until, tap, longPress, byLabel, byLabelLike, sleep } from './runner'
import * as drawingsStore from '../../components/chart/drawingsStore'

const doc = () => document
const q = (sel) => document.querySelector(sel)
const qa = (sel) => [...document.querySelectorAll(sel)]

/** The element `createChart` was handed — the node the long-press listens on. */
const chartEl = () => {
  const lw = q('.tv-lightweight-charts')
  if (!lw) throw new Error('no lightweight-charts container')
  return lw.parentElement
}

/** Open the Tools sheet, returning once it is on screen. */
async function openTools() {
  const more = await until('the More tools button', () => byLabel(doc(), 'More tools'))
  tap(more)
  return until('the Tools sheet', () => byLabel(doc(), 'Chart tools'))
}

/** Dismiss anything the previous step left open.
 *
 * ⛔ THE FLAKE THIS EXISTS FOR, and it was the harness's fault rather than the
 * product's: consecutive long-presses alternated pass/fail, because the menu the
 * FIRST press opened was still on screen and swallowed the second press's
 * pointerdown. A device run that fails every other step reads as a broken
 * feature; it was a dirty starting state. */
async function dismissOverlays() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
  document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
  await sleep(250)
}

/** Long-press the price axis and return the sections the shell built.
 *  Retries ONCE — a single missed synthetic gesture is a harness artefact, and
 *  two in a row is a finding. The failure names what it did resolve. */
async function priceAxisMenu() {
  let lastSeen = 'nothing'
  for (let attempt = 0; attempt < 2; attempt++) {
    await dismissOverlays()
    const el = chartEl()
    const r = el.getBoundingClientRect()
    const got = []
    const onCtx = (e) => got.push(e.detail)
    window.addEventListener('uct:chart-contextmenu', onCtx)
    try {
      // A move first: `openMenuAt` prefers the hovered bar, and a press with no
      // prior pointer position is the one case it has to fall back for.
      const x = Math.round(r.right - 12)
      const y = Math.round(r.top + r.height * 0.35)
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }))
      // eslint-disable-next-line no-await-in-loop
      await longPress(el, { x, y })
      const hit = got.find((g) => g.region && g.region.type === 'priceAxis')
      if (hit) return hit.sections
      lastSeen = got.map((g) => g.region && g.region.type).join(',') || 'nothing'
    } finally {
      window.removeEventListener('uct:chart-contextmenu', onCtx)
    }
  }
  throw new Error(`two long-presses resolved ${lastSeen}, not priceAxis`)
}

const scaleRows = (secs) => {
  const s = (secs || []).find((x) => x.id === 'region')
  if (!s) throw new Error('no price-scale section')
  return s.items.filter((i) => i && i.kind === 'toggle')
}

const STEPS = [
  { name: 'device reports a COARSE pointer', run: () => {
    if (!matchMedia('(pointer: coarse)').matches) throw new Error('pointer is fine — not a touch device')
    return 'true'
  } },

  { name: 'phone chart shell is active', run: async () => {
    await until('data-mobile-chart-shell', () => document.documentElement.hasAttribute('data-mobile-chart-shell'))
    return 'true'
  } },

  { name: 'viewport', note: true, run: () => `${document.documentElement.clientWidth}px` },

  { name: 'the chart actually drew', run: async () => {
    await until('a lightweight-charts canvas', () => q('.tv-lightweight-charts canvas'))
    return `${qa('canvas').length} canvases`
  } },

  { name: 'symbol strip + thumb toolbar present', run: async () => {
    await until('the symbol strip', () => byLabelLike(doc(), /^Change symbol/))
    await until('the chart toolbar', () => byLabel(doc(), 'Chart controls'))
    return 'both'
  } },

  // ── the scale menu: the flow the login form blocked ───────────────────────
  { name: 'price-axis long-press opens Price scale', run: async () => {
    const rows = scaleRows(await priceAxisMenu())
    const ids = rows.map((r) => r.id).join(',')
    if (ids !== 'p-arith,p-log,p-pct') throw new Error(`rows were ${ids}`)
    return ids
  } },

  { name: 'PERCENT is reachable and takes effect', run: async () => {
    const rows = scaleRows(await priceAxisMenu())
    rows.find((r) => r.id === 'p-pct').onSelect()
    await sleep(400)
    const after = scaleRows(await priceAxisMenu())
    const ticked = after.filter((r) => r.checked).map((r) => r.id)
    if (ticked.join(',') !== 'p-pct') throw new Error(`ticked ${ticked.join(',') || 'nothing'} after choosing Percent`)
    return 'p-pct ticked'
  } },

  { name: 'LOG from Percent clears Percent (the inert-writer bug)', run: async () => {
    const rows = scaleRows(await priceAxisMenu())
    rows.find((r) => r.id === 'p-log').onSelect()
    await sleep(400)
    const ticked = scaleRows(await priceAxisMenu()).filter((r) => r.checked).map((r) => r.id)
    if (ticked.join(',') !== 'p-log') throw new Error(`ticked ${ticked.join(',') || 'nothing'}`)
    return 'p-log only'
  } },

  { name: 'ARITHMETIC restores', run: async () => {
    const rows = scaleRows(await priceAxisMenu())
    rows.find((r) => r.id === 'p-arith').onSelect()
    await sleep(400)
    const ticked = scaleRows(await priceAxisMenu()).filter((r) => r.checked).map((r) => r.id)
    if (ticked.join(',') !== 'p-arith') throw new Error(`ticked ${ticked.join(',') || 'nothing'}`)
    return 'p-arith'
  } },

  { name: 'the price-context sheet keeps its own rows', run: async () => {
    const secs = await priceAxisMenu()
    const pa = secs.find((s) => s.id === 'priceactions')
    if (!pa) throw new Error('no priceactions section')
    const ids = pa.items.filter(Boolean).map((i) => i.id)
    if (!ids.includes('draw-hline') || !ids.includes('copy-price')) throw new Error(`rows ${ids.join(',')}`)
    return ids.join(',')
  } },

  // ── the A/L/% chips must STAY hidden (the repair restored the task, not them)
  { name: 'A/L/% chips remain hidden on the phone', run: () => {
    const chips = qa('[class*="scaleToggle"]').find((e) => !/scaleToggleBtn|scaleToggleActive/.test(e.className))
    if (!chips) return 'not rendered at all'
    if (getComputedStyle(chips).display !== 'none') {
      // Say which pointer was actually in play. On a desktop browser this SHOULD
      // fail — the chips are a fine-pointer control — and a message that claims
      // "on a coarse pointer" regardless would misreport the desktop control run.
      const coarse = matchMedia('(pointer: coarse)').matches
      throw new Error(coarse
        ? 'VISIBLE on a coarse pointer — the phone hide regressed'
        : 'visible (pointer is FINE — expected on desktop, this step only means something on a device)')
    }
    return 'display:none'
  } },

  // ── the crosshair readout ────────────────────────────────────────────────
  // ── the store, on THIS origin ────────────────────────────────────────────
  // ⛔ THE ROW THAT EXPLAINS THE NEXT ONE. `crypto.randomUUID` is
  // secure-context-only, and a phone reaches this dev server over plain HTTP.
  // A run that records the transport cannot mistake a transport failure for a
  // product failure a second time.
  { name: 'secure context', note: true, run: () =>
    `${window.isSecureContext ? 'secure' : 'INSECURE'} · randomUUID ${typeof crypto.randomUUID === 'function' ? 'present' : 'ABSENT'}` },

  { name: 'a drawing can be CREATED on this device', run: async () => {
    // This is the exact call every placed trendline makes, and it threw silently
    // here until `utils/uid.js` — the gesture did nothing and printed nothing.
    const sym = 'SPY'
    const before = drawingsStore.getSnapshot(sym).drawings.length
    const id = drawingsStore.addDrawing(sym, { type: 'horizontal', points: [{ price: 114.26 }] })
    const after = drawingsStore.getSnapshot(sym).drawings.length
    if (!id || after !== before + 1) throw new Error(`id=${id} · ${before} → ${after}`)
    drawingsStore.removeDrawing(sym, id)   // leave the device as we found it
    return `${String(id).slice(0, 8)}… · ${before} → ${after}`
  } },

  // ── Tools sheet: Layouts + Drawing boards ────────────────────────────────
  { name: 'Tools sheet opens', run: async () => { await openTools(); return 'open' } },

  { name: 'Tools carries Layouts AND Drawing boards', run: async () => {
    await until('the Layouts row', () => byLabel(doc(), 'Layouts'))
    await until('the Drawing boards row', () => byLabel(doc(), 'Drawing boards'))
    return 'both rows'
  } },

  { name: 'Drawing boards sheet opens and lists boards', run: async () => {
    tap(byLabel(doc(), 'Drawing boards'))
    await until('the boards sheet', () => byLabel(doc(), 'Drawing boards') && qa('[data-testid="board-row"]').length)
    return `${qa('[data-testid="board-row"]').length} board(s)`
  } },

  { name: 'New board creates one in the STORE', run: async () => {
    const before = drawingsStore.listTracings().length
    tap(await until('the New board row', () => byLabel(doc(), 'New board')))
    await sleep(300)
    const after = drawingsStore.listTracings().length
    if (after !== before + 1) throw new Error(`${before} → ${after}`)
    return `${before} → ${after}`
  } },

  { name: 'Layouts sheet opens with prebuilts', run: async () => {
    // Close the boards sheet first, then reopen Tools.
    const close = byLabelLike(doc(), /^Close/)
    if (close) tap(close)
    await sleep(250)
    await openTools()
    tap(await until('the Layouts row', () => byLabel(doc(), 'Layouts')))
    await until('a layout row', () => /Swing board|UCT Default/.test(document.body.innerText))
    return 'listed'
  } },

  { name: 'no horizontal overflow', run: () => {
    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth) throw new Error(`${de.scrollWidth} > ${de.clientWidth}`)
    return `${de.scrollWidth} = ${de.clientWidth}`
  } },

  { name: 'orientation', note: true, run: () => (innerWidth > innerHeight ? 'landscape' : 'portrait') },

  // ⛔ LAST ON PURPOSE. This is the only step that waits on a HUMAN, and a
  // blocking step in the middle of the list holds every automated step behind
  // it — on a rationed device session that turns one un-tapped chart into a
  // run with nothing measured at all.
  { name: '👉 TAP THE CHART — then: V · $ Vol · Avg ND', run: async () => {
    // ⛔ THE ONE STEP THAT CANNOT BE SELF-DRIVEN, and it is worth saying why
    // rather than quietly dropping it. lightweight-charts moves its crosshair
    // from its own pointer handling, and a SYNTHETIC event does not drive it —
    // dispatching `mousemove`/`pointermove` at every element from the canvas up
    // to `.tv-lightweight-charts` produces no crosshair and no legend (measured).
    // A real finger does, which is exactly what a device session has.
    //
    // So this step WAITS for a real tap instead of faking one, and says so in
    // its own name so a screenshot of the panel tells the tester what to do. It
    // fails honestly if no tap arrives rather than reporting a legend nobody saw.
    await dismissOverlays()
    let text = null
    try {
      text = await until('a tap', () => {
        const o = qa('span').find((s) => /^O\s/.test(s.textContent || ''))
        return o && o.parentElement ? o.parentElement.textContent : null
      }, { tries: 60, gap: 300 })
    } catch {
      // ⛔ NOT A FAILURE — "nobody tapped" and "the readout is wrong" are
      // different facts, and an unattended run reporting a red step trains you
      // to ignore red. This says NOT ATTEMPTED and stays out of the fail count.
      return 'NOT ATTEMPTED (no tap arrived) — tap the chart to check this one'
    }
    const t = text.replace(/\s+/g, ' ')
    const missing = ['V ', '$ Vol', 'Avg '].filter((k) => !t.includes(k))
    if (missing.length) throw new Error(`TAPPED but missing ${missing.join(' / ')} in "${t.slice(0, 80)}"`)
    return t.slice(0, 64)
  } },
]

// ─── rendering ──────────────────────────────────────────────────────────────
const MARK = { pass: '<b style="color:#4ade80">PASS</b>', fail: '<b style="color:#ef4444">FAIL</b>', note: '·', pending: '·', running: '…' }

function render(results) {
  const el = document.getElementById('verdicts')
  if (!el) return
  const fails = results.filter((r) => r.state === 'fail').length
  const done = results.filter((r) => r.state === 'pass' || r.state === 'fail' || r.state === 'note').length
  // ⛔ THE HEADER NAMES THE FAILURES, because the list scrolls and a device
  // session does not wait. A run that reported "1 FAIL" and scrolled the failing
  // row out of frame cost a whole device minute and told me nothing.
  const failed = results.filter((r) => r.state === 'fail').map((r) => r.name)
  el.innerHTML =
    `<div><b>PHONE SHELL — ${done}/${results.length}</b> · `
    + (fails ? `<b style="color:#ef4444">${fails} FAIL</b>` : '<b style="color:#4ade80">no failures</b>')
    + ` · <span style="color:#8a8578">${new Date().toISOString().slice(11, 19)}</span></div>`
    + (fails ? `<div style="color:#ef4444">↳ ${failed.join(' | ')}</div>` : '')
    + results.map((r) => `<div>${MARK[r.state] || '·'} ${r.name}${r.note ? `: <span style="color:#8a8578">${r.note}</span>` : ''}</div>`).join('')
}

export async function start() {
  // Let the shell mount and the chart draw before driving anything.
  await sleep(1500)
  const results = await run(STEPS, render)
  window.__deviceResults = results
  return results
}
