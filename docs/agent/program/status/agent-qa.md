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

## Verdicts on `agent/int`
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
