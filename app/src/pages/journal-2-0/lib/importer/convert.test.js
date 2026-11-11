import { describe, it, expect } from 'vitest'
import { sanitizeHtml, htmlToNote } from './convert'
import { mdToHtml } from './adapters/generic'
import HTML_BLOCK_VECTORS from './__fixtures__/html_block_vectors.json'

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

// D3 item 2: the editor's code mark excludes every other mark. A LINK survives (the code mark
// goes from that run); any other mark beside code goes (the parser's own rule). The server
// lane writes the same runs (`test_note_convert_d3.py`, item 2).
describe('htmlToNote — D3 item 2: a link survives a code run', () => {
  it('keeps the link on a code run inside a link, and drops the code mark there', () => {
    expect(shapeOf('<p>see <a href="https://e.com/p">the <code>x</code> plan</a> end</p>'))
      .toBe('doc(paragraph("see ", "the x plan"[link], " end"))')
    expect(shapeOf(mdToHtml('see [the `x` plan](https://e.com/p) end')))
      .toBe('doc(paragraph("see ", "the x plan"[link], " end"))')
    expect(shapeOf('<p><code><a href="https://e.com/p">x</a></code></p>'))
      .toBe('doc(paragraph("x"[link]))')
  })

  it('a link inside part of a code element takes only its own run', () => {
    expect(shapeOf('<p><code>a <a href="https://e.com/p">b</a> c</code></p>'))
      .toBe('doc(paragraph("a "[code], "b"[link], " c"[code]))')
  })

  it('bold beside code keeps code only; an anchor the editor refuses leaves the code mark', () => {
    expect(shapeOf(mdToHtml('**`x`** and *`y`*'))).toBe('doc(paragraph("x"[code], " and ", "y"[code]))')
    expect(shapeOf('<p><a><code>x</code></a></p>')).toBe('doc(paragraph("x"[code]))')
    expect(shapeOf('<p><a href="weird:x"><code>x</code></a></p>')).toBe('doc(paragraph("x"[code]))')
  })
})

// D3 item 1: a code block's final line end is the block's, not the member's. Exactly one goes,
// as on the server (`test_note_convert_d3.py`, item 1), so an exported fence reads back as it was.
describe('htmlToNote — D3 item 1: a code block keeps no final line end', () => {
  const codeOf = (html) => htmlToNote(html).bodyJson.content
    .filter((n) => n.type === 'codeBlock').map((n) => (n.content || []).map((t) => t.text).join(''))

  it('drops the fence line end and nothing more', () => {
    expect(codeOf(mdToHtml('```\nx\n```'))).toEqual(['x'])
    expect(codeOf(mdToHtml('~~~py\na\nb\n~~~'))).toEqual(['a\nb'])
    expect(codeOf(mdToHtml('```\nx\n\n```'))).toEqual(['x\n'])
    expect(codeOf(mdToHtml('    indented\n'))).toEqual(['indented'])
  })

  it('an HTML pre the same way', () => {
    expect(codeOf('<pre><code>x\n</code></pre>')).toEqual(['x'])
    expect(codeOf('<pre>x\n\n</pre>')).toEqual(['x\n'])
    expect(codeOf('<pre><code>a\nb</code></pre>')).toEqual(['a\nb'])
  })
})

// D3 items 7 and 8: the SHARED HTML block vectors the server's `html_to_tiptap` also reads
// (`test_note_convert_d3.py::test_shared_html_block_vectors`), so both HTML parses read one
// block structure (a div is a paragraph boundary; a list item opening with a list).

describe('htmlToNote — D3 items 7 and 8: shared HTML block vectors', () => {
  const quoted = (n) => (n.type === 'text' ? `'${n.text}'`
    : n.type + (n.content ? `(${n.content.map(quoted).join(', ')})` : ''))
  it.each(HTML_BLOCK_VECTORS.vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(quoted(htmlToNote(v.html).bodyJson)).toBe(v.shape)
  })
})

// D3 item 3: a 2,000-line Obsidian note of busy list items took 58-107 s in jsdom. The
// banned-tag pass spread a LIVE `getElementsByTagName('*')` collection (quadratic); it is a
// static list now, with the same output.
describe('htmlToNote — D3 item 3: linear on a big list note', () => {
  const line = (i) => '<li><a href="import-ref://attachments/q.pdf" data-type="attachmentChip" '
    + 'data-name="q.pdf" data-label="NVDA deck"><code>NVDA</code> deck</a> and <code>code [[x.png]]</code> '
    + 'plus <a data-import-link="obsidian:Note.md">Note</a> <img src="import-ref://img.png"> '
    + '<a href="https://e.com/b">a</a> <mark>hl</mark> <strong>bold</strong> ' + i + '</li>'
  const note = (n) => `<ul>${Array.from({ length: n }, (_, i) => line(i)).join('\n')}</ul>`

  // D3 review M5: no wall-clock ceiling (a shared suite runs 2-3x slower under fork contention).
  // The linearity is the RATIO of two timings taken under the same load, and the defect itself
  // is pinned structurally below.
  it('converts a 2,000-line list note, and scales linearly', () => {
    let started = performance.now()
    const small = htmlToNote(note(500))
    const t500 = performance.now() - started
    started = performance.now()
    const big = htmlToNote(note(2000))
    const t2000 = performance.now() - started
    // Every line arrived (each item opens with a chip, so the parser splits the list per item).
    expect(big.bodyPlain.match(/\bbold \d+/g)).toHaveLength(2000)
    expect(small.bodyPlain.match(/\bbold \d+/g)).toHaveLength(500)
    // Quadratic is 16x for 4x the lines; linear is ~4x. Allow noise, never 16x.
    expect(t2000 / Math.max(t500, 1)).toBeLessThan(9)
  }, 60000)

  // The structural pin. A spy on `getElementsByTagName` cannot be it: jsdom's own selector
  // engine answers `querySelectorAll('*')` through that very call (measured: two calls with
  // '*', a static result). So the pin is the code: no live-collection walk in the converter.
  it('never walks a live element collection (the quadratic step itself)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'convert.js'), 'utf8')
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/getElementsBy(TagName|ClassName|Name)\s*\(/)
  })
})

// D3 follow-up (fixture 28's last gap): a raw HTML block in markdown renders on both lanes,
// sanitised; the server's `md_to_tiptap` reads the same `markdown_vectors`.
describe('mdToHtml + htmlToNote — D3 follow-up: shared raw HTML block vectors', () => {
  const quoted = (n) => (n.type === 'text' ? `'${n.text}'`
    : n.type + (n.content ? `(${n.content.map(quoted).join(', ')})` : ''))
  it.each(HTML_BLOCK_VECTORS.markdown_vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(quoted(htmlToNote(mdToHtml(v.md)).bodyJson)).toBe(v.shape)
  })
})

// D3 follow-up (difference 1): an unsafe raw <img> leaves the server's own notice (`unsafe`,
// named by its alt), never a silent drop and never `unresolvable_src` naming the raw src.
describe('import pipeline — D3 follow-up: shared unsafe image vectors', () => {
  const vfile = (p, text) => ({ path: p, size: text.length, lastModified: null, bytes: async () => new TextEncoder().encode(text) })
  const images = (node, out = []) => {
    if (node && typeof node === 'object') {
      if (node.type === 'image') out.push(node)
      for (const c of node.content || []) images(c, out)
    }
    return out
  }
  it.each(HTML_BLOCK_VECTORS.unsafe_image_vectors.map((v) => [v.name, v]))('%s', async (_name, v) => {
    const { parseImport } = await import('./postParse')
    const { genericAdapter } = await import('./adapters/generic')
    const { docs } = await parseImport(genericAdapter, [vfile('n.md', v.md)], {})
    const byRef = new Map(docs[0].media.map((m) => [m.ref, m]))
    const notices = images(htmlToNote(docs[0].html).bodyJson).map((img) => {
      const item = byRef.get(img.attrs.src.slice('import-ref://'.length))
      return [item?.failed?.reason ?? null, item?.name ?? img.attrs.alt ?? null]
    })
    expect(notices).toEqual(v.notices)
  })
})

// D3 follow-up (difference 2): <aside> and <details> are a callout and a toggle on both lanes
// (the server's `mddoc._html_aside_callout` / `_html_details_toggle` read the same vectors).
describe('htmlToNote — D3 follow-up: shared callout and toggle vectors', () => {
  const quoted = (n) => (n.type === 'text' ? `'${n.text}'`
    : n.type + (n.content ? `(${n.content.map(quoted).join(', ')})` : ''))
  const DEFAULT_EMOJI = String.fromCodePoint(0x1f4a1)
  const nodeAttrs = (node, out = []) => {
    if (node && typeof node === 'object') {
      const a = node.attrs || {}
      if (node.type === 'callout') out.push(`callout emoji=${a.emoji === DEFAULT_EMOJI ? 'default' : 'other'} variant=${JSON.stringify(a.variant)}`)
      else if (node.type === 'toggle') out.push(`toggle open=${JSON.stringify(a.open)}`)
      for (const c of node.content || []) nodeAttrs(c, out)
    }
    return out
  }
  it.each(HTML_BLOCK_VECTORS.block_node_vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    const { bodyJson } = htmlToNote(v.html)
    expect(quoted(bodyJson)).toBe(v.shape)
    expect(nodeAttrs(bodyJson)).toEqual(v.attrs)
  })

  // The server's Extended_Pictographic table (`convert/emoji.py`) is DERIVED from this engine:
  // regenerate it from `/\p{Extended_Pictographic}/u` over every code point when this goes red.
  it('the server\'s Extended_Pictographic table is this engine\'s', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const file = path.resolve(__dirname, '../../../../../../api/services/journal_two/note_connectors/convert/emoji.py')
    const table = [...fs.readFileSync(file, 'utf8').matchAll(/\((0x[0-9A-F]+), (0x[0-9A-F]+)\)/g)]
      .map((m) => [Number(m[1]), Number(m[2])])
    const re = /\p{Extended_Pictographic}/u
    const mine = []
    let s = -1
    for (let c = 0; c <= 0x110000; c += 1) {
      const ok = c < 0x110000 && !(c >= 0xd800 && c <= 0xdfff) && re.test(String.fromCodePoint(c))
      if (ok && s < 0) s = c
      if (!ok && s >= 0) { mine.push([s, c - 1]); s = -1 }
    }
    expect(table).toEqual(mine)
  })
})

// D3 follow-up (difference 3): inline raw HTML in a markdown paragraph, both lanes alike.
describe('mdToHtml + htmlToNote — D3 follow-up: shared inline HTML vectors', () => {
  const marked = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks || []).map((m) => (m.type === 'link' ? `link=${m.attrs.href}` : m.type)).sort()
      return `'${n.text}'` + (marks.length ? `[${marks.join('+')}]` : '')
    }
    return n.type + (n.content ? `(${n.content.map(marked).join(', ')})` : '')
  }
  it.each(HTML_BLOCK_VECTORS.inline_vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(marked(htmlToNote(mdToHtml(v.md)).bodyJson)).toBe(v.shape)
  })
})

// D3 fix round 1 (C1): a region's markdown inside an open inline or leaf element keeps its
// text, links and images; the server (`test_note_convert_d3.py`) reads the same vectors.
describe('mdToHtml + htmlToNote — D3 fix round 1: shared region vectors', () => {
  const marked = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks || []).map((m) => (m.type === 'link' ? `link=${m.attrs.href}` : m.type)).sort()
      return `'${n.text}'` + (marks.length ? `[${marks.join('+')}]` : '')
    }
    return n.type + (n.content ? `(${n.content.map(marked).join(', ')})` : '')
  }
  it.each(HTML_BLOCK_VECTORS.region_vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(marked(htmlToNote(mdToHtml(v.md)).bodyJson)).toBe(v.shape)
  })
})

// D3 review M7: differences kept on purpose, pinned per lane (the server pins its own side).
describe('mdToHtml + htmlToNote — D3 fix round 1: known differences, client side', () => {
  const quoted = (n) => (n.type === 'text' ? `'${n.text}'`
    : n.type + (n.content ? `(${n.content.map(quoted).join(', ')})` : ''))
  it.each(HTML_BLOCK_VECTORS.known_differences.map((v) => [v.name.slice(0, 40), v]))('%s', (_name, v) => {
    expect(v.client).not.toBe(v.server)
    expect(quoted(htmlToNote(mdToHtml(v.md)).bodyJson)).toBe(v.client)
  })
})

// D3 fix round 2 ruling: a link wrapping only an image survives as a link right after it (the
// image's alt, else the href). The wizard's own pipeline; the server reads the same vectors.
describe('import pipeline — D3 fix round 2: shared media-link vectors', () => {
  const vfile = (p, text) => ({ path: p, size: text.length, lastModified: null, bytes: async () => new TextEncoder().encode(text) })
  const marked = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks || []).map((m) => (m.type === 'link' ? `link=${m.attrs.href}` : m.type)).sort()
      return `'${n.text}'` + (marks.length ? `[${marks.join('+')}]` : '')
    }
    return n.type + (n.content ? `(${n.content.map(marked).join(', ')})` : '')
  }
  it.each(HTML_BLOCK_VECTORS.media_link_vectors.map((v) => [v.name, v]))('%s', async (_name, v) => {
    const { parseImport } = await import('./postParse')
    const { genericAdapter } = await import('./adapters/generic')
    const file = 'md' in v ? vfile('n.md', v.md) : vfile('n.html', v.html)
    const { docs } = await parseImport(genericAdapter, [file], {})
    expect(marked(htmlToNote(docs[0].html).bodyJson)).toBe(v.shape)
  })
})
