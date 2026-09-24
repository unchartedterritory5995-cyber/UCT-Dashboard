// Wave 5 — the text colour + highlight picker: labelled swatches, pressed
// state, keyboard close, and the touch-tier sheet.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../lib/tiptap'
import TextColorMenu, { TEXT_COLOR_MENU_LABEL } from './TextColorMenu'

let touch = false
vi.mock('../../../../hooks/useBreakpoint', async (orig) => ({ ...(await orig()), useIsTouch: () => touch }))

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null; touch = false; document.body.innerHTML = '' })
function makeEditor(html = '<p>Margins widened sharply.</p>') {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: html })
  let from = null
  editor.state.doc.descendants((n, pos) => { if (from == null && n.isText) from = pos + n.text.indexOf('widened') })
  editor.commands.setTextSelection({ from, to: from + 'widened'.length })
  return editor
}
const marks = (ed, type) => {
  const out = []
  ed.state.doc.descendants((n) => { if (n.isText) for (const m of n.marks) if (m.type.name === type) out.push([n.text, m.attrs.color]) })
  return out
}

describe('TextColorMenu', () => {
  it('every swatch is a labelled button; the current colours read as pressed', () => {
    const ed = makeEditor()
    ed.commands.setTextColor('green')
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    expect(screen.getByRole('group', { name: TEXT_COLOR_MENU_LABEL })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Green text' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Default text color' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'No highlight' }).getAttribute('aria-pressed')).toBe('true')
    for (const label of ['Gray', 'Red', 'Orange', 'Yellow', 'Green', 'Blue']) {
      expect(screen.getByRole('button', { name: `${label} text` })).toBeTruthy()
      expect(screen.getByRole('button', { name: `${label} highlight` })).toBeTruthy()
    }
  })

  it('a swatch sample renders through the NOTE\'s own class -- one mapping, not a copy', () => {
    const ed = makeEditor()
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Red text' }).querySelector('.uct-tc-red')).not.toBe(null)
    expect(screen.getByRole('button', { name: 'Blue highlight' }).querySelector('mark.uct-hl-blue')).not.toBe(null)
  })

  it('picking a text colour applies it to the selection and closes the picker', () => {
    const ed = makeEditor()
    const onClose = vi.fn()
    render(<TextColorMenu editor={ed} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Red text' }))
    expect(marks(ed, 'textColor')).toEqual([['widened', 'red']])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('picking a highlight, then "No highlight", adds and removes it', () => {
    const ed = makeEditor()
    const { unmount } = render(<TextColorMenu editor={ed} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }))
    expect(marks(ed, 'highlight')).toEqual([['widened', 'yellow']])
    unmount()
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'No highlight' }))
    expect(marks(ed, 'highlight')).toEqual([])
  })

  it('a swatch keeps the editor selection on mouse down (the pick lands on what was selected)', () => {
    const ed = makeEditor()
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    screen.getByRole('button', { name: 'Blue text' }).dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('desktop: focus lands on the current swatch; Escape closes and returns focus to the toolbar button', () => {
    const ed = makeEditor()
    const toggle = document.createElement('button')
    document.body.appendChild(toggle)
    const toggleRef = createRef()
    toggleRef.current = toggle
    const onClose = vi.fn()
    render(<TextColorMenu editor={ed} onClose={onClose} toggleRef={toggleRef} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Default text color' }))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(document.activeElement).toBe(toggle)
  })

  it('desktop: a click outside closes it', () => {
    const ed = makeEditor()
    const onClose = vi.fn()
    render(<TextColorMenu editor={ed} onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('touch tier: opens as a bottom sheet titled "Color"', () => {
    touch = true
    const ed = makeEditor()
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Color')
    expect(dialog.querySelectorAll('button[aria-pressed]').length).toBe(14)
  })
})

// Wave 5 fix round 1.
describe('TextColorMenu — fix round 1', () => {
  afterEach(() => { delete navigator.platform })

  it('N7: every member-facing string says "color" (the Journal\'s spelling), never "colour"', () => {
    const ed = makeEditor()
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    expect(TEXT_COLOR_MENU_LABEL).toBe('Text color and highlight')
    const group = screen.getByRole('group', { name: TEXT_COLOR_MENU_LABEL })
    const said = [group.textContent, ...[...group.querySelectorAll('[aria-label],[title]')]
      .flatMap((el) => [el.getAttribute('aria-label'), el.getAttribute('title')])].join(' ')
    expect(said).toMatch(/color/i)
    expect(said).not.toMatch(/colour/i)
  })

  it('N6: two pickers on one page label their OWN rows (per-instance ids)', () => {
    const a = makeEditor()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const b = new Editor({ element: el, extensions: buildExtensions(), content: '<p>x</p>' })
    render(<><TextColorMenu editor={a} onClose={() => {}} /><TextColorMenu editor={b} onClose={() => {}} /></>)
    const rows = [...document.querySelectorAll('[role="group"][aria-labelledby]')]
    expect(rows).toHaveLength(4)
    const ids = rows.map((r) => r.getAttribute('aria-labelledby'))
    expect(new Set(ids).size).toBe(4)
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(['Text color', 'Highlight', 'Text color', 'Highlight'])
    b.destroy()
  })

  it('N6: the id the page passes lands on the picker\'s root group (the toggle\'s aria-controls target)', () => {
    const ed = makeEditor()
    render(<TextColorMenu id="picker-1" editor={ed} onClose={() => {}} />)
    expect(document.getElementById('picker-1')).toBe(screen.getByRole('group', { name: TEXT_COLOR_MENU_LABEL }))
  })

  it.each([['MacIntel', 'Cmd+Shift+H'], ['Win32', 'Ctrl+Shift+H']])('the yellow swatch names the platform\'s chord (%s -> %s)', (platform, chord) => {
    Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
    const ed = makeEditor()
    render(<TextColorMenu editor={ed} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Yellow highlight' }).getAttribute('title')).toBe(`Yellow (${chord})`)
  })
})
