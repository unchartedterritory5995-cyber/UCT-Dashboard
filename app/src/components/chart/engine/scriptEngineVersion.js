// app/src/components/chart/engine/scriptEngineVersion.js
//
// ─── ⭐⭐ THE SCRIPT ENGINE'S VERSION — ONE NUMBER, ONE PLACE ─────────────────
//
// A member's saved Pine script is stored as the TRANSLATED document the engine
// produced on the day they saved it (`compute.*`, `objects`, `meta.blockRuns`, …)
// plus — since this module — the script itself, in its own server column
// (`api/services/user_definitions.py::MAX_PINE_SOURCE_BYTES`). This number is
// stamped on every document a SCRIPT door writes (`meta.engineVersion`), so a
// later browser can tell "translated by an older engine" from "current" without
// translating anything.
//
// ⛔⛔ WHEN TO BUMP IT — and this is the whole contract:
//   Bump `SCRIPT_ENGINE_VERSION` by one in the SAME commit as any engine change
//   that alters what the translator WRITES for an unchanged script: a value it
//   now computes differently, a plot it now withholds or refuses (C45/C48's
//   `blockRuns` are the model), a new stamp a reader depends on. A change that
//   only alters how an EXISTING document is drawn needs no bump — every chart
//   already draws it with today's code.
//   What a bump does: on each member's next chart load, every saved script
//   document stamped below it that holds its source is re-translated ONCE in the
//   browser, drawn from the new translation, and written back through the
//   ordinary revision-guarded save (`savedScriptUpgrade.js`). The next load sees
//   the new stamp and does no work. Documents saved without their source get the
//   one quiet "Updated accuracy available" row in their legend menu instead.
//   ⛔ Never bump it for a change that does not move translator output: every
//   bump costs one translation + one write per saved script per member.
//
// ⛔⛔ ENGINE BUMP RUNBOOK — read before AND after every bump.
//   • ⭐ BUMP ONE NUMBER: this one. The server (the alert/scan/backtest lanes have no
//     browser to ask) READS this declaration (`user_definitions.read_script_engine_version`;
//     keep it `export const SCRIPT_ENGINE_VERSION = <n>` on one line — any other shape
//     reads as unreadable, and unreadable fails CLOSED: every recorded refusal binds).
//     ⛔ Do not add a server literal back: that is the drift this replaced.
//   • A TRANSLATOR REGRESSION CAN MARK GOOD SCRIPTS 'refused' SERVER-SIDE. A browser
//     running the bumped engine records each refusal (`definition_engine_status`, with
//     the engine number that refused), and every server lane — alerts, scans, backtests —
//     then WITHHOLDS that definition by name, for every device. A save that does not come
//     from the script path (stamped >= the refusing engine, script attached) CARRIES the
//     refusal to the new version, refusing engine and all; so do a fork, a share install
//     and a delete/resurrect.
//   • A VERDICT (RECORDED OR CARRIED) BINDS ONLY WHILE ITS ENGINE IS TODAY'S. Browser
//     (`savedScriptUpgrade.upgradeKindOf`) and server (`engine_withheld_reason`) answer
//     identically once this number moves past it:
//       – a version that HOLDS its script stays held until today's engine re-answers: the
//         member's next chart load re-translates it (accepted → written back from the
//         script path, lifted; refused → a new verdict at today's number);
//       – a version WITHOUT its script (a studio / Formula hand edit of a refused script,
//         a share-installed copy) EXPIRES and runs as stored ONLY WHEN ITS MATHS DIFFERS
//         from the refused maths (the server's `same_maths`, from the store's maths
//         identity). A no-op Undo, a presentation-only studio save or a share install
//         carries the refused calculation unchanged and STAYS HELD until it is saved from
//         a script today's engine accepts. Chosen over carrying the script forward:
//         re-translating the ancestor's script would overwrite the member's hand edit
//         (the L2 rule — a hand edit is the member's own maths).
//       – a `write-failed` (the store refused the write-back, e.g. a 422 repaint ack)
//         NEVER clears an older refusal: the alerts keep withholding the stored maths and
//         the chart draws today's translation, without PUTting it again, and offers the
//         Builder.
//   • ⛔ A SCRIPT-HOLDING VERSION WHOSE MEMBER NEVER OPENS A CHART STAYS WITHHELD
//     SERVER-SIDE INDEFINITELY. Only a chart load re-translates it; until then every
//     alert, scan and backtest on it is withheld by name. Nothing on the server re-asks.
//     Owner follow-up, not built: "server-side upgrade for members who never open a
//     chart" (re-translate in the pod with the shipped translator, or notify the member).
//   • RECOVERY IS TO SHIP ANOTHER BUMP (the fixed translator with this number + 1). Every
//     refused script is re-asked on its next chart load (see the bullet above for a
//     member who never opens one), and every scriptless carry whose maths differs from
//     the refused maths expires.
//   • AFTER EVERY BUMP, CHECK THE REFUSED COUNT: in the web pod, against
//     user_definitions.db, `SELECT engine, COUNT(*) FROM definition_engine_status WHERE
//     status='refused' GROUP BY engine` — a jump on the new engine is a regression signal,
//     not a population of bad scripts. (Read-only; never DELETE from that table — the
//     next bump is the fix.)
//
// ⛔ IT IS NOT `memberDocumentMigration.DOOR_VERSION`. That number versions the
// band-opacity RULE a door applied (its rule table must carry an entry per
// version, railed), and a document's bytes can be repaired from it without the
// script. This one versions the TRANSLATOR as a whole and can only be acted on
// with the script in hand. Two questions, two numbers.

/** 1 = the first stamped engine (C45/C48 `blockRuns` withholding is in it). */
/** 2 = the first real bump (2026-11-02): saved scripts re-translate once with every engine
 *  change merged since 1 was stamped (#610), now that refusals are remembered (#673). */
/** 3 = P3 WS-A: the C18 object door refuses by name the master-wrong block shapes (readSelf,
 *  v6 unmatched bool, moved for-bound, continued switch arms). */
/** 4 = the plot lane withholds a var filled from a ta.* call in a block that skips (C48);
 *  a function reading a var written later is refused; hiding colours withhold the whole output. */
/** 5 = W1: Pine v4-v6 builtin names and lookback reads (#736). */
/** 6 = W4 T4: a v6 root `?:` arm with sma/ema/rma/change runs only when chosen; a `?:` off the
 *  column route no longer steps unchosen arms every bar (now refused by name). */
/** 7 = W4-T3 (train): session/timeframe text fixed before bar 0 (own timeframe via a parameter, joined texts, an unreassigned var) is served on the runtime lane */
/** 8 = W3 (train): refusals name their text shape; a {N} message number that rounds across a digit (999.9996 -> 1000) is withheld */
/** 9 = W4-T7 (train): an expression's own series inside a function body (per call site) is served instead of refused */
/** 10 = W4-T2 (train): simple-qualifier folding (reassignment under an invariant test, an unreassigned var, arithmetic over an input) serves values where it refused */
/** 11 = W4-T9 (train): offsets bounded by simple values and frame parameters are served */
/** 12 = W4-T8 (train): series int window lengths (v5 and v6) are served on the runtime lane */
/** 13 = W4-T10 (train): state kernels over runtime values (ta.cum, 3-arg pivothigh/low, ta.stoch, ta.vwap(source)) are served */
/** 14 = W4-T11 (train): runtime text values are served on the runtime lane */
/** 15 = W4-T12 (train): paint typing: colours proven through blocks, functions and colour arrays; fill() over a ?:-chosen plot id */
/** 16 = W4-T13 (train): plotcandle / plotbar are served (OHLC payload from four columns; colours a call omits stay withheld) */
/** 17 = W4-T15 (train): function and statement forms (named/default user args, one-line binding bodies, loop-end values, log.* statements) are served on the runtime lane */
/** 18 = W6-T3a: one static type descriptor per value; runtime lane serves matrix./map. method forms and some former refusals */
/** 19 = W6-T2: v3/v4 `method` is a callable name and keyword misreads are refused by name rather than served */
/** 20 = W6-T6: `for … in` over arrays and line/box/label.all is served on the runtime lane (one shared walk rule) */
/** 21 = W6-T5: array.* reference-formula members are served on the runtime lane; unpinned conventions are refused by name */
/** 22 = W34-I6a: a `switch` arm that wraps onto a continuation line is served on the runtime lane; an arm mixing wrap and block lines is refused by name */
/** 23 = W34-I4b: a v1/v2 (or no-pragma) self-reference's bar 0 on a run from the listing is withheld unless both seeds (na, 0) agree, not guessed */
/** 24 = W34-I4: a v1/v2 self-referencing definition whose every self read is `nz(x[k])` runs as a slot on the runtime lane instead of refusing `pine:state` */
/** 25 = W34-I6c: v4 per-bar window lengths (highestbars/lowestbars and the series-int family) are served on the runtime lane; v1-v4 bare highestbars/lowestbars give Pine's <=0 offset */
/** 26 = W6-T7: matrix.* members are served on the runtime lane (gated at the object door) */
/** 27 = W6-T9: receiver types (overloads by receiver type, chains, members on typed receivers, a record's shallow copy) are served on the runtime lane; the object door keeps master's answer */
/** 28 = W6-T8: map.* members are served on the runtime lane (gated at the object door) */
/** 29 = W34-I6b: v6 bool-residue items 1, 2 and 4 are served on the runtime lane; the object door keeps Q-A3 */
/** 30 = W6-T10: `enum` declarations and `input.enum` are served on the runtime lane; the object door is unchanged */
/** 31 = W6-T6-N1b: two indirect for-in shapes that served without a capture now refuse by name (Q-W6T6-H); runtime lane only, the object door is unchanged */
/** 32 = W6-T10-N: v5 enum names footprint/volume_row and capitalised enum names serve per the manual's case-sensitivity; runtime lane only, the object door is unchanged */
/** 33 = RULING-0927: input.time serves only its T16 default form on the host lane (other forms refuse by name); barstate.isnew stays refused with a sharper reason */
/** 34 = I6a-N4: a block body at a non-multiple-of-4 indent refuses pine:indent with the manual's reason, on both lanes and the door */
/** 35 = PT-GAPS: six host-lane engine gaps (L3, L4, L6, G-c, G-d, G-h) fixed per existing captures; G-f and G-i queued as Q-PT6/Q-PT7 */
/** 36 = HONESTY-SWEEP: the 2026-11-07 honesty sweep (probes vw-hs1..hs7; see docs/pine/evidence/2026-11-07-honesty-sweep) */
/** 37 = STRAT-COLOR: a `strategy.*` read reaching a plot's presentation (colour) or a drawing step is withheld by name (`pine:strategy-call`); the broker is not simulated */
/** 38 = DELETE STACK (IDX-DELETE, CHAINED-REMOVAL, UDT-FIELD-CREATES, SILENT-CREATE-GAPS) + STRAT-NOTE: object removals and creates the chart cannot follow are withheld and named; a drawing withheld for a strategy read says why (see the lanes' EVIDENCE) */
/** 39 = W9 BROKER INTEGRATION (T4 sizing, T6 fill timing, T7 exits, T13a broker report, N7): the strategy broker's integration lands; see the lanes' EVIDENCE */
/** 40 = W9-T12 trade markers, W9-T13b report panel, NO-GUARD-IDS (guard ids hidden on member surfaces except the Pine editor); see the lanes' EVIDENCE */
/** 41 = W9 T5 costs, T8 risk, T4-F1 min-contract source, T11-F1 chart window, T7-F1 order log; see the lanes' EVIDENCE */
/** 42 = CUM-OFF-LISTING: off-listing running totals (ta.cum/obv/pvt/wad/accdist/nvi/pvi) are withheld by name unless they cancel (served member output changes; translator output unchanged); with DIV-1 harness warm-history grading */
/** 43 = LIMITS: runtime limit refusals say their limit in plain words, and the stopping bar number is fixed (member-visible sentences); the service does not emit `limit` (EMIT_REFUSAL_LIMIT=false) */
/** 44 = VAR-OFF: off-listing `var` values that cannot be known are withheld by name, with new sentences (member-visible output); see the lane's EVIDENCE */
/** 45 = DIV-4 paint/colour: translator output changes for paints with a foldable non-literal offset (HP-1 does not digest paints); runtime colour reasons name their limit */
/** 46 = LANE2 (fix/pine-b0-na-seed): the B0 `na` seed lane, with its N1 version gate; see docs/pine/evidence/2026-11-10-lane2-b0/EVIDENCE.md */
/** 47 = OZ stack: DIV-3 table.cell replace + W-C22-DEL withheld deletes/collector + OZ silent-zero naming */
/** 48 = `x = na(x[k]) ? na : U` refuses `pine:cycle` by name in every version and both lanes (LANE2-r1r3 N1 v1/v2, N3 v3+); see docs/pine/evidence/2026-11-11-engine48-na-self-ref/EVIDENCE.md */
/** 49 = a v3+ declaration that reads its own history (`x = … x[k] …`, not declared before) refuses `pine:cycle` by name in both lanes (review ENG48-1096 note 4, N2); v1/v2 unchanged; see docs/pine/evidence/2026-11-11-engine49-v3-self-ref/EVIDENCE.md */
/** 50 = the four doors agree on a v3+ self-referencing declaration: the host walk refuses `pine:cycle` by name whether or not anything reads it (an unread one, one read only through `color=`, one in an uncalled function), a variable named after an earlier user function, and a block-valued `x = if/switch …` whose block reads `x[k]` (review ENG49-1122 notes 1-3, 6); a runtime drawing stop with no named guard says one plain sentence (OZ N-2); v1/v2 unchanged; see docs/pine/evidence/2026-11-11-engine50-doors-agree/EVIDENCE.md */
/** 51 = drawing objects placed and styled as Pine does: table.cell positional order (slots 7-9 after the address are text_size, bgcolor, tooltip); every named argument of a table/setter/clear/merge call placed by its Pine name (placeObjectArgs; setter names from objectSetterParams, both lanes); every style/size/extend/xloc/yloc/align/position constant from one table (objectEnums, v4 label style aliases included); the withhold rule — an enum slot this door cannot read, or an integer point text size, withholds its drawing by name, never draws a default; and the drawing lane reads a value fixed before bar 0 through a var over inputs/literals, a switch keyed by named string consts, `pos = switch …` then `pos`, and a default reassigned in the arms; see docs/pine/evidence/2026-11-12-engine51-cell-order/EVIDENCE.md */
/** 52 = serve, never default: v6 int point text sizes served on the words' scale (labels, boxes, cells; both lanes; v2-ungraded); the static reader reads numbers, colours (C44 color.new/rgb, C46 from_gradient), UDT fields, str.* and bounded helper loops before bar 0; a colour/width/count/tooltip it cannot read withholds its drawing by name (pine:prop-unreadable), never drawn at the default; see docs/pine/evidence/2026-11-12-engine52-serve-never-default/EVIDENCE.md */
/** 53 = (follows 52, fix/pine-engine52-serve-never-default) the run half: a host-OK script whose object program lost drawings (objectLoss partial / removes) carries compute.runtimeObjects = {source, outputs, ...runtimeVersionStamp} on its kind 'ast' document (precedent DIV-4 compute.runtimeColours), minted only with the runtime pane on, the script graded, killed-free, repaint-stated, the run building its drawings with no request / na test / broker, and every visible host row paired one to one (pairRunRows, one function for both lanes); at bind (nativeRegistry.withRunHalf) the run's drawings replace the host program's only when every gate passes on every run (build flag, latch, kill list + served stamp, allowlist + served stamp, runtime.error, at-defaults, run ok, no withheld family the host draws) AND the column rail holds (each mapped run column equals the host column on every served bar); pending draws an empty object layer, refused keeps the host picture with a sentence; schema client defSchema.runtimeObjectsErrors = server presentation_schema._check_runtime_objects; stamp_served reaches ast rows with runtimeObjects / runtimeColours; see docs/pine/evidence/2026-11-12-engine53-run-half/EVIDENCE.md */
/** 54 = the run half's OBJECT RAIL: both lanes name a drawing's source call (objectProgram.objectSiteKey, <line>:<column> of its .new / .copy token; host per create site via translation.objectDiagnostics[OBJECT_SITE_SOURCES], run per object via objectStore site), the door mints compute.runtimeObjects.sites (host site -> source call, declining run-half:site-unpaired when a host site has no call the run lowers as the same family) and stamps programSha256 / programGraphSha256 (runHalfProgram.js: trees or graph + object program + outputs + sites + source hash); at bind withRunHalf refuses run-half:program-unbound when the document no longer digests to its stamp, and after the column rail runs the object rail (runHalfObjectRail.js, registered through runHalfRailSeam.js, run-half:rail-not-loaded when absent): every host-drawn create site's run objects equal the host's (counts per site, creation order, created bar, the drawn row to the price tolerance policy) or run-half:object-rail / run-half:host-object-withheld; nothing comparable is run-half:no-comparable-objects unless the Part 2 evidence hook admits the script (2+ objects-v2 runtime-on MATCH captures); refusals are counted per document session and beaconed {code, hash} (runHalfTelemetry.js, POST /api/pine-runtime-telemetry/run-half); see docs/pine/evidence/2026-11-13-engine54-object-rail/EVIDENCE.md */
/** 55 = (assigned at merge: master + 1) the LENIENT (screener) lane refuses a block local's history read by name: `x[k]` (k >= 1) of a name declared in an `if` block that does not run on every bar refuses `pine:block` with `Resolver.blockLocalHistory`'s sentence (the previous RUN, capture `vw-call-site-history` C05 / D03), where it read the previous BAR through `barOffsetNode` (s10 probe `vw-w3n-draw-block-history-d`: 169 of 315 RDDT bars wrong, bar 2 vendor 100.88 vs 92); a block that runs exactly once reads `na` as the strict lane does (A12); a top-level name's history, a block local read without history and a block that runs on every bar are unchanged; the strict lane, the object pass and the runtime lane are unchanged; rails ast/lenientBlockLocalHistory.test.js */
/** 56 = (follows 55, the lenient lane's block-local history refusal, #1326) HONEST HTF + NAMED GAPS: Pine's look-ahead-off request.security(…, 'W'|'M') translates to `tf_merge` (TradingView's merge: the period's value on the bar that closes it, read off the next bar; the newest finished bar withheld by name `request:htf-newest-unconfirmed`; formula `tf` unchanged; the `htfLookaheadOffStepBacks` disclosure deleted; scans/alerts and formula documents refuse `tf_merge` by name); an other-symbol spelling no binding can serve (bare index/pair/foreign, punctuation) refuses ONLY the plots that read it, by name (columnErrors {guard: pine:request, code: other-symbol:bare / class-share}, one sentence at every door; the other plots are drawn, and a copy saved at 54 upgrades), a foreign exchange / unparseable spelling is refused by name in both lanes (other-symbol:venue-foreign), and a plot reading a ticker the bind refused is refused by name instead of an all-na column; a finished newest daily bar that certainly closes its week/month is served, and off the listing the first period is withheld by name (request:htf-first-period-partial); a partly drawn object family whose ops read a value the run could not compute is named objects:not-computable with a count, and an unserved run half says why; see docs/pine/evidence/2026-11-14-engine55-honest-htf/EVIDENCE.md */
/** 55 = COND-TA (U2; ⛔ NUMBER PENDING: renumbered to master + 1 at the go, with PINE_IMPORT_FIX_ENGINE; follows the lenient block-local hotfix #1326, the 55 above): a `ta.*` call that runs only on some bars is exact or refused by name on every door. The screener lane (translatePine default, the Import tab's Apply) refuses each such value `pine:block` by name (it served the every-bar number: 242 of 635 bars wrong against vw-call-site-history C03); Pine v1-v4 bare calls (`sma(…)`) are history calls on the host, object and Python lanes (gap G-b: a v4 block or arm was drawn off every bar), and v1-v4 `?:` arms are stamped (the v4 User Manual documents the arm as lazy); the runtime lane serves bare calls per call site in v4 only (v1-v3 refuse runtime:conditional-history); the registry's conditional-ta row is conformant; see docs/pine/evidence/2026-11-15-cond-ta/EVIDENCE.md */
export const SCRIPT_ENGINE_VERSION = 56

// ⭐⭐ COND-TA (coordinator ruling 2026-11-15) — THE PINE-IMPORT HOLD.
// A screen or alert saved by the Import tab's APPLY is a FORMULA document: the translated text,
// with no script kept (no `pine_source`) and no engine stamp, so an engine bump never reaches it
// (`savedScriptUpgrade.upgradeKindOf` answered `none`). Before COND-TA the screener lane that wrote
// those formulas served a `ta.*` call that runs only on some bars as its EVERY-BAR number (242 of
// 635 RDDT bars wrong, `vw-call-site-history` C03), and #1326's block-local `x[1]` the same way.
// Which saved formulas hold such a shape cannot be told for certain without the script, so a Pine
// import with no script, applied before this engine, whose saved trees are a STRUCTURAL CANDIDATE
// (`conditionalHistoryCandidate`) is WITHHELD BY NAME on the chart and on every server lane
// (`pineImportHeld`, the twin of `user_definitions.py::pine_import_stale`, which reads THIS
// declaration): `PINE_IMPORT_HELD_SENTENCE`. Re-applying the import stamps `importedFrom.engine`
// with today's engine (`BuilderSheet.applyProvenanceFor`), which lifts it.
// ⛔ It is the engine that LANDED COND-TA: renumber it with that bump (it equals the number of the
// history line that begins "55 = COND-TA"; `pineImportHold.test.js` and the Python twin hold both).
// Keep it `export const PINE_IMPORT_FIX_ENGINE = <n>` on one line: the server reads it.
export const PINE_IMPORT_FIX_ENGINE = 55

/** What the member reads where a held Pine import would have been drawn or evaluated. */
export const PINE_IMPORT_HELD_SENTENCE = 'This script was imported from Pine before a calculation fix. '
  + 'Re-apply the import to update it.'

/** ⭐ NARROWED (coordinator ruling after the #1326 review, 2026-11-15): only a STRUCTURAL
 *  CANDIDATE is held — a document whose saved trees could be one of the shapes the old screener
 *  lane misread: a CALL under an arm of a `?:` (an `if` block and an `if` expression print as
 *  one) or of `iff(c, a, b)`, or an OFFSET under a `?:` arm (a block local's `x[1]`, #1326).
 *  Prod (read-only, 2026-11-15): 3 current Pine Apply saves, 1 such candidate. Every other Pine
 *  import is served as before. Walks the canonical trees (`compute.ast`, `compute.trees`),
 *  never the script. */
export function conditionalHistoryCandidate(def) {
  const compute = def && typeof def === 'object' && def.compute && typeof def.compute === 'object' ? def.compute : null
  if (!compute) return false
  const roots = [compute.ast, ...(compute.trees && typeof compute.trees === 'object' ? Object.values(compute.trees) : [])]
  const seen = new Set()
  // `armOffsets`: an offset counts under a `?:` arm only (the ruling's shape), a call under any arm
  const walk = (n, inArm, inTernaryArm, d) => {
    if (!n || typeof n !== 'object' || d > 256) return d > 256   // fail closed on a tree too deep to read (the server's bound)
    if (Array.isArray(n)) return n.some((x) => walk(x, inArm, inTernaryArm, d + 1))
    if (seen.has(n) && !inArm) return false
    seen.add(n)
    if (inArm && n.type === 'call') return true
    if (inTernaryArm && n.type === 'offset') return true
    const args = Array.isArray(n.args) ? n.args : null
    const ternary = n.type === 'op' && n.name === '?:' && args && args.length === 3
    const iff = n.type === 'call' && String(n.name || '').toLowerCase() === 'iff' && args && args.length === 3
    if (ternary || iff) {
      const arm = (a) => (a && typeof a === 'object' && a.value !== undefined && !a.type ? a.value : a)
      if (walk(arm(args[0]), inArm, inTernaryArm, d + 1)) return true
      return walk(arm(args[1]), true, inTernaryArm || ternary, d + 1) || walk(arm(args[2]), true, inTernaryArm || ternary, d + 1)
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'tok' || k === 'endTok' || !v || typeof v !== 'object') continue
      if (walk(v, inArm, inTernaryArm, d + 1)) return true
    }
    return false
  }
  return roots.some((r) => walk(r, false, false, 0))
}

/** Is this stored row a Pine import with no script, applied before `PINE_IMPORT_FIX_ENGINE`,
 *  whose trees are a structural candidate (`conditionalHistoryCandidate`)? `row` is a store row
 *  (`definition`, and `pine_source` / `has_pine_source` when it holds its script). Reads
 *  provenance and the saved trees only — never the script. */
export function pineImportHeld(row, fixEngine = PINE_IMPORT_FIX_ENGINE) {
  const def = row && typeof row === 'object' ? row.definition : null
  const meta = def && typeof def === 'object' && def.meta && typeof def.meta === 'object' ? def.meta : null
  const imp = meta && meta.importedFrom && typeof meta.importedFrom === 'object' ? meta.importedFrom : null
  if (!imp || String(imp.dialect || '').toLowerCase() !== 'pine') return false
  if ((typeof row.pine_source === 'string' && row.pine_source.trim()) || row.has_pine_source === true) return false
  if (Number.isInteger(imp.engine) && Number.isInteger(fixEngine) && imp.engine >= fixEngine) return false
  return conditionalHistoryCandidate(def)
}

/** The meta key the stamp lives under. `defSchema` keeps unknown `meta` keys
 *  (ignore-and-preserve), and it sits outside every tree, so no hash moves. */
export const ENGINE_STAMP_KEY = 'engineVersion'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The engine version a document was translated by, or null when unstamped. */
export function engineStampOf(def) {
  const m = def && isObj(def.meta) ? def.meta : null
  const v = m ? m[ENGINE_STAMP_KEY] : undefined
  return Number.isInteger(v) && v >= 1 ? v : null
}

/** Was this document translated by an engine older than `current`?
 *  An unstamped document counts as older than every engine. */
export function isStaleStamp(def, current = SCRIPT_ENGINE_VERSION) {
  const s = engineStampOf(def)
  return s === null || s < current
}

/** The document stamped with `version` (today's engine by default). */
export function withEngineStamp(def, version = SCRIPT_ENGINE_VERSION) {
  if (!isObj(def)) return def
  return { ...def, meta: { ...(isObj(def.meta) ? def.meta : {}), [ENGINE_STAMP_KEY]: version } }
}

/** The document WITHOUT the stamp — for every door that is not a script door.
 *  ⛔ A hand-edited document must never claim to be the translator's output: the
 *  Formula tab carries the stored row's `meta` through an edit
 *  (`objectProgramCarry.carryProgramMeta`), and a carried stamp would tell the
 *  next engine "current" about maths the member changed. The same object back
 *  when there is nothing to strip. */
export function withoutEngineStamp(def) {
  if (!isObj(def) || !isObj(def.meta) || !(ENGINE_STAMP_KEY in def.meta)) return def
  const meta = { ...def.meta }
  delete meta[ENGINE_STAMP_KEY]
  return { ...def, meta }
}

/** ⛔ L6 — the store's cap on a stored script (`api/services/user_definitions.py
 *  ::MAX_PINE_SOURCE_BYTES`, pinned equal by `tests/test_saved_script_prebump.py`).
 *  A script over it is never sent: the store would refuse the whole request. */
export const PINE_SOURCE_MAX_BYTES = 256 * 1024

/** Does this script fit the store's cap, measured in UTF-8 bytes as the store does? */
export function withinPineSourceCap(source) {
  if (typeof source !== 'string') return false
  try { return new TextEncoder().encode(source).length <= PINE_SOURCE_MAX_BYTES } catch { return source.length * 4 <= PINE_SOURCE_MAX_BYTES }
}
