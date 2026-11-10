// RAIL (2026-11-10): the ring's clip. A position:fixed control (the desktop chart right-click menu) shows past an
// overflow:hidden ancestor, so its ring must too; found by edge-diag attempt-1 (2895648104): the menu's last row was
// visible to x 705 past the cell's right edge at 599, but the ring stopped at the cell and the step read as "not on it".
// A fixed element IS clipped again by an ancestor that holds it (a transform, filter, perspective or contain makes the
// ancestor its containing block). Written before the targets.js change. LOCAL (jsdom; boxes stubbed).
import { describe, it, expect, afterEach } from 'vitest'
import { rectOf } from './guide/targets'

afterEach(() => { document.body.innerHTML = '' })
const box = (el, left, top, width, height) => { el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height }) }
const build = (childStyle, middleStyle = '') => {
  document.body.innerHTML = `<div id="cell" style="overflow: hidden"><div id="mid" style="${middleStyle}"><div id="menu" style="${childStyle}"><button id="row">Ask AI</button></div></div></div>`
  box(document.getElementById('cell'), 0, 0, 600, 800)
  box(document.getElementById('mid'), 0, 0, 600, 800)
  const row = document.getElementById('row'); box(row, 480, 700, 240, 36)
  return row
}

describe('the ring of a control that overflows a clipping ancestor', () => {
  it('a fixed menu is not clipped by an overflow:hidden ancestor: the ring covers the whole row', () => {
    const r = rectOf(build('position: fixed'))
    expect(r.left).toBe(476)
    expect(r.width).toBe(248)
  })
  it('control: an absolute menu IS clipped there (what shows ends at the cell)', () => {
    const r = rectOf(build('position: absolute'))
    expect(r.left + r.width).toBe(604)
  })
  it('control: an ancestor with a transform holds the fixed menu, so the clip above it applies again', () => {
    const r = rectOf(build('position: fixed', 'transform: translateX(0px)'))
    expect(r.left + r.width).toBe(604)
  })
  it('a clipping ancestor BELOW the fixed element still clips it (the fixed box is inside it)', () => {
    document.body.innerHTML = `<div id="menu" style="position: fixed"><div id="list" style="overflow: hidden"><button id="row">x</button></div></div>`
    box(document.getElementById('list'), 0, 0, 100, 100)
    const row = document.getElementById('row'); box(row, 50, 10, 200, 20)
    expect(rectOf(row).left + rectOf(row).width).toBe(104)
  })
})
