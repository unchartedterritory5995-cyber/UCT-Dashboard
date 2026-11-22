# B2: TradingView's `USI:` breadth spellings in the engine, from UCT's own breadth (track 4, 2026-11-22)

Track 4 (the data indicators need), unit B2, on the coordinator's rulings of 2026-11-22. A member's Pine script that reads
NYSE or Nasdaq breadth as `request.security("USI:ADVN.NY", "D", close)` is read, on both lanes, from UCT's own breadth
counts (B1, `GET /api/pine/breadth/{spelling}`, Exchange Breadth V1), labelled **UCT breadth data (our own counts), not
the exchange's official figures**, and graded MATCH_SUBSTITUTED or a named divergence, never MATCH. Engine number: NUMBER
PENDING (train e95). Stacked on E2 (#2465), whose record and supply plumbing it reuses.

**Nothing a member reads changes today.** Every served spelling sits behind its capture witness (Q-T4-B1, W-B1), which
had not landed on 2026-11-22, so each refuses by name until that capture's one data edit lands. The licence it rests on
is the owner's ESC-03 answer (#2507: `massive` / `derived_analytics` reads LA for member display).

This document holds counts, codes and verdicts only. No breadth value and no TradingView value is committed.

## What is served (behind its witness), and how

| part | where |
|---|---|
| The vocabulary: served spellings, aliases, refusals, the words, the alignment constant | `app/src/components/chart/engine/pineBreadth.js` |
| The witness rows, one per spelling and alias, kind `breadth`, all PENDING | `requestWitnesses.json` (railed equal to `pineBreadth.js::breadthWitnessRow`) |
| The supply: one door per long spelling, never `/api/bars`, never `/api/ticker-meta` | `breadthSupply.js`, `useSecondarySources.js` (`USI~<SPELLING>` keys) |
| The bind, both lanes (the witness-row branch) | `otherSymbols.js::resolveOtherSymbols`, `markBreadthSeries` |
| The per-bar words before UCT's counts | E2's record mechanism keyed by code: `other-symbol:breadth-before-record` |
| The disclosure | `ast/symbolSubstitution.js` (`pineBreadth.js::breadthSourceNote`) |
| The grade rule | `tools/vendor_harness/compare.mjs` (`ours.breadth`, from `otherSymbols.breadthReadsOf`) |
| The capability | `request-breadth` (`api/services/pine_capabilities.py`, detector v4), pending, history-only |
| The assistant | `api/services/pine_authoring.py`: handed a spelling only while the breadth door serves members AND its capture is in |

Served spellings (B1's, railed equal by `tests/test_pine_breadth_b2.py`): `USI:ADVN.NY`, `USI:DECL.NY`, `USI:UNCH.NY`,
`USI:ADVN.NQ`, `USI:DECL.NQ`, `USI:UNCH.NQ`, `USI:ADD`, `USI:ADDQ`; aliases `USI:ADV`, `USI:DECL`, `USI:ADVQ`,
`USI:DECLQ` (each its own pending witness, U05/U06/U09/U10). On D, and on W / M by our resampler (`same-week` /
`same-month` folds, new; or `previous-week` / `previous-month` if the daily capture shows the previous session), each
block pending its own capture (Q-T4-B2, queued by this unit).

**The alignment** is the named constant `pineBreadth.js::BREADTH_DAILY_ALIGNMENT = 'same-date'`, witness pending. Both
answers the capture can give are placements the engine already knows (`same-date`, `previous-session`) and both are
railed (`requestBreadth.test.js` R4, with the landed edit injected); the landing is one data edit.

## Withheld by name, never `na`

| case | code | the member's words |
|---|---|---|
| a bar before UCT's counts begin (NYSE 2009-06-11, Nasdaq 2008-01-02) | `other-symbol:breadth-before-record` (per bar, both lanes) | "Not drawn before 2009-06-11: UCT's NYSE breadth counts start there, so what `USI:ADVN.NY` reads on those bars is not known here." |

ADD and ADDQ hold each session's close only: their open, high and low read `na` (never the close repeated), and the
disclosure says so. No breadth row carries a volume.

## Refused by name

| read | code |
|---|---|
| a served spelling whose capture has not landed (every one, today) | `other-symbol:witness-pending` (cites Q-T4-B1) |
| a weekly or monthly chart before Q-T4-B2 | `other-symbol:witness-timeframe` |
| up / down / total volume (`UVOL`, `DVOL`, `UVOLQ`, `DVOLQ`, `TVOL`, `TVOLQ`); TICK / TRIN | `other-symbol:breadth-not-held` |
| another exchange's counts (`.AM`, `.US`, `.DJ`, `.AX`, the A-suffixed forms) | `other-symbol:breadth-exchange` |
| any other `USI:` series | `other-symbol:breadth-unknown` |
| a spread string (`"(USI:ADVN.NY - USI:DECL.NY) / (USI:UNCH.NY + 1)"`, TradingView's built-in Advance Decline Line) | `other-symbol:breadth-spread` |
| an intraday chart | `other-symbol:breadth-intraday` |
| the door dark for the member (B1's stage below `all`) or refusing (the licence) | `other-symbol:breadth-not-available` |
| bare `ADVN` / `DECN` | `other-symbol:bare`, unchanged (U17/U18 of the capture decide whether TradingView maps them) |

**The spread is refused, not served** (coordinator: "spread support if the built-in ADL needs it and it is small;
otherwise refused by name, and say so"). Serving it needs an expression evaluator over several spellings' rows inside one
request, which is not small; the refusal tells the member the fix (one `request.security` per spelling, combined in the
script).

## Census: the 27 scripts that read `USI:`, through the member door, before (E2 base `ec58afda2a`) and after, both lanes

One closed daily bar, cap 1, no breadth supply, an empty library store (the same on both sides). Same answer on the
production lane and the runtime-on lane.

| | before | after |
|---|---:|---:|
| refused at the door | 25 | 21 |
| attached, every breadth read refused by name at bind | 2 | 6 |
| served (attached and bound clean) | 0 | 0 |

- **0 served -> refused. 0 refused -> served. No MATCH claimed.**
- 11 of 27 change their first named code: `venue-foreign` -> `witness-pending` at the door (3) or at bind after the door
  now attaches (3); -> `breadth-not-held` (1), -> `breadth-exchange` (1); `class-share` -> `breadth-spread` (1, the built-in
  ADL); one attached script's two table cells move from dropped at translation to translated and withheld by name at bind
  (its drawn objects are unchanged); one script reading bare and `USI:` spellings now attaches with both refused by name;
  the one `ADD` read at `"5"` moves from `venue-foreign` to the lower-timeframe refusal (`pine:request`, named).
- The other 16 keep their code: their first wall is elsewhere (another request, a library import, objects, a type).

## Grade diff

W-B1 (Q-T4-B1) and W-B2 (the built-in Advance Decline Line / Ratio) had **not landed**, so no capture of a `USI:` read on
our breadth supply exists yet: the grade of a served breadth read is owed to them.

The six committed captures whose scripts read breadth (`tests/fixtures/vendor/harness`: two each of three corpus
scripts), graded before and after on both lanes (12 grades): **every verdict and every plot verdict unchanged**
(INCONCLUSIVE, refused on our side or a plot not comparable); the reasons of two scripts' four grades now name
`breadth-not-held` where they named `venue-foreign`. The committed `docs/pine/vendor-harness/*/verdicts.json` snapshots
still carry the old reason text (snapshots, not compared in CI).

## Rails and mutants

- `app/src/components/chart/engine/requestBreadth.test.js` (R1-R7): the rows are the template and pending; every refusal
  by name; isolation (the breadth door only, never `/api/bars`, never the exchange lookup); the placement on both lanes at
  both alignments; the per-bar words; weekly by our resampler; the bind's refusals and waits; the member's words.
- `app/src/components/chart/engine/breadthSupply.test.js`: one ask per long spelling; 200 / 202 / 404 / refused /
  failure / abort; ADD close only.
- `app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b2Breadth.test.js`: a real run grades MATCH;
  tagged as reading UCT breadth it grades MATCH_SUBSTITUTED; a DIVERGE stays DIVERGE and names what it read.
- `tests/test_pine_breadth_b2.py`: the engine serves exactly B1's spellings; the rows name B1's door; the capability; the
  assistant handed a spelling only at `all` with its capture in.
- `ci/mutants/t4-b2-breadth.json`: 16 mutants (BR1-BR16), run by `tools/ci_mutant_runner.py` (byte-identical restores).

## Open, by name

- **Q-T4-B1 (W-B1)** lands: fill each row's `witness` + `captured`; flip `BREADTH_DAILY_ALIGNMENT` if it shows the previous
  session. Size each spelling's divergence from the capture and put it in the member's sentence.
- **Q-T4-B2** (queued here): the weekly and monthly blocks.
- **The capability** `request-breadth` is admitted by the coordinator once two scripts (one community) grade
  MATCH_SUBSTITUTED with the runtime pane on against our production supply.
- **B1's stage** goes to `all` (and `PINE_BREADTH_SUPPLY_ENABLED=all` on web) only when B2 ships.
- **The spread unit** (next section), ranked first among the breadth follow-ups.

## B3 (up / down volume as a new derived series): NOT in this unit

What it would need: a per-session up-volume and down-volume total per exchange (the volume of operating equity that
closed up / down), derived by the breadth producer from the same 1-minute composites B1's counts come from, held from
the same coverage starts, served by B1's door under `USI:UVOL`, `USI:DVOL`, `USI:UVOLQ`, `USI:DVOLQ` (and `TVOL` /
`TVOLQ` as their sum), its own witness rows (the probe's U12-U16 already capture TradingView's), and the same grade rule.
The census's 9 `UVOL` / `DVOL` readers are its demand. Until then those spellings refuse `other-symbol:breadth-not-held`.
