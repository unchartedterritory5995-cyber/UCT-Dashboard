/**
 * Minimal markdown renderer shared between CompassReview (weekly) and
 * EODRecap. Handles: # / ## / ### headings, `- ` bullets, paragraphs,
 * **bold**.
 *
 * Style choices (gold h2, line-height, etc.) are baked in to match the
 * Compass brand. Both Weekly and EOD render the same way.
 */

export function renderMarkdown(md) {
  if (!md) return []
  const blocks = md.split('\n\n')
  return blocks.map((block, i) => {
    const trimmed = block.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('# ')) {
      return <h1 key={i} style={{ fontSize: 22, marginTop: 12 }}>{trimmed.slice(2)}</h1>
    }
    if (trimmed.startsWith('## ')) {
      return <h2 key={i} style={{ fontSize: 16, marginTop: 16, color: 'var(--ut-gold, #c9a84c)' }}>{trimmed.slice(3)}</h2>
    }
    if (trimmed.startsWith('### ')) {
      return <h3 key={i} style={{ fontSize: 14, marginTop: 12 }}>{trimmed.slice(4)}</h3>
    }
    if (trimmed.startsWith('- ')) {
      const items = trimmed.split('\n').filter((l) => l.trim().startsWith('- '))
      return (
        <ul key={i} style={{ margin: '6px 0 6px 20px', lineHeight: 1.6 }}>
          {items.map((line, j) => (
            <li key={j}>{renderInline(line.replace(/^\s*-\s*/, ''))}</li>
          ))}
        </ul>
      )
    }
    return <p key={i} style={{ margin: '8px 0', lineHeight: 1.6 }}>{renderInline(trimmed)}</p>
  }).filter(Boolean)
}

export function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  )
}
