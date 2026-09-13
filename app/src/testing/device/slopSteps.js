/* TOUCH SLOP, ON A REAL FINGER — select versus move.
 *
 * ⛔ THE DEFECT THIS GUARDS. `handlePointerDown` used to write `dragRef.current`
 * the instant a drawing was grabbed, and the very next `pointermove` applied the
 * delta. A finger always jitters a pixel or two, so tapping a trendline to open
 * its menu NUDGED IT OFF ITS ANCHOR — silently, with an undo entry the member
 * has to think of. `SLOP_COARSE = 8` is the gate; this proves it on hardware.
 *
 * ⛔⛔ GEOMETRY IS READ FROM THE STORE, NEVER INFERRED FROM POINTER EVENTS.
 * "The events I sent did not arm the drag" is a statement about my own
 * dispatching; "the line is still at the same price" is a statement about the
 * product. `drawingsStore` applies state AND localStorage synchronously (its own
 * header says so), and the harness is same-origin with the app, so the persisted
 * map is the authoritative geometry — no product test hook, no pixel guessing.
 *
 * ⛔ AND THE DRAWING IS PLACED BY TAPPING, the way a member makes one. That is
 * the only way to know WHERE it is in pixels without reaching into the chart's
 * coordinate system: the tap that creates it is the anchor every later gesture
 * uses. A drawing added straight to the store could land off-screen, and every
 * gesture after it would be measuring an empty patch of canvas.
 *
 * ⭐ SETTLED != READY. Placing a drawing settles the store; it does not mean the
 * OVERLAY can hit-test it. Readiness here is semantic: the drawing is ready when
 * a tap on its anchor SELECTS it (the touch quick-bar appears), and no gesture
 * case runs until that has happened.
 */
import { until, expect, appDoc, appState, bootApp, api } from './authHarness'

const DRAW_LS = 'uct-chart-drawings'

const step = (id, tier, title, needs, run) => ({ id, tier, title, needs, run })

/* ── the product's own persisted geometry ─────────────────────────────────── */

function allDrawings(frame) {
  try {
    const raw = frame.contentWindow.localStorage.getItem(DRAW_LS)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
/** Every drawing across every symbol — the harness does not need to know which
 *  symbol the shell settled on, and guessing one is how a probe reads nothing
 *  and calls it "unchanged". */
function flatDrawings(frame) {
  const all = allDrawings(frame)
  const out = []
  for (const sym of Object.keys(all)) for (const d of all[sym] || []) out.push({ sym, ...d })
  return out
}
function byId(frame, id) {
  return flatDrawings(frame).find((d) => d.id === id) || null
}
/** The geometry under test, as a comparable string. */
function geom(d) {
  if (!d || !Array.isArray(d.points)) return null
  return JSON.stringify(d.points.map((p) => ({ t: p.time ?? null, p: p.price ?? null })))
}

/* ── gestures ─────────────────────────────────────────────────────────────── */

const PE = (frame, type, x, y, extra = {}) => new frame.contentWindow.PointerEvent(type, {
  bubbles: true, cancelable: true, clientX: x, clientY: y,
  pointerId: 1, pointerType: 'touch', isPrimary: true,
  button: type === 'pointerup' ? 0 : 0,
  buttons: type === 'pointerup' ? 0 : 1,
  ...extra,
})

/** The element a finger would actually hit at that point. */
function hitEl(frame, x, y) {
  const d = appDoc(frame)
  const el = d.elementFromPoint(x, y)
  if (!el) throw new Error(`nothing at (${x}, ${y}) to touch`)
  return el
}

/** A tap: down and up at one point, no movement at all. */
function tapAt(frame, x, y) {
  const el = hitEl(frame, x, y)
  el.dispatchEvent(PE(frame, 'pointerdown', x, y))
  el.dispatchEvent(PE(frame, 'pointerup', x, y))
}

/**
 * A press-move-release whose MAXIMUM displacement is exactly `dy`.
 *
 * ⛔ ONE MOVE, NOT A RAMP, for the threshold cases. A ramp's intermediate points
 * are themselves displacements, so a 4-step ramp to 8px passes through 2, 4 and
 * 6 — fine for "below" but it makes "exactly at the threshold" untestable,
 * because the case is about the largest distance reached, not the path.
 */
function dragBy(frame, x, y, dy, { second = false } = {}) {
  const el = hitEl(frame, x, y)
  el.dispatchEvent(PE(frame, 'pointerdown', x, y))
  if (second) {
    // A SECOND finger arrives mid-gesture — the pinch that must cancel the drag.
    el.dispatchEvent(PE(frame, 'pointerdown', x + 40, y, { pointerId: 2, isPrimary: false }))
  }
  el.dispatchEvent(PE(frame, 'pointermove', x, y + dy))
  el.dispatchEvent(PE(frame, 'pointerup', x, y + dy))
  if (second) el.dispatchEvent(PE(frame, 'pointerup', x + 40, y, { pointerId: 2, isPrimary: false }))
}

/** The touch quick-bar — the shell's own "a drawing is selected" signal. */
const selected = (frame) => {
  const d = appDoc(frame)
  return !!(d && d.querySelector('[data-uct-qbar]'))
}

const dismiss = (frame) => {
  try {
    const w = frame.contentWindow
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    appDoc(frame).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  } catch { /* nothing open */ }
}

export function buildSlopSteps({ frame, cred }) {
  // Carried between steps: the anchor the drawing was tapped into existence at,
  // its id, and the geometry every later case compares against.
  const ctx = { x: 0, y: 0, id: null, base: null }

  return [
    step('slop-auth', 1, 'a real login, so the suite stands alone', [], async () => {
      const me = await api.me()
      if (!me) await api.login(cred)
      return expect(!!(await api.me()), true, true, 'authenticated')
    }),

    step('slop-pointer', 1, 'the device reports a COARSE pointer — which slop is in force', ['slop-auth'], async () => {
      // ⛔ WITHOUT THIS A PASS IS UNATTRIBUTABLE. The 4px case must NOT arm under
      // SLOP_COARSE (8) and MUST arm under SLOP_FINE (2), so the same result
      // means opposite things depending on the pointer. Naming it makes the run
      // interpretable — and a fine-pointer device would fail the cases below,
      // correctly, rather than passing them for the wrong reason.
      const coarse = frame.contentWindow.matchMedia('(pointer: coarse)').matches
      return expect(coarse ? 'coarse (slop 8)' : 'fine (slop 2)', coarse,
        'coarse (slop 8)', 'the threshold under test is the coarse one')
    }),

    step('slop-app', 1, 'the chart is drawn and the canvas is reachable', ['slop-auth'], async () => {
      const st = await bootApp(frame, '/charts?sym=NVDA&tf=D')
      return expect(st.canvases, st.canvases > 0, '> 0', 'a drawn chart')
    }),

    step('slop-arm', 1, 'the horizontal-line tool is armed through the member’s own door', ['slop-app'], async () => {
      const more = await until('the More tools button', () => appDoc(frame).querySelector('[aria-label="More tools"]'))
      more.click()
      const tools = await until('the Tools sheet', () => appDoc(frame).querySelector('[aria-label="Chart tools"]'))
      const drawRow = [...tools.querySelectorAll('button')].find((b) => /draw on chart/i.test(b.textContent || ''))
      if (!drawRow) throw new Error('no "Draw on chart" row')
      drawRow.click()
      // ⛔ THE ⊞ DOOR ONLY EXISTS ONCE THE DRAW BAR IS OPEN (measured in
      // shellSteps) — asking for it first is how this step used to time out.
      const all = await until('the All-tools door', () => appDoc(frame).querySelector('[aria-label="All drawing tools"]'))
      all.click()
      const box = await until('the tool search box', () => appDoc(frame).querySelector('[aria-label="Search drawing tools"]'))
      const w = frame.contentWindow
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
      setter.call(box, 'horizontal')
      box.dispatchEvent(new w.Event('input', { bubbles: true }))
      const hit = await until('the horizontal tool in the picker', () => {
        const dlg = [...appDoc(frame).querySelectorAll('[role="dialog"]')]
          .find((d) => d.getAttribute('aria-label') === 'All drawing tools')
        if (!dlg) return null
        return [...dlg.querySelectorAll('button')].find((b) => /horizontal/i.test(b.textContent || '')) || null
      })
      hit.click()
      return expect('armed', true, 'armed', 'the horizontal line tool is selected')
    }),

    step('slop-place', 1, '⭐ a drawing is PLACED BY TAPPING, so its pixel anchor is known', ['slop-arm'], async () => {
      const d = appDoc(frame)
      const lw = await until('the chart container', () => d.querySelector('.tv-lightweight-charts'))
      const r = lw.getBoundingClientRect()
      // Mid-canvas, left of the price axis: inside the plot, clear of the axis
      // and of the transport pill in the lower-left.
      ctx.x = Math.round(r.left + r.width * 0.42)
      ctx.y = Math.round(r.top + r.height * 0.42)
      const before = flatDrawings(frame).map((x) => x.id)
      tapAt(frame, ctx.x, ctx.y)

      const made = await until('the new drawing in the store', () => {
        const now = flatDrawings(frame)
        return now.find((x) => !before.includes(x.id)) || null
      }, { timeout: 8000 })
      ctx.id = made.id
      ctx.base = geom(made)
      // ⛔ A PROBE THAT CANNOT READ GEOMETRY MUST NOT REPORT "UNCHANGED".
      if (!ctx.base) throw new Error('the drawing has no readable geometry — every later case would be vacuous')
      return expect({ id: ctx.id, type: made.type, geometry: ctx.base },
        !!ctx.id && !!ctx.base, 'a drawing with readable points')
    }),

    step('slop-ready', 1, '⛔ SETTLED != READY — a tap SELECTS it before any gesture is judged',
      ['slop-place'], async () => {
        // The store settling says the drawing exists; it says nothing about the
        // overlay being able to hit-test it. If this never selects, every case
        // below would be touching empty canvas and reporting "geometry
        // unchanged" — a green run that proves nothing.
        dismiss(frame)
        const cursor = appDoc(frame).querySelector('[aria-label="Cursor"], [aria-label*="cursor" i]')
        if (cursor) cursor.click()   // back to select mode, else taps keep drawing
        await until('the drawing to be selectable at its anchor', () => {
          tapAt(frame, ctx.x, ctx.y)
          return selected(frame) ? true : null
        }, { timeout: 8000 })
        return expect('selected', true, 'selected', 'the overlay can reach this drawing')
      }),

    step('slop-A-tap', 1, 'A · tap to select → geometry UNCHANGED', ['slop-ready'], async () => {
      tapAt(frame, ctx.x, ctx.y)
      const now = geom(byId(frame, ctx.id))
      return expect({ before: ctx.base, after: now }, now === ctx.base,
        'identical geometry', 'selecting must never move a drawing')
    }),

    step('slop-B-below', 1, 'B · 4px — BELOW the coarse threshold → geometry UNCHANGED', ['slop-ready'], async () => {
      dragBy(frame, ctx.x, ctx.y, 4)
      const now = geom(byId(frame, ctx.id))
      return expect({ dy: 4, before: ctx.base, after: now }, now === ctx.base,
        'identical geometry', 'a finger jitter is not a move')
    }),

    step('slop-C-at', 1, 'C · exactly 8px — the rule is STRICTLY GREATER → geometry UNCHANGED', ['slop-ready'], async () => {
      // `crossedDragSlop` uses `> slop`, so the threshold value itself must not
      // arm. An implementation that used `>=` passes every other case here.
      dragBy(frame, ctx.x, ctx.y, 8)
      const now = geom(byId(frame, ctx.id))
      return expect({ dy: 8, before: ctx.base, after: now }, now === ctx.base,
        'identical geometry', 'exactly at the threshold is still a tap')
    }),

    step('slop-D-beyond', 1, '🔴 D · 30px — clearly a DRAG → geometry CHANGES', ['slop-C-at'], async () => {
      // ⛔ THE CASE THAT MAKES THE OTHERS MEAN SOMETHING. Without it, a gate that
      // never armed at all would pass A, B and C perfectly.
      dragBy(frame, ctx.x, ctx.y, 30)
      const now = geom(byId(frame, ctx.id))
      const moved = now !== null && now !== ctx.base
      ctx.moved = now
      return expect({ dy: 30, before: ctx.base, after: now }, moved,
        'different geometry', 'an intentional drag moves the drawing')
    }),

    step('slop-E-history', 1, 'E/F · the select-only taps left NO history entry; the drag left one',
      ['slop-D-beyond'], async () => {
        /* ⭐ ASKED THROUGH THE PRODUCT'S OWN UNDO, because the history stack is
         * in-memory and never persisted — there is nothing to read. One undo
         * after the drag must restore the ORIGINAL geometry with the drawing
         * still present. If any of the taps or sub-threshold gestures had
         * recorded a phantom entry, this undo would consume that instead and the
         * geometry would still be the dragged one. */
        const w = frame.contentWindow
        w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
        const back = await until('the undo to land', () => {
          const g = geom(byId(frame, ctx.id))
          return g === ctx.base ? g : null
        }, { timeout: 6000 }).catch(() => null)
        const still = byId(frame, ctx.id)
        return expect({ afterUndo: geom(still), expected: ctx.base, present: !!still },
          !!back && !!still,
          'the original geometry, drawing still present',
          'exactly one history entry for the drag, none for the taps')
      }),

    step('slop-G-multitouch', 2, 'G · a SECOND finger cancels an in-progress drag', ['slop-E-history'], async () => {
      const before = geom(byId(frame, ctx.id))
      dragBy(frame, ctx.x, ctx.y, 30, { second: true })
      const now = geom(byId(frame, ctx.id))
      return expect({ before, after: now }, now === before,
        'identical geometry', 'a pinch must not smear a drawing')
    }),
  ]
}
