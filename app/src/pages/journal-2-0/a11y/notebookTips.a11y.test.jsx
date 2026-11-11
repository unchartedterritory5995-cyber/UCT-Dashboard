// S13 (audit 2026-11-05): the one-time tip at the moment of need -- its card, on screen, read by axe. The slot that
// decides when (NotebookTipSlot.jsx) renders only its empty status line until then; it is read here too.
import { describe, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import NotebookTip from '../components/notebook/NotebookTip'
import NotebookTipSlot from '../components/notebook/NotebookTipSlot'
import CaptureAlertOffer from '../components/notebook/CaptureAlertOffer'

vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: {}, loading: false, setPrefMerged: vi.fn() }),
}))

describe('the one-time tips -- axe', () => {
  axeSurface('notebook-tip', async () => {
    render(<main><NotebookTip id="chart" text="Draw entry, stop and target to track it on your Setups board." onDismiss={() => {}} /></main>)
    expect(screen.getByRole('note', { name: 'Tip' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  axeSurface('notebook-tip-slot', async () => {
    render(<main><NotebookTipSlot editor={null} /></main>)
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  axeSurface('capture-alert-offer', async () => {
    render(<main><CaptureAlertOffer text="alert me if NVDA closes below 190" /></main>)
    expect(document.querySelector('[data-capture-alert-offer]')).not.toBeNull()
  })
})
