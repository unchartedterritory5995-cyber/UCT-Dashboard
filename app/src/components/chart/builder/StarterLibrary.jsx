// app/src/components/chart/builder/StarterLibrary.jsx
//
// ─── THE STARTER LIBRARY (Phase E, E-8) ─────────────────────────────────────
//
// ⭐ THE FIRM'S SETUPS AS ORDINARY DEFINITIONS. A member who opens a blank
// formula box and does not know the syntax leaves; TC2000 and TradingView both
// ship dozens of built-in scans and it is not decoration, it is the ONBOARDING
// PATH. So this gallery hands a member a named setup, a WORKING scan, and the
// read-back that says what it computes — and then puts it in the box they type
// in, because the point is that they EDIT it.
//
// ⛔ NOT "RUN THIS SCAN". The card's action is *"here is a working scan, now
// change it"*: picking one writes the SHARED `source` the typed box and the
// Conditions picker already share, so a starter goes through the same parse,
// the same budget walk, the same linter, the same read-back and the same Save
// button as anything a member types. There is no starter save path, no starter
// flag on the document and no starter column on the store — a starter that was
// special-cased anywhere would be a second class of object, and every one of
// those places is invisible to a test that opens the library and clicks a card.
//
// ⛔ THE TAXONOMY IS `setupGroups.js`'s AND THIS FILE HOLDS NO COPY OF IT. Both
// the SET of setups and the FAMILY each one belongs to are read from
// `SETUP_GROUPS` at module load, which is why no catalogue entry carries a
// `family`. A hand-list here would agree with today's taxonomy and go silent the
// day it grows — the defect a behavioural test cannot see.
//
// ⛔ AND THE BLURB IS `sentenceFor(tree)`, NEVER A HAND-WRITTEN ONE. Two
// descriptions of one tree is one description too many and the prose one is the
// one that drifts (D-A5). The catalogue carries a `source` and a frozen tree and
// nothing that reads like English.
//
// ⭐ THE REFUSALS ARE PART OF THE PRODUCT. Not every name in the firm's taxonomy
// is expressible as a condition over the closed table, and a scan that
// half-means "High Tight Flag" is worse than no scan — the member trusts the
// firm's name on it. So the setups without a starter are LISTED, by name, each
// with the reason, and a member reading one learns what the screener actually
// holds.

import { useMemo, useState } from 'react'
import UIcon from '../../ui/UIcon'
import { SETUP_GROUPS } from '../../../constants/setupGroups'
import { parseFormula, astHash } from '../engine/ast/parse'
import { sentenceFor } from '../engine/ast/sentence'
import CATALOG from '../engine/ast/starterScans.json'
import styles from './StarterLibrary.module.css'

/**
 * One walk of the TAXONOMY producing every answer this module gives.
 *
 * ⛔ THE TWO INPUTS ARE ARGUMENTS SO A TEST CAN PLANT ONE. A builder that read
 * the real catalogue off the module scope could only ever be tested against
 * today's file, and the cases that matter — a frozen tree that stopped matching
 * its own source, a taxonomy that grew an entry nobody decided about — are
 * exactly the ones today's file does not exhibit. ⚠️ Production still calls it
 * with the real two, once, below.
 *
 * ⛔ THE TAXONOMY DRIVES THE LOOP, NOT THE CATALOGUE. Iterating the catalogue
 * would make a setup the firm added but nobody decided about simply invisible;
 * iterating the taxonomy makes it land in `undecided`, which
 * `StarterLibrary.test.jsx` asserts is empty. That difference is the whole
 * reason the list is read rather than written down.
 *
 * ⛔ AND A STARTER WHOSE FROZEN TREE IS NOT WHAT THE PARSER PRODUCES IS REFUSED,
 * never rendered. The server walks that frozen tree without a parser of its own
 * (decision D-A1), so the two lanes agree only for as long as the freeze holds.
 */
export function buildFrom(catalog, groups) {
  const declared = catalog.starters || {}
  const declaredRefusals = catalog._ungrounded || {}
  const shipped = {}
  const order = []
  const refused = []
  const undecided = []
  const notInTaxonomy = Object.keys(declared).filter(
    (name) => !groups.some((g) => g.setups.includes(name)))

  for (const group of groups) {
    for (const setup of group.setups) {
      const spec = declared[setup]
      if (spec) {
        const parsed = parseFormula(spec.source)
        let entry = null
        let why = null
        if (!parsed.ok) {
          why = `${setup} no longer parses: ${parsed.guard}: ${parsed.error}`
        } else if (JSON.stringify(parsed.ast) !== JSON.stringify(spec.ast)) {
          why = `${setup} carries a frozen tree that is not what the parser `
            + 'produces from its own source, so the two lanes would disagree '
            + 'about what it computes.'
        } else {
          try {
            entry = {
              setup,
              family: group.label,
              source: spec.source,
              ast: parsed.ast,
              sentence: sentenceFor(parsed.ast, {}),
            }
          } catch (err) {
            why = `${setup} has no read-back: ${err && err.message ? err.message : err}`
          }
        }
        if (entry) { shipped[setup] = entry; order.push(entry); continue }
        refused.push({ setup, family: group.label, reason: why })
        continue
      }
      const declaredReason = declaredRefusals[setup]
      if (declaredReason) refused.push({ setup, family: group.label, reason: declaredReason })
      else undecided.push(setup)
    }
  }
  return { shipped, order, refused, undecided, notInTaxonomy }
}

// ⭐ COMPUTED ONCE, AT MODULE LOAD. The catalogue is static data and the parse is
// pure, so re-deriving it per render would be work nobody asked for on a surface
// whose 250 ms formula debounce exists because nobody had measured the frame
// budget.
const BUILT = buildFrom(CATALOG, SETUP_GROUPS)

/** `{ [setup]: {setup, family, source, ast, sentence} }` — the shipped starters. */
export const STARTERS = BUILT.shipped
/** In the firm's own taxonomy order. */
export const STARTER_LIST = BUILT.order
/** `[{setup, family, reason}]` — named, never approximated. */
export const UNGROUNDED = BUILT.refused
/** Taxonomy entries that are neither shipped nor refused. Must be empty. */
export const UNDECIDED = BUILT.undecided
/** Catalogue entries naming a setup the taxonomy does not declare. Must be empty. */
export const NOT_IN_TAXONOMY = BUILT.notInTaxonomy
export const CATALOG_VERSION = CATALOG.version

/** The identity a member's copy will get. ⛔ Derived on demand from the tree,
 *  never stored in the catalogue: a precomputed hash would be a second registry
 *  and two authorities over one name. */
export function starterHash(setup) {
  const entry = STARTERS[setup]
  return entry ? astHash(entry.ast) : null
}

export default function StarterLibrary({ onPick = null, activeSource = '' }) {
  const [showRefused, setShowRefused] = useState(false)
  const families = useMemo(() => {
    const seen = []
    for (const entry of STARTER_LIST) {
      const row = seen.find((f) => f.family === entry.family)
      if (row) row.entries.push(entry)
      else seen.push({ family: entry.family, entries: [entry] })
    }
    return seen
  }, [])

  return (
    <section className={styles.wrap} data-testid="starter-library"
             aria-label="Starter scans">
      <p className={styles.lede}>
        The firm&apos;s setups, as ordinary scans. Pick one and it lands in the
        formula box below — yours to change.
      </p>

      {families.map(({ family, entries }) => (
        <div key={family} className={styles.family}>
          <h3 className={styles.familyHead}>{family}</h3>
          <ul className={styles.grid}>
            {entries.map((entry) => (
              <li key={entry.setup}>
                <button
                  type="button"
                  className={`${styles.card} ${activeSource === entry.source ? styles.cardActive : ''}`}
                  data-testid="starter-card"
                  data-setup={entry.setup}
                  onClick={() => onPick?.(entry)}
                >
                  <span className={styles.cardName}>{entry.setup}</span>
                  {/* ⛔ THE TREE'S OWN SENTENCE. See the header. */}
                  <span className={styles.cardSentence} data-testid="starter-sentence">
                    {entry.sentence}
                  </span>
                  <code className={styles.cardSource}>{entry.source}</code>
                  <span className={styles.cardAction}>
                    <UIcon name="edit" size={13} />Open it and edit
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {UNGROUNDED.length > 0 && (
        <div className={styles.refusedWrap}>
          <button
            type="button"
            className={styles.refusedToggle}
            aria-expanded={showRefused}
            onClick={() => setShowRefused((v) => !v)}
          >
            <UIcon name={showRefused ? 'chevronDown' : 'chevronRight'} size={13} />
            {UNGROUNDED.length} setups have no starter scan yet — and why
          </button>
          {showRefused && (
            <ul className={styles.refusedList} data-testid="starter-refusals">
              {UNGROUNDED.map(({ setup, reason }) => (
                <li key={setup} className={styles.refusedRow} data-setup={setup}>
                  <span className={styles.refusedName}>{setup}</span>
                  <span className={styles.refusedReason}>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
