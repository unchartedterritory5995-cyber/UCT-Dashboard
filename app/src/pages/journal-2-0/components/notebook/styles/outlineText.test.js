import { describe, it, expect } from 'vitest'
import { outlineTextToDoc, docToOutlineText } from './outlineText'

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
})
