/**
 * The editor never turns a stored, pasted or imported font value into CSS it did not check
 * (security lane, round 2, item 3).
 *
 * TipTap's stock FontFamily and FontSize render `style: \`font-family: ${attrs.fontFamily}\``
 * with no narrowing, and content loaded as JSON never passes `parseHTML`. So a note body
 * holding `fontFamily: "x; position:fixed; inset:0; background-image:url(...)"` became an
 * inline style with a fixed, full-screen box and an outside fetch. `lib/tiptap.js` now
 * registers guarded copies of both extensions; this drives the REAL extension list.
 *
 * Nothing a member already has may be stripped, so the legitimate values are DERIVED:
 *   * every value the Font picker offers, from `utils/fontFamilies.js` FONT_OPTIONS;
 *   * every value the Size picker offers, from NoteEditorPage.jsx's own FONT_SIZES array,
 *     read out of that file's source (it is a private const; retyping it here would be a
 *     second copy that drifts);
 *   * what paste and import produce (Word's `Calibri`, `11pt`), from the case table the
 *     server's guard is tested against too: tests/fixtures/notebook_text_style_cases.json.
 */
import { describe, expect, it } from 'vitest'
import { Editor, generateJSON } from '@tiptap/core'
import fs from 'node:fs'
import path from 'node:path'
import { buildExtensions, safeFontFamily, safeFontSize } from './tiptap'
import { FONT_OPTIONS } from '../../../utils/fontFamilies'
import { htmlToNote } from './importer/convert'

const CASES = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../../../tests/fixtures/notebook_text_style_cases.json'), 'utf8'))

const PICKER_FONTS = FONT_OPTIONS.map((f) => f.value).filter(Boolean)
const editorSource = fs.readFileSync(path.resolve(__dirname, '../components/notebook/NoteEditorPage.jsx'), 'utf8')
const sizesMatch = editorSource.match(/const FONT_SIZES = \[([^\]]+)\]/)
const PICKER_SIZES = sizesMatch[1].split(',').map((s) => `${Number(s.trim())}px`)

const doc = (marks) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks }] }] })

function renderMarks(marks) {
  const el = document.createElement('div')
  const editor = new Editor({ element: el, extensions: buildExtensions(), content: doc(marks) })
  const p = el.querySelector('p')
  const span = p.querySelector('span')
  const out = { html: p.innerHTML, style: span ? span.getAttribute('style') : null, json: editor.getJSON() }
  editor.destroy()
  return out
}

describe('the derivations found the pickers (controls)', () => {
  it('reads the Font and Size pickers own arrays', () => {
    expect(PICKER_FONTS.length).toBeGreaterThanOrEqual(20)
    expect(PICKER_SIZES.length).toBeGreaterThanOrEqual(15)
    expect(PICKER_SIZES).toContain('12px')
    // the Size picker really does write `${s}px` from that array
    expect(editorSource).toMatch(/FONT_SIZES\.map\(\(s\) => <option key=\{s\} value=\{`\$\{s\}px`\}/)
  })
})

describe('a hostile value already stored in a note never becomes a style', () => {
  it.each(CASES.family.reject.filter((v) => v.trim()))('fontFamily %j', (value) => {
    const out = renderMarks([{ type: 'textStyle', attrs: { fontFamily: value } }])
    expect(out.style).toBeNull()
    expect(out.html).not.toMatch(/position|url\(|expression|important|display|color/i)
    expect(out.html).toContain('x')                       // the words are still there
  })

  it.each(CASES.size.reject.filter((v) => v.trim()))('fontSize %j', (value) => {
    const out = renderMarks([{ type: 'textStyle', attrs: { fontSize: value } }])
    expect(out.style).toBeNull()
    expect(out.html).not.toMatch(/position|expression|important|calc|var\(/i)
  })

  it('the exact value the security review named renders nothing', () => {
    const out = renderMarks([{ type: 'textStyle', attrs: {
      fontFamily: 'x; position:fixed; inset:0; opacity:0; background-image:url(https://evil.example/p)',
      fontSize: '12px; position:fixed' } }])
    expect(out.html).toBe('<span>x</span>')
  })
})

describe('no legitimate formatting is stripped', () => {
  it.each(PICKER_FONTS)('the Font picker value %j renders as it did', (value) => {
    const el = document.createElement('span')
    el.setAttribute('style', `font-family: ${value}`)
    const expected = el.style.fontFamily
    const probe = document.createElement('div')
    const editor = new Editor({ element: probe, extensions: buildExtensions(),
      content: doc([{ type: 'textStyle', attrs: { fontFamily: value } }]) })
    const span = probe.querySelector('p span')
    expect(span.style.fontFamily).toBe(expected)
    expect(span.style.length).toBe(1)
    expect(editor.getJSON().content[0].content[0].marks[0].attrs.fontFamily).toBe(value)   // stored value untouched
    editor.destroy()
  })

  it.each(PICKER_SIZES)('the Size picker value %j renders as it did', (value) => {
    expect(renderMarks([{ type: 'textStyle', attrs: { fontSize: value } }]).style).toBe(`font-size: ${value};`)
  })

  it.each(CASES.family.accept)('a pasted or imported font %j still renders', (value) => {
    expect(safeFontFamily(value)).toBe(value)
    const out = renderMarks([{ type: 'textStyle', attrs: { fontFamily: value } }])
    expect(out.style).toMatch(/^font-family: /)
    expect(out.style.split(';').filter((s) => s.trim())).toHaveLength(1)
  })

  it.each(CASES.size.accept)('a pasted or imported size %j still renders', (value) => {
    expect(safeFontSize(value)).toBe(value)
    expect(renderMarks([{ type: 'textStyle', attrs: { fontSize: value } }]).style).toBe(`font-size: ${value};`)
  })

  it('a font and a size together are two declarations and no more', () => {
    const out = renderMarks([{ type: 'textStyle', attrs: { fontFamily: 'Georgia, serif', fontSize: '18px' } }])
    expect(out.style).toBe('font-family: Georgia, serif; font-size: 18px;')
  })
})

describe('the guards themselves', () => {
  it('agree with the shared case table', () => {
    for (const v of CASES.family.accept) expect(safeFontFamily(v), v).toBe(v)
    for (const v of CASES.family.reject) expect(safeFontFamily(v), v).toBeNull()
    for (const v of CASES.size.accept) expect(safeFontSize(v), v).toBe(v)
    for (const v of CASES.size.reject) expect(safeFontSize(v), v).toBeNull()
    for (const v of PICKER_FONTS) expect(safeFontFamily(v), v).toBe(v)
    for (const v of PICKER_SIZES) expect(safeFontSize(v), v).toBe(v)
    for (const v of [null, undefined, 12, true, {}, []]) {
      expect(safeFontFamily(v)).toBeNull()
      expect(safeFontSize(v)).toBeNull()
    }
  })
})

describe('paste and import go through the same guard', () => {
  const HTML = '<p><span style="font-family: Calibri, sans-serif; font-size: 11pt">ok</span>'
    + '<span style="font-family: var(--evil); font-size: calc(100vw)">bad</span></p>'

  const marksOf = (json) => json.content[0].content.map((n) => [n.text, (n.marks || []).map((m) => m.attrs)])

  it('paste: parseHTML keeps a real font and drops what is not one', () => {
    const json = generateJSON(HTML, buildExtensions())
    const [ok, bad] = marksOf(json)
    expect(ok).toEqual(['ok', [{ fontFamily: 'Calibri, sans-serif', fontSize: '11pt' }]])
    expect(bad[0]).toBe('bad')
    expect(JSON.stringify(bad[1])).not.toMatch(/var\(|calc\(/)
  })

  it('import: the importer builds its JSON with the same extension list', () => {
    const { bodyJson } = htmlToNote(HTML, {})
    expect(JSON.stringify(bodyJson)).toContain('Calibri, sans-serif')
    expect(JSON.stringify(bodyJson)).not.toMatch(/var\(|calc\(/)
  })
})
