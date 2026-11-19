// app/src/components/chart/engine/__tests__/objectNonLabel.cases.js
//
// THE NON-LABEL MATRIX (boxes, lines, line fills): every call and state write the painter makes for each,
// recorded from master's painter BEFORE the Q-LB2 label geometry, and held byte-identical after it
// (`labelGeometry.test.js`). The label geometry may move labels only.
import { paintObjects } from '../objectCanvas'
import { recordingCanvas, mapping, shaOf } from './labelSingleLine.cases'

const SIZES = ['tiny', 'small', 'normal', 'large', 'huge', 'auto', 14]
const BOX_TEXTS = ['', 'Zone', 'a\nb', 'Long box text']
const HAL = [undefined, 'left', 'center', 'right']
const VAL = [undefined, 'top', 'center', 'bottom']
const EXT = [undefined, 'none', 'left', 'right', 'both']
const LSTYLE = ['solid', 'dotted', 'dashed', 'arrow_left', 'arrow_right', 'arrow_both']

export function nonLabelCases() {
  const out = []
  for (const text_size of SIZES) {
    for (const text of BOX_TEXTS) {
      for (const text_halign of HAL) {
        for (const text_valign of VAL) {
          out.push({ key: `box|${text_size}|${JSON.stringify(text)}|${text_halign || '-'}|${text_valign || '-'}`,
            state: { boxes: [{ id: 1, left: 100, right: 300, top: 400, bottom: 200, bgcolor: '#00f4', border_color: '#00f',
              border_width: 1, border_style: 'solid', text, text_color: '#111', text_size, text_halign, text_valign }] } })
        }
      }
    }
  }
  for (const extend of EXT) {
    for (const border_style of ['solid', 'dotted', 'dashed']) {
      out.push({ key: `boxext|${extend || '-'}|${border_style}`, state: { boxes: [{ id: 1, left: 100, right: 300, top: 400, bottom: 200,
        bgcolor: '#0f04', border_color: '#0f0', border_width: 2, border_style, extend }] } })
    }
  }
  for (const style of LSTYLE) {
    for (const extend of EXT) {
      for (const width of [1, 3]) {
        out.push({ key: `line|${style}|${extend || '-'}|${width}`, state: { lines: [{ id: 1, x1: 100, y1: 300, x2: 400, y2: 350,
          color: '#f00', width, style, extend }] } })
      }
    }
  }
  out.push({ key: 'linefill', state: { lines: [{ id: 1, x1: 100, y1: 300, x2: 400, y2: 350, color: '#f00', width: 1, style: 'solid' },
    { id: 2, x1: 100, y1: 200, x2: 400, y2: 250, color: '#0f0', width: 1, style: 'solid' }], fills: [{ a: 1, b: 2, color: '#00f3' }] } })
  return out
}

export function recordNonLabel(state) {
  const { ctx, log } = recordingCanvas()
  const report = paintObjects(ctx, state, mapping)
  return JSON.stringify({ log, report })
}

export { shaOf }
