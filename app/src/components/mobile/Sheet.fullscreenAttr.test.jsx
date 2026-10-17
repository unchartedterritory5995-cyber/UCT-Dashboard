// A fullscreen Sheet announces itself on <html> (`data-fullscreen-sheet`) so
// floating chrome — the joystick hub — can stand down while it covers the
// screen (Study spec 2026-10-17 §13.2 T16). The hub-side wire is proved in
// hub/hideUnderFullscreenSheet.test.jsx; this pins the Sheet half: fullscreen
// only, ref-counted across nested sheets, gone on close.
import { render, cleanup } from '@testing-library/react'
import { test, expect, afterEach } from 'vitest'
import Sheet from './Sheet'
import { FULLSCREEN_SHEET_ATTR } from './fullscreenSheetAttr'

const present = () => document.documentElement.hasAttribute(FULLSCREEN_SHEET_ATTR)

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute(FULLSCREEN_SHEET_ATTR)
})

test('a fullscreen Sheet sets the attribute while open and removes it on close', () => {
  const { rerender } = render(<Sheet open onClose={() => {}} variant="fullscreen" ariaLabel="Drill">body</Sheet>)
  expect(present()).toBe(true)
  rerender(<Sheet open={false} onClose={() => {}} variant="fullscreen" ariaLabel="Drill">body</Sheet>)
  expect(present()).toBe(false)
})

test('a modal or bottom-sheet never sets it (CONTROL: the attribute is fullscreen-only)', () => {
  render(<Sheet open onClose={() => {}} variant="modal" ariaLabel="Modal">body</Sheet>)
  render(<Sheet open onClose={() => {}} variant="bottom-sheet" ariaLabel="Bottom">body</Sheet>)
  expect(present()).toBe(false)
})

test('nested fullscreen sheets: the attribute survives the inner one closing', () => {
  const outer = render(<Sheet open onClose={() => {}} variant="fullscreen" ariaLabel="Outer">outer</Sheet>)
  const inner = render(<Sheet open onClose={() => {}} variant="fullscreen" ariaLabel="Inner">inner</Sheet>)
  expect(present()).toBe(true)
  inner.unmount()
  expect(present(), 'the outer sheet still covers the screen').toBe(true)
  outer.unmount()
  expect(present()).toBe(false)
})
