/**
 * HTML → listenable plain text for read-aloud / TTS.
 *
 * Why not `element.textContent`? It concatenates every text node with NO
 * separator, so adjacent block elements mash together
 * ("Market PhaseCONFIRMED UPTRENDTrend Score10/10…") and the result is
 * gibberish when spoken. These helpers serialize block elements onto their own
 * lines while keeping inline emphasis (<strong>, <em>, …) flowing inside a
 * sentence.
 */

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'BR', 'HR', 'BLOCKQUOTE',
])

function serialize(node, acc) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      // text node — collapse internal whitespace, keep flowing inline
      acc.s += child.nodeValue.replace(/\s+/g, ' ')
    } else if (child.nodeType === 1) {
      const block = BLOCK_TAGS.has(child.tagName)
      if (block && acc.s && !acc.s.endsWith('\n')) acc.s += '\n'
      serialize(child, acc)
      if (block && acc.s && !acc.s.endsWith('\n')) acc.s += '\n'
    }
  })
}

function blockText(el) {
  if (!el) return ''
  const acc = { s: '' }
  serialize(el, acc)
  return acc.s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Generic block-aware HTML → text. Use when you want the whole fragment. */
export function htmlToSpeechText(html) {
  if (!html || typeof document === 'undefined') return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return blockText(tmp)
}

/**
 * Morning Wire rundown HTML → the spoken briefing.
 *
 * The rundown leads with data-dashboard widgets (regime banner, breadth
 * metrics, market-intelligence lists, exposure model) that are useful to read
 * but nonsense to *listen* to. The human-written briefing — Today's Focus plus
 * the narrative paragraphs — lives in a single `.rd-sections` container, so we
 * read that and skip the widgets. Falls back to whole-fragment block text when
 * the container is absent (older/other rundown shapes).
 */
export function rundownToSpeechText(html) {
  if (!html || typeof document === 'undefined') return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const sections = tmp.querySelector('.rd-sections')
  return blockText(sections || tmp)
}
