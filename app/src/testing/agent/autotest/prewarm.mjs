// UCT Agent AUTOTEST: the definitions PRE-WARM, and the strict repaint count it makes possible.
//
// ⚠ TEMPORARY — PR #948 (merge c531386f4c, uct-rs-phase3), app/src/components/chart/engine/serverCompute.js:
// the first `serverDeclares()` call of a page (an Agent turn's indicatorEdits context build) starts the page's one
// `/api/signature/definitions` request, and when it lands `_notify('definitions')` makes EVERY chart redraw once (one retry
// 30 s later if it failed). Measured bounded (2026-11-08, AUDIT: BOUNDED, NO HOLD): 2 clearRect per canvas layer per chart, once.
// So before a request is graded, the rig spends ONE plain-answer turn (no ops) to take that redraw, and GRADES it: the burst
// must be at most `maxClearsPerLayer` per layer per chart. After it, a chart the request did not touch must not repaint at all.
// Remove this constant (and its uses) when #948's fix lands.
export const DEFINITIONS_PREWARM = Object.freeze({ enabled: true, maxClearsPerLayer: 2, say: 'hello' })

/** Count every canvas clear in the page, per canvas (a redraw clears its layers first). Idempotent. */
export const installRepaintCounter = (p) => p.b.evaluate(`(() => { const P = CanvasRenderingContext2D.prototype; if (!P.__baCounted) { const orig = P.clearRect; P.clearRect = function (...a) { const m = window.__baClears; if (m) m.set(this.canvas, (m.get(this.canvas) || 0) + 1); return orig.apply(this, a) }; P.__baCounted = true } window.__baClears = new Map(); return true })()`)

/** → { <widget id>: [clears per canvas layer] } since the last read, and resets the count. */
export const readRepaints = (p) => p.b.evaluate(`(() => { const out = {}; const m = window.__baClears || new Map(); for (const w of document.querySelectorAll('[data-widget-id]')) { const isChart = w.dataset.widgetType === 'chart' || !!w.dataset.gridCellId; if (!isChart) continue; out[w.dataset.widgetId] = [...w.querySelectorAll('canvas')].map(c => m.get(c) || 0) } window.__baClears = new Map(); return out })()`)

/** One plain-answer turn, graded: → { counts, ok, detail }. `say` is the rig's p.say; `idle` its p.idle. */
export async function prewarm(p, sleep) {
  if (!DEFINITIONS_PREWARM.enabled) return null
  await installRepaintCounter(p)
  await p.say(DEFINITIONS_PREWARM.say, () => ({ disposition: 'answer', ops: [], reply: 'Hello.', question: null, unsupported_category: null }))
  await p.idle(20000)
  await sleep(1500)
  const counts = await readRepaints(p)
  const over = Object.entries(counts).filter(([, layers]) => layers.some(n => n > DEFINITIONS_PREWARM.maxClearsPerLayer))
  return { counts, ok: over.length === 0, detail: over.length ? `over the bound on ${over.map(([id, l]) => `${id}:${l.join(',')}`).join(' ')}` : undefined }
}

/** Charts that repainted at all in `counts`, as roles of the board. */
export function repaintedRoles(counts, roles) {
  const byId = Object.fromEntries(Object.entries(roles).map(([r, v]) => [v.id, r]))
  return Object.entries(counts || {}).filter(([, layers]) => layers.some(n => n > 0)).map(([id]) => byId[id] || `unknown:${id}`)
}
