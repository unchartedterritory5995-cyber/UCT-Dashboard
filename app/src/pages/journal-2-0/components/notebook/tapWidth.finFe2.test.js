// @vitest-environment node
// Finish program, lane FE2, finding P5 — finger targets that were tall enough but too NARROW.
//
// A browser walk at 820 and 390 px measured: the chart block toolbar's Hide toolbar, Chart
// settings and Remove embed at 34 px wide, Half at 39, Sync at 43; the Reporting soon symbol link
// at 41; the template picker's "All" chip at 37. Each already had the 44 px HEIGHT; none declared
// a width. This reads the declarations (jsdom lays nothing out; the browser walk measures the
// boxes): at 1024 px and below each of those classes declares BOTH floors.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (f) => readFileSync(resolve(HERE, f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The bodies of every `@media` block in `css` whose condition matches `re`, joined. */
function media(css, re) {
  const out = []
  const open = /@media([^{]+)\{/g
  let m
  while ((m = open.exec(css))) {
    let depth = 1
    let i = open.lastIndex
    while (i < css.length && depth) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1; i += 1 }
    if (re.test(m[1])) out.push(css.slice(open.lastIndex, i - 1))
  }
  return out.join('\n')
}
/** Every declaration block in `css` whose selector list names `.cls` (as a whole class). */
function rules(css, cls) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) if (new RegExp(`\\.${cls}(?![\\w-])`).test(m[1])) out.push(m[2])
  return out.join(';')
}
const TOUCH = /max-width:\s*1024px/
const FLOOR = /var\(--tap-min(, 44px)?\)/
const floorOf = (css, cls, prop) => new RegExp(`${prop}:\\s*var\\(--tap-min(, 44px)?\\)`).test(rules(media(css, TOUCH), cls))

describe('P5 — 44 px wide as well as tall, at 1024 px and below', () => {
  const embed = read('WidgetEmbedView.module.css')
  const soon = read('ReportingSoon.module.css')
  const picker = read('TemplatePicker.module.css')

  it('the chart block toolbar: every button and the timeframe select', () => {
    for (const cls of ['toolBtn', 'toolSelect']) {
      expect(floorOf(embed, cls, 'min-width'), `${cls} min-width`).toBe(true)
      expect(floorOf(embed, cls, 'min-height'), `${cls} min-height`).toBe(true)
    }
  })

  it('no narrower floor is left behind for touch (the old 34 px one)', () => {
    expect(media(embed, /hover:\s*none/)).not.toMatch(/min-width:\s*\d+px/)
    expect(FLOOR.test('var(--tap-min, 44px)')).toBe(true)
  })

  it('the toolbar wraps inside the block instead of running off it', () => {
    const tb = rules(embed, 'toolbar')
    expect(tb).toMatch(/flex-wrap:\s*wrap/)
    expect(tb).toMatch(/max-width:\s*calc\(100% - 16px\)/)
  })

  it('Reporting soon: the symbol link and the row actions', () => {
    for (const cls of ['symbol', 'action']) {
      expect(floorOf(soon, cls, 'min-width'), `${cls} min-width`).toBe(true)
      expect(floorOf(soon, cls, 'min-height'), `${cls} min-height`).toBe(true)
    }
  })

  it('the template picker’s family chips ("All" was 37 px)', () => {
    expect(floorOf(picker, 'chip', 'min-width')).toBe(true)
    expect(floorOf(picker, 'chip', 'min-height') || /min-height:\s*var\(--tap-min\)/.test(rules(media(picker, TOUCH), 'chip'))).toBe(true)
  })

  it('CONTROL — the reader tells a declared floor from a missing one', () => {
    const css = '@media (max-width: 1024px) { .a { min-width: var(--tap-min, 44px); } .b { color: red; } }'
    expect(floorOf(css, 'a', 'min-width')).toBe(true)
    expect(floorOf(css, 'b', 'min-width')).toBe(false)
    expect(floorOf('.a { min-width: var(--tap-min, 44px); }', 'a', 'min-width')).toBe(false)   // not inside the touch block
  })
})
