# F1b: `request.financial` in the engine, as UCT data (track 4, 2026-11-22)

Track 4, unit F1b. When a member's Pine script calls `request.financial` on its chart's own symbol, the engine now
draws the figure on both lanes from UCT's own point-in-time fundamentals store (company filings). It never uses
TradingView's figures, and it never grades one as TradingView's (Studio ruling 2026-11-14). Engine number: NUMBER
PENDING (train e95). This is a draft stacked on #2465 (E2), never merged alone. F1a (#2506) is the backend door.

This document holds counts, dates and verdicts only. No corpus source and no TradingView value is committed.

## What is served

| `request.financial` id | period | UCT series (fundamentals_pit) |
|---|---|---|
| TOTAL_REVENUE | FQ / TTM | revenue_q / revenue_ttm |
| EARNINGS_PER_SHARE_DILUTED | FQ / TTM | eps_diluted_q / eps_diluted_ttm (GAAP, today's share basis) |
| TOTAL_EQUITY | FQ | equity |
| TOTAL_SHARES_OUTSTANDING | FQ | shares_outstanding |
| FREE_CASH_FLOW | TTM | fcf_ttm |

These are served on daily, weekly and monthly charts, with `gaps_off` (the default) or `gaps_on`. One map serves
both the server and the chart: `pineDataCatalog.json` `financial.fields`.

| part | where |
|---|---|
| The parse rewrite: each call becomes a data read, one series per id, period and `gaps` | `pine.js::eventAsSecurity` (E2's), via `pineEvents.js::eventCallParts` -> `pineFinancial.js::financialCallParts` |
| The read's name, its static refusals, the placement, the member's words | `app/src/components/chart/engine/pineFinancial.js` |
| The bind's decision (both lanes ask it) | `otherSymbols.js::financialDecision` (through `eventDecision`) |
| The supply: one door per chart symbol, never `/api/bars` | `financialSupply.js` (`GET /api/pine/financial/<symbol>`, F1a), `useSecondarySources.js` (`FINANCIAL_KEY`); the door cache is E2's, now one factory for both doors (`eventSupply.js::makeDoorCache`) |
| The per-bar code | `other-symbol:financial-unknown` (`interpret.js::FINANCIAL_UNKNOWN_CODE`) |
| The capability | `request-financial` (`api/services/pine_capabilities.py`, detector v4), history-only, row pending (not admitted) |
| The grade rule | `compare.mjs::uctDataOf`: a run that read UCT data never reads MATCH |
| The assistant | `pine_authoring.FINANCIAL_READS`: handed over only while `PINE_FINANCIAL_SUPPLY_ENABLED=all` |

## Placement (point in time)

- A figure steps on the first chart bar whose session close is at or after the figure's `knownFrom` (F1a).
  - `knownFrom` is the first session whose close follows the filing's public instant, so a filing made public after
    the close is known from the next session.
  - The fiscal period end is never used.
- `gaps_off` carries the figure forward. `gaps_on` reads it on that bar and `na` on every other bar.
  - A figure made public before the chart's first bar is carried into it, but did not step there, so `gaps_on`
    reads `na` on that bar.
- **TradingView may date a figure at the earnings release rather than at the filing**, so the two can differ by
  days. That is why these plots are never graded MATCH. The member's note says so: "each value is dated when its
  filing became public, which can be days after the earnings release".

## Withheld by name, never `na`, never carried

A bar is withheld when UCT knows no current figure on it. There are three cases:

- no filing that yields the figure had become public yet;
- the figure in force is a store **gap** (the newest filing did not yield it);
- the figure is past its `staleFrom` (its fiscal period is older than the store's staleness cap).

The series starts after the chart's **last** unknown bar. Both lanes then withhold every bar before it under
`other-symbol:financial-unknown`:

- the host lane withholds them per bar, with the strip's sentence;
- the runtime lane withholds them by its depth, with `knownFromCode` and `knownFromReason`.

**Why the series starts after the last unknown bar rather than withholding each unknown span:** the runtime lane
refuses a whole run on a hole inside a series' history, while the host lane withholds only the hole's reach. Cutting
the series at its last unknown bar makes both lanes agree and keeps the rule sound.

Measured on production (read-only, as the synthetic admin, 25 symbols): gaps are common in FCF TTM (NVDA: 30 of
42 points) and occur in revenue TTM (PFE 18, GE 18). Stale spans occur (CRM, SMCI). A chart of such a symbol draws
from its last unknown bar on.

The member's words for each case:

| case | sentence |
|---|---|
| before the first filing | "Not drawn before <date>: UCT's figures for <SYM>'s `<ID>` (`<P>`) come from company filings, and none that yields it had become public before then, so what it read on earlier bars is not known here." |
| a gap | "Not drawn before <date>: on <day> UCT did not know a current figure for <SYM>'s `<ID>` (`<P>`) (the newest company filing did not yield it), so what this read carries across that bar is not known here." |
| stale | "Not drawn before <date>: on <day> the latest figure UCT held for <SYM>'s `<ID>` (`<P>`) described a fiscal period too old to be current (no newer company filing yielded it), so it is not carried there." |

## Refused by name

| refusal | code |
|---|---|
| an id UCT does not serve, named with its own reason (the census ids: EARNINGS_PER_SHARE, GROSS_MARGIN, TOTAL_DEBT, BOOK_VALUE_PER_SHARE, FLOAT_SHARES_OUTSTANDING, the estimates, DPS, ACCOUNTS_PAYABLE, EARNINGS_DATE, FUND_FLOWS, AUM, ...); any other id, with the list of what is served | `other-symbol:financial-field` |
| a period UCT does not serve for the id (FY, FH, D), or a period not written as a constant | `other-symbol:financial-period` |
| another symbol | `other-symbol:financial-symbol` |
| another currency | `other-symbol:financial-currency` |
| an id, symbol or `gaps` argument not written as a constant | `other-symbol:financial-argument` |
| an intraday chart | `other-symbol:financial-timeframe` |
| the door dark for the member ("financial figures are not available on this chart yet") | `other-symbol:financial-not-available` |
| the company's filings do not yield the figure, or the symbol has none | `other-symbol:financial-none` |
| a per-share figure or share count while the split history is unverified | `other-symbol:financial-withheld` |
| the engine's internal name written by a script | `other-symbol:event-spelling` |

## The disclosure

Every plot of a script that reads `request.financial` carries this note:

> This script reads `request.financial`. It uses UCT data (company filings), not TradingView's figures: each value is
> dated when its filing became public, which can be days after the earnings release, and its figures can differ from
> TradingView's.

The note does not name the SEC. The catalog's vendor-name rail (owner item O1, the T-46 default) forbids any
member-facing sentence from naming a source. Whether "SEC filings" may be said, as other SEC-sourced panels already
say it on screen, is a question for the owner (O1).

## Census and grade diff

**Census diff.** I ran the 7 community scripts that read `request.financial` and TradingView's reference example
through the member door, before F1b and after, on both lanes. "Before" is the F1b branch's parent (E2 + F1a). The
inputs were the full-census corpus; no library store was loaded, and the two sides are identical in that respect.

| lane | not attached -> attached (translation, step 0) | attached -> refused | unchanged |
|---|---:|---:|---:|
| production | 2 | 0 | 6 |
| runtime-on | 2 | 0 | 6 |

- **The two rows that move** are the one community script whose only wall was data (the counterfactual's "freed by
  the data alone") and the reference example. Both now translate and attach, and their reads are then **refused by
  name at the bind**:
  - the community script reads every figure with a period chosen by an input (not a constant:
    `other-symbol:financial-period`), and four of its six ids are not served (book value per share, basic EPS, the
    analyst estimate, DPS);
  - the example reads `ACCOUNTS_PAYABLE` of another symbol (`other-symbol:financial-field`).

  So neither draws a figure. That matches the census note: F1 alone frees no script.
- **The six unchanged rows** keep walls outside F1b: objects-only, an unreadable table property, a library import,
  an enum input, and no output.
- **0 rows went from served to refused.** The census measures one closed daily bar with no financial supply, so
  `cleanBound` stays false on every row on both sides.

**Grade diff.** No local TradingView capture reads `request.financial`. I searched all 250 runs in the capture store;
the only mention is a manifest note. So no row is graded on either side, and **0 MATCH is claimed**. Any future
capture of such a script grades INCONCLUSIVE, named "a UCT-data substitution" (`compare.mjs::uctDataOf`, railed in
`vendorHarness.test.js`). It can never grade MATCH.

**The supply was measured on production**, read-only, as the synthetic admin, through the existing PIT series route
(F1a reads the same artifact): 25 symbols. The store answers for all 25.
- XOM has only two points: its XBRL history in the store starts 2026-08-03.
- GE's per-share figures are withheld: its split ledger is unverified.
- META, GOOGL, PLTR and RDDT hold no `shares_outstanding`: they are multi-class issuers, and the catalog records this
  limitation.

## Rails and mutants

- `app/src/components/chart/engine/requestFinancial.test.js` covers:
  - the rewrite and every mapped pair;
  - each static refusal, and the internal name (never fetched);
  - placement on both lanes (gaps off and on), weekly and monthly;
  - the three withheld cases with their per-bar code and words on both lanes, plus a control;
  - the bind refusals, the memo (the chart's memoised run recomputes on a refreshed answer), and the disclosure.
- `app/src/components/chart/engine/financialSupply.test.js` covers the financial door: one ask per symbol, dark, pending, separate from the events door, and never `/api/bars`.
- `vendorHarness.test.js` checks that a run reading UCT data grades INCONCLUSIVE ("a UCT-data substitution"), never MATCH. Its control is the same run without the read, which grades MATCH; a DIVERGE stays DIVERGE.
- `tests/test_pine_authoring.py` checks that the assistant is handed `request.financial` only at `PINE_FINANCIAL_SUPPLY_ENABLED=all`.
- `tests/test_pine_capabilities.py` covers `request-financial` beside `request-other`.
- `ci/mutants/t4-f1b-financial.json` holds 14 mutants (FN1-FN15, without FN11).

**Mutants: 14 of 14 KILLED, every file restored byte-equal.** They ran on GitHub's runners (pine-heavy,
`mutants_manifest`, run 45054900576) at `94a094d978`, through `tools/ci_mutant_runner.py`.

The first run (45052829528, 15 mutants) left two survivors and one hollow kill. Each was handled:

- **FN11 survived, and was dropped.** It mutated the data-read skip in `fetchableOtherSymbols`. That skip is one of
  three guards keeping a data read out of `/api/bars`: E2's skip, the internal-name spelling refusal, and the venue
  check. A one-line mutant of one guard cannot break the isolation. FN1 breaks the one path that does reach the
  bars door (the financial key handed to `ensureAll`), and it is KILLED.
- **FN13 survived, and was re-aimed.** It had mutated the depth-probe regex, which is only an optimisation: the run
  finds the depth through its own refusal. FN13 now targets the runtime memo key (`requestSupplyKey`), and a new
  rail drives it through `runtimeColumnsFor`. It is KILLED.
- **FN15's first kill was hollow.** Its rail waited on the generated reference, so it was red before the mutant
  ran. The rail now states its own premise, so it is green on the code and red under the mutant. It is KILLED.
