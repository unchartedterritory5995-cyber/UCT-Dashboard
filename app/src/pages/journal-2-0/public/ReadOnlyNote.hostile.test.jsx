/**
 * The FINAL HTML of a public note page, for a note whose author stored hostile attribute
 * values (security lane, round 2).
 *
 * A share link and a published page render the server's reduced body with the real notebook
 * extensions, read-only. TipTap's FontFamily and FontSize write their attribute into an
 * inline `style`, so before the server narrowed its share and publish modes an author's
 * `fontFamily = "x; position:fixed; inset:0; background-image:url(...)"` reached a visitor's
 * browser as inline CSS, and a link carried the author's `class`, `target` and `rel`.
 *
 * ⛔ THE INPUT IS THE SERVER'S OWN OUTPUT, NOT A COPY OF IT. `tests/fixtures/
 * notebook_public_hostile.json` is written by `tests/test_notebook_fin_sec_public_attrs.py`
 * from the reducer, and that test fails when the file is out of date. `share` and `publish`
 * are what the server serves for the hostile note in `raw`. So this asserts on what a
 * visitor's browser builds from what the server really sends.
 */
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import ReadOnlyNote from './ReadOnlyNote'

const FIXTURE = path.resolve(__dirname, '../../../../../tests/fixtures/notebook_public_hostile.json')
const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

async function renderBody(bodyJson) {
  const view = render(<ReadOnlyNote note={{ title: 'T', bodyJson }} />)
  await waitFor(() => expect(view.container.querySelector('.ProseMirror p')).not.toBeNull())
  return view.container.querySelector('.ProseMirror')
}

const styleDeclarations = (root) => [...root.querySelectorAll('[style]')]
  .flatMap((el) => Array.from({ length: el.style.length }, (_, i) => el.style[i])
    .map((prop) => `${prop}: ${el.style.getPropertyValue(prop)}`))

describe.each(['share', 'publish'])('a hostile note on the public page (%s)', (mode) => {
  it('reaches the visitor with no author-controlled CSS, class, target or rel', async () => {
    const root = await renderBody(data[mode])
    const html = root.innerHTML
    for (const bad of ['position', 'inset', 'opacity', 'background', 'url(', 'evil.example/p',
      'uct-overlay', 'modal-backdrop', '_self', 'opener', 'javascript']) {
      expect(html, `${bad} reached the page`).not.toContain(bad)
    }
    // the only inline style on the page is the legitimate formatting the author chose
    expect(styleDeclarations(root).sort()).toEqual(['font-family: Georgia, serif', 'font-size: 18px'])
    const link = root.querySelector('a')
    expect(link.getAttribute('href')).toBe('https://evil.example/go')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    expect(link.getAttribute('class')).toBeNull()
    expect(link.getAttribute('title')).toBeNull()
    // every word is still there, and the palette colour still renders through its class
    expect(root.textContent).toBe('familysizecolourmarklinkjsgood familygood colour')
    expect(root.querySelector('.uct-tc-red')).not.toBeNull()
  })
})

describe('the fixture', () => {
  it('really is hostile before the server reduces it (the control)', () => {
    const raw = JSON.stringify(data.raw)
    for (const bad of ['position:fixed', 'url(https://evil.example/p)', 'uct-overlay', 'javascript:alert(1)']) {
      expect(raw).toContain(bad)
    }
  })
})
