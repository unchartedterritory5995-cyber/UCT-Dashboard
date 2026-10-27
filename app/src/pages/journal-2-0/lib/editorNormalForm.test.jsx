// W11-R82: two rails on lib/editorNormalForm.js (W11-R80 m-3), the client's "body as the editor will hold it".
//   1. The normal form of the server's real styled-create body (contract `notes.create.kind`) EQUALS what the real,
//      mounted editor emits for it (EditorContent, the React node views live): the detached editor is the editor.
//   2. Its catch-all is never silent. A future plain node view or plugin `view()` that throws would make it fall back
//      to the body as given, and the D2 first-open PUT would come back unseen; under test it THROWS (outside a test it
//      reports the fallback on the console).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Editor, Extension } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { contractBody } from '../__fixtures__/contract'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
document.elementFromPoint = () => null

const extra = vi.hoisted(() => ({ throwInView: false }))
vi.mock('./tiptap', async (orig) => {
  const real = await orig()
  return {
    ...real,
    buildExtensions: (...a) => {
      const list = real.buildExtensions(...a)
      if (!extra.throwInView) return list
      const Boom = Extension.create({
        name: 'boomView',
        addProseMirrorPlugins: () => [new Plugin({ view: () => { throw new Error('a plugin view that throws') } })],
      })
      return [...list, Boom]
    },
  }
})

const { buildExtensions } = await import('./tiptap')
const { editorNormalForm } = await import('./editorNormalForm')

afterEach(() => { extra.throwInView = false; cleanup() })

describe('editorNormalForm (W11-R82)', () => {
  it("the contract styled-create body's normal form is exactly what the mounted editor emits", () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    const body = contractBody('notes.create.kind').note.bodyJson
    const el = document.createElement('div')
    document.body.appendChild(el)
    const ed = new Editor({ element: el, extensions: buildExtensions(), content: body })
    render(<EditorContent editor={ed} />)
    const mounted = ed.getJSON()
    ed.destroy()
    const normal = editorNormalForm(body)
    expect(normal).not.toBe(body)                                   // it ran (a new object), never the fallback
    expect(normal).toEqual(mounted)
  })

  it('a throw inside the editor is never swallowed under test (it would hide the D2 first-open PUT)', () => {
    extra.throwInView = true
    const body = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] }
    expect(() => editorNormalForm(body)).toThrow('a plugin view that throws')
  })

  it('CONTROL: without the throwing view the same body is normalised (a trailing paragraph)', () => {
    const body = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] }
    expect(editorNormalForm(body).content.at(-1)).toEqual({ type: 'paragraph' })
  })
})
