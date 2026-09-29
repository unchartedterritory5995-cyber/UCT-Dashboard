// Wave 10 lane K2 (clause 9d): the ONE keyboard contract for the editor's non-modal disclosures.
// The rendered rails over the real components are NoteOutline.test.jsx, NoteExportControls.test.jsx,
// NoteMenuActions.test.jsx and NoteEditorPage.moreMenu.test.jsx; this file holds the hook's own
// three promises and the nesting rule, each with a case that must NOT act.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import useDisclosureFocus, { focusOwnedBy, DISCLOSURE_ATTR } from './useDisclosureFocus'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

function Box({ label, open = true, onClose = () => {}, openerRef = null, children, focusOnOpen }) {
  const ref = useRef(null)
  const { disclosureProps } = useDisclosureFocus({ open, containerRef: ref, onClose, openerRef, focusOnOpen })
  return <div ref={ref} aria-label={label} role="group" {...disclosureProps}>{children}</div>
}

function Harness({ nested = false, onOuterClose = () => {}, onInnerClose = () => {} }) {
  const opener = useRef(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" ref={opener} onClick={() => setOpen(true)}>Open</button>
      <button type="button">Page control</button>
      {open && (
        <Box label="outer" openerRef={opener} onClose={() => { setOpen(false); onOuterClose() }}>
          <button type="button">One</button>
          {nested && (
            <Box label="inner" onClose={onInnerClose} focusOnOpen={false}>
              <input aria-label="Inner field" />
              <button type="button">Inner last</button>
            </Box>
          )}
          <button type="button">Two</button>
        </Box>
      )}
    </>
  )
}
const tab = (shift = false) => fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: shift })

describe('useDisclosureFocus', () => {
  it('1. opening moves focus to the first control inside', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'One' }))
  })

  it('2. Tab and Shift+Tab wrap at the ends while focus is inside', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    screen.getByRole('button', { name: 'Two' }).focus()
    tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'One' }))
    tab(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }))
  })

  it('3. Escape from anywhere inside closes it and hands focus to the opener', () => {
    const onOuterClose = vi.fn()
    render(<Harness onOuterClose={onOuterClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Two' }), { key: 'Escape' })
    expect(onOuterClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', { name: 'outer' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }))
  })

  it('CONTROL: focus outside the open disclosure keeps the page\'s own Tab', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const page = screen.getByRole('button', { name: 'Page control' })
    page.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    page.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(page)
  })

  it('NESTING: inside an inner disclosure only the INNER one wraps, and one Escape closes one layer', () => {
    const onInnerClose = vi.fn()
    const onOuterClose = vi.fn()
    render(<Harness nested onInnerClose={onInnerClose} onOuterClose={onOuterClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const innerLast = screen.getByRole('button', { name: 'Inner last' })
    innerLast.focus()
    tab()
    expect(document.activeElement).toBe(screen.getByLabelText('Inner field'))   // not "One"
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onInnerClose).toHaveBeenCalledTimes(1)
    expect(onOuterClose).not.toHaveBeenCalled()
  })

  it('focusOwnedBy answers for the INNERMOST disclosure only', () => {
    render(<Harness nested />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const outer = screen.getByRole('group', { name: 'outer' })
    const inner = screen.getByRole('group', { name: 'inner' })
    expect(outer.hasAttribute(DISCLOSURE_ATTR)).toBe(true)
    screen.getByLabelText('Inner field').focus()
    expect(focusOwnedBy(inner)).toBe(true)
    expect(focusOwnedBy(outer)).toBe(false)
    screen.getByRole('button', { name: 'One' }).focus()
    expect(focusOwnedBy(outer)).toBe(true)
    expect(focusOwnedBy(inner)).toBe(false)
  })
})
