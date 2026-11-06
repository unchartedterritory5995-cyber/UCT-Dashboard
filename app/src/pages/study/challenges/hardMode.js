// HARD MODE helpers (production plan piece 43: "ticker hidden, averages hidden, candles only; a legendary fourth
// crown for a perfect run"). Pure, so the rules are testable without a chart. The chart part is one option set the
// Study chart already understands (`overlays: false`, `volume: false`, studyChartLook.studySettingsOverride); the
// ticker is hidden on every Study chart already (the symbol is the item id until the reveal).
//
// THE QUESTION is "what fired on the last candle?" with setup names as cards plus "Nothing fired", and it is still
// scored on the SERVER against the bank's own Yes / No key, which never reaches the browser: naming the item's
// setup posts the bank's Yes ("the setup fires here"), anything else posts its No. A member is credited only when
// the server agrees AND the pick was the setup or "Nothing fired": on a near-miss chart (the bank's answer is No)
// naming another setup is not credited even though No was the right key, and nothing here pretends to know the
// key. The lab's Hard V3 (name it, enter it, stop it) waits on the owner's levels rulings per setup.
import { SETUP_NAMES } from './challengeBank'

export const HARD_TOTAL = 8
export const NOTHING = 'Nothing fired'
// Round 19 (owner, batch 19, on the start card's switches: "I dont like that we are asking questions about stuff with
// important indicators blank ... i dont see the point"): the TICKER is the one thing hidden; the member's own averages and
// volume stay, so the chart is their own. Plan piece 43 said candles only; his words outrank it. `{ overlays: false,
// volume: false }` restores candles only.
export const HARD_CHART = Object.freeze({})
export const RUN_ON_MS = 330   // the owner, batch 10: "show the next candles a bit slower"

function seeded(seed) {
  let s = (Number(seed) || 1) % 2147483647 || 1
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

/** A stable seed from an item id, so a re-render never reshuffles the cards under the member's finger. */
export function idSeed(id) {
  let h = 7
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 2147483647
  return h || 1
}

/** Four cards for one chart: the item's setup, two other setups, and "Nothing fired", in a seeded order. */
export function hardChoices(item, seed = 1, names = SETUP_NAMES) {
  const rnd = seeded(seed)
  const others = names.filter((x) => x !== item.name)
  const picked = []
  while (others.length && picked.length < 2) picked.push(others.splice(Math.floor(rnd() * others.length), 1)[0])
  const cards = [item.name, ...picked, NOTHING]
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]] }
  return cards
}

/** What the member's pick posts against the bank's Yes / No question (the bank's own words for Yes and No). */
export function hardAnswer(picked, item, yes, no) {
  return { choice: picked === item.name ? yes : no, picked_setup: picked }
}

/** Credited only when the server agrees and the pick was the setup itself or "Nothing fired". */
export function hardRight(picked, item, serverCorrect) {
  return !!serverCorrect && (picked === item.name || picked === NOTHING)
}

/** Did the setup fire on this chart? Read from the server's verdict on what was posted, never from a key here. */
export function setupFired(picked, item, serverCorrect) {
  return serverCorrect ? picked === item.name : picked !== item.name
}
