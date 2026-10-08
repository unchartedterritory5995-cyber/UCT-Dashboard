// Lane KEYS3: the door bus the command palette uses to reach a Notebook surface.
import { describe, it, expect, vi } from 'vitest'
import { NOTEBOOK_DOORS, NOTEBOOK_DOOR_EVENT, noteOpenAt, onNotebookDoor, openNotebookDoor } from './notebookDoors'

describe('notebookDoors', () => {
  it('with nobody listening a door is not taken', () => {
    expect(openNotebookDoor(NOTEBOOK_DOORS.VISUAL_PLAYBOOK)).toBe(false)
  })

  it('the first listener takes the door and the second never hears it', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onNotebookDoor('x', a)
    const offB = onNotebookDoor('x', b)
    expect(openNotebookDoor('x', { from: 'palette' })).toBe(true)
    expect(a).toHaveBeenCalledTimes(1)
    expect(a.mock.calls[0][0]).toMatchObject({ door: 'x', from: 'palette' })
    expect(b).not.toHaveBeenCalled()
    offA(); offB()
  })

  it('a listener that answers false declines, and the next one takes it', () => {
    const b = vi.fn()
    const offA = onNotebookDoor('x', () => false)
    const offB = onNotebookDoor('x', b)
    expect(openNotebookDoor('x')).toBe(true)
    expect(b).toHaveBeenCalledTimes(1)
    offA(); offB()
  })

  it('another door is not heard, and a removed listener is gone', () => {
    const a = vi.fn()
    const off = onNotebookDoor('x', a)
    expect(openNotebookDoor('y')).toBe(false)
    off()
    expect(openNotebookDoor('x')).toBe(false)
    expect(a).not.toHaveBeenCalled()
    expect(NOTEBOOK_DOOR_EVENT).toBe('uct:notebook-door')
  })

  it('noteOpenAt: only the Notebook with a note in the address', () => {
    expect(noteOpenAt({ pathname: '/journal/notebook', search: '?note=n1' })).toBe(true)
    expect(noteOpenAt({ pathname: '/journal/notebook', search: '?view=all' })).toBe(false)
    expect(noteOpenAt({ pathname: '/journal/notebook/setups', search: '?note=n1' })).toBe(false)
    expect(noteOpenAt({ pathname: '/dashboard', search: '?note=n1' })).toBe(false)
    expect(noteOpenAt(null)).toBe(false)
  })
})
