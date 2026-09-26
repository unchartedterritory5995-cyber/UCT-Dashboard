// Wave 8 lane 8C, C5 — the three fidelity carry-overs, each through the REAL exporter and the
// REAL importer (never a hand-typed stand-in for either half):
//
//  1. N4. `$x$`, `$$x$$` and `==mark==` — what our Markdown writer emits for inlineMath,
//     blockMath and highlight — come back as inlineMath, blockMath and highlight. And the
//     other side of the same rule: a `$` in prose (escaped by the writer, or unescaped in a
//     file from elsewhere, "$5 and $10") and `a == b == c` never become math or a highlight.
//  2. Image alts. An alt holding `*`, `_`, `&amp;`, `$`, a backslash or brackets survives the
//     Markdown export and re-import unchanged (the md lane), and the web page's `<img alt>`
//     carries it unchanged too (the HTML lane — the page is rendered FROM that Markdown). The
//     writer escapes `$` in an alt, so no math reader pairs two of them.
//  3. Backslashes. A literal `\*` or `\_` in member text (a backslash before ASCII punctuation)
//     re-imports as the same text — inside one text run, across a run boundary, and at a line
//     break.
//
// One spawn for the whole file (exportFormatsMany, `md` and `html` jobs), in a budgeted
// beforeAll — lib/testing/exportBridge.spawnBudget.test.js holds this file to that.
import { describe, it, expect, beforeAll } from 'vitest'
import { exportFormatsMany, importMarkdown, pythonAvailable } from '../testing/exportBridge'
import { htmlToNote } from './convert'

const PY = pythonAvailable()
const describePy = PY ? describe : describe.skip

const t = (text, ...marks) => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const p = (...content) => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) })
const doc = (...content) => ({ type: 'doc', content })
const HL = { type: 'highlight', attrs: { color: null } }

const N4_DOC = doc(
  p('Area ', { type: 'inlineMath', attrs: { latex: '\\pi r^2' } }, ' then ', t('key level', HL), ' holds.'),
  { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
  { type: 'blockMath', attrs: { latex: 'a &= b \\\\\nc &= d' } },
  p('Range $5-$10 on a == b == c, and x==y.'),
  p('Mixed ', { type: 'inlineMath', attrs: { latex: 'x_1 + y^{2}' } }, ' costs $5.'),
)

const ALTS = [
  'Risk *high* and _low_ here',
  'R&amp;D budget',
  'NVDA $5 to $6',
  'snake_case_name* and a lone $',
  'back\\slash \\* star',
  '[bracketed] alt',
  'plain alt',
]
const ALT_DOC = doc(...ALTS.map((alt, i) => ({ type: 'image', attrs: { src: `https://example.com/img${i}.png`, alt } })))

const TEXT_COLOR = { type: 'textColor', attrs: { color: 'red' } }
const BACKSLASH_DOC = doc(
  p('Escape with \\* and \\_ here, keep C:\\Users and a\\\\b; end\\'),
  p('Two \\*stars\\* stay literal.'),
  p(t('path\\', TEXT_COLOR), '_x after a coloured run'),
  p('line ends\\', { type: 'hardBreak' }, 'next line'),
  p('cost \\$5 still exact'),
  p('A ', t('bold ends\\', { type: 'bold' }), ' and ', t('link ends\\', { type: 'link', attrs: { href: 'https://example.com/x' } }), ' done.'),
  p(t('C:\\', TEXT_COLOR), 'Users split over two runs'),
)

let R = null
beforeAll(() => {
  if (!PY) return
  const docs = { n4: N4_DOC, alt: ALT_DOC, bs: BACKSLASH_DOC }
  const jobs = []
  for (const d of Object.values(docs)) {
    jobs.push({ kind: 'md', doc: d })
    jobs.push({ kind: 'html', doc: d })
  }
  const answers = exportFormatsMany(jobs)
  R = {}
  Object.keys(docs).forEach((k, i) => {
    const md = answers[2 * i].markdown
    const html = answers[2 * i + 1].html
    R[k] = { md, html, fromMd: importMarkdown(md), fromHtml: htmlToNote(html).bodyJson }
  })
}, 120_000)

/** Every node of `type` in a TipTap doc, depth first. */
function nodes(json, type, out = []) {
  if (!json || typeof json !== 'object') return out
  if (json.type === type) out.push(json)
  for (const c of json.content || []) nodes(c, type, out)
  return out
}
/** A paragraph's text, with its inline atoms spelled out so a lost node shows. */
function paraText(para) {
  return (para.content || []).map((n) => {
    if (n.type === 'text') return n.text
    if (n.type === 'inlineMath') return `<math:${n.attrs.latex}>`
    if (n.type === 'hardBreak') return '\n'
    return `<${n.type}>`
  }).join('')
}
const hasMark = (n, type) => (n.marks || []).some((m) => m.type === type)

describePy('C5.1 (N4): math and highlight come back as themselves', () => {
  for (const lane of ['fromMd', 'fromHtml']) {
    it(`${lane}: inlineMath, blockMath and highlight survive`, () => {
      const back = R.n4[lane]
      expect(nodes(back, 'inlineMath').map((n) => n.attrs.latex)).toEqual(['\\pi r^2', 'x_1 + y^{2}'])
      expect(nodes(back, 'blockMath').map((n) => n.attrs.latex)).toEqual(['E = mc^2', 'a &= b \\\\\nc &= d'])
      const highlighted = nodes(back, 'text').filter((n) => hasMark(n, 'highlight')).map((n) => n.text)
      expect(highlighted).toEqual(['key level'])
    })

    it(`${lane}: a $ in prose and a == comparison stay text`, () => {
      const paras = nodes(R.n4[lane], 'paragraph').map(paraText)
      expect(paras).toContain('Range $5-$10 on a == b == c, and x==y.')
      expect(paras).toContain('Mixed <math:x_1 + y^{2}> costs $5.')
      expect(paras[0]).toBe('Area <math:\\pi r^2> then key level holds.')
    })
  }

  it('the Markdown carries the forms every math reader reads', () => {
    expect(R.n4.md).toContain('$\\pi r^2$')
    expect(R.n4.md).toContain('==key level==')
    expect(R.n4.md).toContain('$$\nE = mc^2\n$$')
    expect(R.n4.md).toContain('Range \\$5-\\$10')
  })

  it('a Markdown file from elsewhere: "$5 and $10" is money, "$x$" is math, "\\$" is a dollar', () => {
    const back = importMarkdown('It costs $5 and $10 today, $x^2$ is math, \\$y\\$ is not, and ==hot== is.\n\n$$\n\\int_0^1 f\n$$\n')
    expect(nodes(back, 'inlineMath').map((n) => n.attrs.latex)).toEqual(['x^2'])
    expect(nodes(back, 'blockMath').map((n) => n.attrs.latex)).toEqual(['\\int_0^1 f'])
    expect(paraText(nodes(back, 'paragraph')[0])).toBe('It costs $5 and $10 today, <math:x^2> is math, $y$ is not, and hot is.')
    expect(nodes(back, 'text').filter((n) => hasMark(n, 'highlight')).map((n) => n.text)).toEqual(['hot'])
  })

  it('inside code, nothing is math or a highlight', () => {
    const back = importMarkdown('Use `$x$ and ==y==` here.\n\n```\n$$\nnot math\n$$\n```\n')
    expect(nodes(back, 'inlineMath')).toEqual([])
    expect(nodes(back, 'blockMath')).toEqual([])
    expect(nodes(back, 'codeBlock')).toHaveLength(1)
  })
})

describePy('C5.2: an image alt survives both lanes unchanged', () => {
  it('md lane: every alt re-imports exactly', () => {
    const alts = [...nodes(R.alt.fromMd, 'image'), ...nodes(R.alt.fromMd, 'resizableImage')].map((n) => n.attrs.alt)
    expect(alts).toEqual(ALTS)
  })

  it('HTML lane: the web page carries every alt exactly', () => {
    const alts = [...nodes(R.alt.fromHtml, 'image'), ...nodes(R.alt.fromHtml, 'resizableImage')].map((n) => n.attrs.alt)
    expect(alts).toEqual(ALTS)
  })

  it('the writer escapes $ in an alt, so no math reader pairs two of them', () => {
    const line = R.alt.md.split('\n').find((l) => l.includes('img2.png'))
    expect(line).toContain('NVDA \\$5 to \\$6')
    // every $ in every alt is escaped: an ODD run of backslashes before it
    for (const l of R.alt.md.split('\n').filter((x) => x.startsWith('!['))) {
      const alt = l.slice(2, l.lastIndexOf(']('))
      for (const m of alt.matchAll(/(\\*)\$/g)) expect(m[1].length % 2, l).toBe(1)
    }
  })
})

describePy('C5.3: a backslash before ASCII punctuation re-imports as the same text', () => {
  const want = [
    'Escape with \\* and \\_ here, keep C:\\Users and a\\\\b; end\\',
    'Two \\*stars\\* stay literal.',
    'path\\_x after a coloured run',
    'cost \\$5 still exact',
  ]
  for (const lane of ['fromMd', 'fromHtml']) {
    it(`${lane}: every paragraph reads back as the member typed it`, () => {
      const paras = nodes(R.bs[lane], 'paragraph').map(paraText)
      for (const w of want) expect(paras, w).toContain(w)
      // the line-break case keeps its backslash (the break itself is the known soft-break flatten)
      expect(paras.some((x) => x.replace(/\s+/g, ' ') === 'line ends\\ next line'), JSON.stringify(paras)).toBe(true)
      // a run that ends in a backslash inside OUR punctuation keeps it, and its mark
      const texts = nodes(R.bs[lane], 'text')
      expect(texts.filter((n) => hasMark(n, 'bold')).map((n) => n.text)).toEqual(['bold ends\\'])
      expect(texts.filter((n) => hasMark(n, 'link')).map((n) => n.text)).toEqual(['link ends\\'])
      expect(paras).toContain('A bold ends\\ and link ends\\ done.')
      expect(paras).toContain('C:\\Users split over two runs')
      // nothing else came back emphasised
      expect(texts.filter((n) => hasMark(n, 'italic'))).toEqual([])
    })
  }

  it('a lone backslash before a letter is left as it was (a Windows path stays readable, even split over two runs)', () => {
    expect(R.bs.md).toContain('keep C:\\Users and')
    expect(R.bs.md).toContain('\nC:\\Users split over two runs')
    expect(R.bs.md).not.toContain('C:\\\\Users')
  })
})
