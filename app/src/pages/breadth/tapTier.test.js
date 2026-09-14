/**
 * A-19: Data Charts enlarged its controls only at `max-width: 640px`, but the app's
 * touch tier is ≤ 1024 px — at 768 px, 14 of 22 controls measured under 44 px. jsdom
 * applies no CSS, so this reads the stylesheets, as chartWrapLayout.test.js does.
 * The app-wide tapFloor rail only sees rules already written with `var(--tap-min)`,
 * so this tab's typed 44 px rules were invisible to it (D-033).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = rel => fs.readFileSync(path.resolve(here, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every `@media <query>` block, brace-matched. */
export function mediaBlocks(css, query) {
  const text = stripComments(css)
  const out = []
  let at = text.indexOf(`@media ${query}`)
  while (at >= 0) {
    let i = text.indexOf('{', at) + 1
    let depth = 1
    const start = i
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      i++
    }
    out.push(text.slice(start, i - 1))
    at = text.indexOf(`@media ${query}`, i)
  }
  return out
}

/** True when a rule inside `blocks` whose selector list names `selector` declares `prop: value`. */
export function declaresIn(blocks, selector, prop, value) {
  for (const block of blocks) {
    for (const [, sel, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!sel.split(',').map(s => s.trim()).includes(selector)) continue
      for (const chunk of body.split(';')) {
        const c = chunk.indexOf(':')
        if (c >= 0 && chunk.slice(0, c).trim() === prop && chunk.slice(c + 1).trim() === value) return true
      }
    }
  }
  return false
}

const TOUCH = '(max-width: 1024px)'
const TARGETS = [
  ['../BreadthCharts.module.css', '.groupBtn', 'min-height'],
  ['../BreadthCharts.module.css', '.extremesBtn', 'min-height'],
  ['../BreadthCharts.module.css', '.metricItem', 'min-height'],
  ['../BreadthCharts.module.css', '.dateLabel', 'min-height'],
  ['../BreadthCharts.module.css', '.dateInput', 'height'],
  ['../BreadthCharts.module.css', '.ftdToggle', 'min-height'],
  ['../BreadthCharts.module.css', '.loadProblemAction', 'min-height'],
  ['./MetricReadout.module.css', '.item', 'min-height'],
  ['./PresetRow.module.css', '.btn', 'min-height'],
  ['./PresetRow.module.css', '.item', 'min-height'],
]

describe('A-19: every Data Charts finger target reaches the floor on the touch tier', () => {
  for (const [file, selector, prop] of TARGETS) {
    it(`${file} ${selector} declares ${prop}: var(--tap-min) at ≤ 1024 px`, () => {
      expect(declaresIn(mediaBlocks(read(file), TOUCH), selector, prop, 'var(--tap-min)')).toBe(true)
    })
  }

  it('leaves no hand-typed 40/44 px finger height behind', () => {
    for (const file of new Set(TARGETS.map(t => t[0]))) {
      expect(stripComments(read(file)), file).not.toMatch(/(?:min-)?height:\s*4[04]px/)
    }
  })

  it('CONTROL — the reader sees a planted rule and refuses a phone-only one', () => {
    const css = '@media (max-width: 1024px) {\n  .a, .b { min-height: var(--tap-min); }\n}\n@media (max-width: 640px) {\n  .c { min-height: var(--tap-min); }\n}'
    const blocks = mediaBlocks(css, TOUCH)
    expect(declaresIn(blocks, '.b', 'min-height', 'var(--tap-min)')).toBe(true)
    expect(declaresIn(blocks, '.c', 'min-height', 'var(--tap-min)')).toBe(false)
  })
})
