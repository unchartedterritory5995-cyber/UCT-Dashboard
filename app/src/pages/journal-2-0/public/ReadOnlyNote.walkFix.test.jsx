/**
 * Ruling W10-R73 on the public page: a built widget that reads routines or trackers is replaced, by the SERVER, with
 * one plain line, and a built widget that does not still renders. The input is the server's own output:
 * `tests/fixtures/notebook_public_walkfix.json` is written by `tests/test_widget_public_labels.py` from the reducer,
 * and that test fails when the file is out of date.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import ReadOnlyNote from './ReadOnlyNote'

vi.mock('../lib/embedArchive', async (orig) => ({
  ...(await orig()), captureElementPng: vi.fn(async () => null), storeFallbackImage: vi.fn(), kickSnapshotWarm: vi.fn(),
}))

const FIXTURE = path.resolve(__dirname, '../../../../../tests/fixtures/notebook_public_walkfix.json')
const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const HIDDEN = "This widget isn't shown on public pages."

describe.each(['share', 'publish'])('built widgets on the public page (%s)', (mode) => {
  it('a routine or tracker widget is the one plain line; a trades widget still renders', async () => {
    const view = render(<ReadOnlyNote note={{ title: 'T', bodyJson: data[mode] }} />)
    await waitFor(() => expect(view.container.querySelector('.ProseMirror p')).not.toBeNull())
    const lines = [...view.container.querySelectorAll('.ProseMirror p')].map((p) => p.textContent)
    expect(lines.filter((t) => t === HIDDEN)).toHaveLength(2)
    expect(view.container.textContent).not.toContain('DAYSTATE-CANARY')
    expect(await screen.findByTestId('built-widget-embed')).toBeTruthy()
    expect(view.container.textContent).toContain('Breakout')
  })
})
