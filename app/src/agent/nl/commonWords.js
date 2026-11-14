// ── COMMON ENGLISH WORDS — never "typo-corrected" (nl/lexicon.js correctTypos) ─────────────────────────────────────
//
// ⚰️ THE DEFECT (AUDIT #1234, 2026-11-14): correctTypos treated ANY word missing from the generated lexicon (capability
// summaries, hints, the catalog, the member's names) as a typo, and rewrote it to a lexicon word one or two edits away. A
// lexicon word is whatever a capability's prose happens to say, so one hint ("Sending a chart to the Journal") made
// "sort the themes ascending" read as "… sending" and routed it to the Journal's group. On master the capreg corpus alone had
// dozens of such rewrites of plain English: "clone" → close, "drag" → draw, "fell" → fill, "file" → fire, "ping" → pin,
// "done" → none, "march" → match… — and several changed which action groups the model was sent.
//
// A real word is never a typo. correctTypos now asks `isRealWord` (below) first: a word on this list, or an inflection of
// one (or of a lexicon word: "breakouts", "traded", "plotting"), is left exactly as typed. Real typos are not words
// ("weeky", "swtich", "volumn", "candels", "layuot"), so they are still corrected. The list is deliberately COMPACT and
// CURATED (no dictionary dependency): frequent English plus the words members use around charts and markets. It must not
// hold misspellings, abbreviations a lexicon word is one edit from by accident, or tickers.
// ⛔ Rail: agentTypoLexiconRail.test.js runs correctTypos over every capreg corpus utterance and fails on any rewrite of a
// real or lexicon word that is not a recorded deliberate typo.

const WORDS = `
a about above across act action actually add added adding after again against ago ahead all allow almost alone along
already also always am among amount an and another answer any anyone anything anyway apart appear apply are area around
as ask asked at average avoid away back bad base based be bear became because become been before began begin behind
being believe below best better between big bit both bottom break bring brought build built bump business but buy by
call called came can cannot care carry case catch cause center change check choose city clean clear clearly clone close
closed closer come coming common company compare complete consider continue control copy correct cost could count
couple course cover create cross current cut daily dark data date day days deal decide deep define did different
difference direction distance divide do does doing done down drag draw drive drop during each early easy edge either
else enable end enough enter entire even ever every everything exact example except expect explain eye face fact fail
fall far fast feel fell few file fill final find fine finish first fit five fix flat flip follow for form forward found
four free from front full further gain gave get give given go goes going gone good got great green group grow had half
hand happen hard has have he head hear help her here high higher him his hit hold home hour how however huge idea if
important in include inside instead interest internal into is issue it its itself just keep kept kind know known large
last late later lead leader learn least leave left less let level life light like likely limit line list little live
long look lose lost lot low lower made main make making many march mark market matter may maybe me mean measure meet
member middle might mind minute miss model month more morning most move much must my name narrow near need never new
next nice night no none not note nothing notice now number of off often old on once one only open or order other our
out over own paint part pass past pay people per percent perhaps pick piece ping place plan play plot plus point
possible post pull push put quick quickly quite quote raise rather reach react read ready real really reason recent red
remember repeat report rest result return right rise room round rule run said same save saw say second see seem seen
sell send sense set several shall share she short should show side simple since single size slow small so some
something soon sort sound speed spot stack stand start state stay step still stop story strong such suggest sure take
taken talk team tell term test than thank that the their them then there these they thing think this those though three
through time to today together told too took top toward track trade trend true try turn two type under until up upon
us use used very view wait walk want was watch way we week well went were what when where whether which while white who
whole why wide will wipe with within without word work world would write wrong year yes yet you your
apple chip dump exchange figure fundamental hood kill link oops preset pure slap tape temporary tight trail tweak usual warn
ascend descend hows whats
`.trim().split(/\s+/)

export const COMMON_WORDS = new Set(WORDS)

const has = (sets, w) => w.length >= 3 && sets.some(s => s.has(w))
/** The base forms a word may be an inflection of (plural, past, -ing, -ly, -er / -est, re- / up- / un- prefixed). */
export function stemsOf(w) {
  const out = []
  const push = (s) => { if (s && s.length >= 3) out.push(s) }
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) push(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1))
  for (const suf of ['ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(suf)) continue
    const s = w.slice(0, -suf.length)
    push(s); push(s + 'e')
    if (s.length >= 3 && s[s.length - 1] === s[s.length - 2]) push(s.slice(0, -1))     // plotted / plotting → plot
  }
  if (w.endsWith('ly')) push(w.slice(0, -2))
  for (const pre of ['re', 'up', 'un']) if (w.startsWith(pre)) push(w.slice(pre.length))
  return out
}
/** A real word (on the common list, or the lexicon's own) or an inflection of one: never a typo. */
export function isRealWord(w, lexWords = null) {
  const sets = lexWords ? [COMMON_WORDS, lexWords] : [COMMON_WORDS]
  if (has(sets, w)) return true
  for (const s of stemsOf(w)) {
    if (has(sets, s)) return true
    for (const s2 of stemsOf(s)) if (has(sets, s2)) return true       // two steps: "upcoming" → coming → come
  }
  return false
}
/** A common English word, or an inflection of one: never rewritten at all. */
export const isCommonWord = (w) => isRealWord(w, null)
/**
 * The LEXICON words this word is an inflection of ("stochastics" → stochastic, "breakouts" → breakout, "traded" → trade).
 * Such a word is not a typo either, but reading it as its OWN base form is safe and routes it ("add stochastics"): it is
 * normalised to that base and never to any other word one edit away.
 */
export function lexiconBasesOf(w, lexWords) {
  if (!lexWords) return []
  const out = new Set()
  // SUFFIX stems only: a prefix changes the meaning ("unlink" is not "link", "unusual" is not "usual")
  const suffixed = (x) => stemsOf(x).filter(st => !/^(?:re|up|un)/.test(x) || !x.endsWith(st))
  for (const s of suffixed(w)) {
    if (lexWords.has(s)) out.add(s)
    for (const s2 of suffixed(s)) if (lexWords.has(s2)) out.add(s2)
  }
  return [...out]
}
