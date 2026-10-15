// app/src/pages/journal-2-0/components/notebook/screenshotOffer.test.jsx
// Tier 2 part A, item 10 -- the "Tag NVDA · Daily" chip, rendered over a REAL editor holding a real image node.
// Every case asserts what is ON SCREEN (rendered text and roles) or what the editor's own JSON says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../lib/tiptap'
import ScreenshotTagOffer, {
  SCREENSHOT_OFFER_LABEL, findImagePos, labelImage, offerWords,
} from './ScreenshotTagOffer'
import { barPlacement } from '../../lib/barPlacement'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const DAILY = { tf: 'D', label: 'Daily' }
const offer = (extra = {}) => ({ url: '/a.png', symbol: 'NVDA', timeframe: DAILY, ...extra })

let editor
const make = (content = '<p>x</p><img src="/a.png">') => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  return editor
}
const images = () => {
  const out = []
  editor.state.doc.descendants((n) => { if (n.type.name === 'image') out.push(n.attrs) })
  return out
}
const deleteImages = () => {
  const tr = editor.state.tr
  const at = []
  editor.state.doc.descendants((n, pos) => { if (n.type.name === 'image') at.push([pos, pos + n.nodeSize]) })
  for (const [from, to] of at.reverse()) tr.delete(from, to)
  editor.view.dispatch(tr)
}
const bar = () => screen.queryByRole('toolbar', { name: SCREENSHOT_OFFER_LABEL })

beforeEach(() => { make() })
afterEach(() => {
  cleanup()
  editor?.destroy(); editor = null
  document.body.innerHTML = ''
})

describe('the chip names what it will do', () => {
  it('a note with no ticker: "Tag NVDA · Daily"', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(bar()).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tag NVDA · Daily' })).toBeTruthy()
  })
  it('a note with a DIFFERENT ticker: "Tag image NVDA · Daily" (the note keeps its own)', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker="AMD" onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tag image NVDA · Daily' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tag NVDA · Daily' })).toBeNull()
  })
  it('CONTROL — the SAME ticker, in any case, is not "other"', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker="nvda" onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tag NVDA · Daily' })).toBeTruthy()
  })
  it('no timeframe: "Tag NVDA"', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer({ timeframe: null })} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tag NVDA' })).toBeTruthy()
  })
  it('the words are one function of the offer and the note ticker', () => {
    expect(offerWords(offer(), null)).toBe('Tag NVDA · Daily')
    expect(offerWords(offer(), 'AMD')).toBe('Tag image NVDA · Daily')
    expect(offerWords(offer({ timeframe: null }), 'AMD')).toBe('Tag image NVDA')
  })
})

describe('accepting', () => {
  it('pressing the chip hands the offer to the page, once', () => {
    const onAccept = vi.fn()
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={onAccept} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tag NVDA · Daily' }))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept.mock.calls[0][0]).toMatchObject({ url: '/a.png', symbol: 'NVDA' })
  })
  it('labelImage sets the alt on the image node, in the editor JSON, and says true', () => {
    expect(images()[0].alt).not.toBe('NVDA daily chart')
    expect(labelImage(editor, '/a.png', 'NVDA daily chart')).toBe(true)
    const img = editor.getJSON().content.find((n) => n.type === 'image')
    expect(img.attrs.alt).toBe('NVDA daily chart')
    expect(img.attrs.src).toBe('/a.png')
  })
  it('⛔ keeps every OTHER attribute of the node (a resized image keeps its width and title)', () => {
    editor.destroy()
    make({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'image', attrs: { src: '/a.png', alt: '', title: 'my chart', width: 320 } },
      ],
    })
    expect(images()[0].width).toBe(320)
    expect(labelImage(editor, '/a.png', 'NVDA daily chart')).toBe(true)
    expect(images()[0]).toMatchObject({ src: '/a.png', alt: 'NVDA daily chart', title: 'my chart', width: 320 })
  })
  it('labels ONLY the image the offer is for', () => {
    editor.destroy()
    make('<p>x</p><img src="/a.png"><img src="/b.png">')
    expect(labelImage(editor, '/b.png', 'AMD chart')).toBe(true)
    const by = Object.fromEntries(images().map((a) => [a.src, a.alt]))
    expect(by['/b.png']).toBe('AMD chart')
    expect(by['/a.png']).not.toBe('AMD chart')
  })
  it('one undo step takes the alt back out', () => {
    const before = images()[0].alt
    labelImage(editor, '/a.png', 'NVDA daily chart')
    act(() => { editor.commands.undo() })
    expect(images()[0].alt).toBe(before)
  })
  it('a read-only editor takes no tag', () => {
    editor.setEditable(false)
    expect(labelImage(editor, '/a.png', 'NVDA daily chart')).toBe(false)
    expect(images()[0].alt).not.toBe('NVDA daily chart')
  })
})

describe('⛔ image gone (Review Focus 3)', () => {
  it('delete the image, then render: nothing renders, and labelImage says false', () => {
    deleteImages()
    expect(findImagePos(editor.state.doc, '/a.png')).toBeNull()
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(bar()).toBeNull()
    expect(screen.queryByRole('button', { name: /^Tag / })).toBeNull()
    expect(labelImage(editor, '/a.png', 'NVDA daily chart')).toBe(false)
  })
  it('the chip goes away the moment the member deletes the image under it', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(bar()).toBeTruthy()
    act(() => { deleteImages() })
    expect(bar()).toBeNull()
  })
  it('typing ABOVE the image moves it and the chip stays (the position is mapped, not lost)', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    act(() => { editor.commands.insertContentAt(1, 'hello there ') })
    expect(bar()).toBeTruthy()
    expect(labelImage(editor, '/a.png', 'NVDA daily chart')).toBe(true)
  })
  it('⛔ I3: deleting the image tells the page, once, so it can END the offer (and the scanning with it)', () => {
    const onGone = vi.fn()
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} onGone={onGone} />)
    expect(onGone).not.toHaveBeenCalled() // control: the image is there, the offer lives
    act(() => { editor.commands.insertContentAt(1, 'typing above ') })
    expect(onGone).not.toHaveBeenCalled() // a moved image is not a gone one
    act(() => { deleteImages() })
    expect(onGone).toHaveBeenCalledTimes(1)
  })
  it('⛔ I3: an image already gone when the offer arrives (deleted during the read) ends the offer at once', () => {
    deleteImages()
    const onGone = vi.fn()
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} onGone={onGone} />)
    expect(onGone).toHaveBeenCalledTimes(1)
  })
  it('an offer for another image is not shown over this one', () => {
    render(<ScreenshotTagOffer editor={editor} offer={offer({ url: '/other.png' })} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
    expect(bar()).toBeNull()
  })
})

describe('dismiss', () => {
  it('the button named "Dismiss screenshot tag" calls onDismiss and nothing else', () => {
    const onDismiss = vi.fn()
    const onAccept = vi.fn()
    render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={onAccept} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss screenshot tag' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onAccept).not.toHaveBeenCalled()
    expect(images()[0].alt).not.toBe('NVDA daily chart')
  })
})

describe('⛔ the bar stays inside the window (walk run 2: the chip sat at y 991-1018 in an 800 px window)', () => {
  const DESKTOP = { width: 1280, height: 800 }
  const PHONE = { width: 390, height: 844 }

  it('an image whose bottom is BELOW the window puts the bar inside it, not under the image', () => {
    const at = barPlacement({ left: 100, bottom: 985 }, { width: 220, height: 27 }, DESKTOP)
    expect(at.top).toBeLessThanOrEqual(800 - 27 - 8)
    expect(at.top).toBeGreaterThanOrEqual(8)
  })
  it('CONTROL — an image that ends well inside the window still gets the bar 6 px under it', () => {
    expect(barPlacement({ left: 100, bottom: 300 }, { width: 220, height: 27 }, DESKTOP)).toEqual({ top: 306, left: 100 })
  })
  it('an image scrolled up out of the window keeps the bar at the top edge, still reachable', () => {
    expect(barPlacement({ left: 100, bottom: -400 }, { width: 220, height: 27 }, DESKTOP).top).toBe(8)
  })
  it('the RIGHT edge of the bar stays inside a 390 px window, and its left edge keeps its 8 px margin', () => {
    const wide = barPlacement({ left: 300, bottom: 200 }, { width: 250, height: 27 }, PHONE)
    expect(wide.left + 250).toBeLessThanOrEqual(390 - 8)
    expect(wide.left).toBeGreaterThanOrEqual(8)
    expect(barPlacement({ left: -50, bottom: 200 }, { width: 250, height: 27 }, PHONE).left).toBe(8)
    // wider than the window: the left margin wins (the CSS max-width wraps it), never a negative left
    expect(barPlacement({ left: 40, bottom: 200 }, { width: 500, height: 27 }, PHONE).left).toBe(8)
  })

  describe('rendered', () => {
    const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const realInner = { w: window.innerWidth, h: window.innerHeight }
    let box
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 27 })
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 220 })
      window.innerWidth = 1280
      window.innerHeight = 800
      box = { left: 100, bottom: 991 }
      editor.view.nodeDOM = () => ({ getBoundingClientRect: () => ({ ...box }) })
    })
    afterEach(() => {
      if (realHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight)
      if (realWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realWidth)
      window.innerWidth = realInner.w
      window.innerHeight = realInner.h
    })
    const topOf = () => parseInt(bar().style.top, 10)

    it('the bar is placed inside the window when the image runs past the bottom of it', () => {
      render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
      expect(topOf()).toBeLessThanOrEqual(800 - 27 - 8)
      expect(topOf()).toBeGreaterThanOrEqual(8)
    })
    it('a page scroll (captured, so an inner scroller counts) puts it back under the image as it comes into view', () => {
      render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
      expect(topOf()).toBe(765)
      box = { left: 100, bottom: 500 }
      act(() => { fireEvent.scroll(document.body) }) // a scroll on an INNER element: it does not bubble, only the capture sees it
      expect(topOf()).toBe(506)
    })
    it('a resize re-places it inside the new, shorter window', () => {
      render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
      window.innerHeight = 600
      act(() => { fireEvent(window, new Event('resize')) })
      expect(topOf()).toBe(600 - 27 - 8)
    })
    it('the listeners are removed on unmount (the very handlers that were added, scroll with capture)', () => {
      const added = vi.spyOn(window, 'addEventListener')
      const removed = vi.spyOn(window, 'removeEventListener')
      const { unmount } = render(<ScreenshotTagOffer editor={editor} offer={offer()} noteTicker={null} onAccept={vi.fn()} onDismiss={vi.fn()} />)
      const mine = (spy, type) => spy.mock.calls.filter(([t]) => t === type)
      const scrollAdd = mine(added, 'scroll')[0]
      const resizeAdd = mine(added, 'resize')[0]
      expect(scrollAdd[2]).toEqual({ capture: true, passive: true })
      unmount()
      const scrollOff = mine(removed, 'scroll')
      const resizeOff = mine(removed, 'resize')
      expect(scrollOff.some(([, fn, opt]) => fn === scrollAdd[1] && opt?.capture === true)).toBe(true)
      expect(resizeOff.some(([, fn]) => fn === resizeAdd[1])).toBe(true)
      added.mockRestore(); removed.mockRestore()
    })
  })
})
