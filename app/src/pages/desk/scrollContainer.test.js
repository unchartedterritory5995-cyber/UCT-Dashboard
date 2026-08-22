import { afterEach, expect, test } from 'vitest'
import { findScrollContainer, scrollMetrics } from './scrollContainer'

// jsdom does not lay anything out, so scrollHeight/clientHeight must be stated
// explicitly. That is precisely why the original bug was invisible to tests:
// nothing in jsdom scrolls unless you say so.
function sized(el, { scrollHeight, clientHeight, overflowY = 'auto' }) {
  el.style.overflowY = overflowY
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  return el
}

afterEach(() => { document.body.innerHTML = '' })

test('it finds the scroller even though its class is a CSS-Module HASH', () => {
  // ⛔ The bug this exists to prevent: the app's scroller is
  // `<main class="_main_l3b5w_13">`, so `querySelector('.main')` matches
  // NOTHING, the code falls back to window, and window does not scroll here.
  document.body.innerHTML = `
    <div class="_shell_x9f2a_1">
      <main class="_main_l3b5w_13"><div id="page"><article id="body"></article></div></main>
    </div>`
  const main = document.querySelector('main')
  sized(main, { scrollHeight: 45463, clientHeight: 855 })

  expect(document.querySelector('.main')).toBeNull()      // the old lookup fails
  expect(findScrollContainer(document.getElementById('body'))).toBe(main)
})

test('a non-scrolling ancestor is skipped in favour of the real one', () => {
  document.body.innerHTML = `
    <div id="outer"><div id="inner"><article id="body"></article></div></div>`
  sized(document.getElementById('inner'), { scrollHeight: 100, clientHeight: 100 })
  const outer = sized(document.getElementById('outer'), { scrollHeight: 9000, clientHeight: 800 })
  expect(findScrollContainer(document.getElementById('body'))).toBe(outer)
})

test('an ancestor with overflow:visible is not a scroller however tall it is', () => {
  document.body.innerHTML = '<div id="outer"><article id="body"></article></div>'
  sized(document.getElementById('outer'),
        { scrollHeight: 9000, clientHeight: 800, overflowY: 'visible' })
  expect(findScrollContainer(document.getElementById('body'))).toBe(window)
})

test('when nothing scrolls it falls back to window', () => {
  document.body.innerHTML = '<div><article id="body"></article></div>'
  expect(findScrollContainer(document.getElementById('body'))).toBe(window)
})

test('a document-scrolling layout is still handled', () => {
  document.body.innerHTML = '<div><article id="body"></article></div>'
  const doc = document.scrollingElement || document.documentElement
  Object.defineProperty(doc, 'scrollHeight', { value: 5000, configurable: true })
  Object.defineProperty(doc, 'clientHeight', { value: 800, configurable: true })
  expect(findScrollContainer(document.getElementById('body'))).toBe(doc)
  Object.defineProperty(doc, 'scrollHeight', { value: 0, configurable: true })
  Object.defineProperty(doc, 'clientHeight', { value: 0, configurable: true })
})

test('a detached or missing node does not throw', () => {
  expect(findScrollContainer(null)).toBe(window)
  expect(findScrollContainer(document.createElement('div'))).toBe(window)
})

test('scrollMetrics reads the element for an element, and the document for window', () => {
  const el = document.createElement('div')
  expect(scrollMetrics(el)).toBe(el)
  expect(scrollMetrics(window)).toBe(document.scrollingElement || document.documentElement)
  expect(scrollMetrics(null)).toBe(document.scrollingElement || document.documentElement)
})

test('the reader must not go back to naming the scroller', async () => {
  // A structural rail: the literal is what broke three features at once, and it
  // is the kind of thing that gets re-introduced by a well-meaning refactor.
  const src = await import('./ArticleReader.jsx?raw').then((m) => m.default)
  expect(src).not.toMatch(/querySelector\(\s*['"]\.main['"]\s*\)/)
  expect(src).toContain('findScrollContainer')
})
