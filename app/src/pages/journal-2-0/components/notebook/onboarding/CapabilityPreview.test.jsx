// Wave 14 lane W14-A: the capability preview on the first-run welcome.
//
// ⛔ Copy contract: every sentence is asserted as RENDERED TEXT, never as state.
// ⛔ It is static text: it fetches nothing (risk R6, no model call before a member writes).
// ⛔ It is in-flow page content (plan 5.6): it never claims the first-run stage and never
//    portals into the first-run slot, so it can neither cover nor queue behind a tour.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import CapabilityPreview from './CapabilityPreview'
import { CAPABILITY_PREVIEW, PREVIEW_COPY } from './capabilityList'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { isFirstRunStageHeld, registerFirstRunSlot } from '../../../../../components/firstRun/firstRunStage'

const byFlag = (flag) => CAPABILITY_PREVIEW.find((c) => c.flag === flag)

beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  registerFirstRunSlot(null)
  vi.restoreAllMocks()
})

describe('CapabilityPreview', () => {
  it('nothing armed and no sample offer: renders nothing at all', () => {
    const { container } = render(<CapabilityPreview canAddSample={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists exactly the armed capabilities, by their own words', () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true, notebook_review_drafts_enabled: true })
    render(<CapabilityPreview canAddSample={false} />)
    const list = screen.getByRole('list', { name: PREVIEW_COPY.heading })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const grading = byFlag('notebook_plan_grading_enabled')
    const reviews = byFlag('notebook_review_drafts_enabled')
    expect(items[0]).toHaveTextContent(`${grading.label}. ${grading.line}`)
    expect(items[1]).toHaveTextContent(`${reviews.label}. ${reviews.line}`)
    expect(screen.getByRole('heading', { name: PREVIEW_COPY.heading })).toBeInTheDocument()
  })

  it('a dark capability is never named, not even in hidden text', () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true, notebook_playbook_enabled: false })
    const { container } = render(<CapabilityPreview canAddSample={false} />)
    expect(container.textContent).not.toContain(byFlag('notebook_playbook_enabled').label)
    expect(container.textContent).not.toContain(byFlag('notebook_playbook_enabled').line)
  })

  it('the sample promotion shows only when the sample button is on screen', () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    const { rerender } = render(<CapabilityPreview canAddSample={false} />)
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
    rerender(<CapabilityPreview canAddSample promoId="promo-1" />)
    const promo = document.getElementById('promo-1')
    expect(promo).not.toBeNull()
    expect(promo).toHaveTextContent(
      `${PREVIEW_COPY.sampleLead} ${PREVIEW_COPY.sampleButton} ${PREVIEW_COPY.sampleTail}`)
  })

  it('the promotion stands alone when no capability is armed (no list, no heading)', () => {
    render(<CapabilityPreview canAddSample promoId="promo-2" />)
    // P0.8: the "Capture from anywhere" box has its own list and heading under the promotion, so
    // "no list, no heading" is asked of the CAPABILITY list and its heading by name.
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
    expect(screen.queryByRole('heading', { name: PREVIEW_COPY.heading })).toBeNull()
    expect(document.getElementById('promo-2')).toHaveTextContent(PREVIEW_COPY.sampleTail)
  })

  it('calls no model (static text; no AI call before a member has written anything)', async () => {
    // ⛔ ONE payload: the latch keeps the first one it sees, so a loop would arm one line only.
    latchNotebookFlags(Object.fromEntries(CAPABILITY_PREVIEW.map((c) => [c.flag, true])))
    render(<CapabilityPreview canAddSample />)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(CAPABILITY_PREVIEW.length)
    // P0.8: the "Capture from anywhere" box under the list asks its two capture gates (the same
    // endpoints the Settings cards ask), and nothing else. Never a model, never a note read.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const urls = global.fetch.mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => u === '/api/j2/inbound-email/address' || u === '/api/j2/personal/tokens')).toBe(true)
  })

  it('P0.8: the capture doors sit under the list, compact', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    render(<CapabilityPreview canAddSample={false} />)
    const doors = await screen.findByRole('region', { name: 'Capture from anywhere' })
    const list = screen.getByRole('list', { name: PREVIEW_COPY.heading })
    expect(list.compareDocumentPosition(doors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('P0.8: nothing armed and no sample offer still renders nothing at all (the doors do not break that)', () => {
    const { container } = render(<CapabilityPreview canAddSample={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('renders in flow: never claims the first-run stage, never lands in the first-run slot', () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    registerFirstRunSlot(slot)
    latchNotebookFlags({ notebook_chart_plan_enabled: true })
    const { container } = render(<CapabilityPreview canAddSample />)
    expect(isFirstRunStageHeld()).toBe(false)
    expect(slot).toBeEmptyDOMElement()
    expect(container.querySelector('section')).not.toBeNull()
    slot.remove()
  })
})
