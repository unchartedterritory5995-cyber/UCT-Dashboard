import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { VideoTimestamp } from './videoTimestampNode'

let editor
afterEach(() => { editor?.destroy(); editor = null })

function mount(seconds) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({
    element: el,
    extensions: [StarterKit, VideoTimestamp],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'videoTimestamp', attrs: { seconds } }] }],
    },
  })
  return el
}

describe('VideoTimestamp node', () => {
  it('renders a chip showing [m:ss] with a data-video-ts attribute', () => {
    const el = mount(75)
    const chip = el.querySelector('[data-video-ts]')
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('data-video-ts')).toBe('75')
    expect(chip.textContent).toBe('[1:15]')
  })

  it('dispatches uct:video-seek with the seconds on click', () => {
    const el = mount(42)
    const chip = el.querySelector('[data-video-ts]')
    let got = null
    window.addEventListener('uct:video-seek', (e) => { got = e.detail.seconds }, { once: true })
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(got).toBe(42)
  })

  it('serializes back to HTML with data-video-ts (round-trip)', () => {
    mount(3661)
    expect(editor.getHTML()).toContain('data-video-ts="3661"')
  })

  it('clamps malformed seconds to 0', () => {
    const el = mount(-5)
    expect(el.querySelector('[data-video-ts]').getAttribute('data-video-ts')).toBe('0')
  })
})
