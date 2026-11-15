// The lesson player's layout, against what the Study real-screen check found (2026-11-14, the sandbox, 390x844 @3x and
// 1440x900, the course charts MU / PANW / WSM / DHI). Each rail reads the stylesheet the fix lives in, the way the rest
// of the Study rails do (drills/drillLegibility.test.js, ui/tileLegibility.test.js).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { declarations, parseRules } from '../terminal/a11y/__tests__/terminalContrast'
import { TICK_BANDS, plotWidthPx, tickLabelCharsFor } from './studyChartFrame'

const STUDY = join(process.cwd(), 'src', 'pages', 'study')
const read = (...p) => readFileSync(join(STUDY, ...p), 'utf8')
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The bodies of every `@media` block whose query contains `query`, joined (one level of nesting, as these sheets use). */
function mediaBodies(css, query) {
  const text = strip(css)
  let out = ''
  let at = 0
  for (;;) {
    const i = text.indexOf('@media', at)
    if (i < 0) break
    const open = text.indexOf('{', i)
    const head = text.slice(i, open)
    let depth = 1
    let j = open + 1
    while (j < text.length && depth) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1 }
    if (head.includes(query)) out += `${text.slice(open + 1, j - 1)}\n`
    at = j
  }
  return out
}
/** Top-level rules only (every @media block cut out). */
function topLevel(css) {
  let text = strip(css)
  for (;;) {
    const i = text.indexOf('@media')
    if (i < 0) return text
    const open = text.indexOf('{', i)
    let depth = 1
    let j = open + 1
    while (j < text.length && depth) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1 }
    text = text.slice(0, i) + text.slice(j)
  }
}
/** The last value `prop` gets from a rule whose selector list holds exactly `selector`. */
function last(css, selector, prop) {
  let v = null
  for (const r of parseRules(css)) {
    if (!r.selector.split(',').map((s) => s.trim()).includes(selector)) continue
    const d = declarations(r.body).get(prop)
    if (d != null) v = d
  }
  return v
}
const px = (v) => parseFloat(v)

describe('item 11 · a phone keeps two short answers to a row inside the screen', () => {
  const css = read('drills', 'drills.module.css')
  const phone = mediaBodies(css, 'max-width: 640px')

  it('the columns can never grow past their share, and a set with a longer answer is one to a row', () => {
    expect(last(phone, '.choicesGrid', 'grid-template-columns')).toBe('repeat(2, minmax(0, 1fr))')
    expect(last(phone, '.choicesGrid.choicesGridLong', 'grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(last(phone, '.choicesGrid > li > button > span', 'overflow-wrap')).toBe('anywhere')
  })

  it('a six-character answer ("$70.40", 56 px at 17 px) fits beside its key and check in a 390 px phone\'s column', () => {
    const column = (390 - 2 * 28 - 8) / 2                                    // 28 px page margins, the 8 px gap
    const pad = px(last(phone, '.choicesGrid > li > button', 'padding-left')) + px(last(phone, '.choicesGrid > li > button', 'padding-right'))
    const gaps = 2 * px(last(phone, '.choicesGrid > li > button', 'gap'))
    const KEY = 34, CHECK = 30, LABEL = 56                                   // kit2 .key and .tileEnd on a phone; measured label
    expect(pad + gaps + KEY + CHECK + LABEL).toBeLessThanOrEqual(column)
  })
})

describe('item 13 · one 720 px column on a desktop', () => {
  const css = read('DrillPlayer.module.css')
  const desk = mediaBodies(css, 'min-width: 1025px')

  it('the replay control, the chart key and the answers stand on the chart\'s 720 px, stretched to it', () => {
    // (the answer card too: a short card, no trade in it, shrank to 686 px the same way)
    for (const sel of ['.replayBar.replayBar', '.keyWrap.keyWrap', '.body.body', '.revealIn.revealIn']) {
      expect(last(desk, sel, 'max-width'), sel).toBe('720px')
      expect(last(desk, sel, 'width'), sel).toBe('100%')
      expect(last(desk, sel, 'margin-left'), sel).toBe('auto')
    }
    expect(last(desk, '.chartBox', 'max-width')).toBe('720px')
  })

  it('the chart key is rendered inside that column (the wire)', () => {
    expect(read('DrillPlayer.jsx')).toMatch(/<div className=\{styles\.keyWrap\}><ChartKey [^>]*detached/)
  })

  it('the key\'s rules are one element across the row, never a border on each cell (they stepped)', () => {
    const css = topLevel(read('ui', 'chartKey.module.css'))
    expect(last(css, '.row > *', 'border-top')).toBe(null)
    expect(last(css, '.sep', 'grid-column')).toBe('1 / -1')
  })
})

describe('item 14 · the chart\'s frame and furniture clear the date labels', () => {
  const NATURAL_AXIS = 28                                                    // the library's own date axis height
  it('the Study chart reserves a date axis tall enough for our mark and the A/L/% chips under the labels', () => {
    const reserve = px(last(topLevel(read('DrillPlayer.module.css')), '.chartBox', '--time-axis-min-height'))
    const sc = readFileSync(join(process.cwd(), 'src', 'components', 'StockChart.module.css'), 'utf8')
    const mark = px(last(sc, '.brandLogo', 'bottom')) + px(last(sc, '.brandLogo', 'height'))
    const CHIPS = 3 + 24 + 2 + 2                                             // inline dock + a chip + padding + border
    expect(reserve - NATURAL_AXIS).toBeGreaterThanOrEqual(mark)
    expect(reserve - NATURAL_AXIS).toBeGreaterThanOrEqual(CHIPS - 3)       // the labels' own 3 px of bottom padding
  })

  it('the corner brackets stop short of the top price label (it ends about 28 px in from the box\'s right edge)', () => {
    const rule = parseRules(strip(read('DrillPlayer.module.css'))).find((r) => r.selector === '.chartBox.chartBox::after')
    const d = declarations(rule.body)
    const arms = [...d.get('background').matchAll(/(\d+)px (\d+)px no-repeat/g)].map((m) => Math.max(+m[1], +m[2]))
    expect(arms.length).toBe(8)
    expect(px(d.get('inset')) + Math.max(...arms)).toBeLessThanOrEqual(26)
  })
})

describe('item 15 · the date axis reads evenly, months only, at every lesson frame', () => {
  // the library keeps labels ceil(9.375 px x chars / bar spacing) sessions apart and lays them greedily
  const apart = (phone, slots) => Math.ceil((9.375 * tickLabelCharsFor(phone, slots)) / (plotWidthPx(phone) / slots))

  it('the screen check\'s frames: the desktop replay that read "Feb 4 Apr" now labels every month', () => {
    expect(tickLabelCharsFor(false, 187)).toBe(6)     // MU, 150 + 20 days, the reveal's room: 17 sessions apart
    expect(apart(false, 187)).toBeLessThanOrEqual(19) // never past February's 19 sessions
    expect(tickLabelCharsFor(false, 120)).toBe(8)     // a 120-day question: the library's own slot already fits
    expect(tickLabelCharsFor(false, 20)).toBe(null)   // a short frame keeps the library's slot
  })

  it('every frame a lesson shows (100 to 240 slots) lands in an even band on both screens: no month skipped unevenly, no day between two', () => {
    for (const phone of [false, true]) {
      for (let slots = 100; slots <= 240; slots += 1) {
        const k = apart(phone, slots)
        expect(TICK_BANDS.some(([lo, hi]) => k >= lo && k <= hi), `${phone ? 'phone' : 'desktop'} ${slots}: ${k}`).toBe(true)
      }
    }
  })

  it('the drill hands it to the chart (the wire)', () => {
    expect(read('DrillPlayer.jsx')).toMatch(/tickLabelChars=\{tickChars\}/)
  })
})

describe('item 6 · the answer card flows with the page', () => {
  it('no height cap and no scroller inside the lesson\'s own scroll', () => {
    const css = topLevel(read('RevealCard.module.css'))
    expect(last(css, '.card', 'max-height')).toBe(null)
    expect(['auto', 'scroll']).not.toContain(last(css, '.card', 'overflow-y'))
    expect(['auto', 'scroll']).not.toContain(last(css, '.card', 'overflow'))
  })
})

describe('item 18 · the trade boxes read at a glance', () => {
  const css = read('ui', 'study.module.css')
  it('two boxes to a row past a phone, one on it, the name and the number on one line', () => {
    expect(last(topLevel(css), '.legs', 'grid-template-columns')).toBe('repeat(2, minmax(0, 1fr))')
    expect(last(mediaBodies(css, 'max-width: 640px'), '.legs', 'grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(last(topLevel(css), '.leg', 'grid-template-areas')).toBe('"k v" "n n"')
    expect(last(topLevel(css), '.leg b', 'white-space')).toBe('nowrap')
  })
})

describe('item 20 · no phone text under 11 px in the lesson chrome', () => {
  it('the step line, the trade labels, the chart key and the lesson stamp\'s short word', () => {
    expect(px(last(mediaBodies(read('ui', 'hudLooks.module.css'), 'max-width: 640px'), '.cScore em', 'font-size'))).toBeGreaterThanOrEqual(12)
    const study = read('ui', 'study.module.css')
    expect(px(last(topLevel(study), '.leg small', 'font-size'))).toBeGreaterThanOrEqual(12)
    expect(px(last(topLevel(study), '.coachLabel', 'font-size'))).toBeGreaterThanOrEqual(12)
    expect(px(last(topLevel(study), '.stampInline .stampWord.stampWordShort', 'font-size'))).toBeGreaterThanOrEqual(11)
    expect(px(last(topLevel(read('ui', 'chartKey.module.css')), '.head', 'font-size'))).toBeGreaterThanOrEqual(12)
  })
})
