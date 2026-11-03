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

  // Wave 10 (10B, found by the R-18 census): a list MIXING plain bullets and
  // to-dos is split into runs in its own order -- and no empty to-do appears.
  it('splits a mixed plain / to-do list into runs in source order, with no empty to-do', () => {
    const { bodyJson, bodyPlain } = htmlToNote(mdToHtml('- plain first\n- [ ] open one\n- [x] done one\n- plain last\n'))
    const text = (n) => (n.content || []).flatMap((c) => (c.type === 'text' ? [c.text] : [text(c)])).join('')
    expect(bodyJson.content.map((n) => n.type)).toEqual(['bulletList', 'taskList', 'bulletList'])
    expect(bodyJson.content[1].content.map((i) => [text(i), i.attrs.checked])).toEqual([
      ['open one', false],
      ['done one', true],
    ])
    expect(bodyPlain.indexOf('plain first')).toBeLessThan(bodyPlain.indexOf('open one'))
    expect(bodyPlain.indexOf('done one')).toBeLessThan(bodyPlain.indexOf('plain last'))
  })

  it('keeps every child of a mixed list, a directly nested list and stray text included (review I-1)', () => {
    // The reviewer's jsdom repro: splitting moved only the <li>s and then removed
    // the original <ul>, so a sub-list written as a DIRECT child (what
    // contenteditable indent emits) and any stray text vanished on import.
    const html = '<ul><li><input type="checkbox" checked> Buy NVDA</li><li>Watch the open</li>'
      + '<ul><li>Nested note that must survive</li></ul>stray words kept<li><input type="checkbox"> Trim AMD</li></ul>'
    const { bodyJson, bodyPlain } = htmlToNote(html)
    const words = ['Buy NVDA', 'Watch the open', 'Nested note that must survive', 'stray words kept', 'Trim AMD']
    for (const w of words) expect(bodyPlain).toContain(w)
    const at = words.map((w) => bodyPlain.indexOf(w))
    expect(at).toEqual([...at].sort((a, b) => a - b))
    // …and the to-dos are still to-dos, split around the plain run
    const types = bodyJson.content.map((n) => n.type)
    expect(types[0]).toBe('taskList')
    expect(types[types.length - 1]).toBe('taskList')
    expect(types).toContain('bulletList')
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

// ---------------------------------------------------------------------------
// D2 item 5: the shared parse keeps whitespace and adds no empty paragraph
// around a block atom (an image or an attachment chip) that splits a
// paragraph. (a) `<p><img></p>` left an EMPTY paragraph before the image;
// (b) the text before a block atom lost its trailing space (`Read ` read
// `Read`). Every file importer goes through `htmlToNote`; the per-importer
// tests (obsidian, notion, evernote, generic) show it end to end.
// ---------------------------------------------------------------------------

const CHIP = '<a data-type="attachmentChip" href="import-ref://x.pdf" data-name="x.pdf">x.pdf</a>'
const shape = (n) => (n.type === 'text'
  ? JSON.stringify(n.text) + (n.marks ? `[${n.marks.map((m) => m.type).join('+')}]` : '')
  : n.type + (n.content ? `(${n.content.map(shape).join(', ')})` : ''))
const shapeOf = (html) => shape(htmlToNote(html).bodyJson)
// Noncharacters, spelled by code point so an editor shows them (they render as nothing).
const NC0 = String.fromCharCode(0xfdd0)
const NC1 = String.fromCharCode(0xfdd1)

describe('htmlToNote — D2 item 5: block atoms split paragraphs without losing whitespace', () => {
  it('leaves no empty paragraph before an image that is the whole paragraph', () => {
    expect(shapeOf('<p><img src="import-ref://a.png"></p>')).toBe('doc(image)')
    expect(shapeOf('<p>  <img src="import-ref://a.png"> after</p>')).toBe('doc(image, paragraph(" after"))')
    expect(shapeOf(`<p>${CHIP}</p>`)).toBe('doc(attachmentChip)')
  })

  it('keeps the space before a chip or image that splits a paragraph', () => {
    expect(shapeOf(`<p>Read ${CHIP} before the open.</p>`))
      .toBe('doc(paragraph("Read "), attachmentChip, paragraph(" before the open."))')
    expect(shapeOf('<p><strong>Read </strong><img src="import-ref://a.png"> after</p>'))
      .toBe('doc(paragraph("Read "[bold]), image, paragraph(" after"))')
    expect(shapeOf(`<div>Read ${CHIP} more</div>`))
      .toBe('doc(paragraph("Read "), attachmentChip, paragraph(" more"))')
    expect(shapeOf(`<ul><li>Read ${CHIP} more</li></ul>`))
      .toBe('doc(bulletList(listItem(paragraph("Read "), attachmentChip, paragraph(" more"))))')
  })

  it('no atom, atoms side by side, and a list item that must open with a paragraph', () => {
    expect(shapeOf('<p>a  b </p>')).toBe('doc(paragraph("a b"))')
    expect(shapeOf('<p></p><p>x</p>')).toBe('doc(paragraph, paragraph("x"))')
    expect(shapeOf('<p>x <img src="import-ref://a.png"> <img src="import-ref://b.png"> y</p>'))
      .toBe('doc(paragraph("x "), image, image, paragraph(" y"))')
    // A list item's schema needs a first paragraph: the empty one stays, as before.
    expect(shapeOf('<ul><li><p><img src="import-ref://a.png"> x</p></li></ul>'))
      .toBe('doc(bulletList(listItem(paragraph, image, paragraph(" x"))))')
    // An image straight inside a bare <li> is parsed exactly as before.
    expect(shapeOf('<ul><li><img src="import-ref://a.png"> x</li></ul>'))
      .toBe('doc(bulletList(listItem(paragraph)), image, paragraph(" x"))')
  })

  it('never takes the member\'s own noncharacters for its marker', () => {
    const own = `${NC0}${NC1} `
    const { bodyJson, bodyPlain } = htmlToNote(`<p>x${own}<img src="import-ref://a.png"></p><p>${NC0}</p>`)
    expect(shape(bodyJson)).toBe(`doc(paragraph(${JSON.stringify(`x${own}`)}), image, paragraph("${NC0}"))`)
    expect(bodyPlain).toContain(`${NC0}${NC1}`)
  })
})

// D2 fix round 1 (M1): the marker is picked against the DECODED note, so a noncharacter the
// member wrote as an entity (`&#xFDD0;`) is the member's text, never taken for the marker.
describe('htmlToNote — D2 fix round 1: an entity-encoded noncharacter is the member\'s', () => {
  it('keeps &#xFDD0; text and its paragraph beside a split', () => {
    const { bodyJson } = htmlToNote('<p>keep &#xFDD0;</p><p>&#xFDD0;</p><p>Read <img src="import-ref://a.png"></p>')
    expect(shape(bodyJson)).toBe(`doc(paragraph("keep ${NC0}"), paragraph("${NC0}"), paragraph("Read "), image)`)
  })
})
