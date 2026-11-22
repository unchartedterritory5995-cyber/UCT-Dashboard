// THE KICKER'S RULES (Spot the Setup shows them on a Kicker chart): the owner's three rules, measured from the bars (the bank lesson for setup.family3.kicker, in his
// words): a REAL red day before it (down 1% or more, a weak close), a GAP over the red day's CLOSE, and a strong
// close ABOVE the red day's high in the upper half of its range. The look-alikes are found by the same rules, never
// invented: a "baby red" (the red day was too small) and a "weak close" (gapped over the close but did not finish).
export const RULE_LABELS = {
  red: 'A real red day before it',
  gap: "Gaps over the red day's close",
  close: "Closes strong, above the red day's high",
}

export const pct = (from, to) => ((to - from) / (from || 1)) * 100

/** The three rules for bar `i`, each with the measured value and whether it holds. */
export function rules(bars, i) {
  const b = bars[i], r = bars[i - 1], rr = bars[i - 2]
  if (!b || !r || !rr) return []
  const redChg = pct(rr.c, r.c)
  const closePos = (b.c - b.l) / ((b.h - b.l) || 1)
  const redPos = (r.c - r.l) / ((r.h - r.l) || 1)
  return [
    { k: 'red', label: RULE_LABELS.red, value: `${redChg.toFixed(1)}%, closed ${Math.round(redPos * 100)}% up its range`, ok: r.c < r.o && Math.abs(redChg) >= 1 },
    { k: 'gap', label: RULE_LABELS.gap, value: `open ${b.o.toFixed(2)} vs close ${r.c.toFixed(2)}`, ok: b.o > r.c },
    { k: 'close', label: RULE_LABELS.close, value: `close ${b.c.toFixed(2)} vs high ${r.h.toFixed(2)}, ${Math.round(closePos * 100)}% up its range`, ok: b.c > b.o && b.c > r.h && closePos >= 0.5 },
  ]
}

/** Up to two look-alikes inside the last `view` bars, newest first, one of each kind. */
export function findTraps(bars, n, view) {
  const out = []
  for (let i = n - 2; i >= Math.max(2, n - view) && out.length < 2; i--) {
    const [red, gap, close] = rules(bars, i)
    const r = bars[i - 1]
    if (!(r.c < r.o) || !gap.ok) continue
    if (!red.ok && close.ok && !out.some((x) => x.kind === 'baby')) out.push({ i, kind: 'baby', why: 'The red day before it was too small. Not a real red day.' })
    else if (red.ok && !close.ok && !out.some((x) => x.kind === 'weak')) out.push({ i, kind: 'weak', why: 'It gapped over the red close but did not finish strong above its high.' })
  }
  return out
}

/** The candidates for an item: the look-alikes plus the real one (the last visible bar, where the bank's cutoff
 *  sits), sorted by position. */
export function candidates(bars, view) {
  const n = bars?.length || 0
  if (n < 3) return []
  return [...findTraps(bars, n, view), { i: n - 1, kind: 'real', why: 'A real red day, a gap over its close, a strong close above its high. The Kicker.' }].sort((a, b) => a.i - b.i)
}

export const KIND_WORD = { real: 'KICKER', baby: 'BABY RED', weak: 'WEAK CLOSE' }
