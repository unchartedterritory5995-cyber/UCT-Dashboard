// THE MARKS ON THE DRILL CHART (the owner on the real member screen, 2026-11-17: "This one was very good. I think the
// arrow and the text/font could look much better and be a lot more of a cool production"). The marks keep their words and
// colours (DECISION DAY / BAR and BOUGHT in UCT gold, the R marks green, STOPPED and CLOSED red); StockChart draws them as
// labels (`markerLook`: ChartMarkOverlay) with a pointer on the bar and a small sign ahead of each word, in the kit's
// type. This file says which kind each mark is, its sign, and the size for the screen.

/** The kind of a drill mark, from its word: decision | entry | short | target | stop | dot (no word) | note. */
export function markKind(m) {
  const t = String(m?.text || '').trim().toUpperCase()
  if (!t) return 'dot'
  if (/^DECISION (DAY|BAR)$/.test(t)) return 'decision'
  if (t === 'BOUGHT') return 'entry'
  if (t === 'SHORTED') return 'short'
  if (/^\d+(\.\d+)?R$/.test(t)) return 'target'
  if (t === 'STOPPED' || /^CLOSED (UNDER|OVER)$/.test(t)) return 'stop'
  return 'note'
}

/** The sign ahead of each kind's word: a diamond where the question stood, the trade's direction, a tick on a mark
 *  reached, a cross on the stop. */
export const MARK_GLYPH = Object.freeze({ decision: 'diamond', entry: 'up', short: 'down', target: 'check', stop: 'cross' })

/** The drill's marks with their kind and sign (the time, side, colour and word are kept as they are). */
export function studyMarks(markers) {
  if (!Array.isArray(markers) || !markers.length) return markers || null
  return markers.map((m) => {
    const kind = markKind(m)
    return { ...m, kind, glyph: MARK_GLYPH[kind] || null }
  })
}

/** The size of the labels: a phone's are one step smaller and never under 11 px. */
export function studyMarkLook(phone = false) {
  return phone ? 'phone' : 'wide'
}
