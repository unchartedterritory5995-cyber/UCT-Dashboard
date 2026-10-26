// Task 9.16 fix round 1 (M-1, M-2, M-3): the server's refusal sentences are ONE table (toolEditorLib
// SERVER_SENTENCES), pinned word for word to the server's text (__fixtures__/serverSentences.json, extracted from the
// server source), and every sentence that belongs beside a field lands beside THAT field when the server sends it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SERVER from './__fixtures__/serverSentences.json'
import { CHECK, SERVER_SENTENCES, charCount, checkRoutine, checkTracker, blankRoutine, blankItem, fieldOf } from './toolEditorLib'
import { CRUD_COPY } from '../../../lib/toolsCrud'
import RoutineEditorSheet from './RoutineEditorSheet'
import TrackerEditorSheet from './TrackerEditorSheet'
import { installServer, routine, tracker } from './__fixtures__/toolsServer'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
afterEach(() => cleanup())

describe('one table of the server\'s sentences', () => {
  it('is the server\'s text, word for word, for every sentence it names (and no sentence the server lacks)', () => {
    for (const kind of ['routine', 'tracker']) {
      const ours = Object.fromEntries(Object.entries(SERVER_SENTENCES[kind]).map(([k, [text]]) => [k, text]))
      expect(ours).toEqual(SERVER[kind])
    }
    expect(CRUD_COPY.paid).toBe(SERVER.router.S_PAID)
  })

  it('the client\'s own checks say what the server says for the same rule', () => {
    expect(CHECK).toMatchObject({
      routineName: SERVER.routine.S_BAD_NAME, trackerName: SERVER.tracker.S_BAD_NAME, nameLong: SERVER.routine.S_NAME_LONG,
      noItems: SERVER.routine.S_NO_ITEMS, tooMany: SERVER.routine.S_TOO_MANY_ITEMS, itemLong: SERVER.routine.S_ITEM_LONG,
      noWeekday: SERVER.routine.S_BAD_SCHEDULE, unitLong: SERVER.tracker.S_UNIT, kindFixed: SERVER.tracker.S_KIND_FIXED,
    })
  })

  it('placement is an exact match: a reworded sentence goes to the notice line, never to a guessed field', () => {
    expect(fieldOf('routine', SERVER.routine.S_BAD_TIME)).toBe('reminder')
    expect(fieldOf('routine', 'Choose a time on a 5-minute step.')).toBe(null)
    expect(fieldOf('routine', SERVER.routine.S_TYPE_NAME)).toBe(null)
    expect(fieldOf('tracker', SERVER.tracker.S_UNIT)).toBe('unit')
    expect(fieldOf('widget', SERVER.tracker.S_UNIT)).toBe(null)
  })

  it('lengths count code points, as the server does: nine emoji are nine characters', () => {
    const unit = '📚'.repeat(9)
    expect(unit.length).toBe(18)
    expect(charCount(unit)).toBe(9)
    expect(checkTracker({ name: 'Reading', kind: 'number', unit, days: 'trading' })).toEqual({})
    expect(checkTracker({ name: 'Reading', kind: 'number', unit: '📚'.repeat(17), days: 'trading' }).unit).toBe(CHECK.unitLong)
    expect(checkRoutine({ ...blankRoutine(), name: '🧭'.repeat(80), items: [blankItem('🧭'.repeat(200))] })).toEqual({})
  })
})

/** Every field-bound sentence, sent by the server on Save, lands beside that field (aria-invalid + described by it). */
const ROUTINE_FIELDS = Object.entries(SERVER_SENTENCES.routine).filter(([, [, f]]) => f)
const TRACKER_FIELDS = Object.entries(SERVER_SENTENCES.tracker).filter(([, [, f]]) => f)

async function landsBeside(text, field) {
  await waitFor(() => {
    const el = document.querySelector(`[data-field="${field}"]`)
    expect(el, `no ${field} control`).toBeTruthy()
    expect(el.closest('[data-field-box]').textContent).toContain(text)
  })
}

describe('a server sentence lands beside its own field', () => {
  for (const [key, [text, field]] of ROUTINE_FIELDS) {
    it(`routine ${key} -> ${field}`, async () => {
      const net = installServer({ tools: { r1: routine({ settings: { done_share: 1, strict: false, reminder: { on: true, time_et: '09:00' } } }) } })
      render(<RoutineEditorSheet routineId="r1" onClose={() => {}} zone="America/Chicago" now={new Date('2026-10-26T14:00:00Z')} />)
      fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Prep' } })
      net.refuseNext('PUT', '/api/j2/routines/r1', 400, { code: 'invalid', message: text })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await landsBeside(text, field)
      expect(screen.getByTestId('tool-editor-live').textContent).not.toContain(text)
    })
  }
  for (const [key, [text, field]] of TRACKER_FIELDS) {
    it(`tracker ${key} -> ${field}`, async () => {
      const net = installServer({ tools: { t1: tracker() } })
      render(<TrackerEditorSheet trackerId="t1" onClose={() => {}} />)
      fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Rest' } })
      net.refuseNext('PUT', '/api/j2/trackers/t1', 400, { code: 'invalid', message: text })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await landsBeside(text, field)
    })
  }

  it('a sentence with no field shows in the notice line', async () => {
    const net = installServer({ tools: { r1: routine() } })
    render(<RoutineEditorSheet routineId="r1" onClose={() => {}} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Prep' } })
    net.refuseNext('PUT', '/api/j2/routines/r1', 400, { code: 'invalid', message: SERVER.routine.S_BAD_SETTINGS })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByTestId('tool-editor-live').textContent).toContain(SERVER.routine.S_BAD_SETTINGS))
  })
})
