import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateJSON, generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from './calloutNode'

const EXT = [StarterKit, Callout]

let editor
afterEach(() => { editor?.destroy(); editor = null })

describe('Callout node', () => {
  it('parses a raw Notion-shaped <aside> into a callout node, keeping the body text', () => {
    const json = generateJSON('<aside>tip text</aside>', EXT)
    expect(json.content[0].type).toBe('callout')
    expect(json.content[0].content[0].content[0].text).toBe('tip text')
  })

  it('reads a preprocessed data-emoji attribute off the source element', () => {
    const json = generateJSON('<aside data-type="callout" data-emoji="⚠️">careful</aside>', EXT)
    expect(json.content[0].attrs.emoji).toBe('⚠️')
  })

  it('defaults to a lightbulb when no emoji attribute is present', () => {
    const json = generateJSON('<aside>plain</aside>', EXT)
    expect(json.content[0].attrs.emoji).toBe('💡')
  })

  it('round-trips through renderHTML with the emoji as a separate icon node, body text preserved', () => {
    const html = generateHTML(
      { type: 'doc', content: [{ type: 'callout', attrs: { emoji: '🔥' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hot take' }] }] }] },
      EXT,
    )
    expect(html).toContain('data-type="callout"')
    expect(html).toContain('data-emoji="🔥"')
    expect(html).toContain('uctCalloutIcon')
    expect(html).toContain('hot take')
  })

  it('re-parses its own rendered output unchanged (copy/paste stability)', () => {
    const first = generateJSON('<aside data-type="callout" data-emoji="✅">done</aside>', EXT)
    const html = generateHTML(first, EXT)
    const second = generateJSON(html, EXT)
    expect(second).toEqual(first)
  })

  it('mounts in a live editor without crashing on multi-block content', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({
      element: el,
      extensions: EXT,
      content: {
        type: 'doc',
        content: [{
          type: 'callout',
          attrs: { emoji: '📌' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'line one' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'line two' }] },
          ],
        }],
      },
    })
    expect(el.querySelector('[data-type="callout"]')).toBeTruthy()
    expect(el.textContent).toContain('line one')
    expect(el.textContent).toContain('line two')
  })
})
