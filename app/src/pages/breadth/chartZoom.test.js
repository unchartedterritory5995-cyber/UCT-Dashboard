// app/src/pages/breadth/chartZoom.test.js
import { describe, it, expect } from 'vitest'
import { zoomWindowFrom, zoomValues } from './chartZoom'

const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08']

describe('zoomWindowFrom', () => {
  // Payload shapes read in echarts/lib/component/dataZoom: roams.js (inside, batch),
  // SliderZoomView.js (slider), dataZoomAction.js (startValue/endValue).
  it('reads an inside-zoom batch in percent', () => {
    expect(zoomWindowFrom({ batch: [{ start: 50, end: 100 }] }, dates)).toEqual({ from: '2026-09-03', to: '2026-09-08' })
  })
  it('reads a slider payload in percent', () => {
    expect(zoomWindowFrom({ start: 0, end: 25 }, dates)).toEqual({ from: '2026-09-01', to: '2026-09-02' })
  })
  it('prefers explicit values, by index or by category', () => {
    expect(zoomWindowFrom({ startValue: 1, endValue: 3 }, dates)).toEqual({ from: '2026-09-02', to: '2026-09-04' })
    expect(zoomWindowFrom({ startValue: '2026-09-02', endValue: '2026-09-03' }, dates)).toEqual({ from: '2026-09-02', to: '2026-09-03' })
  })
  it('treats the whole range as no zoom', () => {
    expect(zoomWindowFrom({ start: 0, end: 100 }, dates)).toBeNull()
    expect(zoomWindowFrom({ start: 10, end: 90 }, [])).toBeNull()
  })
})

describe('zoomValues', () => {
  // The window is dates, so a new live row or a changed selection keeps it where the member put it.
  it('maps a date window onto the sessions present', () => {
    expect(zoomValues({ from: '2026-09-02', to: '2026-09-05' }, dates)).toEqual({ startValue: '2026-09-02', endValue: '2026-09-04' })
  })
  it('returns null when nothing is zoomed or no session falls inside', () => {
    expect(zoomValues(null, dates)).toBeNull()
    expect(zoomValues({ from: '2026-10-01', to: '2026-10-05' }, dates)).toBeNull()
  })
})
