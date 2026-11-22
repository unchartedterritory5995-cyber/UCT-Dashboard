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

## W-B1 (Q-T4-B1) landed, 2026-11-22: the alignment, the six witnessed spellings, and how far our counts are

Two captures (`t4-wb1-2026-11-22`, rig-clean, no compile error): `vw-data-usi` (U01-U20) on AMEX:SPY 1D (8,512 bars from
1993) and NYSE:RDDT 1D (671). Our side is production's B1 answer of 2026-11-22 (read as the synthetic admin; held
locally, never committed). Derived counts only below; the capture stays local.

- **The alignment is `same-date`** (`BREADTH_DAILY_ALIGNMENT` unchanged). Median |ours - TradingView's|, same-date
  against previous-session: ADVN.NY 549 / 599, DECL.NY 438 / 577, UNCH.NY 49 / 50, ADVN.NQ 448 / 545, DECL.NQ 402 /
  552, ADD 241 / 927. U01 (`"D"`) and U02 (`timeframe.period`) agree on every bar; the SPY and RDDT charts read the same
  series (671 of 671 shared sessions equal).
- **Witnessed and served behind the door** (`requestWitnesses.json` `witness` + `captured`, `BREADTH_DAILY_WITNESS`):
  `USI:ADVN.NY`, `DECL.NY`, `UNCH.NY`, `ADVN.NQ`, `DECL.NQ`, `ADD`. Not in the probe, still pending: `UNCH.NQ`, `ADDQ`.
- **The grade: a named divergence on every witnessed spelling, never MATCH_SUBSTITUTED.** Our counts (operating equity,
  common stock and ADRs) against the exchange's (all issues), same-date, every session both hold
  (`BREADTH_DIVERGENCE`, said in the member's note):

| spelling | sessions (from) | median \|difference\| | as a share of TradingView's | ours lower |
|---|---|---:|---:|---:|
| ADVN.NY | 4,389 (2009-06-11) | 549 | 36% | 99.8% |
| DECL.NY | 4,389 (2009-06-11) | 438 | 32% | 99.7% |
| UNCH.NY | 4,389 (2009-06-11) | 49 | 55% | 99.8% |
| ADVN.NQ | 4,752 (2008-01-02) | 448 | 31% | 99.6% |
| DECL.NQ | 4,752 (2008-01-02) | 402 | 27% | 99.7% |
| ADD | 4,389 (2009-06-11) | 241 | 29% | 61% |

- **The four short spellings are NOT aliases.** TradingView's `USI:ADV` / `DECL` / `ADVQ` / `DECLQ` equal its long
  spellings on 21 / 32 / 31 / 40 of about 8,000 sessions: they are other series. TradingView's `USI:ADD` is `ADV` -
  `DECL` on 6,555 of 8,321 sessions and `ADVN.NY` - `DECL.NY` on 25. So the aliases stay refused by name
  (`witness-pending`); what they are (likely a common-stock universe) is a unit of its own, for the coordinator. And
  UCT's `USI:ADD` is UCT's advancing less declining, which matches neither of TradingView's exactly.
- The bare `ADVN` / `DECN` (U17 / U18) are a third pair of series on TradingView (from 2007-09-28); they keep `bare`.
- The spread (U19, TradingView's built-in Advance Decline Line string) stays refused by name (`breadth-spread`).

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

- **Q-T4-B1 (W-B1)** LANDED 2026-11-22 (section above): six spellings witnessed and sized; the alignment stays same-date.
- **Q-T4-B2** (queued here): the weekly and monthly blocks.
- **The capability** `request-breadth` is admitted by the coordinator once two scripts (one community) grade
  MATCH_SUBSTITUTED with the runtime pane on against our production supply.
- **B1's stage** goes to `all` (and `PINE_BREADTH_SUPPLY_ENABLED=all` on web) only when B2 ships.
- **The spread unit** (next section), ranked first among the breadth follow-ups.

## The next breadth unit: the spread (an expression over several breadth spellings in one request)

**Ranked first among the follow-ups** (coordinator 2026-11-22): TradingView's built-in Advance Decline Line is the most-used
breadth script, and it reads exactly one spread string, `"(USI:ADVN.NY - USI:DECL.NY) / (USI:UNCH.NY + 1)"`, which B2
refuses by name (`other-symbol:breadth-spread`).

What it needs:
- **Parse** the string into an expression over served breadth spellings: `+ - * /`, parentheses, numeric constants, every
  operand a served `USI:` spelling (anything else keeps the refusal, by name). One new parse rule beside
  `pine.js::otherSymbolOf` (a marked node, as E2's event read is), so both lanes read it as one other-symbol series.
- **Supply** each operand from the breadth door (the B2 keys, already isolated), and **combine** per session date: a
  session missing any operand is withheld by name, never computed from a partial row; the first combined session is the
  series' coverage start (the per-bar words already exist). Which OHLC fields the combination carries is the capture's to
  say (close at least; "close only" as ADD otherwise).
- **Witness**: the probe's U19 already captures the spread on SPY / RDDT 1D (Q-T4-B1), and the built-in ADL captures
  (W-B2) grade it end to end.

**Estimate: about one engine day** (the parse rule and its static refusals, about 150 lines; the per-date combination and
its record, about 100; rails on both lanes and 6-8 mutants), plus one grade pass once W-B1 / W-B2 land. Nothing in B2
needs to change for it.

## B3 (up / down volume as a new derived series): NOT in this unit

What it would need: a per-session up-volume and down-volume total per exchange (the volume of operating equity that
closed up / down), derived by the breadth producer from the same 1-minute composites B1's counts come from, held from
the same coverage starts, served by B1's door under `USI:UVOL`, `USI:DVOL`, `USI:UVOLQ`, `USI:DVOLQ` (and `TVOL` /
`TVOLQ` as their sum), its own witness rows (the probe's U12-U16 already capture TradingView's), and the same grade rule.
The census's 9 `UVOL` / `DVOL` readers are its demand. Until then those spellings refuse `other-symbol:breadth-not-held`.
