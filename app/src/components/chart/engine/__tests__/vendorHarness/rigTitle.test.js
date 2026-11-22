// app/src/components/chart/engine/__tests__/vendorHarness/rigTitle.test.js
//
// THE CAPTURE RIG'S SCRIPT-TITLE FINDER (`tools/vendor_harness/rig_title.js`) over recorded DOM.
//
// ⚰️ 2026-11-16: TradingView moved the Pine editor's script title into an `H2`. The batch driver's
// finder did not look at headings and its fallback (`/script/i` over every control above the editor)
// chose the "Publish script" button, which the driver then clicked on the owner's account. A capture
// run never clicks anything it cannot name, so the finder is an allow-list (a heading whose text is a
// script name), and this rail drives it over the header as TradingView renders it today, which holds a
// "Publish script" button that must never be chosen.
//
// The DOM is the editor header recorded from the rig on 2026-11-16 (control texts and their order,
// reduced to what the finder reads). jsdom has no layout, so each element carries its recorded box in
// `data-box` (left, top, width, height) and `offsetParent` follows it.

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(process.cwd(), '..')
const SOURCE = fs.readFileSync(path.join(REPO, 'tools', 'vendor_harness', 'rig_title.js'), 'utf8')
// the driver evaluates the function expression; the file's leading comment is not part of it
const EXPR = SOURCE.slice(SOURCE.indexOf('(sel) =>'))
// eslint-disable-next-line no-new-func
const findTitle = new Function(`return (${EXPR})`)()

beforeAll(() => {
  const boxOf = (el) => {
    const b = el.getAttribute && el.getAttribute('data-box')
    if (!b) return null
    const [left, top, width, height] = b.split(',').map(Number)
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
  }
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return boxOf(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return boxOf(this) ? document.body : null },
  })
})

// The header recorded at 1760 wide (`Create new > Indicator` done): the title H2 sits beside
// `Add to chart`, `Save` and `Publish script`, all above the editor (top 110).
const HEADER = `
  <div data-box="820,40,940,940">
    <div data-box="834,60,920,40">
      <button data-box="834,60,44,36" aria-label="Watchlist, details, and news"></button>
      <div data-box="936,62,135,32"><h2 class="label-YoyW4Og1" data-box="936,64,135,30">Untitled script</h2></div>
      <button data-box="1109,60,141,36" title="Add to chart"><span data-box="1149,68,89,20">Add to chart</span></button>
      <button data-box="1259,60,85,36" title="Save script"><span data-box="1299,68,33,20">Save</span></button>
      <button data-box="1550,60,148,36" title="Share your script with the community"><span data-box="1590,68,96,20">Publish script</span></button>
      <button data-box="1706,60,34,36" title="More"></button>
    </div>
    <div class="monaco-editor" data-box="822,110,758,867"></div>
  </div>`

const mount = (html) => { document.body.innerHTML = html }

describe('the rig script-title finder chooses the title heading, and nothing it cannot name', () => {
  it('on the recorded header it chooses the H2 "Untitled script", never "Publish script"', () => {
    mount(HEADER)
    const got = findTitle('')
    expect(got.ok).toBe(true)
    expect(got.text).toBe('Untitled script')
    expect(got.how).toBe('heading')
    expect(got.x).toBe(936 + 135 / 2)
  })

  it('with the driver\'s selector it chooses the same heading', () => {
    mount(HEADER)
    expect(findTitle('h2[class*="label-"]')).toMatchObject({ ok: true, text: 'Untitled script', how: 'selector' })
  })

  it('⛔ a selector that names a button (even one that says "script") is refused', () => {
    mount(HEADER)
    const got = findTitle('button[title="Share your script with the community"]')
    expect(got.ok).toBe(false)
  })

  it('⛔ with the heading gone, it chooses NOTHING, even though "Publish script" is above the editor', () => {
    mount(HEADER.replace(/<div data-box="936,62,135,32">.*?<\/div>/, ''))
    const got = findTitle('')
    expect(got.ok).toBe(false)
    expect(JSON.stringify(got)).not.toMatch(/Publish/)
  })

  it('⛔ a heading that names an action is not a title (allow-list, not a deny-list of buttons)', () => {
    mount(HEADER.replace('>Untitled script<', '>Publish script<'))
    expect(findTitle('').ok).toBe(false)
  })

  it('⛔ two candidate headings: it chooses nothing rather than guess', () => {
    mount(HEADER.replace('<button data-box="1706,60,34,36" title="More"></button>',
      '<h2 data-box="1706,60,34,30">My other script</h2>'))
    expect(findTitle('').ok).toBe(false)
  })

  it('CONTROL: a narrow header that collapsed "Add to chart" to an icon has no panel, and says so', () => {
    mount(HEADER.replace('<span data-box="1149,68,89,20">Add to chart</span>', ''))
    expect(findTitle('')).toMatchObject({ ok: false, why: 'no panel holds both the editor and an add/update control' })
  })
})
