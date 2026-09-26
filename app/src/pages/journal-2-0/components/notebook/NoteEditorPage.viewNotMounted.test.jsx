import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Wave 6 fix round 5, R5-1 — opening a note must never crash on an editor
 * whose view is not mounted YET.
 *
 * ⚰️ THE CRASH (live walk on 7006f1504, `walk-7006f1504.json` key
 * `CRITICAL_FINDING_editor_view_throwing_getter`): the I5 image-picker effect
 * read `editor?.view?.dom`. tiptap's `Editor.view` is not `undefined` when
 * there is no EditorView: it is a Proxy whose `get` trap THROWS
 * "[tiptap error]: The editor view is not available. Cannot access
 * view['dom']. The editor may not be mounted yet." Optional chaining
 * short-circuits a null/undefined LEFT side only, so it walked straight into
 * the throw; the route ErrorBoundary then replaced the ENTIRE editor with
 * "Something went wrong on this page" — on about half of all note-opens.
 *
 * HOW THIS REPRODUCES IT WITH THE REAL LIBRARY. `useEditor` is the real
 * tiptap hook and the editor it builds is real. Until a LATER tick the page
 * is handed that same editor behind a stable facade that answers exactly two
 * properties the way tiptap answers them for an editor with no view:
 * `isDestroyed` → `true` (tiptap's own `editorView?.isDestroyed ?? true`) and
 * `view` → tiptap's OWN not-mounted proxy, taken from a real, never-mounted
 * `Editor` over the same extensions and doc — so the throw, and its text,
 * come from the library, not from this file. Everything else is the real
 * editor. On the later tick the real editor goes through tiptap's own
 * `unmount()` → `mount(el)` (so the real `unmount`/`mount` events fire) and
 * the facade starts answering from it. The facade keeps ONE identity
 * throughout, as `useEditor` does, so an effect keyed on `[editor]` does NOT
 * re-run when the view arrives — which is what separates "guarded" from
 * "guarded AND attached".
 * ⚠️ Why not simply `editor.unmount()` the real editor on first sight: tiptap's
 * `useEditor` re-checks `isDestroyed` in an effect on EVERY render and rebuilds
 * an editor it finds destroyed, so an unmounted editor under the real hook is
 * replaced on the next render, forever — a harness loop, not the product.
 *
 * The page is wrapped in the app's REAL `RouteErrorBoundary`, and the rail
 * asserts that boundary's fallback text is NOT on screen: a mounted
 * `.ProseMirror` can only say "something rendered"; whether the page survived
 * needs the product's own answer.
 */

// The note-open's editor: no view until a later tick.
let lateMount = true
const mountLog = []
vi.mock('@tiptap/react', async (importOriginal) => {
  const real = await importOriginal()
  const { Editor } = await import('@tiptap/core')

  function useLateEditor(options, deps) {
    const editor = real.useEditor(options, deps)
    const ready = useRef(!lateMount)
    const facade = useMemo(() => {
      if (!editor) return editor
      // A real Editor that is never mounted: its `.view` is tiptap's own
      // throwing proxy (`element: null` skips the constructor's mount).
      const neverMounted = new Editor({
        element: null, extensions: editor.options.extensions, content: editor.getJSON(),
      })
      return new Proxy(editor, {
        get(target, key) {
          if (!ready.current && key === 'view') return neverMounted.view
          if (!ready.current && key === 'isDestroyed') return neverMounted.isDestroyed
          const v = Reflect.get(target, key, target)
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
    }, [editor])
    useEffect(() => {
      if (ready.current || !editor) return undefined
      const t = setTimeout(() => {
        mountLog.push('mount')
        ready.current = true
        editor.unmount()                               // tiptap's own lifecycle, a LATER tick:
        editor.mount(document.createElement('div'))    // real `unmount`, then real `mount`
      }, 5)
      return () => clearTimeout(t)
    }, [editor])
    return facade
  }

  // The real EditorContent adopts a view only when it (re)mounts, and it is
  // React.memo'd on the SAME editor object — so on tiptap's own `mount` event
  // it is re-keyed, which is how a late view reaches the page's DOM. This
  // touches the content component only, never the editor's identity.
  function LateEditorContent(props) {
    const [gen, setGen] = useState(0)
    const ed = props.editor
    useEffect(() => {
      if (!ed) return undefined
      const remount = () => setGen((g) => g + 1)
      ed.on('mount', remount)
      return () => ed.off('mount', remount)
    }, [ed])
    return createElement(real.EditorContent, { ...props, key: gen })
  }

  return { ...real, useEditor: useLateEditor, EditorContent: LateEditorContent }
})

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'Late view', subtitle: '', folderId: null, ticker: null,
  tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
  bodyJson: { type: 'doc', content: [P('Body that must render.')] },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let consoleError
beforeEach(() => {
  lateMount = true
  mountLog.length = 0
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  // React logs a caught boundary error; keep the run readable, but keep the
  // calls so a failure can say what was thrown.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  consoleError.mockRestore()
  vi.clearAllMocks()
})

async function openNote() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const RouteErrorBoundary = (await import('../../../../components/RouteErrorBoundary')).default
  const view = render(
    <MemoryRouter initialEntries={['/journal/notebook?note=n1']}>
      <RouteErrorBoundary>
        <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack />
      </RouteErrorBoundary>
    </MemoryRouter>,
  )
  // Let the later tick land: the view mounts, EditorContent adopts it.
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  return view
}

function thrownByTheBoundary() {
  const caught = consoleError.mock.calls.find((c) => c[0] === '[ErrorBoundary]')
  return caught ? String(caught[1]?.message || caught[1]) : null
}

describe('NoteEditorPage — a note opens when the editor view mounts a tick late (wave 6 fix round 5, R5-1)', () => {
  it('the page survives: no ErrorBoundary fallback, the editor renders the note', async () => {
    await openNote()
    // The boundary first: a crash also stops the harness's own late mount, and
    // "the page survived" is the fact that matters.
    expect(screen.queryByText('Something went wrong on this page'),
      `the route ErrorBoundary replaced the editor: ${thrownByTheBoundary()}`).toBeNull()
    expect(mountLog, 'the harness never reached the late mount').toEqual(['mount'])
    const pm = await waitFor(() => {
      const el = document.querySelector('.ProseMirror')
      if (!el?.editor) throw new Error('editor never rendered')
      return el
    })
    expect(pm.textContent).toContain('Body that must render.')
  })

  it('the Image picker listener is attached once the view EXISTS — the slash item opens this editor\'s own file picker', async () => {
    await openNote()
    expect(screen.queryByText('Something went wrong on this page'),
      `the route ErrorBoundary replaced the editor: ${thrownByTheBoundary()}`).toBeNull()
    const pm = await waitFor(() => {
      const el = document.querySelector('.ProseMirror')
      if (!el?.editor) throw new Error('editor never rendered')
      return el
    })
    const input = document.querySelector('input[aria-label="Upload image"]')
    expect(input, 'the page never rendered its file input').toBeTruthy()
    const click = vi.spyOn(input, 'click')

    const { ITEMS } = await import('./SlashMenu')
    const imageItem = ITEMS.find((i) => i.title === 'Image')
    const editor = pm.editor
    const from = editor.state.selection.from
    act(() => { imageItem.command({ editor, range: { from, to: from } }) })

    expect(click, 'the Image event reached no listener: the effect never attached to the late view').toHaveBeenCalledTimes(1)
  })

  it('CONTROL: with the view mounted from the start (the ordinary path) the picker still opens exactly once', async () => {
    lateMount = false
    await openNote()
    expect(mountLog).toEqual([])
    const pm = await waitFor(() => {
      const el = document.querySelector('.ProseMirror')
      if (!el?.editor) throw new Error('editor never rendered')
      return el
    })
    const input = document.querySelector('input[aria-label="Upload image"]')
    const click = vi.spyOn(input, 'click')
    const { ITEMS } = await import('./SlashMenu')
    const imageItem = ITEMS.find((i) => i.title === 'Image')
    const from = pm.editor.state.selection.from
    act(() => { imageItem.command({ editor: pm.editor, range: { from, to: from } }) })
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Something went wrong on this page')).toBeNull()
  })
})
