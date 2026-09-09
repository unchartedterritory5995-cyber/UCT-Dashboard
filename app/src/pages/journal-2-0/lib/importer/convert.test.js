import { describe, it, expect } from 'vitest'
import { sanitizeHtml, htmlToNote } from './convert'
import { mdToHtml } from './adapters/generic'

describe('sanitizeHtml', () => {
  it('strips scripts, event handlers, and javascript: URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">hi</p><script>evil()</script><a href="javascript:alert(1)">z</a>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('hi')
  })

  it('removes scripts from SVG/MathML foreign content', () => {
    const out = sanitizeHtml('<svg><script>alert(2)</script></svg>')
    expect(out.toLowerCase()).not.toContain('script')
  })

  it('rewrites a data-import-link anchor into an import-link:// href', () => {
    const out = sanitizeHtml('<a data-import-link="obsidian:Vault/Foo.md">Foo</a>')
    expect(out).toContain('href="import-link://obsidian:Vault/Foo.md"')
    expect(out).not.toContain('data-import-link')
  })
})

describe('htmlToNote', () => {
  it('converts GFM checkbox HTML into real taskItems with state', () => {
    const { bodyJson } = htmlToNote(
      '<ul class="contains-task-list">' +
      '<li class="task-list-item"><input type="checkbox" checked> done</li>' +
      '<li class="task-list-item"><input type="checkbox"> todo</li></ul>')
    const list = bodyJson.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })

  it('keeps tables and produces searchable plain text', () => {
    const { bodyJson, bodyPlain } = htmlToNote(
      '<h1>Title</h1><table><tr><td>alpha</td></tr></table>')
    expect(bodyJson.content.map((n) => n.type)).toEqual(['heading', 'table'])
    expect(bodyPlain).toContain('alpha')
  })

  it('turns a data-import-link anchor into a link mark carrying the import-link:// placeholder href', () => {
    const { bodyJson } = htmlToNote('<p><a data-import-link="obsidian:Vault/Foo.md">Foo</a></p>')
    const para = bodyJson.content[0]
    const textNode = para.content[0]
    expect(textNode.text).toBe('Foo')
    const linkMark = textNode.marks.find((m) => m.type === 'link')
    expect(linkMark).toBeTruthy()
    expect(linkMark.attrs.href).toBe('import-link://obsidian:Vault/Foo.md')
  })

  it('turns a Notion-shaped <aside> callout into a callout node with the emoji split out', () => {
    // Byte-for-byte the shape of __fixtures__/notion/My Page…/…: the emoji
    // is inline as the leading character of the aside's text, no wrapper.
    const { bodyJson, bodyPlain } = htmlToNote(
      '<aside>\n💡 This is a callout — a tip the reader should not miss.\n</aside>',
    )
    const callout = bodyJson.content[0]
    expect(callout.type).toBe('callout')
    expect(callout.attrs.emoji).toBe('💡')
    expect(bodyPlain).toContain('This is a callout')
    expect(bodyPlain).not.toContain('💡 This is a callout') // emoji lifted out of the body text
  })

  it('turns a Notion-shaped <details><summary> into a toggle, open by default', () => {
    const { bodyJson, bodyPlain } = htmlToNote(
      '<details><summary>More detail</summary>\nHidden until expanded.\n</details>',
    )
    const toggle = bodyJson.content[0]
    expect(toggle.type).toBe('toggle')
    expect(toggle.attrs.open).toBe(true)
    expect(toggle.content[0].type).toBe('toggleSummary')
    expect(toggle.content[0].content[0].text).toBe('More detail')
    expect(toggle.content[1].type).toBe('toggleContent')
    expect(bodyPlain).toContain('More detail')
    expect(bodyPlain).toContain('Hidden until expanded')
  })

  it('converts label-wrapped checkboxes to taskItems with correct state', () => {
    const { bodyJson } = htmlToNote(
      '<ul class="contains-task-list">' +
      '<li class="task-list-item"><label><input type="checkbox" checked>done task</label></li>' +
      '<li class="task-list-item"><label><input type="checkbox">todo task</label></li></ul>')
    const list = bodyJson.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 2026-09-04 adversarial gate: SIZE regime, measured through the REAL
// wizard-path converter (mdToHtml -> sanitizeHtml -> generateJSON), not the
// separate Python md_to_tiptap used by the background Obsidian connector.
// The wizard has NO client-side markdown-size precheck at all (grepped: no
// MAX_BODY_MD / byte-cap constant anywhere under lib/importer) -- every
// note, regardless of size, is converted and sent to import_confirm, which
// is the only place a >1MB body is caught (per-note isolation, proven in
// test_notes_import.py). These tests measure the actual md->TipTap-JSON
// blowup this specific path produces for three REALISTIC shapes, so the
// "3.4-4.7x, up to ~9x for many-short-headings" claim is proven for the
// FILE IMPORT wizard, not assumed to transfer from the connector's own
// (different) converter.
// ─────────────────────────────────────────────────────────────────────────
describe('markdown -> TipTap JSON blowup through the wizard converter (SIZE regime)', () => {
  function blowupFor(md) {
    const html = mdToHtml(md)
    const { bodyJson } = htmlToNote(html)
    const jsonBytes = new TextEncoder().encode(JSON.stringify(bodyJson)).length
    const mdBytes = new TextEncoder().encode(md).length
    return { blowup: jsonBytes / mdBytes, jsonBytes, mdBytes }
  }

  it('measures a long meeting/daily-notes log (hundreds of bullets + checkboxes)', () => {
    const lines = []
    for (let i = 0; i < 900; i++) lines.push(`- Discussed item ${i} with the team about the trade plan`)
    for (let i = 0; i < 900; i++) lines.push(`- [${i % 2 ? 'x' : ' '}] Follow up on action item ${i} before next session`)
    const { blowup } = blowupFor(lines.join('\n'))
    // Measured claim for this family (bullet/checkbox logs): 3.4-4.7x.
    // A regression that made the wizard's conversion dramatically cheaper
    // OR more expensive than the documented range is what this catches.
    expect(blowup).toBeGreaterThan(2)
    expect(blowup).toBeLessThan(6)
  })

  it('measures the many-short-headings shape — the ~9x worst case', () => {
    const md = Array.from({ length: 1800 }, (_, i) => `## Section ${i}\nnote ${i}`).join('\n\n')
    const { blowup } = blowupFor(md)
    // This shape must exceed the 4.7x "worst case" label from the
    // connector-side estimate — proving that label is NOT a safe ceiling
    // for the wizard path either, and that isolation (not a bigger margin)
    // is the real backstop here too.
    expect(blowup).toBeGreaterThan(4.7)
  })

  it('measures many inline images (chart screenshots pasted into a review note)', () => {
    const lines = []
    for (let i = 0; i < 600; i++) {
      lines.push(`Chart snapshot ${i}:`, '', `![chart ${i}](chart-${String(i).padStart(5, '0')}.png)`, '')
    }
    const { blowup, jsonBytes } = blowupFor(lines.join('\n'))
    expect(jsonBytes).toBeGreaterThan(0)
    expect(blowup).toBeGreaterThan(1)
  })

  it('a body near the derived ceiling (MAX_BODY_JSON_BYTES / worst-case blowup) still converts to a plain, valid TipTap doc', () => {
    // MAX_BODY_JSON_BYTES = 1_000_000 and the documented worst-case blowup
    // is 4.7x -> a ~212,765-char markdown source. Build a realistic
    // (non-filler) bullet log around that size and confirm the wizard
    // converter produces a valid doc that a real import_confirm call could
    // then accept or isolate — the conversion step itself must never throw
    // or silently truncate regardless of input size.
    const bullets = []
    let approxChars = 0
    let i = 0
    while (approxChars < 212_765) {
      const line = `- Reviewed trade idea ${i}: entry/stop/target notes and follow-up checklist item`
      bullets.push(line)
      approxChars += line.length + 1
      i += 1
    }
    const md = bullets.join('\n')
    const html = mdToHtml(md)
    const { bodyJson, bodyPlain } = htmlToNote(html)
    expect(bodyJson.type).toBe('doc')
    expect(bodyJson.content[0].type).toBe('bulletList')
    expect(bodyJson.content[0].content.length).toBe(bullets.length)
    expect(bodyPlain).toContain('Reviewed trade idea 0')
    expect(bodyPlain).toContain(`Reviewed trade idea ${bullets.length - 1}`)
  })
})
