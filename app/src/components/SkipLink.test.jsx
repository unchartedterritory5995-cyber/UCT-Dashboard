import { render, screen, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { test, expect } from 'vitest'
import { SkipLink, SkipLinkPortal } from './skipLinks'

function Page() {
  const pageRef = useRef(null)
  const listRef = useRef(null)
  return (
    <div ref={pageRef}>
      <SkipLinkPortal>
        <SkipLink href="#results" target={() => pageRef.current?.querySelector('[data-focus-list]')}>Skip to results</SkipLink>
        <SkipLink href="#list" target={listRef}>Skip by ref</SkipLink>
        <SkipLink href="#gone" target={() => null}>Skip to nothing</SkipLink>
      </SkipLinkPortal>
      <button type="button">Top bar control</button>
      <div ref={listRef} role="listbox" aria-label="Screen results" tabIndex={0} data-focus-list="" />
    </div>
  )
}

test('moves focus to the target (a function or a ref), never navigating to the hash', () => {
  window.history.replaceState(null, '', '/screener')
  render(<Page />)
  const list = screen.getByRole('listbox')
  fireEvent.click(screen.getByRole('link', { name: 'Skip to results' }))
  expect(document.activeElement).toBe(list)
  expect(window.location.hash).toBe('')
  screen.getByRole('button', { name: 'Top bar control' }).focus()
  fireEvent.click(screen.getByRole('link', { name: 'Skip by ref' }))
  expect(document.activeElement).toBe(list)
})

test('a target that is not on the page leaves focus where it was', () => {
  render(<Page />)
  const btn = screen.getByRole('button', { name: 'Top bar control' })
  btn.focus()
  fireEvent.click(screen.getByRole('link', { name: 'Skip to nothing' }))
  expect(document.activeElement).toBe(btn)
  expect(window.location.hash).toBe('')
})
