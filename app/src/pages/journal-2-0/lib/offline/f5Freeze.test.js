/**
 * ⛔⛔ WHILE Q1-F5 IS OPEN, THE APPEND CALL SITES ARE FROZEN.
 *
 * Four of the seven door families are proved in a live browser on production.
 * The three APPEND families are not: `append_widget_embed`,
 * `append_financial_fact` and `append_document_excerpt` are proved at unit level
 * and in the editor's own conflict rails, but no driver has yet opened them on
 * the real site during a queued save.
 *
 * ⭐ SO THE RULE IS NARROW AND MECHANICAL: until F5's table is green, a branch
 * may not change the client call sites of those three doors, nor the drain's
 * classification, nor the settle. Everything else in these files is open —
 * R-4a's paste/drop handlers and Q2-A's cached-read render both live in
 * `NoteEditorPage.jsx` alongside the excerpt door, and they are welcome there.
 *
 * ⛔ WHY A FREEZE RATHER THAN CARE. "R-1a extends Send-to-Journal; building on a
 * door whose append-only merge isn't proven live is building on sand." The same
 * argument applies to *editing* the door: if the append-only classification is
 * ever found wrong on production, the investigation has to start from the code
 * that was measured, not from code that moved underneath it.
 *
 * ⚖️ AMENDED 2026-09-13 — ONE CHANGE MADE UNDER THE FREEZE, ON AN OWNER RULING.
 * The freeze's reason was *"investigate from the measured code"*, and that
 * investigation COMPLETED: widening the property rail to seven families found
 * that the append-only merge was unreachable for any door this browser fired,
 * with the mechanism traced to two lines — the ring-vouched rebase that ran
 * before the diff was read, pre-send and again on the 409. The freeze protected
 * exactly what it was meant to protect: nobody had moved that code, so the
 * defect was found in the code the measurement was taken against.
 *
 * ⭐ So the freeze was AMENDED, not broken. `outboxDrain.js` gained
 * `ringVouchedPlan` — one authority for "the ring vouched, now what" — and the
 * three append CALL SITES below are untouched, which is what the freeze is
 * actually about. The classifier and the settle are otherwise still frozen.
 *
 * ⚖️ AMENDED 2026-09-23 — DECISION D3 (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`
 * §3, the owner's delegated ruling): the freeze is lifted for EXACTLY two
 * changes and nothing else —
 *   (1) F5P-1: words queued for the note a member is sitting on must be sent, by
 *       the single writer that owns the note (the editor), never by the sweep;
 *   (2) the append-merge class: a server-appended widget, fact or excerpt must
 *       never be dropped by an offline sync.
 * What moved under (2), wave 5 (f2b663d86): `settleLandedSave` (useDurableNote.js)
 * keeps the base the record's unsent words were written on instead of adopting
 * what just landed, and `discardsUnsentWork` (recoverLocalState.js) no longer
 * reads the server's own appends as a discard.
 * What moved under (1), wave 5: `recover()` hands the owning editor queued work to
 * adopt (`queuedWorkToAdopt`) and the base any recovered copy was written on
 * (`baseOfRecovered`); `settleOwnerFork` lets the owner settle its own fork; and
 * `outboxDrain.js` EXPORTS its fork settle as `settleForkedNote` so that owner
 * uses the drain's code, not a copy — the sweep's behaviour is unchanged. The
 * editor half (E-1/E-2/E-3) landed as fe4e278bc (`NoteEditorPage.jsx`, applied by
 * the editor agent from this agent's handover).
 * Fix round 1 of the same change (review `wave5-A-review.md`), no frozen file
 * touched: `settleOwnerFork` now takes what was FORKED and settles only while the
 * record and every queued entry still hold exactly that (S1), and the editor
 * asks the same of its own view before calling it and again before `markSynced`;
 * the editor adopts queued words silently only when the member has not edited
 * since hydration, and a Restore waits for a save already on the wire (S2);
 * `queuedWorkToAdopt` refuses a base whose revision is not the entry's (N4); and
 * `discardsUnsentWork` now ASKS the frozen classifier for `APPEND_ONLY` instead of
 * restating it (N2) — calling `serverChange.js`, not editing it. All of it is
 * recorded, with the reproductions and the mutation proofs, in
 * `docs/notebook/f5-fixes-2026-09-23.md` (§A.3, §B.4, §C).
 * ⛔ NOT moved: the append CALL SITES below, `serverChange.js`,
 * `settleNoteWrite.js`, and the drain's CLASSIFICATION — the finding's own
 * mechanism was already closed by `ringVouchedPlan` (9a213bd45) and re-proved at
 * HEAD. F5's table is still not all GREEN-or-NAMED, so `F5_OPEN` stays true: D3
 * lifted the freeze for two changes, it did not close F5.
 *
 * ⚖️ AMENDED 2026-09-23 (wave 6) — DECISION D3b (the controller's ruling under the
 * owner's delegation, `.superpowers/sdd/2026-09-23-notebook-10/wave6-D3b-brief.md`):
 * the freeze is lifted for ONE more change, of D3's class and found by D3's own
 * work — a note open in an editor in one tab must never be sent by ANOTHER tab's
 * sweep (`wave5-A-report.md`, concern 2) — together with the residuals the wave-5
 * review left scheduled for this lane. What moved in `outboxDrain.js`, and nothing
 * else in it:
 *   · `drainOutbox` takes `noteIsOwned` and SKIPS a note whose per-note owner Web
 *     Lock (`uct-note-owner:<account>:<note>`, held by `useDurableNote` while the
 *     note is open in an editor) is held or queued in any tab — asked at the top
 *     of the loop and again right before the send. Unknown (no Web Locks, null, a
 *     throw) ⇒ exactly the old behaviour: `excludeNoteId` alone decides.
 *   · `settleForkedNote(…, { forked })`: the OWNER's fork settle checks that the
 *     record and every queued entry still hold exactly what was forked, AND
 *     writes, in ONE readwrite transaction (`putNoteWithIntentIf`). The sweep
 *     never passes `forked` and keeps its path; the record both compose is one
 *     function (`forkSettledRecord`). Pinned by the D3b case below.
 * Outside the frozen files, same lane: crash drafts record the revision they were
 * typed on and `baseOfRecovered` answers a REVISION-ONLY base wherever only the
 * revision is provable, so Restore forks and never clobbers; the durable writer's
 * `flush` pins the latest snapshot behind an in-flight write. All of it, with the
 * rails and the mutation proofs: `docs/notebook/f5-fixes-2026-09-23.md` §F.
 * ⚖️ D3b, FIX ROUND 1 (review `wave6-D3b-review.md`; the controller's RULING on
 * residual (c) EXTENDS the lift): what moved in `outboxDrain.js`, and nothing else —
 *   · residual (c): the drain classifies against the record's last-known server
 *     copy through ONE function, `classifiableBase`, which refuses a copy that
 *     may not stand for the queued entry — NEWER than its base, or unorderable —
 *     by asking `baseMayStandFor`, the SAME predicate `baseOfRecovered` asks
 *     (extracted from it, `recoverLocalState.js`). Refused ⇒ UNKNOWN
 *     ⇒ FORK: `ringVouchedPlan` answers 'fork' for it (never the no-evidence
 *     rebase), and the diff branch classifies against `null`, which the frozen
 *     classifier reads as BODY_REWRITE. ⚰️ A pre-A-1 record's `acked@landed` base
 *     read a door's appended block as "no change", the queued body was rebased
 *     over it, and the block was gone. This changes the classification's INPUT;
 *     `classifyServerChange` itself (`serverChange.js`) is untouched. Pinned by
 *     the fix-round-1 case below.
 *   · review N-5: a `permanent` (blocked) entry reports BLOCKED before either
 *     "the editor owns it" skip — it only reports, so it is safe ahead of both.
 * ⚖️ D3b, FIX ROUND 2 (re-review of `d908de394`, notes NN-1 to NN-4): no frozen
 * file touched. `queuedWorkToAdopt` (`recoverLocalState.js`) refuses to adopt a base
 * with no BODY, the key residual (b) uses, instead of the `bodyUnknown` flag the
 * durable store drops (`f5-fixes-2026-09-23.md` §H).
 * ⛔ Still NOT moved by D3b: the append CALL SITES, `serverChange.js`,
 * `settleNoteWrite.js`, and the classifier. `F5_OPEN` stays true.
 *
 * ⛔ THIS RAIL EXPIRES BY CONSTRUCTION. `F5_OPEN` flips to false the day every
 * cell of the seven-family × six-ordering table is GREEN or NAMED (see the
 * constant's own note — amended 2026-09-13, because "zero INCONCLUSIVE rows"
 * and the ruling's "green or named" disagree about a cell whose limitation is a
 * recorded property of the rig). This file then asserts only that the frozen set
 * is still correctly enumerated — an arming condition that names a state, not a
 * date (`lesson_an_arming_condition_that_names_a_test_expires`).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * ⛔ Flip to false only when every cell of F5's table is GREEN or NAMED.
 *
 * ⚖️ AMENDED 2026-09-13 — owner ruling, recorded without asking because a rail
 * that contradicts a ruling is amended, not obeyed.
 *
 * ⚰️ This read *"zero INCONCLUSIVE rows"*, and the ruling that governs the
 * freeze says it lifts when every cell is **"green or named"** — a cell whose
 * limitation is a recorded, named property of the rig is an ANSWER. But a named
 * limitation renders as `⚠️ INCONCL` in the table (`q1_f5_matrix.py`, the verdict
 * glyph map), so the two sentences disagree about the same rows: as written,
 * this rail would refuse to lift a freeze the ruling permits, forever, because
 * the pdf.js caret limitation is not going to stop being true.
 *
 * ⭐ The distinction that matters, and the reason the old wording was still
 * nearly right: INCONCLUSIVE-because-nobody-looked and
 * INCONCLUSIVE-because-this-rig-cannot-look are different facts wearing one
 * glyph. The first blocks the freeze. The second is recorded in
 * `docs/notebook/q1-product-followups.md` with its mechanism and what it does
 * NOT prevent, and does not.
 *
 * ⛔ "Named" is not a synonym for "unmeasured". A cell may only be counted as
 * named if a limitation is written down for it there; an INCONCLUSIVE row with
 * no named limitation still blocks, which is what keeps this from becoming a
 * way to wave the table through.
 */
const F5_OPEN = true

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const rel = (p) => relative(REPO, p).split(sep).join('/')
const read = (p) => readFileSync(join(REPO, p), 'utf8')

/**
 * The frozen set, as (file, the exact line that opens the door).
 *
 * ⛔ THE LINE, NOT THE FILE. Freezing whole files would stop R-4a and Q2-A,
 * which have legitimate work in `NoteEditorPage.jsx` more than a hundred lines
 * from the excerpt door. The unit of the freeze is the CALL, matched by its own
 * text so a moved line is still found.
 */
const FROZEN_CALLS = [
  ['append_document_excerpt', 'app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx',
    '`/api/j2/notes/${noteId}/excerpts`'],
  ['append_financial_fact', 'app/src/pages/journal-2-0/lib/captureFinancialFact.js',
    '`/api/j2/notes/${noteId}/facts/${fact.id}/insert`'],
  ['append_widget_embed', 'app/src/pages/journal-2-0/lib/captureTargets.js',
    '`/api/j2/notes/${noteId}/embeds`'],
  ['append_widget_embed', 'app/src/pages/journal-2-0/components/AddPositionModal.jsx',
    '`/api/j2/notes/${noteId}/embeds`'],
  ['append_widget_embed', 'app/src/pages/journal-2-0/lib/importer/enrichment.js',
    '`/api/j2/notes/${noteId}/embeds`'],
]

/** The decision code the production measurement will be read against. */
const FROZEN_FILES = [
  'app/src/pages/journal-2-0/lib/offline/serverChange.js',
  'app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js',
]

describe('⛔⛔ Q1-F5 FREEZE — the append doors do not move until they are proved live', () => {
  it('every frozen call site is still exactly where the freeze says it is', () => {
    // ⭐ NON-VACUITY FIRST. A freeze over a set that no longer matches anything
    // is a freeze over nothing, and it would read as protection.
    const missing = []
    for (const [family, file, call] of FROZEN_CALLS) {
      if (!read(file).includes(call)) missing.push(`${family} — ${file} no longer contains ${call}`)
    }
    expect(missing, '⛔ a frozen call site moved or changed shape — re-derive the freeze before merging').toEqual([])
  })

  it('every frozen call site still LANDS its revision', () => {
    // The freeze is about not disturbing proven code; this is the property that
    // code exists for, asserted here too so the freeze cannot be satisfied by a
    // call site that survives in name while losing its settle.
    const unsettled = []
    for (const [family, file, call] of FROZEN_CALLS) {
      const src = read(file)
      const at = src.indexOf(call)
      const window = src.slice(at, at + 4000).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      if (!/settleNoteWrite\s*\(/.test(window)) unsettled.push(`${family} — ${file}`)
    }
    expect(unsettled, '⛔ a frozen append door lost its settle').toEqual([])
  })

  it('the classification and the settle are named, and they exist', () => {
    for (const f of FROZEN_FILES) {
      expect(read(f).length, `${f} is frozen and must exist`).toBeGreaterThan(0)
    }
    // The three shapes are the thing production has not yet confirmed for the
    // append families, so their names are pinned here too.
    const sc = read('app/src/pages/journal-2-0/lib/offline/serverChange.js')
    for (const shape of ['metadata-only', 'append-only', 'body-rewrite']) {
      expect(sc, `the ${shape} shape is part of what F5 must prove`).toContain(shape)
    }
  })

  it('⛔⛔ an APPEND door records its revision and NEVER settles with local state', () => {
    // ⭐ THE PROPERTY RAIL'S MATRIX DEPENDS ON THIS, so it is measured here
    // rather than assumed there. `offlineWordsSurvive.property.test.jsx` clamps
    // every append family to the records-only shape — a `settle-first` append
    // row would model something the product cannot produce, and a rail that
    // models an impossible shape proves nothing about a real one.
    //
    // ⛔ The claim: `settleMetadataRevision` — the ONLY path that hands `current`
    // to `settleLandedSave` — belongs to the metadata doors. An append door calls
    // `settleNoteWrite`, which records the revision and deliberately does not
    // settle ("an editor-only optimisation that needs local state").
    const editor = read('app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx')
    const settles = [...editor.matchAll(/settleMetadataRevision\(await update\(\{\s*(\w+)/g)]
      .map((m) => m[1]).sort()
    expect(settles, 'the settle-with-local-state path belongs to the metadata doors only')
      .toEqual(['folderId', 'tags', 'ticker'])

    const settleSrc = read('app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js')
    const code = settleSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    expect(code, 'settleNoteWrite must RECORD, never settle — the append doors all route through it')
      .not.toMatch(/settleLandedSave\s*\(/)

    // …and no append call site reaches a settle by another route.
    for (const [family, file] of FROZEN_CALLS.filter(([f]) => f.startsWith('append_'))) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      if (file.endsWith('NoteEditorPage.jsx')) continue   // the editor settles for its OWN save
      expect(src, `${family} (${file}) must not settle with local state`)
        .not.toMatch(/settleLandedSave\s*\(/)
    }
  })

  it('⚖️ D3b — the SWEEP’s fork settle passes no `forked`; the one-transaction check is the OWNER’s alone', () => {
    // D3b lifted the freeze for the owner's settle, not the sweep's. The sweep
    // settling with a `forked` check would be a behaviour change the ruling did
    // not make — so the one call site in the drain is pinned, and so is the
    // owner's, which must pass exactly what its sibling holds.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const calls = (file) => [...strip(read(file)).matchAll(/(?<!function\s)settleForkedNote\(([^)]*)\)/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim())
    expect(calls('app/src/pages/journal-2-0/lib/offline/outboxDrain.js'))
      .toEqual(['db, entry.noteId, serverNote'])
    expect(calls('app/src/pages/journal-2-0/lib/offline/useDurableNote.js'))
      .toEqual(['db, noteId, serverNote, { forked }'])
  })

  it('⚖️ D3b fix round 1, residual (c) — the drain reads the base it classifies against in ONE place, and both call sites ask it', () => {
    // The ruling moved the classification's INPUT and nothing else. A second
    // `lastKnownServerCopy(` read in the drain would be a second base, one that
    // could hand a POISONED copy to the classifier again — so the read is pinned
    // to `classifiableBase`, and both deciders (the ring-vouched plan and the
    // diff branch) are pinned to asking it.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const drain = strip(read('app/src/pages/journal-2-0/lib/offline/outboxDrain.js').replace(/\r\n/g, '\n'))
    const reads = [...drain.matchAll(/lastKnownServerCopy\s*\(/g)]
    expect(reads.length, 'the drain reads the last-known server copy in exactly one place').toBe(1)
    const at = drain.indexOf('function classifiableBase(')
    expect(at, 'classifiableBase is defined in the drain').toBeGreaterThan(-1)
    const body = drain.slice(at, drain.indexOf('\n}\n', at))
    expect(body, 'and that one read is inside it').toMatch(/lastKnownServerCopy\s*\(/)
    expect(body, 'which asks recovery’s own authority whether the base may stand').toMatch(/baseMayStandFor\s*\(/)
    expect([...drain.matchAll(/(?<!function\s)classifiableBase\(entry, noteRec\)/g)].length,
      'the ring-vouched plan AND the diff branch both ask it').toBe(2)
    const recover = strip(read('app/src/pages/journal-2-0/lib/offline/recoverLocalState.js').replace(/\r\n/g, '\n'))
    expect([...recover.matchAll(/export function baseMayStandFor\(/g)].length, 'ONE definition, in recovery').toBe(1)
    expect(recover, '…which baseOfRecovered asks too').toMatch(/baseMayStandFor\(at, entry\.baseUpdatedAt\)/)
    // …and the classifier the ruling left alone is still frozen, byte for byte in name.
    expect(read('app/src/pages/journal-2-0/lib/offline/serverChange.js')).toMatch(/export function classifyServerChange\(fresh, base\)/)
  })

  it('⭐ the freeze declares WHEN it lifts, and it has not lifted', () => {
    // ⛔ An arming condition that names a DATE expires quietly. This one names a
    // STATE: every cell of the seven-family × six-ordering table GREEN or NAMED
    // (amended 2026-09-13 — see the constant; a named rig limitation is an
    // answer, an unexplained INCONCLUSIVE is not).
    expect(F5_OPEN, 'F5_OPEN is false — then this file should assert the enumeration only').toBe(true)
  })

  it('⭐ CONTROL — the matcher can tell a settled door from an unsettled one', () => {
    const settled = 'const r = await fetch(`/x/embeds`, {method:"POST"})\nawait settleNoteWrite(id, r)'
    const bare = 'const r = await fetch(`/x/embeds`, {method:"POST"})\nreturn true'
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    expect(/settleNoteWrite\s*\(/.test(strip(settled))).toBe(true)
    expect(/settleNoteWrite\s*\(/.test(strip(bare))).toBe(false)
    // …and a COMMENT about the settle must not count as one.
    expect(/settleNoteWrite\s*\(/.test(strip('// settleNoteWrite(id, r) goes here'))).toBe(false)
  })
})
