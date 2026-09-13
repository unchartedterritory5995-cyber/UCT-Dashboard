/* A tiny self-driving step runner for on-DEVICE validation.
 *
 * ⭐ WHY THIS SHAPE. Real-device time here is rationed to ONE MINUTE per device
 * (BrowserStack free tier), and a human tapping through a phone mirror spends
 * most of that on latency. So the page drives itself: each step performs a REAL
 * interaction on the REAL shell and returns a verdict, and the results render
 * on the page. One screenshot then answers a whole run.
 *
 * ⛔ A STEP THAT THROWS IS A FAIL, NOT A CRASH. One broken selector must not
 * silently end the run and leave every later step blank — blank reads as "not
 * reached", which is indistinguishable from "not run at all".
 *
 * ⛔ AND THE PANEL CARRIES A CLOCK. A readout that stops updating reports the
 * last thing it saw as though it were now; that mistake cost a landscape
 * measurement in the previous sprint (an 844px phone reporting
 * `max-width:640px: true`). The clock makes a frozen panel visible AS frozen.
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll until `fn()` is truthy, or throw by NAME. Never a bare timeout: a step
 *  that gave up must say what it was waiting for. */
export async function until(label, fn, { tries = 40, gap = 150 } = {}) {
  for (let i = 0; i < tries; i++) {
    let v
    try { v = fn() } catch { v = null }
    if (v) return v
    // eslint-disable-next-line no-await-in-loop
    await sleep(gap)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

export const byLabel = (root, label) =>
  [...root.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === label)

export const byLabelLike = (root, re) =>
  [...root.querySelectorAll('[aria-label]')].find((e) => re.test(e.getAttribute('aria-label') || ''))

export const tap = (el) => {
  if (!el) throw new Error('tap: element not found')
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }))
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }))
  el.click()
}

/** A long press, as `useLongPress` actually sees it: pointerdown, wait past the
 *  450ms threshold, pointerup. */
export async function longPress(el, { x = 0, y = 0, ms = 800 } = {}) {
  if (!el) throw new Error('longPress: element not found')
  const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }
  el.dispatchEvent(new PointerEvent('pointerdown', o))
  await sleep(ms)
  el.dispatchEvent(new PointerEvent('pointerup', o))
  await sleep(200)
}

/**
 * Run steps in order, rendering as it goes.
 *
 * A step returns `true` (pass), a string (pass, with that string as the note),
 * or throws (fail, with the message). `note: true` marks a step that only
 * RECORDS a value and can never fail — used for viewport width and the like, so
 * a recorded number is never mistaken for an assertion that passed.
 */
export async function run(steps, render) {
  const results = steps.map((s) => ({ name: s.name, state: 'pending', note: '', note_only: !!s.note }))
  render(results)
  const clock = setInterval(() => render(results), 500)
  try {
    for (let i = 0; i < steps.length; i++) {
      results[i].state = 'running'
      render(results)
      try {
        const out = await steps[i].run()
        results[i].state = steps[i].note ? 'note' : 'pass'
        results[i].note = typeof out === 'string' ? out : ''
      } catch (err) {
        results[i].state = steps[i].note ? 'note' : 'fail'
        results[i].note = String((err && err.message) || err).slice(0, 120)
      }
      render(results)
    }
  } finally {
    clearInterval(clock)
    render(results)
  }
  return results
}
