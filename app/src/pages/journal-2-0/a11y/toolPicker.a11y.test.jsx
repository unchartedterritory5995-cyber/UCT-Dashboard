// app/src/pages/journal-2-0/a11y/toolPicker.a11y.test.jsx
//
// Wave 9 Task 9.19: the tool picker (/routine, /track) through 8A's axe harness, in the states a member meets: a list
// of routines with New routine, no trackers yet, and a list that cannot be read with Try again. Each recipe asserts what
// painted before axe runs, so an empty screen cannot pass as a clean one. `fetch` is a fake server.
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import ToolPicker from '../components/notebook/routines/ToolPicker'
import { installServer, routine } from '../components/notebook/routines/__fixtures__/toolsServer'

const noop = () => {}

axeSurface('tool-picker', async () => {
  installServer({ tools: { r1: routine(), r2: routine({ id: 'r2', name: 'Rules I keep' }) } })
  render(<ToolPicker kind="routine" onPick={noop} onNew={noop} onClose={noop} />)
  expect(await screen.findByRole('button', { name: 'Rules I keep' })).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Your routines' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'New routine' })).toBeTruthy()
})

axeSurface('tool-picker-empty', async () => {
  installServer({ tools: {} })
  render(<ToolPicker kind="tracker" onPick={noop} onNew={noop} onClose={noop} />)
  expect(await screen.findByText(/You don't have a tracker yet/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'New tracker' })).toBeTruthy()
})

axeSurface('tool-picker-failed', async () => {
  const net = installServer({ tools: {} })
  net.refuseNext('GET', '/api/j2/routines', 500, {})
  render(<ToolPicker kind="routine" onPick={noop} onNew={noop} onClose={noop} />)
  expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})
