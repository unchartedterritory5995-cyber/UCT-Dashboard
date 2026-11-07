// ⭐ THE NAMED-CONTROL CATALOG (guide/controls.js): every control it teaches is one the product renders, under that name,
// and the words reach it the way the catalog says — a control fully described in a place the words name; several that
// fit equally are asked about; a place left unnamed is only asked about, and only when nothing else claimed the words.
// Held-out phrasings are in agentGuideHeldOutControls.test.js (written before the catalog).
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { CONTROL_ROWS, readControl, askWhich } from './guide/controls'
import { conceptsOf } from './guide/words'
import { GUIDE_FEATURES } from './guide/registry'
import { stepsFor } from './guide/slots'
import { guideFeature } from './guide/registry'

beforeAll(() => { registerBuiltins() })

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) && !p.includes(`${path.sep}agent${path.sep}`)) files.push(p)
  }
})(SRC)
const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
// every name the product gives a control: aria-label and title, quoted or as a template (a `${…}` part reads as "X")
const NAMES = []
for (const m of source.matchAll(/(?:aria-label|title)=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
  if (m[1] != null) NAMES.push(m[1])
  else if (m[2] != null) NAMES.push(m[2].replace(/\$\{[^}]*\}/g, 'X'))
  else for (const q of m[3].matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) NAMES.push(String(q[1] ?? q[2] ?? q[3]).replace(/\$\{[^}]*\}/g, 'X'))
}
const flat = (t) => (Array.isArray(t) ? t.flatMap(flat) : t && typeof t === 'object' && t.not ? flat(t.not) : t ? [t] : [])

describe('the catalog names real controls', () => {
  for (const row of CONTROL_ROWS) {
    it(`${row.id}: every target and result is rendered by the product, under that name`, () => {
      for (const s of row.steps) {
        for (const t of [...flat(s.target), ...flat(s.waitFor)]) {
          if (typeof t === 'string') { expect(source.includes(`data-guide="${t}"`) || source.includes(`data-guide={\`${t.split('.')[0]}.`) || t.startsWith('workspace.widgets.'), t).toBe(true); continue }
          if (t.id) { expect(source.includes(`data-guide="${t.id}"`) || /^chartSettings\.tab\./.test(t.id), t.id).toBe(true); continue }
          if (t.within && t.within !== '@chart') expect(source.includes(`data-guide="${t.within}"`), t.within).toBe(true)
          if (t.widgetType) expect(source).toContain('data-widget-type={w.type}')
          if (t.guide) expect(source, t.guide).toContain(`data-guide="${t.guide}"`)
          if (t.aria) expect(NAMES.includes(t.aria), t.aria).toBe(true)
          if (t.attr === 'title') expect(NAMES.includes(t.value), t.value).toBe(true)
          if (t.nameRe) expect(NAMES.some(n => new RegExp(t.nameRe, 'i').test(n)), t.nameRe).toBe(true)
          // an on-screen label: the words are the product's own text (JSX text, or a schema label)
          if (t.label) expect(source.includes(t.label), t.label).toBe(true)
          if (t.lead) expect(source.includes(t.lead), t.lead).toBe(true)
        }
      }
    })
  }
  it('every drawing-menu row is a label the drawing schema really gives some drawing', () => {
    const drawing = CONTROL_ROWS.filter(r => r.place === 'drawing')
    expect(drawing.length).toBeGreaterThan(10)
    for (const r of drawing) expect(r.tools.length, r.id).toBeGreaterThan(0)
  })
  it('the catalog is the first feature matched (the broad walkthroughs sharing its words come after it)', () => {
    expect(GUIDE_FEATURES[0].id).toBe('control')
  })
})

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
// the last step: what it rings and what it calls it
const last = (q) => { const got = route(q); const s = got ? stepsFor(guideFeature(got.feature), got.detail || q) : []; return JSON.stringify(s.length ? { target: s[s.length - 1].target, name: s[s.length - 1].name } : null) }

describe('the words read as concepts', () => {
  it.each([
    ['how do I get rid of my watchlist', ['delete', 'list']],
    ['how do I download it as a csv', ['export']],
    ['teach me to make a copy of the layout', ['copy', 'duplicate', 'layout']],
    ['how do I see my notes', ['note']],
  ])('%s', (q, want) => { for (const c of want) expect(conceptsOf(q).has(c), c).toBe(true) })
  it('how a member asks is never what they ask about', () => {
    expect(conceptsOf('show me how to').size).toBe(0)
    expect(conceptsOf('walk me through it').size).toBe(0)
  })
})

describe('reaching a control (the inventory’s own phrasings: the tuning set)', () => {
  it.each([
    ['how do I send my alerts to journal', 'Send these alerts to Journal'],
    ['how do I send breadth to journal', 'Send this snapshot to Journal'],
    ['how do I download a png of the chart', 'Download PNG'],
    ['how do I delete my old watchlist', '^Delete (?!watchlist)'],
    ['how do I shade that box blue', 'Fill'],
    ['how do I make the text note bold', 'Bold'],
    ['how do I duplicate a drawing', 'Duplicate'],
    ['how do I refresh the scan', 'Refresh scan'],
    ['how do I delete my old Swing layout from the library', 'permanently'],
  ])('%s → %s', (q, name) => { expect(last(q)).toContain(name) })
})

describe('never a guess', () => {
  it('words several controls fit equally are asked about, naming each', () => {
    const r = readControl('how do I send this to the journal', { weak: true })
    expect(r.ask.length).toBeGreaterThan(3)
    expect(askWhich(r.ask)).toMatch(/^Which one do you mean: .+\? Ask me again with its name\.$/)
  })
  it('a control whose place the words do not name is never shown straight away', () => {
    expect(readControl('how do I stop')?.row).toBeFalsy()
    expect(readControl('how do I stop', { weak: true })?.ask?.map(r => r.id)).toContain('ai.stop')
  })
  it('an object the control does not act on rules it out', () => {
    expect(readControl('how do I delete a ticker from my list')?.row?.id).not.toBe('list.delete')
  })
  it('a drawing that has no such control is said, never swapped for another', () => {
    expect(readControl('how do I make the rectangle italic')?.say).toMatch(/Rectangle has no Italic/)
  })
  it('a weak match is only consulted when no other walkthrough took the words', () => {
    expect(route('how do I stop replay')?.feature).toBe('panelAction')
    expect(route('how do I rename it')?.feature).toBe('control')
  })
})

describe('a weak read never takes words about something else', () => {
  it('a word the catalog does not know keeps the question away (the coach, the model)', () => {
    expect(readControl('walk me through position sizing', { weak: true })).toBeNull()
    expect(route('walk me through position sizing')?.feature).not.toBe('control')
  })
})
