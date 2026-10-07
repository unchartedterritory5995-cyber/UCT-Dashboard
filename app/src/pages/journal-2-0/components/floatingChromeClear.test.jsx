// @vitest-environment jsdom
// Finish program, lane FE2, finding P1 — a Notebook confirm never sits under the floating buttons.
//
// On a phone the red Delete button of "Delete this note?" sat under the floating voice orb, and
// the orb took the tap. The orb and the feedback button are shared chrome and are not changed.
// They already get out of the way of any open sheet: both hide while the page's scroll is locked
// (`hooks/useScrollLocked.js` reads `document.body.style.overflow === 'hidden'`, which `Sheet`
// sets). The Notebook's hand-rolled confirm dialogs never locked scroll, so the buttons stayed.
//
// The fix is in the two dialogs every Notebook confirm goes through, so each caller inherits it:
// `ConfirmModal` (a note's, a folder's and a saved view's Delete, bulk Move to Trash, a version
// restore, a position's Delete) and `UnsentTrashDialog`. The first block proves the lock; the
// second proves that the lock is the signal the REAL orb-side hook reads; the third is the census
// that makes a new hand-rolled modal confirm decide.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, act, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import ConfirmModal from './ConfirmModal'
import UnsentTrashDialog from './notebook/UnsentTrashDialog'
import useScrollLocked from '../../../hooks/useScrollLocked'

afterEach(() => { document.body.style.overflow = '' })

const confirm = () => <ConfirmModal title="Delete this note?" body="b" onConfirm={vi.fn()} onClose={vi.fn()} />
const unsent = () => <UnsentTrashDialog what="note" onSendFirst={vi.fn()} onTrashAnyway={vi.fn()} onClose={vi.fn()} />

describe('P1 — the Notebook’s confirm dialogs lock the page while open', () => {
  for (const [name, el] of [['ConfirmModal', confirm], ['UnsentTrashDialog', unsent]]) {
    it(`${name}: locked while it is open, and put back exactly as it was when it closes`, () => {
      document.body.style.overflow = 'clip'
      const view = render(el())
      expect(document.body.style.overflow).toBe('hidden')
      view.unmount()
      expect(document.body.style.overflow).toBe('clip')
    })
  }

  it('a confirm opened over an open sheet leaves the sheet’s lock in place when it closes', () => {
    document.body.style.overflow = 'hidden'           // a Sheet is open underneath
    const view = render(confirm())
    view.unmount()
    expect(document.body.style.overflow).toBe('hidden')
  })
})

describe('the lock is the signal the floating buttons already read', () => {
  it('useScrollLocked (what FloatingOrb and FeedbackWidget hide on) turns true while a confirm is open', async () => {
    const { result } = renderHook(() => useScrollLocked())
    expect(result.current).toBe(false)
    let view
    act(() => { view = render(confirm()) })
    await waitFor(() => expect(result.current).toBe(true))
    act(() => { view.unmount() })
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('both floating buttons really do hide on that hook (read from their source)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const orb = readFileSync(resolve(here, '../../../components/voice/FloatingOrb.jsx'), 'utf8')
    const fb = readFileSync(resolve(here, '../../../components/FeedbackWidget.jsx'), 'utf8')
    expect(orb).toMatch(/if \(scrollLocked && !inSession\) return null/)
    expect(fb).toMatch(/if \(scrollLocked && !mode\) return null/)
  })
})

describe('CENSUS — every modal dialog the Notebook draws itself', () => {
  it('each aria-modal dialog under the Notebook either is a Sheet, locks the page, or is named here with its reason', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const roots = [resolve(here, 'notebook'), resolve(here, '../tabs')]
    const found = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.jsx$/.test(name) || /\.test\.jsx$/.test(name)) continue
        const code = readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
        // the JSX attribute, not a `[aria-modal="true"]` selector inside a string
        if (!/(?<!\[)aria-modal=(\{[^}]*'true'[^}]*\}|"true")/.test(code)) continue
        const how = /useBodyScrollLock\(/.test(code) ? 'locks' : 'does not lock'
        found.push(`${p.slice(here.length + 1).split(sep).join('/')}: ${how}`)
      }
    }
    roots.forEach(walk)
    expect(found.sort()).toEqual([
      // the two walkthrough engines: a tour card points AT the page, which must stay as it is
      // (scrolling included); its place on a phone is checked in the browser walk instead
      'notebook/onboarding/GenericTourEngine.jsx: does not lock',
      'notebook/onboarding/NotebookTour.jsx: does not lock',
      'notebook/UnsentTrashDialog.jsx: locks',
    ].sort())
    // and the one every other confirm goes through
    expect(readFileSync(resolve(here, 'ConfirmModal.jsx'), 'utf8')).toMatch(/useBodyScrollLock\(/)
  })
})
