// Upgrade legacy Notebook exports (bold "[M:SS] "/"[H:MM:SS] " text prefixes,
// produced by older saveToNotebook versions) into videoTimestamp nodes so they
// become clickable. Pure function over a TipTap doc. Only the leading prefix of
// each top-level paragraph is considered. Caller gates on YouTube-hero presence.

const TS_RE = /^\[(\d+):([0-5]?\d)(?::([0-5]\d))?\]\s?/

function parsePrefix(text) {
  const m = TS_RE.exec(text)
  if (!m) return null
  const seconds =
    m[3] !== undefined
      ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      : Number(m[1]) * 60 + Number(m[2])
  return { seconds, rest: text.slice(m[0].length) }
}

export default function linkifyTimestamps(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return doc
  const content = doc.content.map((node) => {
    if (node.type !== 'paragraph' || !Array.isArray(node.content) || node.content.length === 0) {
      return node
    }
    const [first, ...rest] = node.content
    if (!first || first.type !== 'text' || typeof first.text !== 'string') return node
    const parsed = parsePrefix(first.text)
    if (!parsed) return node
    const tsNode = { type: 'videoTimestamp', attrs: { seconds: parsed.seconds } }
    // Drop the bold mark from any leftover text so the note body reads cleanly.
    const remainder = parsed.rest ? [{ type: 'text', text: parsed.rest }] : []
    return { ...node, content: [tsNode, ...remainder, ...rest] }
  })
  return { ...doc, content }
}
