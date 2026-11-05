VERDICT: GO-WITH-NOTES @59bf931484

Delta re-review of `docs/pine/W9-STRATEGY-DESIGN.md` r3 (`origin/docs/pine-w9-strategy-design`
@59bf931484), against the r2 NO-GO @77859d00b4. Read-only: `git show`/grep on the doc, master
`646dca8cbf` and train `origin/integ/pine-train-2026-11-05` @1b8b4616d8. No vitest, census,
harness, rig or heavy job was run.

Summary: r2's blocker is fixed, and all r2 notes are answered. No new blocker. Builders may use
the doc. The two notes below are fixes to wording and classification. Neither changes any
behaviour today.

## r2 findings: status

**r2 B1 (the floor was applied per side): fixed.**
- T2 step 0 reads only TradingView's captured closed-trade count, from the fixture, before our
  output is read. A reference below 5 is UNGRADABLE on that symbol.
- At or above 5:
  - any difference, including a different trade count, is DIVERGE, naming the first unmatched
    fill by time and its `rule`;
  - all equal is MATCH.
- Routing to RDDT, then the SPY variant, then named-ungradable uses only this verdict. The 11
  SPY-probe scripts are captured on RDDT first and move only on TradingView's count.
- The rails are present:
  - reference 6 / ours 2 grades DIVERGE;
  - 2/6, 0/0 and 4/4 grade UNGRADABLE;
  - 5/5 equal grades MATCH;
  - an accessor spy proves step 0 never reads our count.
- The mutations are present: remove the floor; apply it to our count; read our count in step 0.
- The 5-trade size stays justified by r2's coverage argument (5.2 E, D10).

**r2 N1 (the lock rail failed non-pin bumps): fixed.**
- The rail looks up the entry at the greatest version <= `SCRIPT_ENGINE_VERSION`.
- Case 1: a ledger change with no bump is red.
- Case 2: a non-pin bump with no lock edit is green, and no other lane touches the lock.
- Cases 4-5: an edited, removed or out-of-order entry is red.
- Mutations: an exact-version lookup turns case 2 red; dropping the sha compare turns case 1
  green, so the rail fails.
- `SCRIPT_ENGINE_VERSION` remains the one authority, and W5's five-field identity is untouched.

**r2 N2 (`DEEP_BARS`): folded.**
`snapshot_builder.DEEP_BARS = HISTORY_WINDOW_BARS` is added to T14a and to the AST rail, with a
mutation. The existing-caller check is below; see N1.

**r2 N3 (T14a's dependencies): fixed.**
- W5-T11, W5-T14 and W5-T15 are stated as not on the train. Verified: none is an ancestor of
  `1b8b4616d8`; only W5-T12 is.
- T14a builds from the train tip and merges first, and the W5 lanes rebase.
- All three constants are on master and the train today: `scan_evaluator.py:227`,
  `screener_backtest.py:160`, `snapshot_builder.py:667`.

**r2 N4 (SPY warm-up): fixed.** The SPY variants use a 5x-lookback warm-up, and any that do not
converge are named UNGRADABLE.

**r2 N5 (re-translation per pin batch): accepted** as cost (one bump per capture-session batch).

## Does folding `DEEP_BARS` change any existing caller?

**Not today.** On the train, `DEEP_BARS` has one code consumer:
`snapshot_builder._read_daily_bars` calls `bars_sqlite.get_bars(ticker, "D", DEEP_BARS)`
(`:672`). Binding it to `HISTORY_WINDOW_BARS` (5,000) passes the same integer. Other mentions:
- `technicals.py:379`, a docstring;
- `snapshot_builder.py:472`, a comment;
- two docs.
No test asserts the literal. So the fold is behaviour-identical, as T14a claims ("the value is
still 5,000").

## Notes

N1. Folding `DEEP_BARS` rests on a false premise, and its future effect is not classified.
   - **The "API ceiling" premise is false.** 3.4 argues that `DEEP_BARS` is "the same quantity"
     partly because "its own comment says '5000 matches the bars API ceiling'". The bars API
     ceiling is not 5,000: `api/routers/bars.py:564` and `:1339` take `le=60000`, and
     `serve_bars_history` defaults to 60,000 (`:1184`). Only `warm_universe` defaults to 5,000
     (`:1383`). So that comment at `snapshot_builder.py:665-666` was already wrong.
   - **What `DEEP_BARS` actually defines.** It is the all-time-high depth. `build_row` hands the
     full read only to `technicals.ath_fields`; every other column uses `bars[-400:]`. So
     `DEEP_BARS` defines the member-visible screener columns `dist_ath_pct` and `new_ath`
     ("`DEEP_BARS` caps the read at ~20 years", `technicals.py:379`).
   - **The consequence.** After the fold, a D9 change to `HISTORY_WINDOW_BARS` also redefines
     "all-time high" in every member's screen. 3.4 says this is intended ("A longer window (D9)
     should deepen the snapshot's ATH read with it"), which is a legitimate choice.
   - **Fix:**
     - (a) Correct the premise in 3.4, and replace the `snapshot_builder.py:665-666` comment in
       T14a. Do not leave the false "API ceiling" sentence in place.
     - (b) Classify the coupling in D9: changing the constant also moves the ATH columns
       (`dist_ath_pct`, `new_ath`) for every screen, so D9 needs the screener owner's sign-off as
       well as W5's.
   - The alternative is to keep `DEEP_BARS` separate, with an owner ruling that ATH depth is its
     own quantity, and reword `scan_evaluator.py:223`. Either is acceptable once it is stated.
     The fold as written is a defensible choice argued from a wrong fact.

N2. A reference below 5 can hide our over-trading.
   With reference 2 and ours 6, the result is UNGRADABLE on RDDT, by the coordinator's ruling, and
   the script moves to its SPY variant. If the SPY variant is also below 5, the script is named
   ungradable, and a large over-trade by our broker never surfaces. That is the price of keeping
   our count out of routing, and the ruling stands. A non-gating diagnostic would still help:
   after a verdict is fixed, write both counts to the grade report so a reviewer can see 2 against
   6. It does not affect the verdict or routing, and step 0's spy rail stays as it is, since
   reading happens after step 0. Optional.

SHA reviewed: 59bf931484 (doc), 646dca8cbf (master), 1b8b4616d8 (train).
