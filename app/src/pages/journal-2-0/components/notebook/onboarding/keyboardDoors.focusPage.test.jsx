// VIS-5 (audit 2026-11-05, issue 25): "Tour Esc -> <body> (focus lost)". When a tour closes and what opened
// it is gone (a Learn menu row, an auto start), focus goes to the first-run heading, else the page's own
// heading (`data-focus-fallback`), else <main> -- and never moves focus a member already put somewhere.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIRST_RUN_HEADING_ATTR, focusPageIfLost } from './keyboardDoors'

afterEach(() => { document.body.innerHTML = '' })
const html = (s) => { document.body.innerHTML = s; document.activeElement?.blur?.() }

describe('focusPageIfLost', () => {
  it('Home: the first-run heading wins', () => {
    html(`<main tabindex="-1"><h2 tabindex="-1" ${FIRST_RUN_HEADING_ATTR}="">Welcome</h2><h2 tabindex="-1" data-focus-fallback="">All notes</h2></main>`)
    expect(focusPageIfLost()).toBe(true)
    expect(document.activeElement.textContent).toBe('Welcome')
  })

  it('a list: the page heading marked data-focus-fallback', () => {
    html('<main tabindex="-1"><h2 tabindex="-1" data-focus-fallback="">All notes</h2></main>')
    expect(focusPageIfLost()).toBe(true)
    expect(document.activeElement.textContent).toBe('All notes')
  })

  it('nothing marked: <main>, which takes focus programmatically', () => {
    html('<main tabindex="-1"><p>a note</p></main>')
    expect(focusPageIfLost()).toBe(true)
    expect(document.activeElement.tagName).toBe('MAIN')
  })

  it('CONTROL: focus a member put somewhere is never moved', () => {
    html('<main tabindex="-1"><h2 tabindex="-1" data-focus-fallback="">All notes</h2><button>Mine</button></main>')
    document.querySelector('button').focus()
    expect(focusPageIfLost()).toBe(false)
    expect(document.activeElement.textContent).toBe('Mine')
  })
})

describe('both tour engines fall back on close', () => {
  const read = (f) => readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'onboarding', f), 'utf8')
  it('NotebookTour and GenericTourEngine call it after handing focus back', () => {
    expect(read('NotebookTour.jsx')).toMatch(/if \(wasOpenRef\.current\) focusPageIfLost\(\)/)
    expect(read('GenericTourEngine.jsx')).toMatch(/if \(openedRef\.current\) focusPageIfLost\(\)/)
  })
  it('the Notebook pane heading is the fallback target', () => {
    const tab = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.jsx'), 'utf8')
    expect(tab).toMatch(/className=\{styles\.paneHeading\} data-focus-fallback="">/)
  })
})
