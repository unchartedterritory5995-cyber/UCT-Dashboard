import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import NoteAskPanel from './NoteAskPanel'

// ─────────────────────────────────────────────────────────────────────────
// WAVE K SLICE 5 — RETRIEVED CONTENT IS DATA, NEVER INSTRUCTION.
//
// The backend half of that invariant lives in
// api/services/journal_two/ask_prompt.py (never in the system prompt, never
// out of its fence, never a tool). This is the OTHER end of the same
// sentence: what a member's browser does with a source label and a citation
// once they come back.
//
// The threat is concrete and does not need a hostile member. A document
// label IS a filename — "<script>alert(1)</script>.pdf" is a legal one — and
// page text is whatever a PDF someone emailed them contains. React escapes
// text children, so the surface is safe by construction and the ONE way to
// break it is dangerouslySetInnerHTML. That is why the sweep below is the
// load-bearing rail and the render cases are the demonstration: the sweep
// covers every component on this surface, including the ones Slice 6 has not
// written yet.
// ─────────────────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const J2_ROOT = path.resolve(HERE, '../..')             // pages/journal-2-0

// ⛔ STRIP COMMENTS FIRST, THEN MATCH. The first version of this rail matched
// the bare identifier and went red on FolderSidebar.jsx — whose only
// occurrence is a comment reading "split-and-render, NEVER
// dangerouslySetInnerHTML". A rail that fails on the file documenting the
// correct idiom gets muted, not obeyed. The scope is journal-2-0 for the same
// reason: MorningWire renders rundown_html by design (see CLAUDE.md), and
// sweeping it in would leave this permanently red for a decision taken
// deliberately somewhere else.
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /(^|[^:])\/\/[^\n]*/gm

function stripComments(src) {
  return src.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '$1')
}

function usesUnsafeHtml(src) {
  return /dangerouslySetInnerHTML/.test(stripComments(src))
}

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('the Journal 2.0 surface never hands untrusted content to the HTML parser', () => {
  const files = sourceFiles(J2_ROOT)

  it('sweeps a real, non-trivial set of files', () => {
    // Non-vacuity: a sweep that walked an empty directory would pass silently
    // and read as coverage forever.
    expect(files.length).toBeGreaterThan(30)
    expect(files.some(f => f.endsWith('NoteAskPanel.jsx'))).toBe(true)
    expect(files.some(f => f.endsWith('FolderSidebar.jsx'))).toBe(true)
  })

  it('the detector can actually see the thing it looks for', () => {
    // Control. Without this the sweep proves nothing about the matcher.
    expect(usesUnsafeHtml('<div dangerouslySetInnerHTML={{__html: x}} />')).toBe(true)
    expect(usesUnsafeHtml('<div>{x}</div>')).toBe(false)
  })

  it('a comment FORBIDDING the pattern is not an offender', () => {
    // The exact false positive this rail produced on its first run.
    expect(usesUnsafeHtml('// split-and-render, NEVER dangerouslySetInnerHTML')).toBe(false)
    expect(usesUnsafeHtml('/* never use dangerouslySetInnerHTML here */')).toBe(false)
    // ...and stripping comments must not blind it to real code beside one.
    const beside = ['// a note about it', '<div dangerouslySetInnerHTML={{__html: x}} />'].join('\n')
    expect(usesUnsafeHtml(beside)).toBe(true)
  })

  it('no component on this surface uses dangerouslySetInnerHTML', () => {
    const offenders = files
      .filter(f => usesUnsafeHtml(fs.readFileSync(f, 'utf8')))
      // Forward slashes so a failure reads the same on every OS -- and so a
      // mutation check can attribute the red to THIS rail by name.
      .map(f => path.relative(J2_ROOT, f).split(path.sep).join('/'))
    // Names, never a count — a failure must say WHICH file to open.
    expect(offenders).toEqual([])
  })
})

// ── The demonstration: hostile source content renders as inert text ────────

function sseBody(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
})

async function askWith(answerText) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, body: sseBody([{ type: 'delta', text: answerText }]),
  })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  render(<NoteAskPanel noteId="n1" getEditorDom={() => dom} />)
  fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
  fireEvent.change(screen.getByPlaceholderText(/what did i say about/i), {
    target: { value: 'what does the filing say' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  return screen.findByTestId('note-ask-answer')
}

describe('a citation quoting hostile source text is inert', () => {
  it('renders script markup from a source as literal text', async () => {
    const out = await askWith('The document says "<script>alert(1)</script>" verbatim.')
    expect(out.querySelector('script')).toBeNull()
    expect(out.textContent).toContain('<script>alert(1)</script>')
  })

  it('renders an onerror image payload as literal text, creating no element', async () => {
    const payload = '<img src=x onerror=alert(1)>'
    const out = await askWith(`The page contains "${payload}" on line 3.`)
    expect(out.querySelector('img')).toBeNull()
    expect(out.textContent).toContain(payload)
  })

  it('a malicious document name inside a citation stays text', async () => {
    // Source labels are filenames. This one is legal on every OS.
    const label = '<iframe src=javascript:alert(1)></iframe>.pdf'
    const out = await askWith(`See "${label}" for the figure.`)
    expect(out.querySelector('iframe')).toBeNull()
    expect(out.textContent).toContain(label)
  })

  it('the markup is text in the accessible name too, not just the visible label', async () => {
    // aria-label is interpolated from the same untrusted string; a screen
    // reader user must get the same inert content, not a different one.
    await askWith('It says "<script>x</script>" here.')
    const chip = screen.getByRole('button', { name: /^Jump to this in the note:/ })
    expect(chip.getAttribute('aria-label')).toContain('<script>x</script>')
    expect(chip.querySelector('script')).toBeNull()
  })
})
