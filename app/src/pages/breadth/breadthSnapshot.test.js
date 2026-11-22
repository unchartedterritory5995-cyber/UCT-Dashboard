/**
 * breadthSnapshot.js — the sheet capture's pure parts: the filename, the footer strip, which rows
 * count as "in view", and the clone (spacer/overscan rows dropped, sticky header + Date column made
 * relative so they neither double nor lose the FTD tag's anchor, footer strip appended).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { breadthSnapshotFilename, breadthSnapshotFooter, visibleRowIndexes, buildSnapshotClone } from './breadthSnapshot'

const rect = (top, height) => ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top })

// A sheet: wrap 0..320 (clientHeight 320), header 0..32, a spacer row, then 14 rows of 32 px from
// y = -96 (three overscan rows above the header line), so rows 3..11 (y 0..288 body area) are in view.
function sheet() {
  const wrap = document.createElement('div')
  const table = document.createElement('table')
  table.innerHTML = '<thead><tr><th class="x_dateCol_1">Date</th><th>A</th></tr></thead><tbody></tbody>'
  const body = table.tBodies[0]
  const spacer = document.createElement('tr')
  spacer.setAttribute('data-snapshot-skip', '')
  spacer.innerHTML = '<td colspan="3"></td>'
  body.appendChild(spacer)
  for (let i = 0; i < 14; i++) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td class="x_dateCell_2">d${i}</td><td>v</td>`
    tr.getBoundingClientRect = () => rect(-96 + i * 32, 32)
    body.appendChild(tr)
  }
  spacer.getBoundingClientRect = () => rect(-5000, 4904)
  table.tHead.getBoundingClientRect = () => rect(0, 32)
  wrap.getBoundingClientRect = () => rect(0, 320)
  Object.defineProperty(wrap, 'clientHeight', { value: 320 })
  wrap.appendChild(table)
  const page = document.createElement('div')
  page.appendChild(wrap)
  document.body.appendChild(page)
  return { wrap, table, page }
}

afterEach(() => { document.body.innerHTML = '' })

describe('breadthSnapshot', () => {
  it('filename: uct-breadth-<universe>-<top row date>.png', () => {
    expect(breadthSnapshotFilename('nasdaq', '2026-11-18')).toBe('uct-breadth-nasdaq-2026-11-18.png')
    expect(breadthSnapshotFilename('uct', '2026-01-02')).toBe('uct-breadth-uct-2026-01-02.png')
    expect(breadthSnapshotFilename(null, 'LIVE', new Date(2026, 10, 19))).toBe('uct-breadth-uct-2026-11-19.png')
  })

  it('footer: UCT Breadth · <Universe> · <date>', () => {
    expect(breadthSnapshotFooter('Nasdaq', '2026-11-18')).toBe('UCT Breadth · Nasdaq · 2026-11-18')
    expect(breadthSnapshotFooter('UCT', null)).toBe('UCT Breadth · UCT')
  })

  it('only the rows under the header and inside the window are in view (never the spacer)', () => {
    const { wrap, table } = sheet()
    // tbody index 0 is the spacer; rows i=0..13 are tbody indexes 1..14. Row i spans
    // -96+32i .. -64+32i; in view (below 32, above 320, > 1/3 shown) = i 4..12.
    expect(visibleRowIndexes(wrap, table)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('the clone keeps the visible rows, un-sticks header + Date column, and carries the footer', () => {
    const { wrap, page } = sheet()
    const { holder, rows } = buildSnapshotClone(wrap, { footer: 'UCT Breadth · Nasdaq · 2026-11-18' })
    expect(rows).toBe(9)
    expect(holder.parentElement).toBe(page)       // inside the page: the theme roles resolve
    const t = holder.querySelector('table')
    expect(t.tBodies[0].rows).toHaveLength(9)
    expect(t.querySelector('[data-snapshot-skip]')).toBeNull()
    expect(t.tBodies[0].rows[0].cells[0].textContent).toBe('d4')
    expect(t.tHead.style.position).toBe('relative')
    expect(t.querySelector('th').style.position).toBe('relative')
    expect(t.tBodies[0].rows[0].cells[0].style.position).toBe('relative')
    expect(holder.lastChild.textContent).toBe('UCT Breadth · Nasdaq · 2026-11-18')
    // The live sheet is untouched.
    expect(wrap.querySelector('tbody').rows).toHaveLength(15)
    holder.remove()
  })
})
