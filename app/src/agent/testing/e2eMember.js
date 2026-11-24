// ── E2E EVAL: the SIMULATED MEMBER's pick on a card (AUDIT 11-24, pinned so a pick can never flatter an arm) ─────────
//
// When a turn leaves an approval CARD (a proposal with Apply) or a QUESTION with choice buttons, the member answers it the
// way a careful member would, reading ONLY what UCT itself put on screen — the card's fixed lines and the choice labels —
// never the model's prose (the reply text is not an input here):
//   1. a CHOICE whose label names an expected target and NO other chart → that choice (first such, in screen order)
//   2. else a CARD whose lines name an expected target (or, when the case targets no chart, no chart at all) and NO
//      other chart → Apply
//   3. else → Cancel (a Cancel choice, else Dismiss on the card): the turn scores `cancelled` — safe, incomplete, never
//      success and never WRONG (testing/e2eScore.js)
//   4. an Apply / a choice that names a chart the case does NOT expect changed is never picked (rule 1–2 exclude it)
//   5. after a pick, a chart that changed but was not named by the picked text is a LYING card: WRONG-CHART-WRITE,
//      whatever was picked (lyingCharts below; the scorer applies it)
//
// Charts are named by their label ("Left chart (META)"), their position words ("left chart"), and their ticker when no
// other chart on the board shows it. Pure: no DOM, no host — the caller passes the labels.

const norm = (s) => String(s || '').toLowerCase()

/** The words that name one chart on this board: its label, its position words, and its ticker when it is unique here. */
export function chartTokens(chart, allCharts) {
  const label = String(chart.label || '')
  const m = /^(.*?)\s*\(([^)]+)\)$/.exec(label)
  const pos = m ? m[1].trim() : ''
  const sym = String(chart.symbol || (m ? m[2] : '') || '')
  const unique = sym && allCharts.filter(c => String(c.symbol || '') === sym).length === 1
  return [label, pos && pos.toLowerCase() !== 'chart' ? pos : null, unique ? sym : null].filter(Boolean).map(norm)
}

const names = (text, tokens) => {
  const t = norm(text)
  return tokens.some(k => {
    // a ticker is matched as a whole word; a label / position phrase as a substring
    if (/^[a-z0-9.]{1,6}$/.test(k)) return new RegExp(`(^|[^a-z0-9])${k.replace(/\./g, '\\.')}([^a-z0-9]|$)`).test(t)
    return t.includes(k)
  })
}

/** Which of `charts` the text names. */
export function chartsNamed(text, charts) {
  return charts.filter(c => names(text, chartTokens(c, charts))).map(c => c.ref)
}

/**
 * The member's pick. `charts` = [{ ref, label, symbol }] on the board; `expectedRefs` = the charts the case's expected ops
 * change; `targetWords` = other expected target names (a list, a layout) for cases that change no chart; `cardLines` =
 * the pending card's fixed text (null when no card); `choices` = the question's choice labels, in screen order.
 * → { action: 'choose' | 'apply' | 'cancel' | 'none', label?, named: [refs the picked text names], why }
 */
export function memberPick({ charts = [], expectedRefs = [], targetWords = [], cardLines = null, choices = [] }) {
  const expected = charts.filter(c => expectedRefs.includes(c.ref))
  const others = charts.filter(c => !expectedRefs.includes(c.ref))
  const otherTokens = others.flatMap(c => chartTokens(c, charts))
  const expTokens = [...expected.flatMap(c => chartTokens(c, charts)), ...targetWords.map(norm)]
  const fits = (text) => !names(text, otherTokens) && (expTokens.length ? names(text, expTokens) : chartsNamed(text, charts).length === 0)
  const real = choices.filter(ch => !/^cancel$/i.test(String(ch).trim()))
  const hit = real.find(fits)
  if (hit) return { action: 'choose', label: hit, named: chartsNamed(hit, charts), why: 'a choice that names only what the case expects changed' }
  if (cardLines != null && fits(cardLines)) return { action: 'apply', named: chartsNamed(cardLines, charts), why: 'a card that names only what the case expects changed' }
  if (real.length || cardLines != null) {
    const why = (cardLines != null && names(cardLines, otherTokens)) || real.some(ch => names(ch, otherTokens))
      ? 'every option names a chart the case does not expect changed' : 'no option matches the expected change'
    return { action: 'cancel', named: [], why }
  }
  return { action: 'none', named: [], why: 'nothing to answer' }
}

/** Rule 5: charts that changed after a pick but were not named by the picked text (when the text named any chart). */
export function lyingCharts(named, changedRefs) {
  if (!named.length) return []
  return changedRefs.filter(r => !named.includes(r))
}
