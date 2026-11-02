# Status — agent-qa (QA & integration)

Only agent-qa edits this file. Update it in every PR.

## In flight
- **PR 1 — program fixtures** (`agent/qa/fixtures-v1`): fake-provider DataEnvelopes for all 12 MD-1 v1 kinds and
  the 3 SC-1 kinds; cases live · delayed · periodic · historical · stale · market-closed · unavailable · refused ·
  partial · no-source-time. JSON under `app/src/agent/__fixtures__/program/` (generated), Python loader + rail in
  `tests/test_uct_agent_qa_fixtures.py` (`load_fixture`, `cases_for`, `fake_kind`, `fake_registry`), browser
  loader `app/src/agent/__fixtures__/program/index.js`.
  ⚠ Per-kind `data` shapes for MD-1 kinds are PROVISIONAL until agent-md documents them; envelope = MD-1 §3,
  scan `data` = SC-1 §2.
- Next: PR 2 conformance suite, PR 3 cost and limits suite, PR 4 integration.

## Findings (open; the fix belongs to the owner)
- **F-1 (agent-lead / agent-md): `app/src/agent/marketdata/client.js` is unreachable.**
  Repro: `cd app && npx vitest run src/components/screener/reachable.test.js`.
  Expected: the client is imported by a capability or a test, or has an `AWAITING_A_DECISION` entry.
  Actual: listed as "connected to nothing". It is the MD-1 browser door, so it is expected to stay unwired
  until a capability uses it; it needs an `AWAITING_A_DECISION` entry or an importer.
- **F-2 (outside the program, recorded for agent-lead to route):** the same rail fails on master content.
  The "DASHBOARD COCKPIT RETIREMENT" parking note expired 2026-10-31.
  `components/chart/supportLoop/doorNameCoverage.js` is unreachable.
  `components/chart/engine/ast/doorCoverage.js` is reachable but still parked.
  None are in an agent-qa path.
- **F-3 (agent-lead), reported by agent-md on PR #569:**
  `tests/test_uct_agent_program_gateway.py::test_dark_by_default_and_nothing_registered` asserts that no kinds
  are registered, so it fails as soon as MD-1 kinds land. It needs agent-lead to update it.

- **F-4 (agent-sc), on #570 @ 77f9ff6087: a zero-match scan is undated and marked stale.**
  Repro: seed 80 rows with `bars_asof` 20261030, then run `screen.run`/`screen.count` with
  `{"filters":[{"key":"rs_rank","op":"gte","min":1000}]}`.
  Expected: ok, `rows: []`/`count: 0`, coverage present, `as_of` 2026-10-30T20:00:00Z, `stale: false`.
  Actual: `as_of: null`, `stale: true`, note "could not say which session".
  Cause: the provenance read describes the matched rows only, so it has no date when nothing matches.

- **F-5 (agent-md; expected to close with PR 1b / #579):** on v1.0, a quote read outside the regular session
  carries BOTH `NOTE_CLOSED` and `NOTE_EXTENDED`. That breaks v1.1 rule (b). Measured on the merged adapter with
  a faked client:
  `post_market` on a non-trading day (massive labels weekends and overnight `post_market`) → historical with both notes;
  `pre_market` on a trading day → historical with both notes;
  holiday (`regular` label, non-trading day) → historical with only the closed note, which is correct.
  Rows carry no `last_source` yet (v1.1 rule d).

- **F-4 — CLOSED** on agent/int c3a090e26f; the probe passes 79/79. Zero matches are ok, dated by the screen's
  universe (the 10-30 close), stale false, with a note beginning "No names matched". `as_of` moves with the data:
  a 10-28 universe gives the 10-28 close. An empty universe gives `as_of: null` with a note and stale false.
  The 69 earlier checks still pass.
- **F-6 — MITIGATED by #579, entry kept and reclassified.** The line still reads the clock at import
  (`NOW = time.time()`, verified on agent/int), so the syntactic rail still sees it. But an autouse fixture now
  freezes `quotes.time` to that same NOW. Verified with a 65 s delay injected between import and run: the pre-fix
  file (0db96c8e7e) fails its 2 timing tests, while the fixed file (872b5cf762) passes them. Remove the entry when
  NOW becomes a fixed literal.
- (original F-6 text) **F-6 (agent-md): `tests/test_uct_agent_data_quotes.py:22` sets `NOW = time.time()` at IMPORT (since #569, on
  agent/int).** Tests compare vendor stamps against it under the 60 s budget (e.g. `observed=NOW - 40` must not
  be stale), so they flip once the suite has run ~20 s past the import. This is the same defect that holds #579
  (its line 22 too).
  Fix: take the clock in a fixture, or pin `quotes.time`.
  Railed by `tests/test_uct_agent_qa_clock.py`: an AST scan of every `tests/test_uct_agent*.py`, with a STRICT
  KNOWN entry for this line. A new offender reds the rail, and so does fixing this line without removing the entry.
- **#578 probe (post-merge) — 19/19 pass.**
  - Own screens only; never another member's, even a public one.
  - Unrunnable screens are listed `runnable:false` with a reason, and the read is partial.
  - Coverage counts screens.
  - Another member's `saved_id` is refused with the SAME note as a nonexistent id (no existence oracle), with no
    name or spec leaked, and spends the turn's scan.
  - `text` with the criteria language off is refused with the screener's sentence.
  - A two-source precheck refusal spends nothing; `screen.saved` spends the scan.
  - Dark under all three flag combinations.
  - Low: when a member has >100 screens, coverage counts the 100 listed. The note says so; consider
    `evaluated` = all screens.
- **#579 probe (held; agent-md, MD-1 v1.1 quotes) — 12/12 scenarios pass** against agent-qa's v1.1 predicate on a
  pinned clock with the product's real calendar: regular fresh/stale; pre-market at 10 min → live with the
  extended note; post-market at 40 min → historical with the closed note; the 900 s/901 s boundary; overnight;
  Saturday; Thanksgiving; the 11-27 half-day after 13:00 → extended; one prev_close row → partial with its stamp
  excluded; all prev_close in session → historical with NOTE_NO_TRADES. Its only defect is the F-6 pattern in
  its test file. When it merges, #572's fixtures regenerate to its wording and session labels.

- **Rail (agent-lead's request): `app/src/agent/qa/readDataTurnId.test.js`.**
  - Every call to the MD-1 client's `readData` (by name, alias or namespace import) must pass
    `turnId: currentTurnId()` imported from agent/trace, called at the read.
  - It refuses a literal id, a self-minted id (uuid, Date.now), no options, a spread, a stored variable, a
    `currentTurnId` defined elsewhere, `readData` used as a value, and a re-export.
  - Unrelated local `readData` helpers in app/src/lib are ignored, because names are resolved through imports
    (acorn AST).
  - 0 non-test importers today (F-1). It stays non-vacuous through a real-file case (`agentData.test.js`) and 14
    controls.

- **F-7 (agent-sc), #584 @ 3092a36832: the readData turn-id rail fails at `capabilities/screener.js:407` and
  `:450`.** turnId comes through a `scanTurn(ctx)` wrapper rather than `const turnId = currentTurnId()`.
  Repro: merge #584 with #572, then run `npx vitest run src/agent/qa/readDataTurnId.test.js`.
  Fix, tested on a throwaway local merge: call currentTurnId() directly at both sites (40/40 pass).
  Otherwise #584 passes:
  - flag-off output is BYTE-IDENTICAL to agent/int (every answer and the full fetch sequence, 0 `/api/agent/data`);
  - no turn → refused, nothing sent;
  - one scan per turn is enforced server-side (#570 probe).
- **F-8 (agent-md), #585 @ 4b974ccf59: `tests/test_uct_agent_data_pr3.py:25` sets
  `TODAY = datetime.now(timezone.utc).date()` at import.** The adapter ages statements on its own real clock, so
  the exact-boundary stale test flips if a run crosses UTC midnight. #585's quote tests are clean (NOW =
  1793000000.0), so F-6's KNOWN entry is removed in #585's integration window.
- **#582 (corpus, 31 questions):** the scorer `tests/test_uct_agent_qa_scan_corpus.py` lands after it merges.
  Planned: ORACLE (control, must be 100%) and GRAMMAR-DIRECT (deterministic baseline) interpreters, per-category
  and nl tallies, perturbation controls, and a recorded baseline.

- **F-9 (agent-lead), `tools/agent_ownership_check.py`: false FOREIGN after a criss-cross merge.**
  Repro: merge agent/int into a branch whose earlier head was merged meanwhile, which leaves two merge bases.
  Actual: 6 FOREIGN files from #583. Expected: 1 file, my status doc, which is the true two-dot diff.
  Cause: the three-dot diff picks one merge base.
  Fix: judge `git diff --name-only origin/agent/int HEAD`, or fall back to it when `git merge-base --all` returns >1.
- **agent-qa's own slip (recorded honestly):** one push was chained after `ownership_check | head -1 && git push`, so
  it went out on the pipe's exit code. The tree pushed added only this file's 2 lines, so no harm, but the check was
  not a gate. Since then the check runs in its own call and is read before any push.
- **F-6 entry: SUPERSEDED by agent-lead's plan, #589.** The removal PR is #585 + agent/int + the one-line removal,
  merged back to back with #585. The pending-removal marker below was dropped: #586 leaves the clock file identical
  to agent/int.
- (superseded) **F-6 entry: marked PENDING_REMOVAL for exactly one window.** Its fix (NOW literal) is in #585. The rail tolerates
  the absence of that entry alone, so agent/int stays green when #585 merges. The follow-up QA PR deletes both the
  entry and the marker.
  Verified: the rail passes 16/16 on agent/int and 16/16 with #585's two test files substituted.

- **F-7 — VERIFIED FIXED** on #584 @ 7cd053d123: `currentTurnId()` is called directly, the null check comes before
  readData at both sites, and the rail plus scan tests pass 44/44 (the rail now sees 1 real importer).
- **F-8 — VERIFIED FIXED** on #585 @ 3aa3693e9d. A plugin shifts the process wall clock: pr3 + quote tests pass 73/73
  at the real time, 2030-01-01 and 23:59:59.9 UTC. Control: the pre-fix file fails 5 under the same shift.
  **Owed (owner's #585 directive):** the exact news-ingest boundary (STALE_AFTER_S vs +1) and an explicit UTC-midnight
  test for fundamentals ages. Requested from agent-md.
- **Corpus scorer LANDED in #586** (`tests/test_uct_agent_qa_scan_corpus.py`, baseline pinned in
  `__fixtures__/program/scores/discovery-baseline.json`). It is measured on agent/int d98ef2dcd6, where #582 is
  integrated, and gives the same numbers as the pre-merge measurement below.
- **F-8 boundaries — VERIFIED** on #585 @ 476fc07a77, the owner's directive:
  - news ingest: exactly STALE_AFTER_S is fresh, +1 s is stale;
  - fundamentals: the UTC-midnight flip (day 135 at 23:59:59 is fresh, day 136 at 00:00:00 is stale);
  - shifted-wall probe 77/77 at the real time, 2030-01-01 and 23:59:59.9;
  - agent-qa's own `>`→`>=` mutation in each adapter turns the boundary tests red (news 1, statements 2).
- **Corpus scored (measured on a local merge of #584+#582):**
  ORACLE 31/31 (control).
  GRAMMAR-DIRECT 5/31 = **answerable 0/26**; the refusals 5/5 are trivial, because it refuses all English.
  Spotlight questions d08/d19/d22/d26 are all refused, each with the grammar's own sentence.
  Mutation checks: every derived wrong answer fails, and near-misses inside tolerance pass.

- **themes `as_of` null while prices move (#591, MD-1 v1.3 §4.3) — raised by agent-qa, ACCEPTED as documented.**
  `live_applied_at` is UCT's apply time (a computation time, forbidden as `as_of` by §3). The vendor observation
  time is not carried, and the values mix live prices with completed-session reference closes. §4.3 lines 131–132
  state this. The fixtures will add a predicate: a null `as_of` always comes with `data.live_applied_at` +
  NOTE_LIVE_APPLIED, and `as_of` never equals `live_applied_at`. RVOL notes are pinned against SC-1 §2c.

- **#596 model isolation — PASS** (ADR-005 §1: nil exposure today + forward rails, in #603):
  (a) gateway, dormant by default since #599 and activated-only `answer`;
  (b) the turn body carries no answer objects;
  (c) planner context, end to end with a leaking control;
  (d) history/titles;
  (e) traces/telemetry;
  (f) F-10 closed by the L3 rail.
  Mutation proofs: the memory skip, the record `local` flag, and `is_local_row`.
- **Rulings (agent-lead):**
  - **F-13**: ADR-005 L7 means traces and telemetry carry no values. The member's stored transcript may hold them,
    railed never-replayed.
  - **F-11**: accepted; a fail-closed fix comes in a lead hardening PR after the RC, and the strict pin stays until then.
  - **F-12**: stock.compare's composite rating is a KNOWN LIMITATION for this RC. It's pre-program behaviour,
    railed never-replayed; making it local-only is an owner decision.
- **Verdicts:** 64b522a433 GREEN (exact: pytest 1181, vitest 2007). 80229cba14 + #596 + #603: QA rails green, and
  #596's own tests need its #599 refresh (27 fail without UCT_AGENT_ISOLATED, and all 32 pass with it).

- **F-15 (Indicators, owner of `app/src/components/chart/builder/agentDefinitions.js`; cc agent-lead), new with
  #610 on r2. The Agent's Undo of a definition DELETE is no longer exact for a Pine-imported script.**
  Repro (both halves probed on r2):
  - Browser: the real `executeDefinitionAction` then `undoDefinitionAction` with the real `saveUserDefinition`. Undo
    reports `confirmed`, but the saved body's `meta` has lost `engineVersion` (`saveUserDefinition` strips the stamp
    from any save that carries no `pineSource`).
  - Server: the real `user_definitions` service. A script save stores the script, and the tombstone keeps it. The
    Agent's resurrecting save sends no `pine_source`, so the restored version holds **no script**.
  Expected: Undo restores the stamped document and its stored script, or refuses.
  Actual: the maths are unchanged, but the auto-upgrade link is lost. Once `VITE_SAVED_SCRIPT_UPGRADE` is on, the
  restored indicator shows "Updated accuracy available — open in Builder and save".
  Not blocking: the Agent is admin-only and dark, production bakes the flag `'0'`, and nothing renders differently
  today. Script stamping itself is NOT flag-gated, so stamped rows already exist in production.
  Fix direction (the owner's call): capture with `GET /{id}?source=1` before deleting, and pass `pineSource` on the
  Undo save.
  **Fix: draft PR #617 (`77b46e56cc`, Indicators, based on master; it waits behind Sprint 1 and the owner's go).
  agent-qa re-check on a local, never-pushed merge of r2 + #617:**
  - My reproduction, turned around to require exactness, passes: delete then Undo of a stamped script restores the
    stamp and the stored script.
  - Control: a server that withholds the script means nothing is deleted.
  - #617's `agentDefinitions.test.js`: 23 passed.
  - Agent vitest under the lock: **121 files, 2081 passed** (r2's 2058 plus those 23), with no Agent file changed.
  - Ownership: all 3 files are EXTERNAL (Indicators: `chart/**` and `useUserDefinitions.js`), so agent-lead
    approval is needed.
  - Seen in passing, not from #617: `src/hooks/pollingSites.rail.test.js` fails on master content
    (`pages/traderArchive/TodayRhymes.jsx: 1 (listed 0)`). It is outside the Agent gate and is for agent-lead to
    route.
  F-15 closes when #617 lands.

- **F-16 (owner decision; agent-lead for the mechanics): the screener exposes the UCT Ratings that `ratings`
  isolates, so the composite's RANKING and threshold COUNTS reach the model.**
  Repro: `cd app && npx vitest run src/agent/qa/isolationAudit.test.jsx`. A scripted plan runs `screener.run`
  filtered and sorted by `uct_composite`, with sentinel values in the scan rows.
  Expected (if the composite is model-isolated): no ordering or count derived from it reaches a model request.
  Actual: the raw values stay out, but the next model request carries:
  - `conversation_memory.recent_results[0].symbols_in_order` in composite order;
  - `screener.lastScreen` with `sort: "uct_composite desc"` and `matches`;
  - the replayed outcome text "3 stocks match (UCT Composite >= 90)".
  A one-name `within` screen at `>= X`, repeated, bisects a stock's exact composite. The same holds for
  `rating_eps/growth/value/smr`, `sponsorship`, `accdis` and `rs_rank`.
  Options: drop these fields from the Agent's screener catalog, mark screens on them local-only, or rule that ranking
  and counts are acceptable and only raw values are protected.
- **F-17 (agent-lead, turn.py / router): `TurnIn.recentOutcome` is an unused door for free text into the model
  request.** It is dropped only when stored history already holds a local row.
  Repro: `pytest tests/test_uct_agent_qa_isolation_audit.py -k recent_outcome`.
  Expected: the door is removed, or it fails closed. Actual: a sentinel reaches `messages`. No browser sends it today.
- **F-18 (agent-lead, turn.py): `name_conversation` reads agent rows without the `is_local_row` guard that
  `history_messages` applies.** An unblanked stored local-plan reply reaches the naming call.
  Repro: `-k NAMING`. Latent: such rows are blanked at write, and the model wrote them before any value existed.

- **F-19: FIXED by agent-md #638** (proof `test_F19_PROVEN_…`: an explicit `now` alone decides, whatever the wall clock or the helper says; red on the pre-fix quotes.py). Was: **(agent-md, `quotes._session_detail`; the helper is `massive._today_et_is_a_trading_day`): `now` is
  half-honoured.**
  `_session_detail(now)` uses `now` for the minutes but asks the WALL clock whether it is a trading day. agent-md's
  tests hide this by patching the helper with a hand-picked value per row.
  Repro: `pytest tests/test_uct_agent_qa_md2.py -k F19`. On any day, a mid-session `now` on a day of the opposite type
  gets the wrong state.
  Expected: the day comes from `now`. Actual: it comes from the wall clock.
  Production passes no `now`, so this is latent, but every frozen-clock caller (tests, corpora) is affected.
- **F-20: FIXED by agent-md #638** (proofs `F-20 PROVEN …`: fixed words keyed on status, no digits, no note, even when the note carries a number; red on the pre-fix capability). Was: **(agent-md, `marketDataQuote.answerFromEnvelope`): a refusal or unavailable answer echoes `env.notes[0]`.**
  §4.5 says notes never leave the module and that such an answer has "no number at all". A budget refusal gives
  "I couldn't get a price for NVDA: this turn already made 8 data reads…", which contains a number and a gateway note.
  Repro: `npx vitest run src/agent/qa/md2Quote.test.js -t F-20`.
  Expected: fixed words (or a reason from a closed list), no digits. Actual: the note, verbatim.
- **O-1: TAKEN by agent-md #638; agent-qa agrees** (NYSE half-day extended trading ends at 17:00). The clocks now pin 16:59 after-hours, 17:00 and 19:59 overnight. Was **(observation for agent-md, not a defect today):** on an early-close day (2026-11-27), `after-hours` runs from
  13:00 to 20:00. On NYSE half days, extended trading ends at 17:00, so 17:00–20:00 is labelled after hours when no
  session trades. The answer stays honest, because a print older than 15 minutes says "no trade in the last 15
  minutes … Not a real-time price".
- **F-21: FIXED by agent-lead `bb3d4f35f0`.** The marker travels with `data` and every dict/row inside it, and a copied-out row or `data` object is stripped end to end. Proofs `test_L2_F21_PROVEN_…` go red on the pre-fix gateway. Residual by construction, still pinned: a bare SCALAR carries no marker; L3 + L4 hold it. Was: **(agent-lead, gateway.py L2): the marker is on the envelope only.** `env.data`, its rows, or a value copied
  out of them carry no marker, so L5/L6 cannot recognise them, and that is how a capability answer is built.
  Repro: `pytest tests/test_uct_agent_qa_isolation_layers.py -k F21`. Both sides are pinned: the data is unmarked, and
  a copied-out value passes the strip.
  Suggest also stamping `data` and each row, so a copied sub-object stays marked. L3 (allowlist) + L4 (local-only)
  remain the boundary for derived values.
- **F-22: FIXED by `bb3d4f35f0`.** The naming call screens rows for the marker. CONTROL: an unmarked reply is still read. The proof goes red on the pre-fix turn.py. Was: **(agent-lead, turn.py): L6 runs inside `run_turn` only.** `name_conversation` (router `_name_unnamed`) reads
  stored member and agent text without `strip_isolated_request`, so an agent row whose data carries the marker is
  still read. Latent: that text is the model's own words.
  Repro: `-k F22`. Suggest applying the same marker check to the naming call's rows.

## Blockers
- (none)

## Handoffs (to / from)
- To agent-md, agent-sc: fixtures ready to code against once PR 1 merges.
- From agent-md: PR #569 (quote, quotes) is ready. An ownership check and conformance review are queued.

## Ready for integration
- **#572 (fixtures).** quote, quotes and bars.daily are re-cut to their merged producers: `data` fields, note
  constants imported from the adapters, coverage on quote reads, no `delayed` quote path. New v1.1 quote cases:
  extended-live, extended-closed, holiday, no-current-trade. Rules (a)–(e) are a reusable predicate
  (`quote_semantics_errors`) with controls showing it can fail. Other MD-1 kinds keep provisional `data` shapes.

## RELEASE BLOCKER CLEARED: held-out quote sets at the OUTCOME level on agent-md #664 + agent-lead `c9fd4437ea` (MD-1 §4.7)
**Set 1 (44): 35 PASS · 9 SAFE-MISS · 0 FAIL. Set 2 (54, written blind to the fix, published now): 52 PASS ·
2 SAFE-MISS · 0 FAIL.**
- Path (`qa/quoteHeldout.test.js`): the REAL parser → the REAL `answerQuote` / `answerDailyBars` → `instrument.resolve`
  answered by the REAL server classifier (`instruments.classify`) over **QA's own index** (`md2/resolve-qa-index.json`,
  generated by `tests/test_uct_agent_qa_quote_outcome.py`; not agent-md's fixture).
- Any quote, quotes or bars read counts as an EXECUTION. All 14 executions price exactly the meant symbols, each typed
  as one.
- Outcomes: set 1 ask 11 · priced 6 · model 26 · limit 1. Set 2 priced 8 · ask 7 · limit 12 · model 27.
- Mutation-proved: if lowercase words are priced instead of asked, 17 tests go red.
- **Observation for the owner (not a FAIL; pinned): 5 asks NAME a security the member probably didn't mean.**
  "btc price" → BTC (Grayscale Bitcoin Mini Trust); "price of gold" → GOLD (Barrick); "dow price" → DOW (Dow Inc.);
  "eth price" → ETH (Grayscale Ethereum Mini Trust); "sol price" → SOL (Emeren). Nothing executes, and the name shows
  the member the difference. A stricter policy would give these the §4.7.3 limit sentence.
- **By design (contract P32):** "BTC price" typed in CAPITALS prices the Grayscale Bitcoin Mini Trust ETF, named in
  the answer. Owner to confirm.
- md2 rails moved to §4.7:
  - `md2Quote` parses the new 42-row table, checks resolve-then-quote within one turn, and has a 5th dark shape
    (`instrument.resolve` missing).
  - `md2Panel` checks **every row's outcome column end to end** through the real panel: 48/48.
- Suites (lock) on `c9fd4437ea` + this PR: pytest **1733**, vitest **136 files, 2480 passed**.

## ⭐ FINAL VERDICT: Sprint 2 release candidate `608ad6adaec6207fb29accb3fcf72ad5741c391f`
**GO to deploy DARK (every flag off). HOLD on activating quote (`UCT_AGENT_DATA=1` + `UCT_AGENT_DATA_KINDS=quote,quotes`) until
the held-out misreads (item 7) are fixed.**
Checked out EXACTLY at the SHA (detached, clean), every Agent flag unset; probes added only for their run, then removed.

1. **Suites (lock):** Agent pytest **1658 passed**; vitest **134 files, 2373 passed** (both equal agent-lead's).
   QA rails: pytest 338, vitest 148.
2. **Per-kind allowlist (server, real router, spies on every kind's adapter and validator): 20/20.**
   - Flags off: config `data/scan/nl1` false and `data_kinds` [], every kind × purpose refused, nothing ran, no budget.
   - DATA=1, KINDS=quote,quotes: config `data_kinds` = [quote, quotes]; ONLY quote and quotes are admitted. Every other
     kind (bars.daily, breadth.current, ratings, screen.*) is refused for every purpose and its source never ran.
   - Listing isolated or scan kinds with ISOLATED or SCAN off is still refused (it never widens).
   - KINDS unset, empty, or garbage (`*,all,QUOTE,quotes.x, ,ratingz`) admits nothing.
   - A member is denied on `/data`, `/config` and `/turn`.
3. **Flags-off regression against production `c6c6545006`.**
   - Production = the Sprint 1 tree + one CI commit (#619, the gate timeout 25→40). The RC does not contain it, so the
     Agent's own changes are `c3ba71c343..RC`. ⚠️ **Promote by MERGE, not tree replace**, or the gate timeout reverts
     to 25.
   - Routes: 1967 vs 1967, +0 −0; the 15 Agent routes and their auth dependencies are identical.
   - `stock.profile`: answers plus request sequence BYTE-IDENTICAL production vs RC.
   - Screener flags-off answers plus request sequence: BYTE-IDENTICAL.
   - stock.quote and stock.dailyBars are absent from the manifest (the golden has no added or removed capability).
   - Chart, indicator, watchlist, workspace and Undo: none of their files changed (`agentMutations` closure has 0
     changed files), and their suites are green.
   - **Every intended flags-off change, and nothing else (all non-test product files in the diff):**
     - (a) stock.compare's rating row, text and summary removed (F-12);
     - (b) `run_turn` never forwards `recentOutcome` (F-17; the field is still accepted);
     - (c) naming skips local and marked rows (F-18, F-22);
     - (d) history fails closed on action-less outcome rows outside `ACTIONLESS_OUTCOME_KINDS` (F-11, #622);
     - (e) the L6 strip and the L5 `modelSafeBody` run on every turn, a no-op while nothing is marked;
     - (f) #626 routing: the screen-condition patterns add the screener group;
     - (g) #646: `screener.run`'s hint for "(latest session)" fields, plus a wider `SCREEN_WORDS` deciding when the full
       catalog is sent;
     - (h) config gains `data_kinds`;
     - (i) the screener's gateway path also needs `screen.*` in `data_kinds` (no effect with scan off);
     - (j) golden: only `screener.run.hints` and `stock.compare.summary`.
     - Everything else is dormant code (marketData*, quotes `session_detail`, gateway allowlist and markers) or
       test/eval data (`freshness.json`, `sc2.json`, `section_b*`, which has no importer).
4. **Quote (MD-2) at this SHA:** PASS.
   - 21 session clocks, including weekend, holiday, early close and O-1; real-adapter envelopes for live, stale, pre,
     post, overnight, weekend, holiday, early close, partial, unavailable and refused.
   - 16 fast phrasings at **0 model calls**; 4 dark shapes; the served path makes **no `/api/live-prices`** call and no
     screener call.
5. **stock.dailyBars (#644, in the RC, dark: `bars.daily` will not be listed):** the harness (PR #655) ran on this SHA
   and PASSES (28 vitest + 10 pytest).
   - Open: **F-23** (half-day 13:00–16:00 "last completed session"). Untested in activation; it stays dark this release.
6. **Isolation matrix at this SHA**
   - **PROVEN:** L1 (dormant, allowlist, refusal order); L2 including F-21 (data and rows marked); L3; L4 (local rows,
     unreadable rows, F-11, F-18); L5; L6 (F-17, F-22, marked rows); L7; F-12 rating removed.
   - **ACCEPTED (owner):** F-16-R (reconstruction from public inputs); cell #14 (non-local outcome text replayed, safe
     while capability text is value-free); the bare-scalar copy-out residual (held by L3/L4).
   - **OPEN, stated explicitly: F-16 enforcement (agent-sc PR-A #654 / PR-B) is NOT in this candidate.** The
     pre-existing screener route still sends the model the field catalog that names all 33 prohibited fields (the 31 +
     base_structure, base_relation_count, hvc_52w, theme). Measured in the model-bound body: each once, `theme` 16×.
   - **Owner condition (A) PROVEN:** quote activation adds NO new path.
     - Server: only quote and quotes are admitted, the quote row's fields contain none of the 33, and every `screen.*`
       kind is refused for every purpose.
     - Browser: for the same panel turns, prohibited-name occurrences in the model-bound body are IDENTICAL with quote
       OFF and ON; the stock.quote manifest entry names none; the planner path makes no gateway read; the screener
       stays on `/api/screener/scan`.
7. **NL quality: held-out quote phrasings (44, written by QA without reading the parser;
   `scores/quote-heldout.json`, rail `qa/quoteHeldout.test.js`): 35 PASS · 2 SAFE-MISS · 7 FAIL.**
   - **FAIL, a confident answer at 0 model calls:**
     - H26 "btc price" → quote BTC (an ETF, not bitcoin);
     - H28 "what's the price of gold" → GOLD (Barrick);
     - H37 "how's the s&p doing" → S, P;
     - H29 "price of apple and microsoft" → APPLE (MSFT dropped);
     - H30 "nvdia price" → NVDIA;
     - H19 "nvda price history" → today's quote;
     - H40 "nvda close on friday" → the latest close, whatever the day.
   - SAFE-MISS: H06 "amd vs nvda price" and H35 "$nvda $amd $tsla" go to the model.
   - **This misses the owner's bar** (a wrong quote or symbol is a FAIL), so: HOLD on activation. Owner: agent-md
     (marketDataPhrases.js).
8. **Still unverified:**
   - SAT-1 B (credentialed live run; no credential);
   - the real Massive provider's payloads (faked in every QA test);
   - planner (model) quality on any phrasing (needs paid runs, not authorised);
   - a real browser (jsdom only);
   - stock.dailyBars in activation (dark);
   - isolated kinds with a real reader (no caller exists);
   - F-16 enforcement (not in the RC).
9. **F-2, exactly (`components/screener/reachable.test.js`, a non-gate rail):**
   - It fails 3 ways: the expired 2026-10-31 parking note "DASHBOARD COCKPIT RETIREMENT" still covers 24 files;
     `chart/supportLoop/doorNameCoverage.js` is unreachable; `chart/engine/ast/doorCoverage.js` is reachable but still
     parked.
   - **None of the 25 is in the Agent release diff or changed vs production.**
   - One is in the Agent's import closure: `doorCoverage.js`, via the existing chart builder (drawings → … → PineBox →
     importGaps), unchanged since 2026-09-18. The rail's complaint about it is a stale parking entry, not a severed wire.
   - The rail is **not in the master deploy gate**, which runs `tests/test_uct_agent*.py` and
     `vitest src/agent + agentMutations`.
   - **Verdict: harmless reachability noise for this release.** The notes belong to the dashboard and chart owners.
   - `qa/sentinels.js` (the 26th, mine) has moved under `__fixtures__/program/` (test infra) in this PR.

## ⭐ F-16 FINAL RULING: agent-qa's INDEPENDENT review of fields that could reproduce a hidden UCT ranking
For the owner (via agent-lead). Written **without reading agent-sc's list**, from the code on agent/int `0a1cda2216`:
`api/services/screener/enrich.py`, `research/ratings.py`, `rs_weighted_return.py`, `screener/setup_score.py`,
`pattern_join.py`, `earnings_context.py`/`setup_grade.py` and `filters.field_catalog()` (187 fields).
Hidden by the ruling (26): `uct_composite`, `rating_eps/growth/value/smr`, `sponsorship`, `accdis`, `rs_rank`,
`rs_return`, `dp_*` (4), `opt_*` (3), `candle_score`, `earnings_setup_grade`, `pattern_engine_*` (5), `in_uct20`.
**The mechanism to watch is SORT and THRESHOLD over the inputs.** A hidden rating that is a universe percentile of
a visible input has exactly that input's order. And counts at thresholds, run one name at a time, bisect any value.

**A. Still VISIBLE, and it reproduces a hidden field EXACTLY or in exact order**

| # | Hidden | Visible route | How exact | Source |
|---|---|---|---|---|
| A1 | `rs_return`, `rs_rank` | `chg_pct_3m`, `chg_pct_6m`, `chg_pct_1m`, `chg_pct_1w` | **Exact formula**: `rs_return = 0.40·3m + 0.20·6m + 0.20·1m + 0.20·1w` (renormalised when a term is missing). `rs_rank` is its percentile, so ordering by that sum IS the RS Rank order. The change fields come from the same `returns` dict, keys `3m` and `6m` | `rs_weighted_return.RS_TERMS`; `snapshot_builder.py:~377` |
| A2 | `candle_score` (Setup Score) | `pct_vs_ema20`, `vol_nweek_low`, `avg_body_pct_5`, `close_position`, `close_cv_pct`, `pole_pct`, `vol_updown_ratio` | **Exact**: a fixed points table over exactly these seven (25/18/10/5 · 20/13/8 · 15/8 · 15/8 · 10/5 · 15/10/5 · 10/5) | `setup_score.py:115-160` |
| A3 | `rating_value` | `peg` | Exact order: the inverted universe percentile of PEG (PEG > 0) | `enrich.py` value leg |
| A4 | `rating_growth` | `blended_growth` | Exact order: the universe percentile of `blended_growth` (the field itself is visible) | `enrich.py` growth leg |
| A5 | `sponsorship` | `inst_pct` | Monotone: a letter of the universe percentile of `inst_pct` | `enrich.py` sponsorship |
| A6 | `rating_eps` | `eps_growth` | The percentile of the `earnings_growth` metric. Same order IF `eps_growth` is that metric (not verified) | `enrich.py` eps leg |
| A7 | `rating_smr` | `rev_growth`, `op_margin`, `roe` | The mean of their three universe percentiles. All three are visible; close order within a screen | `enrich.py` smr leg |

**B. Still VISIBLE and IS a UCT-computed ranking or Pattern Engine output: recommend adding it to the hidden list**

| # | Field | Why |
|---|---|---|
| B1 | `sector_rs_pct` (Sector RS) | The **sector percentile of the hidden `rs_return`**: a UCT RS ranking under another name (`enrich.py:216`, `snapshot_builder.py:1591`) |
| B2 | `pattern_entry_dist_pct`, `pattern_stop_dist_pct`, `pattern_expectancy_r` | Pattern Engine outputs (`pattern_join.py:433`, `snapshot_db.py:128`) that do not carry the `pattern_engine_` prefix, so the ruling's prefix misses them. `pattern_expectancy_r` is UCT's synthetic expectancy |

**C. Reconstructable APPROXIMATELY**
- C1 `uct_composite` = `_composite(eps, rs, growth, value, smr, accdis)`. Five of its six inputs are A1, A3, A4, A6 and A7.
  The sixth, `accdis`, is a 65-day up/down volume ratio, which is not a field. `vol_updown_ratio` is setup_score's
  shorter window and only a proxy. So the composite's ORDER can be closely approximated from visible fields.
- C2 `earnings_setup_grade`: four weighted inputs (beat streak 0.30, revisions, IV premium, RS), published on
  /methodology §12. Only the RS term (A1) and the move fields (`implied_move_pct`, `last_report_move_pct`) are fields,
  so this is partial.
- C3 `accdis` from `vol_updown_ratio`: different window, coarse.

**D. Owner questions (not rankings)**
- D1 `archive_calls_n` (Team Archive Calls): a count of the team's own archived calls per ticker, a proprietary
  editorial signal. Not covered by the ruling.
- D2 `theme` (UCT Theme taxonomy), `stage2`/`stage4`, `ma_stack`, `hvc_52w`: either taxonomy or public methods, so no
  action recommended.

**Recommendation (owner decision)**
1. Add B1 and B2 to the hidden set. They are UCT's own computed outputs and the ruling's intent covers them.
2. A1–A7 are ordinary market data (returns, PEG, growth, margins, ownership). Hiding them would gut the Agent's
   screener, so the honest options are:
   - (i) accept that a ranking rebuildable from public inputs is not protected, and protect only UCT's computed
     outputs; or
   - (ii) additionally refuse the specific *combinations* that ARE the formula (A1's four-term weighted sort, A2's
     seven-input set). That is brittle, because a model can sort on one input at a time.
   QA recommends (i), stated explicitly on the ruling, plus B1 and B2.
3. Outside the Agent, for the owner: `/methodology` says UCT Rating components are "scored against fixed thresholds
   … will change to a ranked percentile when that job lands". The code ranks by universe percentile when available,
   and CLAUDE.md records `RATINGS_PERCENTILE_ENABLED=1` on production, so a member-facing page may be stale.
   Not verified live.
QA's rails for the implemented ruling will take the hidden set as data, so B1 and B2 join with a one-line change
if the owner agrees.

**OWNER DECISION on this review (relayed by agent-lead):** the recommendation is ACCEPTED.
- **The final hidden set (31)** = the ruling's 26 + B1 (`sector_rs_pct`) + B2 (`pattern_entry_dist_pct`,
  `pattern_stop_dist_pct`, `pattern_expectancy_r`) + **`archive_calls_n`** (newly hidden as proprietary research).
- **Visible:** public inputs (price changes, PEG, growth, institutional %, technicals). A ranking on public data that
  the member asks for is allowed. The Agent must not deliberately reproduce UCT formulas or expose their weights.
- **Enforcement:** server-side, with QA rails and adversarial tests (to come, against agent-sc's implementation).

| Matrix cell | State |
|---|---|
| F-16-R: a hidden UCT output reconstructed from visible public inputs (A1–A7, C1–C3 above) | **ACCEPTED RESIDUAL (owner decision), not an OPEN cell.** Hiding the outputs does not guarantee they cannot be reconstructed. The protected things are UCT's computed outputs and its formulas and weights. The rails will check the Agent never names a UCT weight or formula (manifest, hints, system prompt, answers). They will not check that a member's own public-data sort can't resemble one |

## Sprint 2 task 2: MD-2 ACCEPTANCE HARNESS for agent-md's `stock.quote` (#624, MD-1 v1.5 §4.5)
Files: server `tests/test_uct_agent_qa_md2.py`, browser `app/src/agent/qa/md2Quote.test.js`, and fixtures
`app/src/agent/__fixtures__/program/md2/scenarios.json` (generated with `--write`). It is independent of agent-md's own
tests in two ways:
- the trading day is DERIVED from the real NYSE calendar for the frozen clock's own date, never hand-picked;
- the envelopes come from the REAL `quotes` adapter, with the session clock, staleness clock and `fetched_at` all
  frozen at one instant.

| Area | Result |
|---|---|
| Session clocks (21, incl. O-1's 16:59 / 17:00 / 19:59 half-day clocks after #638) | PASS. regular · open bell · 09:29 premarket · 04:00 · 03:59 overnight · 16:00 and 19:59 after-hours · 20:00 overnight · Monday 03:59 after a weekend · Saturday · Sunday 21:00 · Thanksgiving (holiday) · its eve 21:00 · observed 2026-07-03 · early close 2026-11-27 (12:59 regular, 13:00 / 19:59 after-hours) · both DST Mondays. A UTC `now` gives the same answer. An unreadable calendar reads closed; an unreadable early close falls back to 16:00 |
| §4.5 rules, 12 real scenarios (one per answer row, plus a budget refusal) | PASS: only `{text, present}` leave; "live/now" appears iff the read is fresh and live (text and shown figures); no envelope field names, source id or notes are echoed on ok/partial reads. Each row's sentence is checked: stale in the price sentence, extended hours, the last extended print and its time, closed + last trade or last close with its date, priced from a close, `Partial: no price for NOPE.` |
| As-of reference | PASS: from `fetched_at`; a browser clock moved to 2031 changes nothing |
| Session from the data, not the words | PASS: P01 "…premarket?" during the regular session answers "regular session", with one `quote` read for purpose `answer` and the open turn id |
| Flags off (4 states: data off; no `data_kinds` accessor; quote not activated; `quotes` missing) | PASS: not served, registers nothing, `match()` is null for all 30. `answerQuote` equals `answerProfile` byte for byte with the same request sequence, and makes no gateway read |
| Fast path, 30 phrasings parsed from MD-1-phrasings.md | PASS: all 16 fast quote rows match exactly (P01–P10, P12, P13, P15–P17, P25); every model/clarify row is null; bars rows are not stock.quote's; `match()` does no I/O |
| Zero model turns in the REAL panel (`md2Panel.test.jsx`, on agent/int `40185db069` with #632/#633 wired) | **PASS**: every fast quote row makes **0 model turns** and exactly 1 gateway read of the right kind (`quote`, or `quotes` for many) with the right symbols, purpose `answer` and the turn id. All 14 model/clarify/bars rows make no fast-path read. Every dark config shape (data off · no `data_kinds` · quote not activated · `quotes` missing) makes no read, sends the sentence to the model as today, and leaves stock.quote out of the manifest. Mutation-proved: a fast handler that never claims → 16 red; flags ignored → 3 red (the 4th, data off, is also held by the data client's own refusal) |
| Mutation proofs (capability) | 5 of 5 red: stale claiming live; overnight claiming live; notes leaking on ok reads; the session taken from the words; flags-off ignoring `data_kinds` |

## Sprint 2 task 3: COST BASELINE (model calls per corpus phrasing, today)
A measurement, pinned exactly so any reduction or regression is a reviewed diff. File:
`app/src/agent/__fixtures__/program/scores/cost-baseline.json`. Rail: `tests/test_uct_agent_qa_cost_baseline.py`.
No paid call: a scripted planner that answers directly, with research stubbed.
- **Model:** model_calls = browser_requests × (server_calls + naming_call).
  - Browser requests come from the real panel (`fastPathCorpus.test.jsx`).
  - server_calls = 1, or 2 when UCT forces research for current-facts wording.
  - naming_call = 1 per new conversation the plan leaves unnamed, measured as an upper bound.
- **Discovery corpus (31 phrasings), measured on agent/int `191a06510c`:**
  - 31 browser requests, 0 handled by the fast path.
  - **64 model calls**: 31 planner + 31 naming + 2 post-research. d17 and d26 trigger forced research.
  - By category: refusal 10/5, setup 10/5, strength 10/5, volume 8/4, momentum 7/3, sector 7/3, fundamental 6/3,
    volatility 4/2, earnings 2/1.
- **The levers this exposes** (each a model-call reduction, owned by agent-lead):
  1. The fast path claims none of the 31.
  2. Naming costs one call per conversation whenever the plan gives no title. Making the planner always return a
     title would remove up to 31.
  3. Forced research on "latest / today" wording costs two calls each.
- A CONTROL proves the instrument tells 1 call from 2. Every phrasing stays within the 2-call per-request ceiling.
- Next: add agent-md's 30 MD-1 phrasings (#620) as a second corpus once merged (fastPathCorpus measures them too).

## ⭐ Sprint 2 task 1: ADVERSARIAL MODEL-ISOLATION AUDIT (ADR-005), on master `c3ba71c343`
Targets: `breadth.current`, `ratings`, and the stock.compare composite (F-12).
Method: SENTINEL values planted at the source, then a check of what every model-bound payload carries. Each path is
run both dormant and activated (`UCT_AGENT_ISOLATED=1` set inside the test).
**States:**
- PROVEN: blocked by code, whatever the flags.
- DORMANT: blocked only because a flag is off or no caller is wired.
- OPEN: a sentinel or a derived number reaches a model request. These are strict pins that fail once fixed.
Tests: server `tests/test_uct_agent_qa_isolation_audit.py`, browser `app/src/agent/qa/isolationAudit.test.jsx`, plus the existing `tests/test_uct_agent_qa_isolation.py` and `app/src/agent/qa/modelIsolation.test.jsx`.
Three guards were mutation-proved, each broken by hand, then restored from the committed blob and sha-checked: the
gateway's exception log, the local-plan reply drop, and the `recent_outcome` guard.

| # | Path | Layer | State | Proof (test) | Owner of any fix |
|---|---|---|---|---|---|
| 1 | Isolated kind read, any purpose, flags at default | L1 | DORMANT (+ PROVEN refusal order) | `test_L1_ORDER_...` · `tests/test_uct_agent_qa_isolation.py::test_DORMANT_...` | - |
| 2 | Isolated kind, activated, purpose research/scan | L1 | PROVEN | `tests/test_uct_agent_qa_isolation.py::test_an_isolated_kind_is_refused_...` | - |
| 3 | Validator raising with a value in its message | L1 | PROVEN (type-only log, fixed note) | `test_L1_a_validator_that_RAISES_...` | - |
| 4 | Adapter raising with a value in its message | L1 | PROVEN | `test_L1_an_adapter_that_RAISES_...` (mutation-proved) | - |
| 5 | Adapter returning a contract-breaking envelope full of values | L1 | PROVEN (replaced; the logged MD-1 errors echo no values) | `test_L1_a_contract_BREAKING_...` | - |
| 6 | Validator text passed into envelope notes | L1 | PROVEN for the two real validators (fixed words) | `test_L1_the_REAL_validators_...` | - |
| 7 | Per-kind allowlist `UCT_AGENT_DATA_KINDS=quote`: every other kind, for every purpose, even with ISOLATED on | L1 | OPEN on master; **PROVEN with #621** (refused, nothing run, no budget). The test follows the code and asserts both states strictly | `test_L1_ALLOWLIST_with_DATA_on_...` | agent-lead (#621) |
| 7a | Allowlist fails closed (DATA on, KINDS unset → every kind refused) and never widens ISOLATED or SCAN (every kind listed, both off → isolated and scan kinds still refused) | L1 | **PROVEN with #621** (skipped before it, as there is nothing to test) | `test_L1_ALLOWLIST_fails_closed_...` | — |
| 8 | Envelope marker `isolated: true` | L2 | **PROVEN with agent-lead `368d3a4b22`**: the gateway stamps `True` on every isolated read, whatever the adapter wrote; a non-true value breaks MD-1, so the read is replaced and still stamped; a non-isolated kind carries no marker (CONTROL). The marker is on the ENVELOPE only (F-21) | `tests/test_uct_agent_qa_isolation_layers.py::test_L2_…` (mutation-proved: 10 red without the stamp) | agent-lead (done) |
| 9 | Caller allowlist (who may `readData` an isolated kind) | L3 | PROVEN (static AST rail) | `app/src/agent/qa/modelIsolation.test.jsx` (1) | - |
| 10 | History: a local-only outcome row | L4 | PROVEN | `tests/test_uct_agent_qa_isolation.py::test_a_stored_local_answer_...` | - |
| 11 | History: an unreadable outcome row | L4 | PROVEN (fail closed) | `tests/test_uct_agent_qa_isolation.py::test_an_unreadable_outcome_row_FAILS_CLOSED` | - |
| 12 | History: the planning reply of a local plan, even stored unblanked | L4 | PROVEN | `test_L4_PROVEN_...` (mutation-proved) | - |
| 13 | History: an outcome row with no `actions` (F-11) | L4 | OPEN on master; **PROVEN with #622** (fails closed for `answered`, garbled, empty and None kinds). Residual by design: the 25 `ACTIONLESS_OUTCOME_KINDS` browser notes still replay, which is safe while their text is UCT's fixed words (railed by agent-lead against useAgent.js) | `test_L4_F11_an_answered_row_without_actions` (with a CONTROL) | agent-lead (#622) |
| 14 | History: any NON-local outcome row's text is replayed verbatim | L4 | **OPEN by design**: the server keys on the action name or the `local` flag, never on content; safe only while every non-local capability's TEXT is value-free | `test_L4_OPEN_PIN_...` | agent-lead (structural) |
| 15 | Conversation naming reads an unblanked local-plan reply (`history_messages` drops it; `name_conversation` has no guard) | L4 | **PROVEN with agent-lead `5aabae8a73`** (F-18 fixed: the same `is_local_row` guard), with a CONTROL showing a non-local reply is still read | `test_L4_PROVEN_F18_the_NAMING_call_...` (mutation-proved: red on the pre-fix turn.py) | agent-lead (done) |
| 16 | `recentOutcome` (free browser text) | L6 | **PROVEN with `5aabae8a73`** (F-17 fixed: run_turn never forwards it; the TurnIn field stays accepted for old clients), with a CONTROL showing the member's words still go | `test_L6_PROVEN_F17_...` (mutation-proved) · `test_L6_PROVEN_recent_outcome_is_dropped_once_...` | agent-lead (done) |
| 17 | `workspace_context`, `pending`, `reference` and stored history rows | L6 | **PROVEN with `368d3a4b22`**: marked objects are removed at any depth; a wholly marked context becomes empty; a stored row whose data carries the marker is replayed as unreadable, text included; the strip is logged as a count. CONTROLS: unmarked siblings, the member's words, and an unmarked row ARE sent. Not covered: values copied OUT of an envelope (F-21) and the naming call (F-22) | `tests/test_uct_agent_qa_isolation_layers.py::test_L6_…` · `test_uct_agent_qa_isolation_audit.py::test_L6_PROVEN_a_MARKED_object_…` (mutation-proved: 7 red without the strip) | agent-lead (done) |
| 18 | Gateway envelope to server to model | L6 | PROVEN by structure: `turn.py` imports no marketdata/gateway module (AST) | `test_L6_research_results_...` | - |
| 19 | Browser serializer drops `isolated` objects (agentClient) | L5 | **PROVEN with `368d3a4b22`**: `modelSafeBody` strips at any depth from context, pending, reference, repair, history and memory (7 planted, 7 counted); the caller's object is not mutated; the log carries a count, never content. BOTH `/api/agent/turn` and `/turn/stream` send the stripped body; end to end, a context provider publishing a marked object never reaches the model request while its unmarked fields do | `app/src/agent/qa/isolationLayers.test.jsx` (mutation-proved: 6/6 red with an identity serializer) | agent-lead (done) |
| 20 | Isolated reader end to end: context, memory, pending, title, telemetry, traces | L5/L7 | PROVEN for a `localOnly` reader, with a leaking CONTROL that is caught | `app/src/agent/qa/modelIsolation.test.jsx` (2) | - |
| 21 | stock.compare composite (F-12) | L4/L5 | **REMOVED with `5aabae8a73`** (owner display-only rule): the rating is absent from views, text, turn bodies, memory, traces and telemetry, while the served payload carried it (CONTROL), and a source rail forbids reading it | `modelIsolation.test.jsx::F-12 FIXED …` · `isolationAudit.test.jsx::F-12 …` (mutation-proved) | agent-lead (done) |
| 22 | **Screener composition, raw values**: the catalog carries `uct_composite`, `rating_*`, `sponsorship`, `accdis`, `rs_rank`, the same UCT Ratings (`screener/enrich.py`) | L4/L5/L7 | PROVEN: values stay in the stored table; text, context, memory, telemetry and traces are clean | `app/src/agent/qa/isolationAudit.test.jsx::PROVEN ...` | - |
| 23 | **Screener composition, RANKING**: a screen sorted by `uct_composite` puts `memory.recent_results[0].symbols_in_order` in composite order, plus `lastScreen.sort` | L5/L7 | **OPEN** (F-16) | `app/src/agent/qa/isolationAudit.test.jsx::OPEN ... RANKING ...` | owner + agent-lead |
| 24 | **Screener composition, COUNT**: matches at a member-chosen threshold in the replayed text AND in context `lastScreen.matches`; a one-name `within` screen at `>= X`, repeated, bisects a stock's exact composite | L4/L6 | **OPEN** (F-16) | `app/src/agent/qa/isolationAudit.test.jsx::OPEN ... COUNT ...` | owner + agent-lead |
| 25 | Telemetry: unknown keys dropped; 5 short free-text columns not value-checked | L7 | PROVEN for unknown keys; the free text relies on the browser (railed for the isolated reader in #20) | `test_L7_telemetry_...` | - |
| 26 | Server logs on a turn carrying sentinels in context and history | L7 | PROVEN (none logged) | `test_L7_a_scripted_turn_...` | - |
| 27 | Web research results | L6 | out of scope: web text, not UCT data (research is forced off in these tests) | - | - |


**F-12, stock.compare's UCT composite: its OWN row.** Owner rule: DISPLAY-ONLY *iff* server-enforced isolation is
demonstrably intact.

| Cell | State | Proof |
|---|---|---|
| Display to the member (stored views) | shown (CONTROL: the detector sees it) | `isolationAudit.test.jsx::F-12 display …` |
| Tool result: outcome text | clean today | `… F-12 … no value in any of them TODAY` · `modelIsolation.test.jsx::F-12` |
| History replay | clean today, **browser-enforced only**: the row is NOT local, so the server replays its text verbatim (cell #14) | `test_L4_OPEN_PIN_…` (pins it with `stock.compare`) |
| Summaries and titles | clean: `name_conversation` never reads outcome rows | `test_uct_agent_qa_isolation.py::test_the_chat_naming_call_never_reads_outcome_rows` |
| Memory, context, pending | clean today (memory holds NVDA and AMD in the member's order) | `… F-12 … TODAY` |
| Traces and telemetry | clean today | `… F-12 … TODAY` |
| Server enforcement | **NONE**: the value comes from `/api/research/compare` (the Research page route), not the gateway; no isolated kind, marker or local flag applies | `… F-12 … NOT SERVER-ENFORCED` (strict pin) |
| Compositions | **OPEN**: the same composite is a screener field, so its ranking and threshold counts reach the model (F-16) | `isolationAudit.test.jsx::OPEN …` |

**Resolved with agent-lead `5aabae8a73`: the rating is omitted** (every cell above now reads absent, a source rail keeps it out, and the proofs go red on the pre-fix stock.js). The verdict that led to it: **server-enforced isolation was NOT intact for F-12.** Two cells fail: server enforcement (none) and
compositions (F-16). By the owner's rule, the rating should be omitted from stock.compare. That is agent-lead's
removal; QA will flip these pins to proofs that it is gone.

**Activation gate (recommendation to agent-lead and the owner).** `UCT_AGENT_ISOLATED` stays off until:
- (a) L2, L5 and L6 exist, and cells #8, #17 and #19 are flipped to PROVEN;
- (b) the allowlist lands (#7's xfail turns into a pass);
- (c) F-11, F-17 and F-18 are closed;
- (d) **the owner decides F-16**. While the screener serves the same UCT Ratings as ordinary fields, isolating the
  `ratings` kind does not keep the composite's ranking or threshold counts from the model.

Note for the owner (outside the Agent, untouched): `api/routers/ai_search.py:1158` already writes "UCT composite N"
into AI Search's own model prompt. That is relevant to the F-16 policy; it is not an Agent finding.

## ⭐ FINAL VERDICT — refreshed Sprint 1 RC r2 `0da44001b83b01b04630870622a571389baf56e3` (`agent/rc/sprint1-r2`): GREEN
r2 = c6895db012 + a merge of master `e56d4cfd2d` (= production: Pine #610/#613, Indicators #577, News #615).
Checked out EXACTLY at the r2 SHA (detached, clean), nothing added, every Agent flag unset.
- **Agent paths unchanged:** `git diff c6895db012 0da44001b8` over `api/services/uct_agent`, `app/src/agent`,
  `api/routers/uct_agent.py`, `agentMutations*`, `api/services/news`, the Agent tests and tools is **empty**. 40 files
  differ, all of them master work.
- **Full Agent suites (suite lock):** pytest **1251 passed**; vitest **120 files passed (5 skipped), 2058 passed
  (6 skipped)**. Again with `VITE_SAVED_SCRIPT_UPGRADE=0` (the value production bakes): **identical, 2058 passed**.
- **QA rails:** pytest **253 passed**; the QA vitest rails ran inside the full vitest run.
- **Corpus:** oracle **31/31** (26/26, 5/5) · grammar-direct **5/31** (0/26 answerable) · browser fast path **0/31**.
  All three match their pinned baselines.
- **Flags-off server probe: 50/50.** Config reports data/scan/nl1 false. `/api/agent/data` refuses every kind for
  every purpose, and spies show no adapter or validator ran and no budget opened. Each flag gates on its own, and a
  member is denied.
- **Route table** (`api.main:app` walked on each tree): r2 vs master `e56d4cfd2d` adds exactly one route,
  **`POST /api/agent/data` (`require_admin_dark`)**, and removes none. Against base `51b9af9794`, the only other
  addition is `GET /api/trade-exchange-news/library/bookmarks/{event_id}`, which is master's #615 and already live.
- **Screener, flags off:** the answers plus the full request sequence are **byte-identical** to base `51b9af9794`.
- **#610 / #577 vs the Agent:** I walked the acorn import closure of `agentMutations.js` (108 files) and found
  **0 changed files**. #577 (`importVerdict.js`) is reached only through a render chain, and no Agent code calls it.
  #610 has **one real contact: F-15** (below), which is latent and not RC-blocking.

## ⭐ FINAL VERDICT — Sprint 1 release candidate `c6895db012f97cede60d998fd300ca608f730531` (`agent/rc/sprint1`): GREEN
Checked out EXACTLY at the RC SHA (detached, `git diff --quiet`), nothing added, every Agent flag unset in the shell.
- **Full Agent suites (suite lock):** pytest **1251 passed**; vitest **120 files passed (5 skipped), 2058 passed (6 skipped)**.
  Both match agent-lead's gate.
- **QA suites:** pytest **253** (isolation, clock, fixtures, scan corpus); vitest **69** (turn-id 21, isolation 12,
  fast-path corpus 32, fixtures 4). Corpus: oracle 31/31 · grammar-direct answerable 0/26 · browser fast path 0/31.
- **Flags-off regression (UCT_AGENT_DATA, UCT_AGENT_SCAN, UCT_AGENT_ISOLATED, UCT_AGENT_NL1 all unset):**
  - The real router on a bare app: **50/50**.
    - `/api/agent/config` reports data, scan and nl1 false; the gateway reports isolated dormant.
    - `/api/agent/data` refuses EVERY registered kind for answer/research/scan with the UCT_AGENT_DATA sentence and
      valid envelopes. **No adapter or validator ran, and no budget was opened** (spy registry).
    - With DATA on alone: scan kinds are refused (UCT_AGENT_SCAN) and isolated kinds stay dormant.
    - A member is denied both routes.
  - Route table vs the pre-program base 51b9af9794, by AST: **exactly one Agent route added, POST /api/agent/data,
    admin-dark**. None were removed, and all 15 RC Agent routes are admin-dark.
  - Browser, flags off: the screener capability (run, runSaved own/starter, listSaved, no-turn run), every answer AND
    the full request sequence are **byte-identical between the pre-program base and the RC**, with no /api/agent/data call.
- **Open findings, all ruled:**
  - F-11: latent, with a lead hardening PR after the RC.
  - F-12: stock.compare composite rating, a known limitation; the owner decides.
  - F-13: wording, fixed.
  - F-14: read-only, fixed in #606.
  - Nothing blocks.

- **42d962963d — GREEN** (#572 integrated). The locked run's tree differed from this tip only by 2 lines of this file
  (two-dot `git diff`). Agent pytest under the lock: 1049 passed. Agent vitest: 115 files passed, 5 skipped;
  1988 passed, 6 skipped.
- **d837b6a96f — GREEN** (#579 quote freshness v1.1, #580 ADR-002 docs, #581 currentTurnId).
  No non-QA diff. Agent pytest under the lock: 1037 passed (agent-lead's 809 + agent-qa's 228).
  Agent vitest: 114 files passed, 5 skipped; 1967 passed, 6 skipped.
  The quote fixtures are regenerated to v1.1 (`regular|extended|closed`, `NOTE_SET_AS_OF_LIVE`, the adapter's note
  order). On 14 of 14 readable quote cases they are IDENTICAL to the merged adapter fed the same stamps on the same
  pinned clock (status, freshness, as_of, stale, notes, coverage, session, row keys).
- **c3a090e26f — GREEN** (#570 screen.run/count with the F-4 fix + precheck, #578 screen.saved + saved_id/text).
  No non-QA diff. Agent pytest under the lock: 1002 passed (agent-lead's 790 + agent-qa's 212).
  Agent vitest: 113 files passed, 5 skipped; 1966 passed, 6 skipped.
  The new clock rail (`test_uct_agent_qa_clock.py`, 16) lands in #572 on top of these counts.
- **862b0fa5ed — GREEN** (#569 quote/quotes, #571 gateway test, #575 pre-admission validate, #576 bars.daily).
  The tree was agent/int plus QA-only files: no non-QA diff, checked with `git diff --name-only`.
  Agent pytest under the lock: 938 passed (agent-lead's 730 + agent-qa's 208).
  Agent vitest: 113 files passed, 5 skipped; 1966 passed, 6 skipped (agent-lead's 1962 + agent-qa's 4).
- **76a45af859 — GREEN** (#569, #571). pytest 887 (711 + 176); vitest 1966.

## Verdicts on open PRs
- **#569 (agent-md, quote/quotes):** ownership check clean (4 files). Conformance review is pending agent-md's
  documented `data` fields.
- **#570 (agent-sc, screen.run/count) @ 77f9ff6087:** ownership check clean (6 files). An independent probe passes
  69 of 73 checks; the 4 failures are all **F-4** (zero matches). Passing: stale (>1 session behind) with its note,
  mixed sessions naming the oldest, stopped-bar drops (dropped/partial/excluded/absent from rows), dark with
  nothing executed, the 50-row cap, one scan per turn, and closing coverage. **Not ready** until F-4 is fixed or
  agent-lead rules on it. #570 also bumps SC-1 to v1.1, which needs agent-lead's acknowledgement.
