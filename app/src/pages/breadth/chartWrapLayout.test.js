/**
 * The readout is the chart's legend, so it has to sit ABOVE the plot.
 *
 * `.chartWrap` holds exactly two children — MetricReadout, then the ECharts
 * div — and its `display:flex` is there only to centre the loading / empty /
 * error placeholder. That centring shipped as `flex-direction: row`, which
 * silently turned the legend into a sibling COLUMN: measured in Chrome at
 * 1840px it took 372px of gutter, vertically centred, and squeezed the plot
 * from 1878px to 1506px.
 *
 * jsdom computes no layout, so no component test can see this — the rule is
 * checkable only as a declaration. Reads the real stylesheet, not a copy.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../BreadthCharts.module.css',
)

/** Body of a top-level rule, brace-matched — comments in the block would
 *  defeat a `[^}]*` grab the moment one contained a brace. */
function ruleBody(text, selector) {
  const at = text.indexOf(selector + ' {')
  if (at < 0) return null
  let i = text.indexOf('{', at) + 1
  let depth = 1
  const start = i
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    i++
  }
  return text.slice(start, i - 1)
}

/** One declaration's value, or null. Splits on `;` rather than matching a
 *  pattern — an escape inside a template literal is one collapse away from
 *  turning `\s` into a bare `s`, which is a rail that quietly matches
 *  nothing and passes on every input. */
const decl = (body, prop) => {
  // The rule carries a prose comment, and prose contains colons — leave it
  // in and the first chunk parses as a property named "/* Column, not row...".
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const chunk of clean.split(';')) {
    const colon = chunk.indexOf(':')
    if (colon < 0) continue
    if (chunk.slice(0, colon).trim() !== prop) continue
    return chunk.slice(colon + 1).trim()
  }
  return null
}

describe('.chartWrap stacks the readout above the plot', () => {
  const text = fs.readFileSync(CSS, 'utf8')
  const body = ruleBody(text, '.chartWrap')

  it('finds the rule at all', () => {
    expect(body).not.toBeNull()
  })

  it('is a column, so the readout is a header and not a side gutter', () => {
    expect(decl(body, 'display')).toBe('flex')
    expect(decl(body, 'flex-direction')).toBe('column')
  })

  it('stretches its children, so the chart keeps the full panel width', () => {
    // `center` here would shrink the ECharts div to its content width even in
    // a column, which is the same defect wearing a different hat.
    expect(decl(body, 'align-items')).toBe('stretch')
  })
})
