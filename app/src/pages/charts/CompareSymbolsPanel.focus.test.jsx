// ⭐ UCT RS a11y gate §12.2 (2026-11-08) — Compare Symbols holds keyboard focus.
// The keyboard check found the panel opening with focus on <body> and no trap: Tab
// walked the page behind the backdrop. Now focus lands on the selected tab, Tab and
// Shift+Tab wrap inside the card (`useFocusTrap`), Escape closes, and focus returns
// to the control that opened it.
import { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
import { focusableWithin } from '../../components/mobile/useFocusTrap'

vi.mock('./CompareRotation', () => ({ default: () => <div data-testid="rotation"><button type="button">Plot</button></div> }))

import CompareSymbolsPanel from './CompareSymbolsPanel'

function makeApi() {
  let comp = []
  return { getComparison: () => comp, setComparison: (a) => { comp = a }, getPercentScale: () => false, setPercentScale: () => {} }
}

function Host({ intent = null }) {
  const [open, setOpen] = useState(false)
  const chartApiById = useRef(new Map([['chart-1', makeApi()]]))
  const activeChartRef = useRef('chart-1')
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Tools: Compare</button>
      <button type="button">Behind</button>
      {open && <CompareSymbolsPanel chartApiById={chartApiById} activeChartRef={activeChartRef}
        initialIntent={intent} onClose={() => setOpen(false)} />}
    </div>
  )
}

const dialog = () => screen.getByRole('dialog', { name: 'Compare Symbols' })
async function openFromOpener(props) {
  render(<Host {...props} />)
  const opener = screen.getByRole('button', { name: 'Tools: Compare' })
  opener.focus()
  await act(async () => { fireEvent.click(opener) })
  return opener
}
const tab = async (shift = false) => {
  await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift }) })
}

test('on open, focus moves into the panel, on the selected tab', async () => {
  await openFromOpener()
  expect(dialog().getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overlay' }))
  expect(dialog().contains(document.activeElement)).toBe(true)
})

test('opened on the Rotation tab, focus lands on Rotation', async () => {
  await openFromOpener({ intent: { tab: 'rotation' } })
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Rotation' }))
})

test('Tab and Shift+Tab wrap inside the panel and never reach the page behind it', async () => {
  await openFromOpener()
  const nodes = focusableWithin(dialog())
  expect(nodes.length).toBeGreaterThan(2)
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  last.focus()
  await tab()
  expect(document.activeElement, 'Tab on the last control wraps to the first').toBe(first)
  await tab(true)
  expect(document.activeElement, 'Shift+Tab on the first control wraps to the last').toBe(last)
  // focus that somehow escaped is pulled back in on the next Tab
  screen.getByRole('button', { name: 'Behind' }).focus()
  await tab()
  expect(dialog().contains(document.activeElement)).toBe(true)
})

test('Escape closes the panel and focus returns to the opener', async () => {
  const opener = await openFromOpener()
  expect(document.activeElement).not.toBe(opener)
  await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
  expect(screen.queryByRole('dialog', { name: 'Compare Symbols' })).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('the Close button returns focus to the opener too', async () => {
  const opener = await openFromOpener()
  expect(dialog().contains(document.activeElement), 'focus was inside the panel').toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })) })
  expect(screen.queryByRole('dialog', { name: 'Compare Symbols' })).toBeNull()
  expect(document.activeElement).toBe(opener)
})
