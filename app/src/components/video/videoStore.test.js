import { describe, it, expect, beforeEach } from 'vitest'
import * as v from './videoStore'

const LIST = [
  { id: 1, youtube_id: 'aaaaaaaaaaa', title: 'First' },
  { id: 2, youtube_id: 'bbbbbbbbbbb', title: 'Second' },
  { id: 3, youtube_id: 'ccccccccccc', title: 'Third' },
]

beforeEach(() => v.__reset())

describe('videoStore', () => {
  it('starts closed with empty list', () => {
    expect(v.getSnapshot().mode).toBe('closed')
    expect(v.currentVideo()).toBeNull()
  })

  it('play() opens docked at the given index', () => {
    v.play(LIST, 1)
    const s = v.getSnapshot()
    expect(s.mode).toBe('docked')
    expect(s.index).toBe(1)
    expect(v.currentVideo().youtube_id).toBe('bbbbbbbbbbb')
  })

  it('next() advances and stops at the end', () => {
    v.play(LIST, 1)
    expect(v.next()).toBe(true)
    expect(v.getSnapshot().index).toBe(2)
    expect(v.next()).toBe(false)
    expect(v.getSnapshot().index).toBe(2)
  })

  it('play() and playIndex() bump selectSeq; autoplay next() does not', () => {
    expect(v.getSnapshot().selectSeq).toBe(0)
    v.play(LIST, 0)
    expect(v.getSnapshot().selectSeq).toBe(1)
    v.playIndex(1)
    expect(v.getSnapshot().selectSeq).toBe(2)
    v.next()
    expect(v.getSnapshot().selectSeq).toBe(2)
    v.play(LIST, 2) // re-picking (even the same video) still bumps
    expect(v.getSnapshot().selectSeq).toBe(3)
  })

  it('minimize/expand toggle docked<->mini', () => {
    v.play(LIST, 0)
    v.minimize()
    expect(v.getSnapshot().mode).toBe('mini')
    v.expand()
    expect(v.getSnapshot().mode).toBe('docked')
  })

  it('clearDockSlot auto-minimizes and clears the rect', () => {
    v.play(LIST, 0)
    v.registerDockSlot({ top: 0, left: 0, width: 640, height: 360 })
    v.clearDockSlot()
    expect(v.getSnapshot().mode).toBe('mini')
    expect(v.getSnapshot().dockRect).toBeNull()
  })

  it('registerDockSlot records the rect without forcing a re-dock', () => {
    v.play(LIST, 0)
    v.minimize() // user intentionally parked it in the corner
    v.registerDockSlot({ top: 0, left: 0, width: 640, height: 360 })
    const s = v.getSnapshot()
    expect(s.mode).toBe('mini') // stays mini — only expand() re-docks
    expect(s.dockRect.width).toBe(640)
  })

  it('close() resets to closed/empty', () => {
    v.play(LIST, 2)
    v.close()
    const s = v.getSnapshot()
    expect(s.mode).toBe('closed')
    expect(s.list).toEqual([])
    expect(v.currentVideo()).toBeNull()
  })

  it('setPos persists the free-drag position and notifies subscribers', () => {
    let hits = 0
    const unsub = v.subscribe(() => { hits += 1 })
    v.setPos(300, 200)
    expect(v.getSnapshot().pos).toEqual({ x: 300, y: 200 })
    expect(JSON.parse(localStorage.getItem('desk_video_pos'))).toEqual({ x: 300, y: 200 })
    expect(hits).toBeGreaterThan(0)
    unsub()
  })
})
