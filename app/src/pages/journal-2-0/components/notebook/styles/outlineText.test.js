import { describe, it, expect } from 'vitest'
import { outlineTextToDoc, docToOutlineText, outlineIsExpressible } from './outlineText'

describe('outline text', () => {
  it('turns lines into headings, placeholders and paragraphs, and back', () => {
    const text = '## The setup\nWhat is the pattern?\n{{block:chart}}\n\n## Risk'
    const doc = outlineTextToDoc(text)
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'heading'])
    expect(doc.content[2].content[0].text).toBe('{{block:chart}}')
    expect(docToOutlineText(doc)).toBe(text)
  })
  it('an empty text is an empty doc', () => {
    expect(outlineTextToDoc('')).toEqual({ type: 'doc', content: [] })
  })
  it('a blank line is an empty paragraph with no content (valid for the schema)', () => {
    expect(outlineTextToDoc('a\n\nb').content[1]).toEqual({ type: 'paragraph' })
  })
  it('a heading keeps level 2 and its text', () => {
    expect(outlineTextToDoc('## Risk').content[0]).toEqual(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Risk' }] })
  })
  it('a spaced placeholder is trimmed to the exact placeholder; a malformed one stays plain text', () => {
    expect(outlineTextToDoc('  {{block:chart}}  ').content[0].content[0].text).toBe('{{block:chart}}')
    expect(outlineTextToDoc('{{block: chart}}').content[0].content[0].text).toBe('{{block: chart}}')
  })
  it('a built-in outline survives the round trip as text (headings and paragraphs)', () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Setup' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Why now?' }] },
    ] }
    expect(outlineTextToDoc(docToOutlineText(doc))).toEqual(doc)
  })
  it('a bare "## " line is dropped, never an empty text node', () => {
    const doc = outlineTextToDoc('## \nWhy now?\n##   ')
    expect(doc.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Why now?' }] }])
    expect(JSON.stringify(doc)).not.toContain('"text":""')
  })
})

describe('outlineIsExpressible: can plain text hold this outline faithfully?', () => {
  const p = (t, marks) => ({ type: 'paragraph', content: [{ type: 'text', text: t, ...(marks ? { marks } : {}) }] })
  const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: t }] })
  const doc = (...c) => ({ type: 'doc', content: c })

  it('yes: nothing, an empty doc, h2 headings, plain paragraphs, placeholders, blank paragraphs', () => {
    expect(outlineIsExpressible(null)).toBe(true)
    expect(outlineIsExpressible({ type: 'doc', content: [] })).toBe(true)
    expect(outlineIsExpressible(doc(h(2, 'Setup'), p('Why now?'), p('{{block:chart}}'), { type: 'paragraph' }))).toBe(true)
  })
  it('no: lists, marks, links, images, tables, callouts, widgets, non-h2 headings', () => {
    expect(outlineIsExpressible(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('a')] }] }))).toBe(false)
    expect(outlineIsExpressible(doc(p('bold', [{ type: 'bold' }])))).toBe(false)
    expect(outlineIsExpressible(doc(p('link', [{ type: 'link', attrs: { href: 'https://x.test' } }])))).toBe(false)
    expect(outlineIsExpressible(doc({ type: 'image', attrs: { src: 'x' } }))).toBe(false)
    expect(outlineIsExpressible(doc({ type: 'table', content: [] }))).toBe(false)
    expect(outlineIsExpressible(doc({ type: 'callout', content: [p('x')] }))).toBe(false)
    expect(outlineIsExpressible(doc({ type: 'widgetEmbed', attrs: { widgetId: 'chart' } }))).toBe(false)
    expect(outlineIsExpressible(doc(h(1, 'Big')))).toBe(false)
    expect(outlineIsExpressible(doc(h(3, 'Small')))).toBe(false)
  })
  it('no: text that would read back as something else', () => {
    expect(outlineIsExpressible(doc(p('## looks like a heading')))).toBe(false)
    expect(outlineIsExpressible(doc(p('two\nlines')))).toBe(false)
    expect(outlineIsExpressible(doc(h(2, '')))).toBe(false)
  })
  it('the answer is "yes" exactly when the round trip is lossless', () => {
    const cases = [doc(h(2, 'A'), p('b'), p('{{block:chart}}')), doc(h(1, 'A')), doc(p('x', [{ type: 'italic' }])), doc(h(2, 'A'), { type: 'paragraph' })]
    for (const d of cases) {
      const lossless = JSON.stringify(outlineTextToDoc(docToOutlineText(d))) === JSON.stringify(d)
      expect(outlineIsExpressible(d), JSON.stringify(d)).toBe(lossless)
    }
  })
})
