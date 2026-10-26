// Wave 11 Task 11.15: the share preview. Every assertion reads what the member SEES (text, roles, names, values) or
// what the server is SENT (path, body), never component state. `fetch` is a fake gallery server whose answers have
// the shape of `template_gallery.share_preview` over `widget_engine/share.py`: {travels, slots, kept, notShared,
// prefill}, refusals {detail: {code, message}}.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import SharePreviewSheet, {
  SENT_SENTENCE, DEBOUNCE_MS, pickLine, fieldsFromPrefill, sharedNumbers, FIELD_NAME_HINT, CATEGORY_HINT,
} from './SharePreviewSheet'
import { openSharePreview } from './openSharePreview'

const waves = vi.hoisted(() => ({ eleven: true }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 11 && waves.eleven }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))

const PREVIEW = '/api/j2/template-gallery/share/preview'
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const S_OWN_WORDS = 'Field 2 uses your own words. Change that part before sharing.'
const S_ADOPTED = 'This widget came from the library, so it can’t be shared again.'
const S_NOT_SHARED = 'Your setups are left out; people pick their own.'

// ── the fake server ────────────────────────────────────────────────────────────────────────────────

const WIDGET_PREFILL = {
  // Ruling W11-R22's shape exactly: formulas [{id, name}], items [{text}], numbers [{path, value, label?}].
  name: 'My R curve', description: 'R by setup', formulas: [{ id: 'f1', name: 'Risk multiple' }],
  numbers: [{ path: 'filters/0/values/0', value: 2.5, label: 'Hold days' }],
}
/** What share_plan answers for these edits (its keys exactly), unless `over` says otherwise. */
function widgetAnswer(body, over = {}) {
  const e = body.edits || {}
  return {
    travels: {
      name: e.name?.trim() || 'Win rate by setup', description: e.description?.trim() || 'Win rate split by setup',
      plan: { v: 3, source: 'trades', view: { type: 'bar', auto: false }, formulas: [{ id: 'f1', name: e.formulas?.f1?.trim() || 'Field 1', expr: '[#p2] * 2', format: 'number' }] },
      slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: true }, { id: 'p2', type: 'number', label: 'Field 1', any: false }],
    },
    slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: true }, { id: 'p2', type: 'number', label: 'Field 1', any: false },
      { id: 'p3', type: 'account', label: 'Account', any: true }],
    kept: [...(body.keep || [])],
    notShared: [S_NOT_SHARED],
    prefill: WIDGET_PREFILL,
    ...over,
  }
}
const ROUTINE_ITEMS = ['Check news', 'Mark levels', 'Size the plan']
const ROUTINE_PREFILL = { name: 'Morning prep', items: ROUTINE_ITEMS.map((text) => ({ text })) }
function routineAnswer(body) {
  const e = body.edits || {}
  const items = (e.items || []).filter((t) => typeof t === 'string' && t.trim()).map((t) => ({ text: t.trim(), negative: false }))
  return {
    travels: { name: e.name?.trim() || 'Routine with 0 items', items, schedule: { kind: 'every' }, settings: { done_share: 1 } },
    slots: [], kept: [], notShared: ['Your ticks, history and reminders are left out.'], prefill: ROUTINE_PREFILL,
  }
}

/** A gallery server: `answer(body)` answers the preview (a {status, body} pair or a body for 200). Every request is
 *  recorded; `hold` makes each preview wait until released. */
function installServer(answer, { hold = false } = {}) {
  const calls = []
  const pending = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method || 'GET', body })
    const reply = () => {
      if (url === PREVIEW) {
        const out = answer(body)
        return out && out.__status ? json(out.__status, out.body) : json(200, out)
      }
      if (url.endsWith('/tools') || url.endsWith('/styles')) return json(200, { template: { id: 'g1' } })
      return json(404, {})
    }
    if (hold && url === PREVIEW) return new Promise((resolve) => pending.push(() => resolve(reply())))
    return reply()
  })
  return {
    calls,
    previews: () => calls.filter((c) => c.url === PREVIEW),
    release: () => { const r = pending.shift(); r?.() },
    waiting: () => pending.length,
  }
}
const refuse = (code, message) => () => ({ __status: 400, body: { detail: { code, message } } })

beforeEach(() => { setOnline(true); waves.eleven = true })
afterEach(() => { cleanup(); setOnline(true); vi.useRealTimers() })

function mount(props) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(<SharePreviewSheet onClose={onClose} onDone={onDone} {...props} />)
  return { onClose, onDone }
}
const sendButton = () => screen.getByRole('button', { name: 'Send for review' })
const travels = () => document.querySelector('[data-travels]')
const settle = (ms = DEBOUNCE_MS + 150) => act(() => new Promise((r) => setTimeout(r, ms)))
/** The sheet has asked twice (the prefill ask, then the ask WITH the prefilled words) and the answer is fresh. */
async function primed(net, n = 2) {
  await waitFor(() => expect(net.previews().length).toBe(n))
  await waitFor(() => expect(sendButton().disabled).toBe(false))
}

// ── the tests ──────────────────────────────────────────────────────────────────────────────────────

describe('the share preview of a widget', () => {
  it('prefill_shown_and_only_edits_sent', async () => {
    const net = installServer(widgetAnswer)
    mount({ kind: 'widget', id: 'w1' })
    expect(await screen.findByRole('dialog', { name: 'Share to library' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What will be shared' })).toBeTruthy()
    const name = await screen.findByRole('textbox', { name: 'Name' })
    expect(name.value).toBe('My R curve')
    expect(screen.getByRole('textbox', { name: 'Description' }).value).toBe('R by setup')
    const field = screen.getByRole('textbox', { name: 'Name of field 1' })
    expect(field.value).toBe('Risk multiple')
    expect(field.getAttribute('placeholder')).toBe('Field 1')
    expect(name.getAttribute('maxlength')).toBe('80')
    expect(screen.getByRole('textbox', { name: 'Description' }).getAttribute('maxlength')).toBe('280')
    expect(screen.getByText('A name can be at most 80 characters.')).toBeTruthy()
    await primed(net)
    // The first ask carries no edits (nothing typed yet); the second is exactly the fields' values.
    expect(net.previews()[0].body).toEqual({ kind: 'widget', id: 'w1', keep: [] })
    expect(net.previews()[1].body).toEqual({
      kind: 'widget', id: 'w1', keep: [],
      edits: { name: 'My R curve', description: 'R by setup', formulas: { f1: 'Risk multiple' } },
    })
    fireEvent.change(name, { target: { value: 'Setup win rate' } })
    fireEvent.change(field, { target: { value: '' } })
    await waitFor(() => expect(net.previews().length).toBe(3))
    const body = net.previews()[2].body
    expect(body.edits).toEqual({ name: 'Setup win rate', description: 'R by setup', formulas: { f1: '' } })
    // Nothing else from the row: the stored number and its label never ride along unasked.
    expect(JSON.stringify(body)).not.toMatch(/2\.5|Hold days/)
  })

  it('number_switch_off_by_default_and_keep_sent_when_on', async () => {
    const net = installServer(widgetAnswer)
    mount({ kind: 'widget', id: 'w1' })
    const sw = await screen.findByRole('switch', { name: 'Hold days: Share this number (2.5)' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await primed(net)
    expect(net.previews().every((c) => c.body.keep.length === 0)).toBe(true)
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(net.previews().length).toBe(3))
    expect(net.previews()[2].body.keep).toEqual(['filters/0/values/0'])
    fireEvent.click(sw)
    await waitFor(() => expect(net.previews().length).toBe(4))
    expect(net.previews()[3].body.keep).toEqual([])
  })

  it('what_travels_is_the_server_answer', async () => {
    const net = installServer((b) => widgetAnswer(b, {
      travels: { name: 'Server words', description: 'Server description', plan: { formulas: [{ id: 'f1', name: 'Server field' }] } },
    }))
    mount({ kind: 'widget', id: 'w1' })
    expect((await screen.findByRole('textbox', { name: 'Name' })).value).toBe('My R curve')
    await primed(net)
    const t = within(travels())
    expect(screen.getByRole('heading', { name: 'Exactly what travels' })).toBeTruthy()
    expect(t.getByText('Server words')).toBeTruthy()
    expect(t.getByText('Server description')).toBeTruthy()
    expect(t.getByText('Server field')).toBeTruthy()
    expect(travels().textContent).not.toMatch(/My R curve|R by setup|Risk multiple/)
    expect(travels().textContent).not.toMatch(/[{}"]/)                  // plain words, never JSON
    // The line of choices and the left-out sentences are the server's too.
    expect(screen.getByText(pickLine(['Setup', 'Number', 'Account']))).toBeTruthy()
    expect(screen.getByText('People who use it pick their own: Setup, Number, Account')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Not shared' })).toBeTruthy()
    expect(screen.getByText(S_NOT_SHARED)).toBeTruthy()
  })

  it('debounce_one_in_flight', async () => {
    const net = installServer(widgetAnswer, { hold: true })
    mount({ kind: 'widget', id: 'w1' })
    await waitFor(() => expect(net.waiting()).toBe(1))
    await act(async () => net.release())
    await waitFor(() => expect(net.waiting()).toBe(1))            // the ask WITH the prefilled words
    await act(async () => net.release())
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    expect(net.previews().length).toBe(2)
    // Three quick edits: nothing until 600 ms after the last, then ONE ask with the last value.
    fireEvent.change(name, { target: { value: 'A' } })
    expect(sendButton().disabled).toBe(true)                     // the answer on screen is not for these fields
    await settle(200)
    fireEvent.change(name, { target: { value: 'AB' } })
    await settle(200)
    fireEvent.change(name, { target: { value: 'ABC' } })
    await settle(DEBOUNCE_MS - 200)
    expect(net.previews().length).toBe(2)
    await settle(400)
    expect(net.previews().length).toBe(3)
    expect(net.previews()[2].body.edits.name).toBe('ABC')
    // While that ask is in flight, more edits wait for it: no second request in flight.
    fireEvent.change(name, { target: { value: 'ABCD' } })
    await settle()
    fireEvent.change(name, { target: { value: 'ABCDE' } })
    await settle()
    expect(net.previews().length).toBe(3)
    expect(net.waiting()).toBe(1)
    await act(async () => net.release())
    await waitFor(() => expect(net.previews().length).toBe(4))   // then once, with the latest fields
    expect(net.previews()[3].body.edits.name).toBe('ABCDE')
    expect(sendButton().disabled).toBe(true)
    await act(async () => net.release())
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    expect(net.previews().length).toBe(4)
  })

  it('offline_no_request', async () => {
    setOnline(false)
    const net = installServer(widgetAnswer)
    mount({ kind: 'widget', id: 'w1' })
    expect((await screen.findByRole('alert')).textContent).toBe("You're offline. Try again when you're back online.")
    expect(net.calls).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(sendButton().disabled).toBe(true)
    // Back online, Try again asks, and the prefill arrives.
    setOnline(true)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findByRole('textbox', { name: 'Name' })).value).toBe('My R curve')
    await primed(net)
  })

  it('success_sentence_exact', async () => {
    const net = installServer(widgetAnswer)
    const { onDone } = mount({ kind: 'widget', id: 'w1' })
    const sw = await screen.findByRole('switch', { name: /Share this number/ })
    await primed(net)
    fireEvent.click(sw)
    await waitFor(() => expect(net.previews().length).toBe(3))
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    fireEvent.click(sendButton())
    expect((await screen.findByRole('status')).textContent).toBe("Sent. UCT reviews every item before it's listed.")
    expect(SENT_SENTENCE).toBe("Sent. UCT reviews every item before it's listed.")
    expect(onDone).toHaveBeenCalledWith(SENT_SENTENCE)
    const publish = net.calls.filter((c) => c.url === '/api/j2/template-gallery/tools')
    expect(publish).toHaveLength(1)
    // Named by the SERVER's answer, and carrying exactly the edits and keep that answer was given for.
    expect(publish[0]).toMatchObject({ method: 'POST' })
    expect(publish[0].body).toEqual({
      kind: 'widget', id: 'w1', title: 'My R curve', description: 'R by setup',
      edits: { name: 'My R curve', description: 'R by setup', formulas: { f1: 'Risk multiple' } },
      keep: ['filters/0/values/0'],
    })
  })
})

describe('fix round 1', () => {
  it("I-1: the author's own field names are prefilled from R22's formulas [{id, name}] (the object form still reads)", () => {
    const travels = { plan: { formulas: [{ id: 'f2' }, { id: 'f1' }] } }
    const r22 = fieldsFromPrefill('widget', { name: 'N', formulas: [{ id: 'f1', name: 'Risk' }, { id: 'f2', name: 'Hold' }] }, travels)
    expect(r22.formulas).toEqual([{ id: 'f2', text: 'Hold' }, { id: 'f1', text: 'Risk' }])
    expect(fieldsFromPrefill('widget', { formulas: { f1: 'Risk' } }, null).formulas).toEqual([{ id: 'f1', text: 'Risk' }])
    expect(fieldsFromPrefill('routine', { items: [{ text: 'A' }, 'B'] }, null).items.map((i) => i.text)).toEqual(['A', 'B'])
  })

  it("I-2: a field name is capped at the server's 60 with its sentence beside it", async () => {
    installServer(widgetAnswer)
    mount({ kind: 'widget', id: 'w1' })
    const field = await screen.findByRole('textbox', { name: 'Name of field 1' })
    expect(field.getAttribute('maxlength')).toBe('60')
    const hint = document.getElementById(field.getAttribute('aria-describedby'))
    expect(hint.textContent).toBe(FIELD_NAME_HINT)
    expect(FIELD_NAME_HINT).toBe('A field name can be at most 60 characters.')
  })

  it("I-3: turning a number on re-asks the server, and the panel shows the SERVER's value", async () => {
    // The server answers with its own value for the kept number (9), not the switch's 2.5.
    const net = installServer((b) => widgetAnswer(b, {
      prefill: { ...WIDGET_PREFILL, numbers: [{ path: 'filters/0/values/0', value: (b.keep || []).length ? 9 : 2.5, label: 'Hold days' }] },
    }))
    mount({ kind: 'widget', id: 'w1' })
    const sw = await screen.findByRole('switch', { name: 'Hold days: Share this number (2.5)' })
    await primed(net)
    expect(travels().textContent).not.toMatch(/Shared numbers/)
    expect(within(travels()).getByText('Bar')).toBeTruthy()                          // "Shown as: Bar", from the plan
    fireEvent.click(sw)
    await waitFor(() => expect(net.previews().length).toBe(3))
    expect(net.previews()[2].body.keep).toEqual(['filters/0/values/0'])
    await waitFor(() => expect(within(travels()).getByText('Hold days 9')).toBeTruthy())
    expect(travels().textContent).not.toMatch(/2\.5/)
  })

  it('I-3 CONTROL: a switch the server did not keep shows nothing in the panel', async () => {
    const net = installServer((b) => widgetAnswer(b, { kept: [] }))
    mount({ kind: 'widget', id: 'w1' })
    const sw = await screen.findByRole('switch', { name: /Share this number/ })
    await primed(net)
    fireEvent.click(sw)
    await waitFor(() => expect(net.previews().length).toBe(3))
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    expect(travels().textContent).not.toMatch(/Shared numbers|Hold days/)
    expect(sharedNumbers({ kept: ['x/y'], prefill: { blocks: { built_a: { numbers: [{ path: 'y', value: 1 }] } } } })).toEqual([])
    expect(sharedNumbers({ kept: ['built_a/y'], prefill: { blocks: { built_a: { numbers: [{ path: 'y', value: 0, label: 'T' }] } } } })).toEqual(['T 0'])
  })

  it('M-3: focus moves to Done after a send, and to the refusal after a send refused for good', async () => {
    const net = installServer(widgetAnswer)
    mount({ kind: 'widget', id: 'w1' })
    await screen.findByRole('textbox', { name: 'Name' })
    await primed(net)
    fireEvent.click(sendButton())
    const done = await screen.findByRole('button', { name: 'Done' })
    await waitFor(() => expect(document.activeElement).toBe(done))
    cleanup()
    globalThis.fetch = vi.fn(async (url, init = {}) => (url === PREVIEW ? json(200, widgetAnswer(JSON.parse(init.body)))
      : json(400, { detail: { code: 'adopted', message: S_ADOPTED } })))
    mount({ kind: 'widget', id: 'w1' })
    await screen.findByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    fireEvent.click(sendButton())
    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(alert))
  })

  it('M-5: not_yours cannot be fixed here, so it blocks with no Try again', async () => {
    installServer(refuse('not_yours', 'This routine is not in your account.'))
    mount({ kind: 'template', id: 's1' })
    expect((await screen.findByRole('alert')).textContent).toBe('This routine is not in your account.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(sendButton().disabled).toBe(true)
  })

  it('M-7: the fields are not a form Enter half-submits, and a missing category says so', async () => {
    const net = installServer(() => ({
      travels: { name: 'T', blocks: [] }, slots: [], kept: [], notShared: [], prefill: { name: 'T', blocks: {} },
    }))
    mount({ kind: 'template', id: 's1' })
    const select = await screen.findByRole('combobox', { name: 'Category (required)' })
    expect(document.querySelector('[data-share-preview] form')).toBeNull()
    expect(document.getElementById(select.getAttribute('aria-describedby')).textContent).toBe(CATEGORY_HINT)
    await waitFor(() => expect(net.previews().length).toBe(2))
    fireEvent.change(select, { target: { value: 'journal' } })
    expect(screen.queryByText(CATEGORY_HINT)).toBeNull()
  })

  it('M-8: a routine held by two blocks gets controls once; the second block says where to change it', async () => {
    const net = installServer(() => ({
      travels: {
        format: 2, name: 'T', description: '',
        blocks: [{ block: 'routine_a', settings: { inline: 'r1' } }, { block: 'routine_b', settings: { inline: 'r1' } }],
        definitions: [], routines: [{ key: 'r1', name: 'Morning prep', items: [{ text: 'A' }] }], trackers: [], slots: [],
      },
      slots: [], kept: [], notShared: [],
      prefill: {
        name: 'T', description: '',
        blocks: { routine_a: { name: 'Morning prep', items: [{ text: 'A' }] }, routine_b: { name: 'Morning prep', items: [{ text: 'A' }] } },
      },
    }))
    mount({ kind: 'template', id: 's1' })
    expect(await screen.findByText('This is the same as Routine: Morning prep above. Change it there.')).toBeTruthy()
    expect(screen.getAllByRole('textbox', { name: 'Item 1' })).toHaveLength(1)
    await waitFor(() => expect(net.previews().length).toBe(2))
    expect(Object.keys(net.previews()[1].body.edits.blocks)).toEqual(['routine_a'])
  })
})

describe('server refusals', () => {
  it('adopted_refusal_disables_send', async () => {
    const net = installServer(refuse('adopted', S_ADOPTED))
    mount({ kind: 'widget', id: 'w1' })
    expect((await screen.findByRole('alert')).textContent).toBe(S_ADOPTED)
    expect(sendButton().disabled).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(travels()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    await settle()
    expect(net.previews()).toHaveLength(1)
    fireEvent.click(sendButton())
    expect(net.calls.some((c) => c.url.endsWith('/tools'))).toBe(false)
  })

  it('own_words_sentence_names_field', async () => {
    installServer(refuse('own_words', S_OWN_WORDS))
    mount({ kind: 'widget', id: 'w1' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(S_OWN_WORDS)
    expect(alert.textContent).toMatch(/^Field 2 /)
    expect(alert.getAttribute('data-refusal')).toBe('own_words')
    expect(sendButton().disabled).toBe(true)
  })

  it('a refusal at send time stands at the top and keeps Send off', async () => {
    const net = installServer(widgetAnswer)
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      if (url === PREVIEW) return json(200, widgetAnswer(JSON.parse(init.body)))
      return json(400, { detail: { code: 'adopted', message: S_ADOPTED } })
    })
    mount({ kind: 'widget', id: 'w1' })
    await screen.findByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    fireEvent.click(sendButton())
    expect((await screen.findByRole('alert')).textContent).toBe(S_ADOPTED)
    expect(sendButton().disabled).toBe(true)
    expect(net).toBeTruthy()
  })
})

describe('the share preview of a routine and a tracker', () => {
  it('routine_untick_removes_item', async () => {
    const net = installServer(routineAnswer)
    mount({ kind: 'routine', id: 'r1' })
    const boxes = await screen.findAllByRole('checkbox', { name: /^Share item \d$/ })
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true])
    expect(screen.getAllByRole('textbox', { name: /^Item \d$/ }).map((i) => i.value)).toEqual(ROUTINE_ITEMS)
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull()
    await primed(net)
    expect(within(travels()).getByText('Mark levels')).toBeTruthy()
    fireEvent.click(boxes[1])
    await waitFor(() => expect(net.previews().length).toBe(3))
    // Unticked is '' AT ITS PLACE, so each kept item stays paired with its own stored settings.
    expect(net.previews()[2].body.edits).toEqual({ name: 'Morning prep', items: ['Check news', '', 'Size the plan'] })
    await waitFor(() => expect(within(travels()).queryByText('Mark levels')).toBeNull())
    expect(within(travels()).getByText('Check news')).toBeTruthy()
    // An item the author edits travels in the author's new words.
    fireEvent.change(screen.getByRole('textbox', { name: 'Item 3' }), { target: { value: 'Size it' } })
    await waitFor(() => expect(net.previews().length).toBe(4))
    expect(net.previews()[3].body.edits.items).toEqual(['Check news', '', 'Size it'])
  })

  it('a tracker shares its Name and Unit', async () => {
    const net = installServer((b) => ({
      travels: { name: b.edits?.name || 'Number tracker', kind: 'number', unit: b.edits?.unit || null, days: 'trading' },
      slots: [], kept: [], notShared: ['Your logged values are left out.'], prefill: { name: 'Sleep', unit: 'hrs' },
    }))
    mount({ kind: 'tracker', id: 't1' })
    expect((await screen.findByRole('textbox', { name: 'Name' })).value).toBe('Sleep')
    expect(screen.getByRole('textbox', { name: 'Unit' }).value).toBe('hrs')
    await primed(net)
    expect(net.previews()[1].body.edits).toEqual({ name: 'Sleep', unit: 'hrs' })
    expect(within(travels()).getByText('Number')).toBeTruthy()
    expect(within(travels()).getByText('Trading days')).toBeTruthy()
    expect(screen.queryByText(/People who use it pick their own/)).toBeNull()      // no choices: no line, no zero
  })
})

describe('the share preview of a template', () => {
  const STYLE_PREFILL = {
    name: 'My prep', description: 'Before the open',
    blocks: {
      built_a: { name: 'R curve', description: 'R by setup', formulas: [{ id: 'f1', name: 'Risk' }], numbers: [{ path: 'display/target', value: 3, label: 'Target' }] },
      routine_a: { name: 'Morning prep', items: [{ text: 'Check news' }, { text: 'Mark levels' }] },
      tracker_a: { name: 'Sleep', unit: 'hrs' },
    },
  }
  const templateAnswer = (b) => ({
    travels: {
      format: 2, name: b.edits?.name || 'Template', description: b.edits?.description || '',
      blocks: [
        { block: 'built_a', enabled: true, settings: { ref: 'inline:d1' } },
        { block: 'routine_a', enabled: true, settings: { inline: 'r1', bind: 'next-trading-day', display: 'items' } },
        { block: 'tracker_a', enabled: true, settings: { inline: 't1', bind: 'note-day', display: 'chart' } },
        { block: 'marketcontext', enabled: true, settings: {} },
      ],
      definitions: [{ key: 'd1', name: b.edits?.blocks?.built_a?.name || 'Win rate', description: '', plan: { formulas: [{ id: 'f1', name: 'Risk' }] } }],
      routines: [{ key: 'r1', name: b.edits?.blocks?.routine_a?.name || 'Routine with 2 items', items: [{ text: 'Check news' }], schedule: { kind: 'every' } }],
      trackers: [{ key: 't1', name: 'Sleep', kind: 'number', unit: 'hrs', days: 'trading' }],
      slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: true }],
    },
    slots: [{ id: 'p1', type: 'setup', label: 'Setup', any: true }],
    kept: [...(b.keep || [])], notShared: [], prefill: STYLE_PREFILL,
  })

  it("F-FE-1 F1: the template's outline travels in the server's words, inside Exactly what travels", async () => {
    // template_gallery.share_preview's `outline` (11.15 M-4, W11-R33): sanitized, every link mark already dropped.
    const OUTLINE = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Before the bell' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'What would change the plan?' }] },
    ] }
    installServer((b) => ({ ...templateAnswer(b), outline: OUTLINE, outlineGone: false }))
    mount({ kind: 'template', id: 's1' })
    await waitFor(() => expect(travels()?.querySelector('[data-outline-travels]')).toBeTruthy())
    const box = travels().querySelector('[data-outline-travels]')
    expect(within(box).getByRole('heading', { name: 'Outline' })).toBeTruthy()
    expect(within(box).getByText('Before the bell')).toBeTruthy()
    expect(within(box).getByText('What would change the plan?')).toBeTruthy()
    expect(box.querySelector('a')).toBeNull()
  })

  it("F-FE-1 F1: an outline that is gone draws no outline and says so ONCE, in the server's own sentence", async () => {
    const S_GONE = 'SERVER: the outline came from a template you deleted.'
    installServer((b) => ({ ...templateAnswer(b), outline: null, outlineGone: true, notShared: [S_GONE] }))
    mount({ kind: 'template', id: 's1' })
    await waitFor(() => expect(travels()).not.toBeNull())
    expect(screen.getAllByText(S_GONE)).toHaveLength(1)
    expect(document.querySelector('[data-outline-travels]')).toBeNull()
  })

  it('F-FE-1 F1 CONTROL: no outline in the answer (a widget, or none sent) draws no outline section', async () => {
    installServer((b) => ({ ...templateAnswer(b) }))
    mount({ kind: 'template', id: 's1' })
    await waitFor(() => expect(travels()).not.toBeNull())
    expect(document.querySelector('[data-outline-travels]')).toBeNull()
    expect(screen.queryByText('This template makes an empty page.')).toBeNull()
  })

  it('lists each held widget, routine and tracker with the same controls, and sends per-block edits', async () => {
    const net = installServer(templateAnswer)
    const { onDone } = mount({ kind: 'template', id: 's1' })
    expect(await screen.findByRole('heading', { name: 'Widget: R curve' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Routine: Morning prep' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tracker: Sleep' })).toBeTruthy()
    const sw = screen.getByRole('switch', { name: 'Target: Share this number (3)' })
    await waitFor(() => expect(net.previews().length).toBe(2))
    expect(net.previews()[1].body.edits).toEqual({
      name: 'My prep', description: 'Before the open',
      blocks: {
        built_a: { name: 'R curve', description: 'R by setup', formulas: { f1: 'Risk' } },
        routine_a: { name: 'Morning prep', items: ['Check news', 'Mark levels'] },
        tracker_a: { name: 'Sleep', unit: 'hrs' },
      },
    })
    fireEvent.click(sw)
    await waitFor(() => expect(net.previews().length).toBe(3))
    expect(net.previews()[2].body.keep).toEqual(['built_a/display/target'])
    // Exactly what travels names each held item by the SERVER's answer, with its day in words.
    await waitFor(() => expect(within(travels()).getByText('Widget: R curve')).toBeTruthy())
    expect(within(travels()).getByText('Routine: Morning prep (For the next trading day)')).toBeTruthy()
    expect(within(travels()).getByText('Tracker: Sleep (For the day of the note)')).toBeTruthy()
    expect(within(travels()).getByText('And 1 other part of the template')).toBeTruthy()
    // A template needs its category before it can be sent (the style share's own field).
    await waitFor(() => expect(net.previews().length).toBe(3))
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Category (required)' }), { target: { value: 'journal' } })
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    fireEvent.click(sendButton())
    expect((await screen.findByRole('status')).textContent).toBe(SENT_SENTENCE)
    const publish = net.calls.filter((c) => c.url === '/api/j2/template-gallery/styles')
    expect(publish).toHaveLength(1)
    expect(publish[0].body).toMatchObject({ styleId: 's1', title: 'My prep', category: 'journal', keep: ['built_a/display/target'] })
    expect(onDone).toHaveBeenCalledWith(SENT_SENTENCE)
  })
})

describe('keyboard_only_and_44px', () => {
  it('the whole flow runs from the keyboard', async () => {
    const user = userEvent.setup()
    const net = installServer(widgetAnswer)
    const { onDone } = mount({ kind: 'widget', id: 'w1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await primed(net)
    name.focus()
    await user.keyboard('{End} 2')
    expect(name.value).toBe('My R curve 2')
    const sw = screen.getByRole('switch', { name: /Share this number/ })
    while (document.activeElement !== sw) await user.tab()
    await user.keyboard(' ')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(sendButton().disabled).toBe(false), { timeout: 3000 })
    while (document.activeElement !== sendButton()) await user.tab()
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('status')).textContent).toBe(SENT_SENTENCE)
    expect(onDone).toHaveBeenCalled()
    const body = net.calls.find((c) => c.url.endsWith('/tools')).body
    expect(body.edits.name).toBe('My R curve 2')
    expect(body.keep).toEqual(['filters/0/values/0'])
  })

  it('every control in the sheet wears a class the stylesheet floors at 44 px', async () => {
    installServer(routineAnswer)
    mount({ kind: 'routine', id: 'r1' })
    await screen.findAllByRole('checkbox')
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/library/library.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    const floored = new Set()
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/min-height:\s*var\(--tap-min\)/.test(m[2])) continue
      for (const part of m[1].split(',')) { const cls = part.match(/\.[A-Za-z][\w-]*/g); if (cls) floored.add(cls[cls.length - 1].slice(1)) }
    }
    expect(floored.size).toBeGreaterThan(4)                                         // non-vacuity
    const root = document.querySelector('[data-share-preview]')
    const controls = [...root.querySelectorAll('button, input, select, textarea')]
    expect(controls.length).toBeGreaterThan(6)
    const wears = (el) => [...el.classList].some((c) => [...floored].some((f) => c === f || c.includes(`_${f}_`)))
    for (const el of controls) {
      const target = el.type === 'checkbox' ? el.closest('label') : el
      expect(wears(target), `${el.outerHTML.slice(0, 80)} is not floored`).toBe(true)
    }
  })
})

describe('the doors', () => {
  it('openSharePreview opens one at a time on its own root', async () => {
    installServer(widgetAnswer)
    const close = openSharePreview({ kind: 'widget', id: 'w1' })
    const again = openSharePreview({ kind: 'routine', id: 'r1' })
    expect(again).toBe(close)
    expect(await screen.findByRole('dialog', { name: 'Share to library' })).toBeTruthy()
    expect(document.querySelectorAll('[data-share-preview-root]')).toHaveLength(1)
    expect(document.querySelector('[data-share-preview]').getAttribute('data-share-preview')).toBe('widget')
    act(() => close())
    await waitFor(() => expect(document.querySelector('[data-share-preview-root]')).toBeNull())
    const next = openSharePreview({ kind: 'routine', id: 'r1' })
    expect(next).not.toBe(close)
    act(() => next())
    await waitFor(() => expect(document.querySelector('[data-share-preview-root]')).toBeNull())
  })

  it('ShareStyleForm opens the share preview for a style holding a slot while wave 11 is on, else its own form', async () => {
    const { default: ShareStyleForm } = await import('../styles/ShareStyleForm')
    const net = installServer(() => ({ travels: { name: 'T', blocks: [] }, slots: [], kept: [], notShared: [], prefill: { name: 'T', blocks: {} } }))
    const tpl = { id: 's1', name: 'My prep', blocks: [{ block: 'routine_a', settings: {} }] }
    const { unmount } = render(<ShareStyleForm style={tpl} onClose={() => {}} onShared={() => {}} />)
    expect(await screen.findByRole('dialog', { name: 'Share to library' })).toBeTruthy()
    await waitFor(() => expect(net.previews()[0]?.body).toMatchObject({ kind: 'template', id: 's1' }))
    unmount()
    waves.eleven = false
    render(<ShareStyleForm style={tpl} onClose={() => {}} onShared={() => {}} />)
    expect(await screen.findByText('Share My prep to community')).toBeTruthy()
    cleanup()
    waves.eleven = true
    render(<ShareStyleForm style={{ id: 's2', name: 'Plain', blocks: [{ block: 'marketcontext' }] }} onClose={() => {}} onShared={() => {}} />)
    expect(await screen.findByText('Share Plain to community')).toBeTruthy()
  })
})
