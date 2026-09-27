// What the importer's Markdown reader understands beyond CommonMark (wave 8, lane 8C, C5).
//
// Our own Markdown writer (`notes_export.tiptap_to_markdown`) emits three forms CommonMark
// does not know: `$…$` for inlineMath, `$$` lines for blockMath, and `==…==` for highlight —
// the forms Obsidian, Pandoc and Typora read. Before this module the importer read all three
// back as plain text (OPEN-ITEMS N4). The rules here mirror the server's web-page renderer
// (`notes_export_formats._markdown_it`: mdit-py-plugins' dollarmath with `allow_space=False,
// allow_digits=False`, and `_mark_rule`), so the HTML lane and the Markdown lane agree:
//
//  · inline `$…$`: the opening `$` is not escaped, not followed by whitespace and not preceded
//    by a digit; the closing `$` is the NEXT unescaped `$`, and it must not follow whitespace
//    or precede a digit — otherwise it is not math at all. So "$5 and $10" is money.
//  · block `$$`: a line opening with `$$`, closed on the same line or on a later line ending
//    with `$$`; a blank line before the close means it was never a formula.
//  · `==…==`: nothing just inside either `==`, no `=` or line break inside, and — the Obsidian
//    adapter's own rule (adapters/obsidian.js HIGHLIGHT_RE) — neither marker touching a letter,
//    digit, `_` or `=` outside. So `a == b == c` and `x==y` stay text.
//
// ⛔ And one CommonMark gap closed for image alts: markdown-it renders an alt with
// `renderInlineAsText`, which SKIPS a backslash-escaped character and a decoded entity (both
// are `text_special` tokens), so `![R\&amp;D](x)` came back "Ramp;D" and `\*` vanished. The
// image renderer here reads every text-bearing token.
//
// No regex lookbehind anywhere (the iOS 16 floor, app/src/noRegexLookbehind.test.js).

const WORDISH = /[=\p{L}\p{N}_]/u
const SPACE = /\s/
const DIGIT = /[0-9]/

function isEscaped(src, pos) {
  let n = 0
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5c; i -= 1) n += 1
  return n % 2 === 1
}

function mathInline(state, silent) {
  const { src, pos: start, posMax: max } = state
  if (src.charCodeAt(start) !== 0x24) return false
  const next = src[start + 1]
  if (next === undefined || start + 1 >= max || SPACE.test(next)) return false
  if (start > 0 && DIGIT.test(src[start - 1])) return false
  if (isEscaped(src, start)) return false
  let end = -1
  for (let pos = start + 1; ;) {
    const found = src.indexOf('$', pos)
    if (found < 0 || found >= max) return false
    if (isEscaped(src, found)) { pos = found + 1; continue }
    end = found
    break
  }
  if (SPACE.test(src[end - 1])) return false
  if (end + 1 < max && DIGIT.test(src[end + 1])) return false
  const latex = src.slice(start + 1, end)
  if (!latex) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = latex
    token.markup = '$'
  }
  state.pos = end + 1
  return true
}

function mathBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const startPos = state.bMarks[startLine] + state.tShift[startLine]
  let end = state.eMarks[startLine]
  if (startPos + 2 > end) return false
  if (state.src.charCodeAt(startPos) !== 0x24 || state.src.charCodeAt(startPos + 1) !== 0x24) return false
  let closed = false
  let nextLine = startLine
  const firstLine = state.src.slice(startPos, end)
  if (firstLine.trim().length > 3 && firstLine.trim().endsWith('$$')) {
    closed = true
    end = end - 2 - (firstLine.length - firstLine.trimEnd().length)
  }
  while (!closed) {
    nextLine += 1
    if (nextLine >= endLine) break
    const s = state.bMarks[nextLine] + state.tShift[nextLine]
    const e = state.eMarks[nextLine]
    const line = state.src.slice(s, e)
    if (line.trim().endsWith('$$')) {
      closed = true
      end = e - 2 - (line.length - line.trimEnd().length)
      break
    }
    if (line.trim() === '') break
  }
  if (!closed) return false
  if (silent) return true
  state.line = nextLine + 1
  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = state.src.slice(startPos + 2, end).trim()
  token.markup = '$$'
  token.map = [startLine, state.line]
  return true
}

function markInline(state, silent) {
  const { src, pos: start, posMax: max } = state
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d || start + 2 >= max) return false
  if (start > 0 && WORDISH.test(src[start - 1])) return false
  const end = src.indexOf('==', start + 2)
  if (end < 0 || end + 2 > max) return false
  const inner = src.slice(start + 2, end)
  if (!inner || SPACE.test(inner[0]) || SPACE.test(inner[inner.length - 1])) return false
  if (inner.includes('\n') || inner.includes('=')) return false
  if (end + 2 < max && WORDISH.test(src[end + 2])) return false
  if (!silent) {
    state.push('mark_open', 'mark', 1).markup = '=='
    const oldMax = state.posMax
    state.pos = start + 2
    state.posMax = end
    state.md.inline.tokenize(state)
    state.posMax = oldMax
    state.push('mark_close', 'mark', -1).markup = '=='
  }
  state.pos = end + 2
  return true
}

/** An image's alt as plain text, keeping every character the member wrote. */
export function altText(children) {
  let out = ''
  for (const tok of children || []) {
    switch (tok.type) {
      case 'text':
      case 'text_special':
      case 'code_inline':
      case 'html_inline':
        out += tok.content
        break
      case 'math_inline':
        out += `$${tok.content}$`
        break
      case 'softbreak':
      case 'hardbreak':
        out += '\n'
        break
      case 'image':
        out += altText(tok.children)
        break
      default:
        break
    }
  }
  return out
}

/** markdown-it plugin: the importer's math, highlight and image-alt rules. */
export function uctMarkdown(md) {
  const esc = md.utils.escapeHtml
  md.inline.ruler.after('escape', 'uct_math_inline', mathInline)
  md.inline.ruler.before('emphasis', 'uct_mark', markInline)
  md.block.ruler.before('fence', 'uct_math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span data-type="inline-math" data-latex="${esc(tokens[idx].content)}"></span>`
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div data-type="block-math" data-latex="${esc(tokens[idx].content)}"></div>\n`
  md.renderer.rules.image = (tokens, idx, options, env, slf) => {
    const token = tokens[idx]
    token.attrs[token.attrIndex('alt')][1] = altText(token.children)
    return slf.renderToken(tokens, idx, options)
  }
}
