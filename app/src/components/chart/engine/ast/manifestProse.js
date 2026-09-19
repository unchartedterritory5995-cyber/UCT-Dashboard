// app/src/components/chart/engine/ast/manifestProse.js
//
// ─── ⭐ THE MANIFEST'S PROSE IS FOR ENGINEERS, AND IT WAS SHIPPING TO MEMBERS ──
//
// About FORTY PER CENT of `closedTable.json` is top-level prose: the rulings that
// explain why `cum` is refused, why an offset may not run forwards, what a vendor
// note may be written from. Every one is load-bearing documentation and none of it
// is read at runtime. It was being parsed and held in memory by every browser that
// loaded the engine.
//
// ⛔ MEASURE THE SIZES, DO NOT QUOTE THEM — `stripProse(TABLE).savedBytes` is the
// one authority and `manifestProse.test.js` floors it. This paragraph read
// "169KB, and 68KB of it" for long enough that BOTH numbers had drifted: measured
// 2026-09-17 the manifest is 248,305 bytes and the strip removes 102,004. Only the
// ratio survived, which is why the ratio is the only figure left in this sentence.
//
// ⛔ THIS IS A BUILD-TIME STRIP, NOT AN EDIT. The file on disk keeps every word —
// it is the repo's most-cited artifact and the Python lane reads the SAME file, so
// the source cannot move. Only the browser bundle is slimmed, and only on `build`:
// tests and dev server see the whole document, because dozens of rails assert on
// exactly this prose.
//
// ⛔⛔ THE KEEP LIST IS EXPLICIT AND THE RAIL IS DERIVED, which is the only safe
// order. A build step that silently dropped a key the code READS would fail at
// runtime, in a browser, with a value that is `undefined` rather than a refusal —
// so `manifestProse.test.js` walks the real source of both lanes for property
// ACCESS (never a bare mention, which matches the comments that name these keys
// constantly) and fails if anything accessed is missing from `KEEP`.

/** Sections that carry the grammar itself. Never stripped, never prose. */
export const STRUCTURAL = Object.freeze([
  'nodeTypes', 'functions', 'scalars', 'series', 'clock', 'operators', 'benchmarks',
])

/** ⭐ THE `_` KEYS THE RUNNING PRODUCT ACTUALLY READS AS DATA — derived once by
 *  walking both lanes for property access, and pinned here so the strip is a
 *  decision rather than a guess. The rail re-derives it on every run.
 *
 *  ⚠️ `_functions_excluded` and `_scalars_excluded` are 41KB of the 48KB kept, and
 *  they stay because `vocabulary.js` serves the formula reference page from them —
 *  a member searching for a name they cannot use is told WHY, and that answer lives
 *  in these two rosters. They are data with prose in them, not prose. */
export const KEEP = Object.freeze([
  '_functions_arg_role_kinds',  // read by interpret.js
  '_functions_excluded',        // read by vocabulary.js
  '_scalars_excluded',          // read by vocabulary.js
  '_benchmarks_scannable',      // read by vocabulary.js
  // ⛔⛔ READ BY `user_definitions.requirement_tags` AND `consumer_refusal`,
  // which is a CONTAINMENT mechanism — it decides whether a fetch-dependent
  // script may reach the screener, the sweep, an alert, a share or a listing.
  // Stripping it does not break those functions, it makes them return NO TAGS,
  // so every guarded script would be ADMITTED. This rail caught exactly that
  // on the day the key was added, which is the whole reason the rail derives
  // the accessed set instead of trusting this list.
  '_requirement_tags',
  // ⛔⛔ READ BY `ast_bind.BIND_TIME_CLOCK`, WHICH DECIDES WHETHER A COMPUTED
  // WINDOW LENGTH FOLDS AT ALL. Stripping it does not break the fold pass — it
  // makes the roster EMPTY, so `timeframe.isweekly ? lenWeekly : lenDaily` stops
  // folding and every script using one refuses `resolve:window` in production
  // while passing every test here. ⚠️ The direction is fail-CLOSED (a refusal,
  // not a wrong number), which is the safe half — and still a whole capability
  // silently absent from the shipped bundle. Third key this rail has caught.
  '_bind_time_constants',
  // ⛔⛔ READ BY `pine.js`, WHICH DECIDES WHICH `barstate.*` NAMES THE HOST
  // CONTRACT SERVES AND WHICH ONE IT REFUSES BY NAME. Stripping it empties the
  // rosters: the six shipped names stop resolving on a pane — a member's script
  // refuses for a capability that IS built — and `isnew` loses the sentence that
  // tells its author why per-tick evaluation is a different question. Fourth key
  // this rail has caught, and the first one it caught by failing the BUILD
  // instead of by somebody noticing.
  '_barstate',
  // ⛔⛔ READ BY `parse.js::foldNotesOf` AND `PineBox`, AND IT IS THE ONLY COPY OF
  // THE SENTENCE. `_folds` carries the member-facing note for a TRANSLATOR-LEVEL
  // fold — a divergence with no table function to hang a `vendorNote` on. Stripping
  // it does not break a computation, which is exactly why it would ship: every
  // number stays right and the member is simply never told that their
  // `request.security` became the chart's own series. That is the failure the
  // divergence roster calls "merely KNOWN", arriving through the build.
  '_folds',
  // ⭐ THE SENTENCE AND THE FLOOR. `_tables_fit` carries the note a member reads
  // when a table had to be SCALED to fit a phone (R-R), plus the 9px readable
  // floor the layer scales down to. Stripping it would not break the fit — it
  // would make a scaled table SILENT about being scaled, which is the same
  // failure shape as `_folds` and `_alertconditions`: the member sees a number
  // rendered differently from the author's script and is never told why.
  '_tables_fit',
  // ⛔⛔ READ BY `parse.js::alertNotesOf` AND `PineBox`, AND IT IS THE ONLY COPY OF
  // THE SENTENCE. `_alertconditions` carries the note a member reads when the HOST
  // lane declines to draw an `alertcondition` (ruling D1, option C). Stripping it does
  // not change one number and does not change which column a pane selects — the lane
  // split is in `chooseOutput` — so every test stays green and the member is simply
  // never told where their alert went. Same failure shape as `_folds`, one ruling later.
  '_alertconditions',
  // ⛔⛔ READ BY `parse.js::INPUTS_ARE_FOLDED` AND `ast_table.INPUTS_ARE_FOLDED`,
  // WHICH DECIDE WHETHER A WINDOW NAMING A MEMBER'S KNOB IS BOUNDED AT ALL
  // (ruling R-J). Stripping it makes the constant fall back to its safe reading —
  // `false` — so every `ta.sma(v, lenDaily)` becomes unanalysable, every script
  // using one is branded `repaints`, and `canSaveFormula` refuses it. That is
  // fail-CLOSED, which is the direction that ships silently: no wrong number, no
  // crash, just a capability absent in production while every test stays green.
  '_input_windows',
])

/**
 * The manifest with its unread prose removed.
 *
 * ⛔ CONSERVATIVE BY CONSTRUCTION: it drops ONLY top-level keys that begin with
 * `_` and are not in `KEEP`. A per-entry `sentence` is never touched — those are
 * 9.7KB and they are what the read-back says to a member, so they are runtime data
 * by definition.
 *
 * @param {object} table the parsed manifest
 * @returns {{table: object, dropped: string[], savedBytes: number}}
 */

/** ⭐⭐⭐ THE `_` KEYS THAT ARE PROSE, LISTED RATHER THAN INFERRED.
 *
 *  ⛔⛔ THIS LIST EXISTS SO THE STRIP CAN FAIL LOUD. Until 2026-09-09 the rule
 *  was *"drop any `_` key not in KEEP"*, and three times a new key the product
 *  READS was added and would have shipped missing — `_requirement_tags` (the
 *  containment flag: stripped, every guarded script is ADMITTED),
 *  `_bind_time_constants` (stripped, no window folds) and one more before them.
 *  Each was caught by a rail, by hand, after the fact.
 *
 *  ⛔ AN ALLOWLIST THAT SILENTLY DISCARDS IS HOW A WHOLE CAPABILITY SHIPS
 *  MISSING. The rail that catches it is real and stays — but it is a second
 *  chance, and the first chance should not be *"somebody remembers to run the
 *  frontend suite"*. With both lists explicit, a key in NEITHER fails the BUILD
 *  and names itself, so the author registers it in the same commit that adds it.
 *
 *  ⚠️ THE COST IS DELIBERATE: adding any top-level `_` key to the manifest now
 *  breaks the build until it is registered here as data or as prose. That is one
 *  line of work at the moment of writing, against a capability silently absent
 *  in production — and the failure is at build time, on the author's machine,
 *  naming the key.
 */
export const DROP = Object.freeze([
  // ⚰️ `_` — THE DOCUMENT'S OWN HEADER, 1,176 CHARACTERS OF PROSE, AND THE SECOND
  // PASSENGER FOUND THE SAME HOUR. Its entry read `// the document's own header,
  // read server-side`, and no lane reads it: there is no `["_"]`, no `get("_")`
  // and no `._` access to the top-level key anywhere in `app/src` or `api/`.
  //
  // ⭐ WHAT JUSTIFIED IT WAS A SENTENCE. `api/services/user_definitions.py:1022`
  // is a DOCSTRING containing the text `` `_requirement_tags._` ``, and the access
  // pattern for a one-character key (`\.\s*_\b`) matches the `._` in it. The rail
  // stripped `//`, `/*` and `#` comments but not docstrings, so prose inside a
  // triple-quoted string was read as code. ⚠️ And the citation was wrong TWICE:
  // the `_` that sentence names is a key NESTED INSIDE `_requirement_tags`, not
  // this top-level header — while the sentence itself is explaining a rail that
  // AST-walks docstrings.
  //
  // ⛔ THE STRIPPER IS WHERE THIS WAS FIXED, NOT THE LIST. Dropping `_` alone
  // would be the third fix in this family to correct an instance and leave the
  // class — the filename fix of 2026-09-09, the visibility fix of 2026-09-17, and
  // then this. `withoutComments` now removes docstrings and template-literal prose
  // in BOTH lanes, keeping `${…}` interpolations because those hold real accesses.
  // Measured over the 57 admitted files before it was applied: exactly one key
  // leaves the accessed set (`_`) and none enters.
  "_",
  // ⚰️⚰️ `_clock` STOOD IN `KEEP` AND WAS A PASSENGER — 3,567 CHARACTERS OF PROSE
  // SHIPPED TO EVERY BROWSER, JUSTIFIED BY THE RAIL'S OWN FALSE HIT. Its entry
  // read `// read by api/services/readiness.py`, and `readiness.py:82` is
  // `self._clock = clock` — a constructor-injected monotonic clock for a startup
  // deadline probe, in a file that contains no reference to this manifest at all
  // (`grep -c closedTable api/services/readiness.py` → 0). The same generic name
  // is `self._clock` in `discord_render/loopwatch.py` and
  // `journal_two/broker/rate_limit.py` too; none of the three has anything to do
  // with the Pine clock.
  //
  // ⭐ WHAT MAKES IT WORTH THIS MANY LINES: somebody saw the rail report `_clock`
  // as ACCESSED, went looking for the reader, found the file the false hit came
  // from, and WROTE THE FALSE HIT DOWN AS THE JUSTIFICATION. The comment cites a
  // real file that really contains the string, so it reads exactly like evidence
  // and survived every review since — `lesson_a_comment_claiming_agreement_is_not
  // _agreement`, and the invented-citation class in one. A citation you cannot
  // quote is struck: quote the ACCESS, not the file name.
  //
  // ⛔ THIS IS THE SECOND HALF OF THE SAME DEFECT the scan narrowing fixed in
  // `manifestProse.test.js`, and the header there predicted it in those words —
  // "a false read admits prose to the bundle AND excuses it". Narrowing the scan
  // to files that can see the manifest turned the first half green and made this
  // half fail, which is the rail working: it fails in BOTH directions or it is
  // not a rail. Found by the 223-commit merge of 2026-09-17.
  //
  // ⚠️ The prose itself is not lost — this is a build-time strip and the file on
  // disk keeps every word, which is where `clock_parity.json` and the EDT→EST
  // ruling it records are cited from.
  "_clock",
  // ⭐ R-K (2026-09-13). Prose: the limits this engine has, each with the case
  // that found it. Read by engineers, never by the product — so it DROPS, and
  // a member never receives a paragraph about `or` evaluation.
  "_engine_limits",
  "_shape",
  "_canonical",
  "_no_offset",
  "_no_offset_reopened_by",
  "_sentence",
  "_functions_indicators",
  "_functions_atr_convention",
  "_functions_arg_roles",
  "_functions_warmup",
  "_functions_na",
  "_functions_rounding",
  "_functions_smoothing",
  "_functions_recurrence",
  "_functions_bar_readers",
  "_functions_arg_extreme",
  "_functions_bounded_state",
  "_functions_pivots",
  "_functions_domain",
  "_functions_hull",
  "_functions_cumulative",
  "_functions_vendor_note",
  "_booleans",
  "_yields",
  "_scalars",
  "_scalars_node",
  "_scalars_as_of",
  "_scalars_freshness",
  "_scalars_totality",
  "_session",
  "_functions_math",
  "_functions_sum_dev",
  "_benchmarks",
  "_functions_vendor_parity_resolutions",
  // ⚰️ `_clock_barstate` STOOD HERE AND IS GONE — CORRECTLY, AND ITS SUCCESSOR
  // MUST NOT REPLACE IT. That key was a flat prose STRING: one note arguing why
  // `barstate.*` are columns rather than folds, which the running product never
  // reads. Its successor `_barstate` is a DATA object — `pine.js` derives
  // `BUILTIN_BARSTATE_SERIES` and `BUILTIN_BARSTATE_REFUSED` from its `extent`,
  // `realtime` and `refused` rosters, and `clockTimeframeWire` reads it too — so
  // dropping it would strip the roster the door is built from.
  // ⛔ RENAMING THE ENTRY WAS THE OBVIOUS EDIT AND IT WAS WRONG: it put one key
  // in KEEP and DROP at once, which `manifestProse.test.js` catches by name. The
  // prose INSIDE `_barstate` (`_`, `_the_two_ingredients`, `_the_tri_state`, …)
  // is still stripped — every one of those is underscore-prefixed and handled by
  // the ordinary nested rule. Full argument: docs/pine/barstate.md.
])

export function stripProse(table) {
  const out = {}
  const dropped = []
  const unregistered = []
  let savedBytes = 0
  for (const [key, value] of Object.entries(table)) {
    if (!key.startsWith('_')) { out[key] = value; continue }
    if (KEEP.includes(key)) { out[key] = value; continue }
    if (DROP.includes(key)) {
      dropped.push(key)
      savedBytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
      continue
    }
    unregistered.push(key)
  }
  // ⛔⛔ FAIL THE BUILD, NAMING THE KEY. The old behaviour dropped it and said
  // nothing, so a key the product reads shipped as `undefined` in a browser —
  // three times. There is no case for tolerating an unknown key here: every one
  // is either data the runtime reads or prose for engineers, and only the person
  // adding it knows which.
  if (unregistered.length) {
    throw new Error(
      `closedTable.json has ${unregistered.length} top-level key(s) that `
      + `manifestProse.js does not classify: ${unregistered.join(', ')}.
`
      + 'Add each to KEEP (the running product reads it — stripping it would ship '
      + 'a capability missing) or to DROP (prose for engineers, safe to strip from '
      + 'the browser bundle). The file on disk keeps every word either way; this '
      + 'decides only what the browser is sent.')
  }
  return { table: out, dropped, savedBytes }
}
