/**
 * Template context — the data a Notebook template opens pre-filled with.
 *
 * Assembled CLIENT-SIDE at create time from endpoints that already exist;
 * every fetch is best-effort with a hard timeout. A failed / gated / empty
 * source resolves to null (graceful blanks — a template must always produce
 * a valid doc, offline included, and a free-tier 402 simply yields the
 * un-filled scaffold).
 *
 * Trading-day nuance (plan §4): the "today" used for the game-plan lookup is
 * the local calendar day — game plans are written the same morning they're
 * used, so calendar-day matching is correct HERE. Trade pulls (V2) must use
 * the ET trading-day helpers instead.
 */

const TIMEOUT_MS = 2500

const fetchJson = async (url) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { credentials: 'include', signal: ctl.signal })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const fmtDate = (d) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

const fmtShort = (d) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Monday of the week containing `d` (Sun→next Mon: a Sunday plan is for the week ahead). */
const mondayOf = (d) => {
  const out = new Date(d)
  const day = out.getDay()
  const shift = day === 0 ? 1 : 1 - day
  out.setDate(out.getDate() + shift)
  return out
}

/** "GREEN — UCT exposure 95/150" style one-liner from /api/breadth. */
const regimeLineFrom = (b) => {
  if (!b) return null
  const phase = b.market_phase || null
  const score = b.exposure && b.exposure.score != null ? Math.round(b.exposure.score) : null
  if (!phase && score == null) return null
  const parts = []
  if (phase) parts.push(String(phase))
  if (score != null) parts.push(`UCT exposure ${score}/150`)
  return parts.join(' — ')
}

/** Open positions as display lines. */
const positionLinesFrom = (data) => {
  const rows = (data && (data.positions || data.rows)) || []
  if (!Array.isArray(rows) || rows.length === 0) return []
  return rows.slice(0, 12).map((r) => {
    const side = (r.side || 'long').toUpperCase()
    const entry = r.entryPrice != null ? `$${Number(r.entryPrice).toFixed(2)}` : '—'
    const stop = r.stopPrice != null ? `$${Number(r.stopPrice).toFixed(2)}` : '—'
    return `${r.symbol} ${side} · in ${entry} · stop ${stop}`
  })
}

/** Walk a TipTap doc: bullet items under the heading whose text includes `headingText`. */
export function extractSectionBullets(bodyJson, headingText) {
  try {
    const blocks = (bodyJson && bodyJson.content) || []
    const wanted = headingText.toLowerCase()
    const out = []
    let inSection = false
    for (const node of blocks) {
      if (node.type === 'heading') {
        const text = (node.content || []).map((c) => c.text || '').join('')
        inSection = text.toLowerCase().includes(wanted)
        continue
      }
      if (!inSection) continue
      if (node.type === 'bulletList') {
        for (const li of node.content || []) {
          const text = ((li.content || [])[0]?.content || [])
            .map((c) => c.text || '').join('').trim()
          if (text) out.push(text)
        }
      }
    }
    return out
  } catch {
    return []
  }
}

/** Today's game-plan note (tag `game-plan`, created today) + its plan bullets. */
const findTodayGamePlan = async () => {
  const data = await fetchJson('/api/j2/notes?tag=game-plan&sort=created')
  const notes = (data && data.notes) || []
  const today = new Date().toDateString()
  const note = notes.find((n) => {
    const created = n.createdAt ? new Date(n.createdAt) : null
    return created && created.toDateString() === today
  })
  if (!note) return null
  // The list payload may omit bodyJson — fetch the full note for the quote.
  const full = note.bodyJson ? note : (await fetchJson(`/api/j2/notes/${note.id}`))?.note
  const planBullets = full ? extractSectionBullets(full.bodyJson, 'My plan') : []
  return { id: note.id, title: note.title || 'Game Plan', planBullets }
}

/**
 * Assemble everything the catalog's build(ctx) functions can use. `needs`
 * lets a template skip fetches it doesn't read (the picker passes the
 * template's own declaration).
 */
export async function assembleTemplateContext({ ticker, needs = {} } = {}) {
  const now = new Date()
  const [breadth, positions, gamePlan] = await Promise.all([
    needs.regime ? fetchJson('/api/breadth') : Promise.resolve(null),
    needs.positions ? fetchJson('/api/j2/positions') : Promise.resolve(null),
    needs.gamePlan ? findTodayGamePlan() : Promise.resolve(null),
  ])
  return {
    dateText: fmtDate(now),
    dateShort: fmtShort(now),
    weekOfText: fmtShort(mondayOf(now)),
    ticker: (ticker || '').trim().toUpperCase() || null,
    regimeLine: regimeLineFrom(breadth),
    positionLines: positionLinesFrom(positions),
    gamePlanNote: gamePlan,
  }
}

/** The zero-network fallback (also what tests use): everything blank. */
export function emptyTemplateContext() {
  const now = new Date()
  return {
    dateText: fmtDate(now),
    dateShort: fmtShort(now),
    weekOfText: fmtShort(mondayOf(now)),
    ticker: null,
    regimeLine: null,
    positionLines: [],
    gamePlanNote: null,
  }
}
