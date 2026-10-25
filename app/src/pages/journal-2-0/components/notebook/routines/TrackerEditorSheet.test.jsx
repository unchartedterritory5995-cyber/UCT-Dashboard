// Wave 9 Task 9.16: the tracker editor. Every assertion reads what the member SEES or what the server is SENT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import TrackerEditorSheet from './TrackerEditorSheet'
import { openTrackerEditor } from './openTrackerEditor'
import { openRoutineEditor } from './openRoutineEditor'
import { installServer, tracker } from './__fixtures__/toolsServer'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))

const S_KIND_FIXED = "A tracker's type can't change. Make a new tracker instead."
const S_UNIT = 'A unit can be at most 16 characters.'
let net
beforeEach(() => { net = installServer({ tools: { t1: tracker(), 'checkin:mood': tracker({ id: 'checkin:mood', name: 'Check-in mood', kind: 'scale', unit: null, readOnly: true, etag: null, usedIn: 0, settings: { days: 'any' } }) } }) })
afterEach(() => cleanup())

function mount(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<TrackerEditorSheet onClose={onClose} onSaved={onSaved} {...props} />)
  return { onClose, onSaved }
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const radio = (name) => screen.getByRole('radio', { name })

describe('a new tracker', () => {
  it('kind, unit (for a number) and days: Trading days by default', async () => {
    const { onSaved } = mount()
    expect(await screen.findByRole('heading', { name: 'New tracker' })).toBeTruthy()
    expect(['Yes / no', 'Number', '1-5 scale', 'Duration'].map((k) => radio(k).checked)).toEqual([true, false, false, false])
    expect(screen.queryByRole('textbox', { name: 'Unit' })).toBeNull()       // a unit is for a number only
    expect(radio('Trading days').checked).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Sleep' } })
    fireEvent.click(radio('Number'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Unit' }), { target: { value: 'hours' } })
    fireEvent.click(radio('Any day'))
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(net.sent('POST', '/api/j2/trackers')[0].body).toEqual({ name: 'Sleep', kind: 'number', unit: 'hours', settings: { days: 'any' } })
  })

  it('a yes/no tracker sends no unit, even one typed while it was a number', async () => {
    mount()
    await screen.findByRole('heading', { name: 'New tracker' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Journaled' } })
    fireEvent.click(radio('Number'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Unit' }), { target: { value: 'pages' } })
    fireEvent.click(radio('Yes / no'))
    save()
    await waitFor(() => expect(net.sent('POST', '/api/j2/trackers')).toHaveLength(1))
    expect(net.sent('POST', '/api/j2/trackers')[0].body).toEqual({ name: 'Journaled', kind: 'yesno', settings: { days: 'trading' } })
  })

  it('unit_17_chars_refused_client_side_too', async () => {
    mount()
    await screen.findByRole('heading', { name: 'New tracker' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Sleep' } })
    fireEvent.click(radio('Number'))
    const unit = screen.getByRole('textbox', { name: 'Unit' })
    fireEvent.change(unit, { target: { value: 'x'.repeat(16) } })
    expect(screen.queryByText(S_UNIT)).toBeNull()                            // 16 is fine
    fireEvent.change(unit, { target: { value: 'x'.repeat(17) } })
    expect(screen.getByText(S_UNIT)).toBeTruthy()                            // said as they type, beside the field
    expect(unit.getAttribute('aria-invalid')).toBe('true')
    save()
    await waitFor(() => expect(document.activeElement).toBe(unit))
    expect(net.sent('POST')).toHaveLength(0)                                 // and never sent
  })

  it('the server\'s own sentence for a unit lands beside the unit', async () => {
    mount()
    await screen.findByRole('heading', { name: 'New tracker' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Sleep' } })
    fireEvent.click(radio('Number'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Unit' }), { target: { value: 'hrs' } })
    net.refuseNext('POST', '/api/j2/trackers', 400, { code: 'invalid', message: 'SERVER: A unit can be at most 16 characters.' })
    save()
    const unit = screen.getByRole('textbox', { name: 'Unit' })
    await waitFor(() => expect(unit.getAttribute('aria-invalid')).toBe('true'))
    expect(unit.closest('[data-field-box]').textContent).toContain('SERVER: A unit can be at most 16 characters.')
  })

  it('the count cap shows the server\'s sentence and keeps the draft', async () => {
    mount()
    await screen.findByRole('heading', { name: 'New tracker' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Focus' } })
    net.refuseNext('POST', '/api/j2/trackers', 409, { code: 'count_cap', message: 'You have 30 trackers. Archive one in My tools to make room.' })
    save()
    expect(await screen.findByText('You have 30 trackers. Archive one in My tools to make room.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Focus')
  })
})

describe('editing a tracker', () => {
  it('tracker_kind_fixed_after_create', async () => {
    const { onSaved } = mount({ trackerId: 't1' })
    expect(await screen.findByRole('heading', { name: 'Edit tracker' })).toBeTruthy()
    expect(radio('Number').checked).toBe(true)
    expect(screen.getByText(S_KIND_FIXED)).toBeTruthy()
    for (const k of ['Yes / no', 'Number', '1-5 scale', 'Duration']) {
      expect(radio(k).getAttribute('aria-disabled')).toBe('true')
      expect(radio(k).hasAttribute('disabled')).toBe(false)
    }
    fireEvent.click(radio('Duration'))
    expect(radio('Number').checked).toBe(true)                               // the guard holds
    expect(screen.getByRole('textbox', { name: 'Unit' }).value).toBe('hours')
    fireEvent.change(screen.getByRole('textbox', { name: 'Unit' }), { target: { value: '' } })
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const put = net.sent('PUT', '/api/j2/trackers/t1')[0]
    expect(put.headers['If-Match']).toBe('3')
    expect(put.body).toEqual({ name: 'Sleep', unit: null, settings: { days: 'trading' } })   // a cleared unit is null; no kind
    expect(put.body).not.toHaveProperty('kind')
  })

  it('a conflict keeps the draft and offers Reload', async () => {
    mount({ trackerId: 't1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    net.store.set('t1', tracker({ name: 'Sleep hours', etag: 4 }))
    fireEvent.change(name, { target: { value: 'Rest' } })
    save()
    expect(await screen.findByText('Changed in another tab. Reload to see the newer version.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Rest')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Sleep hours'))
  })

  it('a check-in tracker is read-only: its words and no controls', async () => {
    mount({ trackerId: 'checkin:mood' })
    expect(await screen.findByText('Mood and focus come from your check-ins.')).toBeTruthy()
    expect(screen.getByText('Check-in mood')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('Escape asks only when something changed', async () => {
    const { onClose } = mount({ trackerId: 't1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.keyDown(name, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    cleanup()
    const second = mount({ trackerId: 't1' })
    const n2 = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.click(radio('Any day'))
    fireEvent.keyDown(n2, { key: 'Escape' })
    expect(await screen.findByRole('heading', { name: 'Keep your changes?' })).toBeTruthy()
    expect(second.onClose).not.toHaveBeenCalled()
  })
})

describe('openTrackerEditor', () => {
  it('one editor at a time across routines and trackers, focus back to the opener', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    let close
    await act(async () => { close = openTrackerEditor({ trackerId: 't1' }) })
    expect(await screen.findByRole('heading', { name: 'Edit tracker' })).toBeTruthy()
    let other
    await act(async () => { other = openRoutineEditor({}) })
    expect(other).toBe(close)                                                 // the open editor answers
    expect(screen.queryByRole('heading', { name: 'New routine' })).toBeNull()
    await act(async () => { close(); await new Promise((r) => setTimeout(r, 5)) })
    expect(document.querySelectorAll('[data-tracker-editor-root]')).toHaveLength(0)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
