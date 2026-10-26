// Wave 11 Task 11.17: one "pick yours" choice. The member's own values come from the two existing readers, through a
// fake server with their real shapes: `GET /api/j2/widget-definitions/vocabulary?field=` -> {field, values} (text, or
// {id, name}) and `GET /api/j2/routines|trackers?filter=active` -> {routines|trackers: [...]}. The picker POSTs nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SlotPicker, { NO_VALUES, VALUES_FAILED, VOCAB_FIELD, anyWords, numberOf, valuesOf } from './SlotPicker'

const VOCAB = '/api/j2/widget-definitions/vocabulary?field='
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })

function installServer({ vocab = {}, routines = [], trackers = [], fail = new Set() } = {}) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' })
    if (url.startsWith(VOCAB)) {
      const field = url.slice(VOCAB.length)
      if (fail.has(field)) return json(500, {})
      return json(200, { field, values: vocab[field] || [] })
    }
    if (url === '/api/j2/routines?filter=active') return json(200, { routines })
    if (url === '/api/j2/trackers?filter=active') return json(200, { trackers })
    return json(404, {})
  })
  return calls
}

function mount(slot, answer) {
  const onPick = vi.fn()
  const onCancel = vi.fn()
  render(<SlotPicker slot={slot} answer={answer} onPick={onPick} onCancel={onCancel} />)
  return { onPick, onCancel }
}
const done = () => screen.getByRole('button', { name: 'Done' })

beforeEach(() => setOnline(true))
afterEach(() => { cleanup(); setOnline(true) })

describe('the helpers', () => {
  it('words Any by the choice\'s own label, and reads only finite numbers', () => {
    expect(anyWords('Kind of note')).toBe('Any kind of note')
    expect(numberOf('2.5')).toBe(2.5)
    expect(numberOf(' 0 ')).toBe(0)
    expect(numberOf('-12')).toBe(-12)
    // A plain decimal only (Number() alone would read these as 16, 3, 1000 and 0.5).
    for (const bad of ['', '  ', 'two', 'NaN', 'Infinity', '-Infinity', '0x10', '0b11', '1e3', '.5', '5.', '+3', null, undefined, Number.NaN]) {
      expect(numberOf(bad), String(bad)).toBe(null)
    }
  })

  it('a text value is its own words; {id, name} is the id worded by its name; repeats and junk are dropped', () => {
    expect(valuesOf(['Breakout', '', { id: 7, name: 'Main' }, { id: 'f1' }, { name: 'no id' }, 'Breakout', null]))
      .toEqual([{ value: 'Breakout', label: 'Breakout' }, { value: '7', label: 'Main' }, { value: 'f1', label: 'f1' }])
  })

  it('every list type reads its own vocabulary field (a kind of note is the notes source\'s `kind`)', () => {
    expect(VOCAB_FIELD).toEqual({
      setup: 'setup', tag: 'tag', symbol: 'symbol', account: 'account', property: 'property', folder: 'folder', note_kind: 'kind',
    })
  })
})

describe('the member\'s own values', () => {
  it('lists a setup from the vocabulary, with no Any where the choice does not allow it', async () => {
    const calls = installServer({ vocab: { setup: ['Breakout', 'Pullback'] } })
    const { onPick } = mount({ id: 'p1', type: 'setup', label: 'Setup', any: false }, 'Breakout')
    expect((await screen.findByRole('radio', { name: 'Breakout' })).checked).toBe(true)
    expect(screen.queryByRole('radio', { name: 'Any setup' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Pullback' }))
    fireEvent.click(done())
    expect(onPick).toHaveBeenCalledWith('Pullback', 'Pullback')
    expect(calls).toEqual([{ url: `${VOCAB}setup`, method: 'GET' }])
  })

  it('lists a folder by name and answers its id; Any is offered where allowed', async () => {
    installServer({ vocab: { folder: [{ id: 'fold-1', name: 'Reviews' }] } })
    const { onPick } = mount({ id: 'p2', type: 'folder', label: 'Folder', any: true }, { any: true })
    expect((await screen.findByRole('radio', { name: 'Any folder' })).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Reviews' }))
    fireEvent.click(done())
    expect(onPick).toHaveBeenCalledWith('fold-1', 'Reviews')
  })

  it('a kind of note reads ?field=kind', async () => {
    const calls = installServer({ vocab: { kind: [{ id: 'daily', name: 'Daily' }] } })
    mount({ id: 'p3', type: 'note_kind', label: 'Kind of note', any: true })
    expect(await screen.findByRole('radio', { name: 'Daily' })).toBeTruthy()
    expect(calls[0].url).toBe(`${VOCAB}kind`)
  })

  it('routines and trackers come from the member\'s own lists', async () => {
    const calls = installServer({ routines: [{ id: 'r1', name: 'Morning routine' }], trackers: [{ id: 't1', name: 'Sleep' }] })
    const { onPick } = mount({ id: 'p4', type: 'routine', label: 'Routine', any: false })
    fireEvent.click(await screen.findByRole('radio', { name: 'Morning routine' }))
    fireEvent.click(done())
    expect(onPick).toHaveBeenCalledWith('r1', 'Morning routine')
    cleanup()
    mount({ id: 'p5', type: 'tracker', label: 'Tracker', any: false })
    expect(await screen.findByRole('radio', { name: 'Sleep' })).toBeTruthy()
    expect(calls.map((c) => c.url)).toEqual(['/api/j2/routines?filter=active', '/api/j2/trackers?filter=active'])
  })

  it('no values says so, and Done waits for a pick', async () => {
    installServer({ vocab: { symbol: [] } })
    mount({ id: 'p6', type: 'symbol', label: 'Symbol', any: false })
    expect(await screen.findByText(NO_VALUES)).toBeTruthy()
    expect(done().disabled).toBe(true)
  })

  it('a failed read says so (never an empty list read as "none")', async () => {
    installServer({ fail: new Set(['tag']) })
    mount({ id: 'p7', type: 'tag', label: 'Tag', any: true })
    expect((await screen.findByRole('alert')).textContent).toBe(VALUES_FAILED)
    expect(screen.queryByText(NO_VALUES)).toBeNull()
    // Any is still offered where allowed.
    expect(screen.getByRole('radio', { name: 'Any tag' })).toBeTruthy()
  })
})

describe('a number', () => {
  it('needs a finite number; Any only where allowed', async () => {
    const calls = installServer()
    const { onPick } = mount({ id: 'p8', type: 'number', label: 'Field 1', any: true })
    const box = screen.getByRole('textbox', { name: 'Field 1' })
    expect(done().disabled).toBe(true)
    fireEvent.change(box, { target: { value: '1e400' } })
    expect(done().disabled).toBe(true)
    fireEvent.change(box, { target: { value: '0x10' } })
    expect(done().disabled).toBe(true)
    fireEvent.change(box, { target: { value: '-1.5' } })
    fireEvent.click(done())
    expect(onPick).toHaveBeenLastCalledWith(-1.5, '-1.5')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Any field 1' }))
    expect(box.disabled).toBe(true)
    fireEvent.click(done())
    expect(onPick).toHaveBeenLastCalledWith({ any: true }, 'Any field 1')
    expect(calls).toEqual([])                                     // a number reads nothing
  })

  it('Enter in the box is Done; Cancel changes nothing', async () => {
    installServer()
    const { onPick, onCancel } = mount({ id: 'p9', type: 'number', label: 'Hold days', any: false }, 4)
    const box = screen.getByRole('textbox', { name: 'Hold days' })
    expect(box.value).toBe('4')
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.change(box, { target: { value: '6' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(6, '6')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
  })
})
