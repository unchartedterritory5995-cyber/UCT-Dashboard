/**
 * The measurement `useTextInputFocus.js:15-17` was standing on, and never had.
 *
 * That comment justifies keeping `hooks/useKeyboardVisible.js` beside the focus hook like this:
 *
 *   "the viewport hook stays, because a soft keyboard can also cover the pad when focus is
 *    somewhere this hook cannot see (a cross-origin iframe)"
 *
 * It is two claims wearing one sentence, and only one of them can be measured anywhere near this
 * repo:
 *
 *   A. focus inside a cross-origin iframe is INVISIBLE to `useTextInputFocus` — the parent's
 *      `document.activeElement` is not a text-entry element while the member types in the frame.
 *   B. a soft keyboard actually rises in that situation and eats more than the hook's 150px.
 *
 * ── (A) MEASURED, 2026-09-10, Increment 4 Stream E ────────────────────────────────────────────
 * Playwright, real engines, 390x844 viewport, two local origins (127.0.0.1 on two ports; a
 * differing port IS a differing origin). `isTextEntry` was not re-typed — its source and its
 * `NON_TEXT_INPUT_TYPES` table were extracted from `useTextInputFocus.js` and evaluated in the
 * page, so the shipped rule is what answered.
 *
 *   engine     control (parent's own input)   cross-origin frame focused    contentDocument
 *   chromium   activeElement=INPUT, true      activeElement=IFRAME, FALSE   null (blocked)
 *   webkit     activeElement=INPUT, true      activeElement=IFRAME, FALSE   null (blocked)
 *
 * The frame was asked whether it really held focus (`el === document.activeElement` inside the
 * frame) and said true in both engines, so "the parent sees no text entry" is not a missed click.
 *
 *   ⭐ AND THE COMMENT UNDERSTATES IT. A SAME-origin iframe measured identically —
 *   activeElement=IFRAME, isTextEntry FALSE, in both engines. The hook is blind to EVERY iframe;
 *   the origin is not what blinds it. Cross-origin only removes the workaround: same-origin the
 *   parent could read `iframe.contentDocument.activeElement` ("READABLE: INPUT" in both engines),
 *   cross-origin it gets null. So the blind spot is wider than the sentence claims, and the
 *   sentence's reasoning is still sound.
 *
 * ── (B) NOT MEASURED, AND NOT MEASURABLE FROM HERE ────────────────────────────────────────────
 * A soft keyboard needs a real touch device. jsdom has no viewport at all; a headless Chromium or
 * WebKit has no soft keyboard (visualViewport measured 844 of 844 the whole time, above); and the
 * device path that could answer it is shut — BrowserStack AUTOMATE quota is expired. Recorded as
 * open, not resolved by argument. ⛔ Do not read "(A) supported" as "(B) supported".
 *
 * ── REACHABILITY TODAY (grep, 2026-09-10) ─────────────────────────────────────────────────────
 * Two `<iframe>` elements are rendered anywhere in app/src:
 *   * `pages/journal-2-0/components/notebook/NoteVideoHero.jsx:66` — a cross-origin YouTube embed
 *     on notebook notes, and `notebook` IS a shipped hub mode since B10. The default embed player
 *     has no text field, so it should raise no keyboard.
 *   * `pages/OptionsFlow_admin.jsx:22` — a TradingView `widgetembed` with `symboledit=1`, which
 *     DOES put a symbol input inside a cross-origin iframe. That file has zero importers
 *     (`components/screener/reachable.test.js:414`, "Partner-owned; verified zero-importer"), so
 *     it reaches no member today.
 * So: the mechanism is real and measured, and the product does not currently exercise it. That is
 * an argument for leaving the OR alone, not for deleting either half — the next embed that ships
 * with a search box turns it on with no code change here.
 *
 * ⛔ NOTHING WAS CHANGED. `useKeyboardVisible.js` keeps its behaviour and HubRoot.jsx:272 keeps
 * `keyboardVisible || textInputFocused || viewportHidden`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import useTextInputFocus, { isTextEntry } from './useTextInputFocus'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const SRC_ROOT = path.resolve(HERE, '..')

let executed = 0
const ran = () => {
  executed += 1
}

let hosts = []
function mount(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  hosts.push(host)
  return host.firstElementChild
}

beforeEach(() => {
  hosts = []
})
afterEach(() => {
  hosts.forEach((h) => h.remove())
  document.body.innerHTML = ''
})

describe('the focus hook is blind to an iframe — the element the browser really hands it', () => {
  it('isTextEntry(<iframe>) is false — and the browser puts exactly that element in activeElement', () => {
    ran()
    // The browser measurement above says the parent's `document.activeElement` is the IFRAME
    // ELEMENT while a field inside the frame holds focus. This is what the shipped rule does with
    // that element. jsdom cannot delegate focus into a frame, so this asserts the half jsdom can
    // answer honestly rather than pretending to reproduce the whole path.
    expect(isTextEntry(mount('<iframe title="embed"></iframe>'))).toBe(false)
  })

  it('CONTROL: the same rule says true for a real text field', () => {
    ran()
    // Without this, "false for an iframe" is indistinguishable from a rule that says false for
    // everything (rule 14 / lesson_a_fixture_that_cannot_distinguish_is_not_a_rail).
    expect(isTextEntry(mount('<input type="text" />'))).toBe(true)
  })

  it('useTextInputFocus reports NOT-typing while an iframe holds focus, and typing for a field', () => {
    ran()
    const { result } = renderHook(() => useTextInputFocus())
    expect(result.current, 'nothing focused yet').toBe(false)

    const field = mount('<input type="text" />')
    act(() => { field.focus() })
    expect(result.current, 'CONTROL: a focused text field must report true').toBe(true)
    act(() => { field.blur() })
    expect(result.current).toBe(false)

    const frame = mount('<iframe title="embed"></iframe>')
    act(() => { frame.focus() })
    // The member may be typing in there. The hub is told nobody is.
    expect(result.current, 'the focus hook claimed to see into a frame').toBe(false)
    // And the parent is not merely ignoring the event — this IS where focus landed.
    expect(document.activeElement === frame || document.activeElement === document.body).toBe(true)
    act(() => { frame.blur() })
  })
})

describe('the OR is still load-bearing — do not delete either half on a guess', () => {
  it('HubRoot ORs both hooks and imports both', () => {
    ran()
    const src = fs.readFileSync(path.join(HERE, 'HubRoot.jsx'), 'utf8')
    // Non-vacuity: these must MATCH, not merely fail to contradict.
    expect(src).toMatch(/import\s+useKeyboardVisible\s+from\s+'\.\.\/hooks\/useKeyboardVisible'/)
    expect(src).toMatch(/import\s+useTextInputFocus\s+from\s+'\.\/useTextInputFocus'/)
    expect(src).toMatch(/keyboardVisible\s*\|\|\s*textInputFocused/)
  })

  it('useKeyboardVisible has a consumer OUTSIDE the hub, so deleting it is not a hub-local call', () => {
    ran()
    // ⛔ lesson_a_search_over_sources_counts_the_searcher: this file names the hook in prose, and
    // so does the hook's own file and the hook it is paired with. Report total / self / subject /
    // external and prove the exclusions actually fired, instead of quoting one number.
    const files = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(jsx?|mjs)$/.test(entry.name)) files.push(full)
      }
    }
    walk(SRC_ROOT)
    expect(files.length).toBeGreaterThan(100)

    const IMPORTS_IT = /from\s+'[^']*hooks\/useKeyboardVisible'/
    const importers = files
      .filter((f) => IMPORTS_IT.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC_ROOT, f).replace(/\\/g, '/'))

    // The searcher does NOT import it — it only names it — so the raw importer list is already
    // self-free. Assert that, rather than assuming it.
    expect(importers).not.toContain(path.relative(SRC_ROOT, SELF).replace(/\\/g, '/'))
    // Non-vacuity: an empty importer list would be a failed scan, not a finding.
    expect(importers.length).toBeGreaterThan(0)

    const outsideHub = importers.filter((f) => !f.startsWith('hub/'))
    // MobileNav.jsx:49 is the one. If this ever empties, `useKeyboardVisible` really has become a
    // hub-local hook and the delete conversation is a hub conversation — but until then it is not.
    expect(outsideHub).toEqual(['components/MobileNav.jsx'])
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(5)
  })
})
