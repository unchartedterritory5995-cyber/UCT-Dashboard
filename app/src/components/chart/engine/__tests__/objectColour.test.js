// Stabilization 1 — a drawing program's colours are colours, in the browser too.
//
// ⚰️ The trust gap (2026-10-08): a stored `objects` program's colour literal reached
// `el.style.background` unchecked, so a hand-crafted, SHARED definition could load a
// URL in a recipient's page. The server now refuses it at save (and at share install /
// fork); these are the browser's two doors — bind (`assertColorNode`) and the CSS sink
// (`objectTableDom`) — answering the SAME fixture as the server.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { isObjectColourLiteral, isCssColour } from '../objectColour'
import { assertObjectProgram } from '../ast/objectProgram'
import { renderTables } from '../objectTableDom'
import { layoutTables } from '../objectCanvas'
import { tableProgram } from '../../builder/authoring/tables'

const CASES = JSON.parse(fs.readFileSync(
  path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/ast/object_colour_cases.json'), 'utf8'))

describe('one grammar, both lanes (object_colour_cases.json)', () => {
  it.each(CASES.literal.accept)('literal accepted: %s', (v) => expect(isObjectColourLiteral(v)).toBe(true))
  it.each(CASES.literal.reject)('literal refused: %s', (v) => expect(isObjectColourLiteral(v)).toBe(false))
  it.each(CASES.css.accept)('css accepted: %s', (v) => expect(isCssColour(v)).toBe(true))
  it.each(CASES.css.reject)('css refused: %s', (v) => expect(isCssColour(v)).toBe(false))
})

// a real program from the authoring door's own writer, with the colour swapped in
const program = (hex) => tableProgram({ position: 'top_right', cells: [
  { row: 0, col: 0, text: 'RSI', color: hex, background: '#000000' }] }, () => null, () => 'number')

describe('load: a stored program with a non-colour literal is refused, a real one passes', () => {
  it('url(...) is refused by name (the door defSchema and the runtime both call)', () => {
    expect(() => assertObjectProgram(program('url(https://evil.example/x)'))).toThrow(/is not a colour/)
  })
  it('hex and theme references still pass', () => {
    expect(() => assertObjectProgram(program('#2962FF80'))).not.toThrow()
    expect(() => assertObjectProgram(program('chart.fg_color@80'))).not.toThrow()
  })
})

describe('the CSS sink: whatever reaches the renderer, only a colour reaches CSS', () => {
  const doc = new JSDOM('<!doctype html><div></div>').window.document
  it('every colour field and width of a hostile render state is dropped; safe ones are kept', () => {
    const evil = 'url(https://evil.example/x)'
    const root = doc.createElement('div')
    doc.body.appendChild(root)
    renderTables(root, layoutTables({ tables: [{
      id: 1, position: 'top_right', bgcolor: evil, frame_width: 2, frame_color: evil,
      border_width: '1px solid red; background: url(x)', border_color: '#ff0000',
      cells: [{ col: 0, row: 0, text: 'a', text_color: evil, bgcolor: evil, text_size: 'normal' },
        { col: 1, row: 0, text: 'b', text_color: '#00FF00', bgcolor: 'rgba(1,2,3,0.5)', text_size: 'normal' }],
    }] }), doc)
    expect(root.innerHTML).not.toMatch(/url\(/)
    const tds = [...root.querySelectorAll('td')]
    expect(tds[0].style.color).toBe('rgb(209, 212, 220)') // the renderer's default, not the URL
    expect(tds[0].style.background).toBe('')
    expect(tds[1].style.color).toBe('rgb(0, 255, 0)')
    expect(tds[1].style.background).toMatch(/rgba\(1, 2, 3, 0\.5\)/)
    expect(root.querySelector('table').style.border).toBe('') // a URL frame colour draws no frame
  })
})
