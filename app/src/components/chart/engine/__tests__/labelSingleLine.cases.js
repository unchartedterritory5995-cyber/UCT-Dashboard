// app/src/components/chart/engine/__tests__/labelSingleLine.cases.js
//
// THE SINGLE-LINE LABEL MATRIX, shared by the golden it was recorded from and the rail
// that holds every later painter to it (`labelMultiline.test.js`). A case is a label
// with NO `\n` in its text; its record is every call and every state write the painter
// makes on a canvas, in order.
import crypto from 'node:crypto'
import { paintObjects, LABEL_ANCHOR } from '../objectCanvas'

const SHAPES = ['circle', 'square', 'diamond', 'triangleup', 'triangledown', 'arrowup',
  'arrowdown', 'xcross', 'cross', 'flag']
export const STYLES = [...new Set([...Object.keys(LABEL_ANCHOR), ...SHAPES, 'none', 'text_outline', 'label_center'])]
const SIZES = ['tiny', 'normal', 'large', 'huge']
const ALIGNS = [undefined, 'left', 'center', 'right']
const TEXTS = ['S', '                RS Rating', '   99', '']
const VARIANTS = [
  { yloc: 'price', y: 300 },
  { yloc: 'abovebar', y: null },
  { yloc: 'belowbar', y: null, text_formatting: 'bold italic' },
  { yloc: 'price', y: 300, color: undefined },
  { yloc: 'price', y: 300, color: '#00000000', textcolor: undefined },
]

export const mapping = { timeToX: (t) => t, priceToY: (p) => (p == null ? null : 500 - p), width: 1000, height: 500 }

/** A canvas that records every method call AND every state write, in order. */
export function recordingCanvas() {
  const log = []
  const methods = ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill',
    'fillRect', 'strokeRect', 'fillText', 'strokeText', 'arc', 'setLineDash', 'rect', 'quadraticCurveTo',
    'bezierCurveTo', 'translate', 'rotate', 'scale', 'clip', 'ellipse']
  const target = {}
  for (const m of methods) target[m] = (...args) => { log.push([m, ...args]) }
  target.measureText = (s) => { log.push(['measureText', s]); return { width: String(s).length * 6 } }
  const ctx = new Proxy(target, {
    set(t, k, v) { log.push(['set', k, v]); t[k] = v; return true },
  })
  return { ctx, log }
}

export function singleLineCases() {
  const out = []
  for (const style of STYLES) {
    for (const size of SIZES) {
      for (const textalign of ALIGNS) {
        for (const text of TEXTS) {
          VARIANTS.forEach((v, vi) => {
            const lb = { id: 1, x: 100, text, style, color: '#f00', textcolor: '#fff', size, ...v }
            if (textalign) lb.textalign = textalign
            out.push({ key: `${style}|${size}|${textalign || '-'}|${JSON.stringify(text)}|v${vi}`, label: lb })
          })
        }
      }
    }
  }
  return out
}

export function recordOf(label) {
  const { ctx, log } = recordingCanvas()
  const report = paintObjects(ctx, { labels: [label] }, mapping)
  return JSON.stringify({ log, report })
}

export const shaOf = (s) => crypto.createHash('sha256').update(s).digest('hex')
