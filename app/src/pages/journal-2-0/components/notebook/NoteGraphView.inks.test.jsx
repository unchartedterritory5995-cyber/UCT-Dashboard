// Wave 10 lane 10B — 9b support: the graph canvas paints ONLY stylesheet inks.
//
// accessibility.md named it: the nodes, edges and hub labels were colour
// literals chosen for a dark canvas, near-invisible on the light theme and
// measured nowhere. They are now `.ink*` rules (theme tokens) the component
// reads with getComputedStyle; a11y/notebookContrast.test.js measures each in
// dark, oled and light. This file rails the COMPONENT half:
//   - draw() carries no colour literal (a literal is a colour no theme reaches
//     and no contrast rail measures);
//   - every ink the component reads has an element in the DOM and a rule in
//     the stylesheet (a missing rule would silently paint the fallback).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GRAPH_INKS } from './NoteGraphView'

const DIR = join(process.cwd(), 'src/pages/journal-2-0/components/notebook')
const src = readFileSync(join(DIR, 'NoteGraphView.jsx'), 'utf8')
const css = readFileSync(join(DIR, 'NoteGraphView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of `const draw = () => { ... }`, brace-matched. */
function drawBody() {
  const at = src.indexOf('const draw = () => {')
  expect(at, 'draw() not found').toBeGreaterThan(0)
  let i = src.indexOf('{', at)
  let depth = 0
  const start = i
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break }
  }
  return src.slice(start, i + 1)
}
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/

describe('NoteGraphView — every colour the canvas paints is a stylesheet ink (wave 10, 9b)', () => {
  it('draw() holds no colour literal', () => {
    const body = drawBody()
    expect(body.length).toBeGreaterThan(500) // non-vacuity: this IS the draw loop
    expect(body).toContain('ink.node')
    expect(body.match(COLOUR_LITERAL), 'a literal colour in draw()').toBeNull()
  })

  it('CONTROL: the literal check can fail (the pre-wave-10 edge colour)', () => {
    expect("ctx.strokeStyle = 'rgba(148,163,184,0.20)'".match(COLOUR_LITERAL)).not.toBeNull()
    expect("ctx.fillStyle = '#7aa2c8'".match(COLOUR_LITERAL)).not.toBeNull()
  })

  it('every ink the component reads has a stylesheet rule whose colour is a TOKEN', () => {
    expect(GRAPH_INKS.length).toBeGreaterThanOrEqual(7)
    for (const name of GRAPH_INKS) {
      const cls = `.ink${name[0].toUpperCase()}${name.slice(1)}`
      const rule = new RegExp(`\\${cls}\\s*\\{([^}]*)\\}`).exec(css)
      expect(rule, `${cls} has no rule`).toBeTruthy()
      expect(rule[1], `${cls} colour must be a var(--token)`).toMatch(/color:\s*var\(--[a-z-]+\)/)
    }
  })

  it('the ink elements are never shown', () => {
    expect(css).toMatch(/\.inks\s*\{\s*display:\s*none;?\s*\}/)
  })
})
