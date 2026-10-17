/**
 * The Customize editor for Today and the trade page (P4a Task 7).
 *
 * The editor is a Sheet over ONE preference blob. It edits a DRAFT of the layout; Save posts that blob
 * through `setPrefMerged`, replacing only the list(s) the member changed. Everything here is asserted on
 * rendered text and on the value that would be POSTed, never on component state.
 *
 * `setPrefMerged` is faked at the hook boundary: it runs the updater against the stored layout (as the real
 * one does, with the parsed pref) and records what it would have written. The real hook's own success and
 * failure answers are pinned in PageLayoutEditor.realSave.test.jsx.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'

const { prefsRef, mergedRef, posts, refreshSpy } = vi.hoisted(() => ({
  prefsRef: { current: {} },
  mergedRef: { impl: null },
  posts: [],
  refreshSpy: vi.fn(),
}))

vi.mock('../../../../hooks/usePreferences', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: () => ({
      prefs: prefsRef.current,
      setPref: vi.fn(),
      setPrefMerged: (key, updater) => mergedRef.impl(key, updater),
      loading: false,
    }),
    refreshPreferences: refreshSpy,
  }
})

import PageLayoutEditor from './PageLayoutEditor'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../../lib/pageLayouts'

const clone = (v) => JSON.parse(JSON.stringify(v))
const move = (list, id, to) => {
  const i = list.findIndex((e) => e.id === id)
  const [e] = list.splice(i, 1)
  list.splice(to, 0, e)
  return list
}

// A saved layout that exercises everything the editor must keep: a customised market list holding an id this
// build does not know (hidden, mid-list), a reordered premarket list, an unknown phase, an unknown top-level
// field. The SAVED object is never mutated by a test (each reads the string back).
function buildSaved() {
  const saved = clone(DEFAULT_LAYOUT)
  const market = saved.today.market
  market.find((e) => e.id === 'myRules').shown = true
  market.splice(2, 0, { id: 'zz_future_panel', shown: false })
  saved.today.premarket = move(saved.today.premarket, 'weekStrip', 0)
  saved.today.postclose.find((e) => e.id === 'todayNote').shown = true
  saved.today.overnight = [{ id: 'night_panel', shown: true }]
  saved.futureField = { keep: 'me', n: [1, 2, 3] }
  saved.trade = move(saved.trade, 'story', 0)
  return saved
}
const SAVED = buildSaved()
const SAVED_TEXT = JSON.stringify(SAVED)

const MARKET_ORDER = [
  ['Coach notes', true], ['This week', true], ['Goal progress', true], ['Quick actions', true],
  ['Checklist for today', false], ['My rules', true], ['Market regime', false], ["Today's note", false], ['Notices', false],
]

const rowNames = () => screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))
const rowState = () => screen.getAllByRole('checkbox').map((c) => [c.getAttribute('aria-label').replace(/^Show /, ''), c.checked])
const dialog = () => screen.getByRole('dialog')
const lastPost = () => posts[posts.length - 1]

function open(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<PageLayoutEditor page="today" initialPhase="market" onClose={onClose} onSaved={onSaved} {...props} />)
  return { onClose, onSaved }
}

beforeEach(() => {
  posts.length = 0
  refreshSpy.mockReset()
  prefsRef.current = { [LAYOUT_PREF]: SAVED_TEXT }
  // The real hook hands the updater the PARSED pref and resolves {ok: true} once the server took the write.
  mergedRef.impl = async (key, updater) => {
    const current = JSON.parse(prefsRef.current[key])
    const next = updater(current)
    if (next === undefined) return undefined
    posts.push({ key, value: JSON.parse(JSON.stringify(next)) })
    return { ok: true }
  }
})

describe('opening the editor', () => {
  it('titles the sheet for the page', () => {
    open()
    expect(screen.getByText('Customize Today')).toBeTruthy()
  })

  it('shows the market list in layout order, each checkbox matching `shown`', () => {
    open()
    expect(rowState()).toEqual(MARKET_ORDER)
    // The id this build does not know is kept but never rendered as a row.
    expect(dialog().textContent).not.toContain('zz_future_panel')
  })

  it('has three phase tabs, real buttons with aria-pressed, defaulting to the current session', () => {
    open({ initialPhase: 'postclose' })
    const tabs = ['Premarket', 'Market', 'After close'].map((n) => screen.getByRole('button', { name: n }))
    expect(tabs.map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    // The after-close list is the one on screen: Today's note is on there.
    expect(rowState().find(([n]) => n === "Today's note")[1]).toBe(true)
  })

  it('falls back to Market when the session is not a known phase', () => {
    open({ initialPhase: undefined })
    expect(screen.getByRole('button', { name: 'Market' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches the list with the tab, and a tab press does not write anything', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Premarket' }))
    expect(screen.getByRole('button', { name: 'Premarket' }).getAttribute('aria-pressed')).toBe('true')
    expect(rowNames()[0]).toBe('Show This week')
    expect(posts).toHaveLength(0)
  })

  it('the trade page has its own title, no phase tabs, and its saved order', () => {
    open({ page: 'trade', initialPhase: undefined })
    expect(screen.getByText('Customize trade page')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Premarket' })).toBeNull()
    expect(rowNames()[0]).toBe('Show The story')
    expect(rowNames()).toHaveLength(9)
  })
})

describe('editing the list', () => {
  it('Show <label> toggles a panel', () => {
    open()
    const box = screen.getByRole('checkbox', { name: 'Show Notices' })
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(screen.getByRole('checkbox', { name: 'Show Notices' }).checked).toBe(true)
  })

  it('Move My rules up moves it, announces it, and keeps focus on the pressed button', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    const names = rowNames()
    expect(names.indexOf('Show My rules')).toBe(4)
    expect(names.indexOf('Show Checklist for today')).toBe(5)
    expect(within(dialog()).getByRole('status').textContent.trim()).toBe('My rules moved up')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move My rules up' }))
  })

  it('Move My rules down moves it, announces it, and keeps focus on the pressed button', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules down' }))
    const names = rowNames()
    expect(names.indexOf('Show My rules')).toBe(6)
    expect(names.indexOf('Show Market regime')).toBe(5)
    expect(within(dialog()).getByRole('status').textContent.trim()).toBe('My rules moved down')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move My rules down' }))
  })

  it('the same move twice in a row still changes the live region text', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    const first = within(dialog()).getByRole('status').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    const second = within(dialog()).getByRole('status').textContent
    expect(second.trim()).toBe('My rules moved up')
    expect(second).not.toBe(first) // an unchanged text is not announced again
  })

  it('when a move brings the row to an end, focus goes to its other move button', () => {
    open()
    // Coach notes is first: Move down once puts This week first; move This week up to the top.
    fireEvent.click(screen.getByRole('button', { name: 'Move This week up' }))
    expect(rowNames()[0]).toBe('Show This week')
    expect(screen.getByRole('button', { name: 'Move This week up' }).disabled).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move This week down' }))
  })

  it('when a move brings the row to the bottom, focus goes to its Move up button', () => {
    open()
    // Today's note is second from last: Move down puts it last, where Move down is disabled.
    fireEvent.click(screen.getByRole('button', { name: "Move Today's note down" }))
    expect(rowNames()[rowNames().length - 1]).toBe("Show Today's note")
    expect(screen.getByRole('button', { name: "Move Today's note down" }).disabled).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: "Move Today's note up" }))
  })

  it('the first row cannot move up and the last row cannot move down', () => {
    open()
    expect(screen.getByRole('button', { name: 'Move Coach notes up' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Notices down' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Coach notes down' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Move Notices up' }).disabled).toBe(false)
  })

  it('edits on one phase survive a trip to another tab and back', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Premarket' }))
    fireEvent.click(screen.getByRole('button', { name: 'Market' }))
    expect(rowNames().indexOf('Show My rules')).toBe(4)
  })
})

describe('Save', () => {
  it('posts journal_page_layout with ONLY the market list changed; every other list and unknown id is byte-equal', async () => {
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    expect(posts).toHaveLength(1)
    const { key, value } = lastPost()
    expect(key).toBe('journal_page_layout')
    // The market list changed, and its unknown id is still exactly where it was (index 2).
    expect(value.today.market).not.toEqual(SAVED.today.market)
    expect(value.today.market[2]).toEqual({ id: 'zz_future_panel', shown: false })
    expect(value.today.market.find((e) => e.id === 'notices').shown).toBe(true)
    // Everything else is the input, byte for byte.
    const { market: _m, ...otherPhases } = value.today
    const { market: _s, ...savedOtherPhases } = SAVED.today
    expect(JSON.stringify(otherPhases)).toBe(JSON.stringify(savedOtherPhases))
    expect(JSON.stringify(value.trade)).toBe(JSON.stringify(SAVED.trade))
    expect(JSON.stringify(value.futureField)).toBe(JSON.stringify(SAVED.futureField))
    expect(value.version).toBe(SAVED.version)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('a save from the trade page replaces only the trade list', async () => {
    const { onClose } = open({ page: 'trade', initialPhase: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Move The story down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const { value } = lastPost()
    expect(value.trade).not.toEqual(SAVED.trade)
    expect(JSON.stringify(value.today)).toBe(JSON.stringify(SAVED.today))
    expect(JSON.stringify(value.futureField)).toBe(JSON.stringify(SAVED.futureField))
  })

  it('edits on two phases save both lists and nothing else', async () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Premarket' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const { value } = lastPost()
    expect(value.today.market).not.toEqual(SAVED.today.market)
    expect(value.today.premarket).not.toEqual(SAVED.today.premarket)
    expect(JSON.stringify(value.today.postclose)).toBe(JSON.stringify(SAVED.today.postclose))
    expect(JSON.stringify(value.today.overnight)).toBe(JSON.stringify(SAVED.today.overnight))
  })

  // The value the updater is handed is this tab's preference cache at Save (another writer in this tab, or a
  // re-read), not necessarily the server's latest: see the editor's header comment.
  it('applies the edit to the layout the cache holds at Save, not the one the editor opened on', async () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    // Another tab saved a different postclose list while the sheet was open.
    const fresher = clone(SAVED)
    fresher.today.postclose.find((e) => e.id === 'notices').shown = true
    prefsRef.current = { [LAYOUT_PREF]: JSON.stringify(fresher) }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(lastPost().value.today.postclose.find((e) => e.id === 'notices').shown).toBe(true)
  })

  it('with nothing changed it closes without writing or announcing a save', async () => {
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('a toggle that is undone is not an edit', async () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts).toHaveLength(0)
  })

  it('a failed POST says so, stays open, saves nothing as done, and puts the server layout back in the cache', async () => {
    mergedRef.impl = async () => ({ ok: false })
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't save your layout. Nothing was changed.")
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    // The member's edit is still on screen, and Save is pressable again.
    expect(rowNames().indexOf('Show My rules')).toBe(4)
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false)
  })

  it('a write that throws is a failure too', async () => {
    mergedRef.impl = async () => { throw new Error('offline') }
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save your layout. Nothing was changed.")
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a write that resolves with nothing (the hook swallowed its own failure) is a failure, never a save', async () => {
    mergedRef.impl = async () => undefined
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save your layout. Nothing was changed.")
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('a retry after a failure can succeed, and clears the failure line', async () => {
    let n = 0
    const ok = mergedRef.impl
    mergedRef.impl = async (k, u) => (n++ === 0 ? { ok: false } : ok(k, u))
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Reset to default and Cancel', () => {
  it('Reset restores THIS phase to the default and leaves the other phases as they are', async () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    // The market list is the registry default again (unknown ids are not rows).
    const defaults = DEFAULT_LAYOUT.today.market
    expect(screen.getAllByRole('checkbox').map((c) => c.checked)).toEqual(defaults.map((e) => e.shown))
    expect(rowNames()[4]).toBe('Show Checklist for today')
    // The premarket list the member had arranged is untouched.
    fireEvent.click(screen.getByRole('button', { name: 'Premarket' }))
    expect(rowNames()[0]).toBe('Show This week')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const { value } = lastPost()
    // Reset keeps an id this build does not know (a newer build's panel), after the defaults.
    expect(value.today.market.filter((e) => e.id !== 'zz_future_panel')).toEqual(DEFAULT_LAYOUT.today.market)
    expect(value.today.market.some((e) => e.id === 'zz_future_panel')).toBe(true)
    expect(JSON.stringify(value.today.premarket)).toBe(JSON.stringify(SAVED.today.premarket))
    expect(JSON.stringify(value.trade)).toBe(JSON.stringify(SAVED.trade))
  })

  it('Reset on the trade page restores only the trade list', () => {
    open({ page: 'trade', initialPhase: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(rowNames()[0]).toBe('Show Linked notes')
  })

  it('Reset announces itself', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(within(dialog()).getByRole('status').textContent).toMatch(/reset to the default/i)
  })

  it('Cancel closes without writing', () => {
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(posts).toHaveLength(0)
  })
})

describe('Escape, and a save in flight', () => {
  it('Escape closes the sheet and writes nothing, even after an edit', () => {
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(posts).toHaveLength(0)
    expect(onSaved).not.toHaveBeenCalled()
  })

  // A write that has not answered yet: the test settles it by hand.
  function holdTheWrite() {
    let settle
    mergedRef.impl = (key, updater) => new Promise((resolve) => {
      settle = (answer) => {
        if (answer.ok) posts.push({ key, value: JSON.parse(JSON.stringify(updater(JSON.parse(prefsRef.current[key])))) })
        resolve(answer)
      }
    })
    return (answer) => settle(answer)
  }

  it('while the save is in flight Cancel is disabled', () => {
    holdTheWrite()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
  })

  it('a close attempt during the save (Cancel, Escape, the title close button) does nothing', async () => {
    const settle = holdTheWrite()
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    // The save still finishes the normal way: one close, one "saved".
    settle({ ok: true })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(posts).toHaveLength(1)
  })

  // P4a m7. Two presses inside ONE act reach the handler before the re-render that disables the button, which
  // is what a fast double press does in a browser; only the ref can stop the second.
  it('a second Save press while the first is in flight sends nothing', async () => {
    let calls = 0
    const held = holdTheWrite()
    const hold = mergedRef.impl
    mergedRef.impl = (k, u) => { calls += 1; return hold(k, u) }
    const { onClose, onSaved } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    const save = screen.getByRole('button', { name: 'Save' })
    act(() => { save.click(); save.click() })
    expect(calls).toBe(1)

    held({ ok: true })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(posts).toHaveLength(1)
  })

  it('after a FAILED save the sheet can be dismissed again', async () => {
    const settle = holdTheWrite()
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Move My rules up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    settle({ ok: false })
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('accessibility', () => {
  it('every control has an accessible name', () => {
    open()
    const controls = within(dialog()).queryAllByRole('button').concat(within(dialog()).queryAllByRole('checkbox'))
    expect(controls.length).toBeGreaterThan(20)
    for (const c of controls) {
      const name = (c.getAttribute('aria-label') || c.textContent || '').trim()
      expect(name, c.outerHTML).not.toBe('')
    }
  })

  it('tab order runs the tabs, then the rows, then the actions', () => {
    open()
    const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]'
    const order = Array.from(dialog().querySelectorAll(FOCUSABLE))
      .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim())
    const at = (name) => order.indexOf(name)
    const lastTab = at('After close')
    const firstRow = at('Show Coach notes')
    const lastRow = at('Move Notices up')
    const firstAction = at('Reset to default')
    expect(lastTab).toBeGreaterThan(-1)
    expect(['Premarket', 'Market', 'After close'].map(at).every((i) => i > -1 && i <= lastTab)).toBe(true)
    expect(firstRow).toBeGreaterThan(lastTab)
    expect(lastRow).toBeGreaterThan(firstRow)
    expect(firstAction).toBeGreaterThan(lastRow)
    expect(at('Cancel')).toBeGreaterThan(firstAction)
    expect(at('Save')).toBeGreaterThan(at('Cancel'))
    // Within a row the order is the box, then up, then down.
    expect(at('Move My rules up')).toBe(at('Show My rules') + 1)
    expect(at('Move My rules down')).toBe(at('Show My rules') + 2)
  })

  it('the live region is polite', () => {
    open()
    expect(within(dialog()).getByRole('status').getAttribute('aria-live')).toBe('polite')
  })
})
