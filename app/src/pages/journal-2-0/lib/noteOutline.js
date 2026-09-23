/**
 * Wave 5 — the note's outline: every heading, H1–H6, in document order, with
 * the position to jump to. Pure (any ProseMirror doc), so the panel and its
 * rails read the same list.
 *
 * Headings inside a callout, a toggle or an inserted answer are listed too —
 * a heading is a heading wherever the member put it.
 */
export function outlineOf(doc) {
  const out = []
  if (!doc) return out
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos })
      return false // a heading holds inline content only
    }
    return !node.isAtom
  })
  return out
}

/** Index of the heading whose section holds `pos`, or -1 above the first. */
export function currentHeadingIndex(outline, pos) {
  let current = -1
  for (let i = 0; i < outline.length; i += 1) {
    if (outline[i].pos < pos) current = i
    else break
  }
  return current
}

/** The shallowest level present, so the outline's indentation starts at 0. */
export function outlineBaseLevel(outline) {
  return outline.reduce((min, h) => Math.min(min, h.level), 6)
}
