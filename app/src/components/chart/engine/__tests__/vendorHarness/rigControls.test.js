// app/src/components/chart/engine/__tests__/vendorHarness/rigControls.test.js
//
// THE CAPTURE RIG'S CONTROL FINDER (`tools/vendor_harness/rig_controls.js`) over RECORDED DOM: the script-title
// menu's `Create new` row, its `Indicator` submenu row, and the Pine editor dialog's `Add to chart`.
//
// ⚰️ patrick-54's review (coordinator ruling 2026-11-21): the batch searched those controls by own text over the
// whole page and took the first hit; one attempt clicked an unrelated "Save" behind a modal. The finder now looks
// only inside each control's container (an open `[role="menu"]`'s `[role="menuitem"]` rows; `#pine-editor-dialog`),
// takes exactly one or nothing, and never a control another element covers at its centre.
//
// The DOM is the rig's, read on 2026-11-21 04:10Z (patrick-54, master 2b140dd338, the Driver's own steps, read-only:
// `D:/uct-rig-facts/dom_facts_2026-11-21.json`): every element below is one of the recorded ancestor chains, with its
// recorded tag, role, id, first class and box. Elements the recording did not hold are marked TEST-MADE: they are the
// hazards the finder must refuse. jsdom has no layout, so each element carries its box in `data-box` (left, top,
// width, height), and `elementFromPoint` answers with the deepest boxed element at the point, the highest `data-z`
// first (a cover is given one), as a browser's hit test does.

import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(process.cwd(), '..')
const SOURCE = fs.readFileSync(path.join(REPO, 'tools', 'vendor_harness', 'rig_controls.js'), 'utf8')
// the driver evaluates the function expression; the file's leading comment is not part of it
const EXPR = SOURCE.slice(SOURCE.indexOf('(a) =>'))
// eslint-disable-next-line no-new-func
const find = new Function(`return (${EXPR})`)()

const boxOf = (el) => {
  const b = el.getAttribute && el.getAttribute('data-box')
  if (!b) return null
  const [left, top, width, height] = b.split(',').map(Number)
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
}
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return boxOf(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }
  }
  document.elementFromPoint = (x, y) => {
    let best = null
    let bestKey = null
    const all = [...document.body.querySelectorAll('*')]
    all.forEach((el, order) => {
      const r = boxOf(el)
      if (!r || r.width <= 0 || r.height <= 0 || x < r.left || x >= r.right || y < r.top || y >= r.bottom) return
      let depth = 0
      for (let p = el; p; p = p.parentElement) depth += 1
      const key = [Number(el.getAttribute('data-z') || 0), depth, order]
      if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1]
        || (key[1] === bestKey[1] && key[2] > bestKey[2])))) { best = el; bestKey = key }
    })
    return best
  }
})

// (a) the script-title menu open, `Create new` hovered: its submenu shows `Indicator` (recorded chains)
const MENU = `
  <div id="overlap-manager-root">
    <div class="portal-hBVkaP2P" data-box="0,0,1760,1000">
      <div role="menu" id=":ru:" class="contentDefaultAppearance-g8RohgNX" data-box="896,96,340,427">
        <div class="anchorContext-Vxn4LhYL"><div class="pkn-cTp_unV8">
          <div class="flex-go0ZeNQF" data-box="896,96,340,427"><div class="mainScrollWrapper-go0ZeNQF" data-box="896,96,340,427">
            <div class="main-go0ZeNQF" data-box="902,96,328,427">
              <div class="background-NQom5I8Z" data-box="902,275,328,32">
                <div role="menuitem" id=":r1a:" class="button-XNUivTou" data-box="902,275,328,32">
                  <div class="buttonContent-VX4kpR9i" data-box="906,277,320,28"><div class="middle-FtwwRr7u" data-box="934,277,250,28">
                    <div class="title-FtwwRr7u" data-box="938,282,246,18">Create new</div></div></div>
                </div>
              </div>
            </div>
          </div></div>
        </div></div>
      </div>
    </div>
    <div class="portal-hBVkaP2P" data-box="0,0,1760,1000">
      <div role="menu" id=":r19:" class="contentDefaultAppearance-g8RohgNX" data-box="1229,268,222,153">
        <div class="anchorContext-Vxn4LhYL"><div class="pkn-cTp_unV8">
          <div class="flex-go0ZeNQF" data-box="1229,268,222,153"><div class="mainScrollWrapper-go0ZeNQF" data-box="1229,268,222,153">
            <div class="main-go0ZeNQF" data-box="1235,268,210,153"><div data-box="1235,274,210,141">
              <div class="background-NQom5I8Z" data-box="1235,274,210,32">
                <div role="menuitem" class="button-XNUivTou" data-box="1235,274,210,32">
                  <div class="buttonContent-VX4kpR9i" data-box="1239,276,202,28"><div class="middle-FtwwRr7u" data-box="1267,276,60,28">
                    <div class="title-FtwwRr7u" data-box="1271,281,56,18">Indicator</div></div></div>
                </div>
              </div>
            </div></div>
          </div></div>
        </div></div>
      </div>
    </div>
    <div class="monaco-editor" data-box="0,0,0,0"></div>
  </div>`

// (b) the Pine editor dialog after `Create new > Indicator` (recorded chains), with the layout header's three
// zero-height "Save" titles (recorded too): "Save" has 4 own-text matches on this page
const EDITOR = `
  <div class="js-button-text" data-box="551,11,100,16"><div class="textWrap-OjWQ1m5F" data-box="551,11,100,16"><span class="stateTitle-HVUOghkg" data-box="591,27,20,0">Save</span></div></div>
  <div class="js-button-text" data-box="603,11,100,16"><div class="textWrap-OjWQ1m5F" data-box="603,11,100,16"><span class="stateTitle-HVUOghkg" data-box="643,27,20,0">Save</span></div></div>
  <div class="js-button-text" data-box="712,11,100,16"><div class="textWrap-OjWQ1m5F" data-box="712,11,100,16"><span class="stateTitle-HVUOghkg" data-box="752,27,20,0">Save</span></div></div>
  <div class="js-rootresizer__contents" data-box="0,0,1760,1000">
    <div class="panel-XpK1dKBC" data-box="882,0,878,1000"><div class="container-P8VxnSRo" data-box="882,0,878,1000"><div class="contents-P8VxnSRo">
      <div class="container-FgScb_09" data-box="882,50,878,950"><div data-box="882,50,878,950"><div class="tv-script-widget" data-box="882,50,878,950">
        <div id="pine-editor-dialog" class="editorBaseLayoutContainer-dialog-mImut1T6" data-box="882,50,878,950">
          <div data-box="902,62,838,48"><div class="wrapper-x8fc_nZs" data-box="902,62,838,48"><div class="left-x8fc_nZs" data-box="902,62,441,34">
            <button class="apply-common-tooltip" data-box="1109,62,141,34"><span class="content-kjRfTlfx" data-box="1149,63,89,32"><span class="ellipsisContainer-kjRfTlfx" data-box="1149,67,89,24">Add to chart</span></span></button>
            <button class="saveButton-lN2I26jn" data-box="1259,62,85,34"><span class="content-kjRfTlfx" data-box="1299,63,33,32"><span class="ellipsisContainer-kjRfTlfx" data-box="1299,67,33,24">Save</span></span></button>
          </div></div></div>
          <div class="editorWrapper-mImut1T6" data-box="902,110,838,867"><div data-box="902,110,838,867"><div role="code" class="monaco-editor" data-box="902,110,838,867"></div></div></div>
        </div>
      </div></div></div>
    </div></div></div>
  </div>
  <div id="overlap-manager-root"><div class="monaco-editor" data-box="0,0,0,0"></div></div>`

// TEST-MADE hazards
const OUTSIDE_CREATE = '<div class="TEST-MADE" data-box="40,300,120,20">Create new</div>'
const MODAL = (text) => `<div class="TEST-MADE modal" data-z="5" data-box="0,0,1760,1000"><button data-box="800,500,100,30"><span data-box="810,505,80,20">${text}</span></button></div>`
const COVER_MENU = '<div class="TEST-MADE cover" data-z="5" data-box="900,270,340,40"></div>'
const COVER_ADD = '<div class="TEST-MADE cover" data-z="5" data-box="1100,55,160,50"></div>'

const mount = (html) => { document.body.innerHTML = html }
const ADD_RECORDED = '<span class="ellipsisContainer-kjRfTlfx" data-box="1149,67,89,24">Add to chart</span>'

describe('the menu rows: a [role="menuitem"] inside an open [role="menu"], exactly one', () => {
  it('on the recorded menu it finds "Create new" at its centre', () => {
    mount(MENU)
    const got = find({ text: 'Create new', within: 'menu' })
    expect(got).toMatchObject({ ok: true, x: 938 + 246 / 2, y: 282 + 18 / 2 })
    expect(got.el.closest('[role="menuitem"]').id).toBe(':r1a:')
  })

  it('and "Indicator" to the right of the row that opened it', () => {
    mount(MENU)
    const cn = find({ text: 'Create new', within: 'menu' })
    expect(find({ text: 'Indicator', within: 'menu', rightOf: cn.rect })).toMatchObject({ ok: true, x: 1271 + 56 / 2 })
    // a rect it is not to the right of finds nothing
    expect(find({ text: 'Indicator', within: 'menu', rightOf: { right: 1500 } }).ok).toBe(false)
  })

  it('⛔ a same-text element outside every menu is never chosen, and alone it is no row at all', () => {
    mount(MENU + OUTSIDE_CREATE)
    expect(find({ text: 'Create new', within: 'menu' })).toMatchObject({ ok: true, x: 938 + 246 / 2 })
    mount(MENU.replace('>Create new<', '><') + OUTSIDE_CREATE)
    expect(find({ text: 'Create new', within: 'menu' })).toMatchObject({ ok: false, found: 0 })
  })

  it('⛔ two menu rows of that text: nothing is chosen, by name', () => {
    mount(MENU.replace('<div class="monaco-editor" data-box="0,0,0,0"></div>',
      '<div role="menu" data-box="20,600,200,40"><div role="menuitem" data-box="20,600,200,40"><div data-box="30,610,120,20">Create new</div></div></div>'))
    expect(find({ text: 'Create new', within: 'menu' })).toMatchObject({ ok: false, STOP: true, found: 2 })
  })

  it('⛔ a row something else covers at its centre is not chosen (a real click would land on the cover)', () => {
    mount(MENU + COVER_MENU)
    expect(find({ text: 'Create new', within: 'menu' })).toMatchObject({ ok: false, STOP: true, covered: true })
  })

  it('CONTROL: a row with no box (not shown) is not counted', () => {
    mount(MENU.replace('data-box="938,282,246,18"', 'data-box="938,282,0,0"'))
    expect(find({ text: 'Create new', within: 'menu' })).toMatchObject({ ok: false, found: 0 })
  })
})

describe('Add to chart: inside #pine-editor-dialog, exactly one', () => {
  it('on the recorded dialog it finds the editor\'s own button, and a click on it reaches that button', () => {
    mount(EDITOR)
    const got = find({ text: 'Add to chart', within: 'editor' })
    expect(got).toMatchObject({ ok: true, x: 1149 + 89 / 2, y: 67 + 24 / 2 })
    let clicked = null
    document.querySelector('button.apply-common-tooltip').addEventListener('click', (e) => { clicked = e.currentTarget })
    got.el.click()
    expect(clicked && clicked.className).toBe('apply-common-tooltip')
  })

  it('⭐ "Save" has four own-text matches on the page; inside the dialog it has one (the scoping patrick-54 asked for)', () => {
    mount(EDITOR)
    const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
    expect([...document.querySelectorAll('*')].filter((e) => own(e) === 'Save')).toHaveLength(4)
    expect(find({ text: 'Save', within: 'editor' })).toMatchObject({ ok: true, x: 1299 + 33 / 2 })
  })

  it('⛔ the dialog\'s own button gone and one outside it (a modal): nothing is chosen, though the page holds exactly one', () => {
    // the binding gate counts own-text `Add to chart` over the whole page: here it counts 1 and passes
    mount(EDITOR.replace(ADD_RECORDED, '<span data-box="1149,67,89,24"></span>') + MODAL('Add to chart'))
    expect(find({ text: 'Add to chart', within: 'editor' })).toMatchObject({ ok: false, found: 0 })
  })

  it('⛔ a modal over the dialog: its button is covered and is not chosen', () => {
    mount(EDITOR + COVER_ADD)
    expect(find({ text: 'Add to chart', within: 'editor' })).toMatchObject({ ok: false, STOP: true, covered: true })
  })

  it('⛔ two in the dialog: nothing is chosen, by name', () => {
    mount(EDITOR.replace('<div class="editorWrapper-mImut1T6"',
      '<button data-box="1400,62,141,34"><span data-box="1420,67,89,24">Add to chart</span></button><div class="editorWrapper-mImut1T6"'))
    expect(find({ text: 'Add to chart', within: 'editor' })).toMatchObject({ ok: false, STOP: true, found: 2 })
  })

  it('⛔ no editor dialog on the page: nothing is chosen, and the menu is no editor', () => {
    mount(MENU)
    expect(find({ text: 'Add to chart', within: 'editor' })).toMatchObject({ ok: false, why: 'no #pine-editor-dialog on the page' })
    expect(find({ text: 'Create new', within: 'nowhere' }).ok).toBe(false)
  })
})
