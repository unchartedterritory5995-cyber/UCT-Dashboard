# Vendor truth — the only oracle that can say we are RIGHT

> ⛔⛔ **EVERY OTHER NUMBER IN THIS REPO IS OURS.** Read that sentence twice
> before adding anything here, because the whole value of this directory is that
> nothing in it comes from us.

## Why this exists

We hold four kinds of numeric rail, and until 2026-08-29 **not one of them could
detect a wrong number**:

| rail | what it proves | what it cannot see |
|---|---|---|
| `tools/ast_conformance.py --check` | the JS and Python lanes agree at 1e-9 | two lanes agreeing on a **shared misconception** — a wrong reading of `closedTable.json` is read identically by both |
| `tests/fixtures/indicators/*.json` | our engine has not **changed** | whether it was ever right: `_generate.py:305` sets `expected = ic.compute_case(...)` — *our own core* |
| `tools/chart_parity.py` | the picture matches the committed picture | the same, in pixels |
| `tools/alert_replay.py` | fires reproduce | it derives its clock from the thing under test |

`tools/ast_conformance.py`'s own header names inheritance (1) and says *"what
covers that is the golden fixtures"*. **The golden fixtures do not cover it.**
They are generated from `indicator_compute`. The pointer is circular, and it has
been circular since the fixtures were written.

So: our indicators could disagree with TradingView on every bar of every symbol
and **every gate in this repository would stay green**. For a product whose
promise is *"paste your script and it looks the same"*, that is the deepest hole
in the build, and it is the one hole no amount of internal testing can fill.

## The rule this directory exists to enforce

> **A number in this directory was READ OFF THE VENDOR'S OWN SCREEN.**
> It was not computed here, not derived here, not "checked against" anything
> here, and not remembered. If you cannot say which chart it was read from, on
> what date, by whom, it does not belong in this directory.

⛔ **A PLAUSIBLE NUMBER IS WORSE THAN NO NUMBER.** An invented "vendor" value
does not merely fail to help — it converts this harness from an oracle into a
mirror, and it does so silently, forever, because nothing downstream can tell an
observed number from a manufactured one. If you are tempted to fill a gap with
"what it obviously should be", leave the gap. The harness reports gaps loudly and
on purpose (`tools/vendor_truth.py --coverage`).

## ⭐ AN OBSERVATION CARRIES THE VENDOR'S OWN BARS. THIS IS NOT OPTIONAL.

The single most important design decision here, and the one that is easy to get
wrong: **the OHLCV comes off the same chart as the plotted value.**

If we compute against *our* bars and compare to *their* plotted number, a delta
has two possible causes — our maths differs, or our data differs — and the
harness cannot tell you which. That is an unattributable measurement, which is
the shape this repo has paid for repeatedly. Carrying the vendor's own bars
removes the data axis entirely: given identical inputs, any delta **is** a maths
delta, and the finding is actionable the moment it appears.

⚠️ It also means a vendor observation is a big object. That is fine. Six
observations that can each attribute a delta are worth more than six hundred that
cannot.

## Transcription protocol

1. Open the script on the vendor platform. Use the **exact** text in
   `script.source` — not a paraphrase, not a "cleaned up" version.
2. Pick a symbol and timeframe with **no splits or dividends** in the window, or
   the bars and the plot will disagree with each other. Daily bars on a large-cap
   over a recent 6–12 month window is the boring, correct choice.
3. Read off the OHLCV **and** the plotted value for each recorded bar, from the
   same chart, in the same session. The vendor's data window / Data Window pane
   gives more decimal places than the tooltip — use it.
4. Record **every** digit the vendor shows. Do not round. `readDecimals` states
   how many the vendor displayed, so the harness can distinguish "we differ" from
   "they showed fewer digits than we did".
5. Fill `provenance` completely. `who`, `when`, `platform`, `platformVersion`,
   `chartUrl` where one exists.
6. Run `python tools/vendor_truth.py --check`. Record what it says **in the
   commit**, including a delta if there is one. A delta is a finding, not a
   failure — see below.

## A delta is a FINDING, not a failure

When our number and the vendor's differ, exactly one of three things is true, and
the harness's job is to make you say which:

- **an explained divergence** — it matches a row in `divergences.json`, a
  deliberate, documented difference in convention (e.g. a seeding rule). The row
  carries the reason and the decision.
- **an unexplained divergence** — it does not match any row. This is a BUG until
  proven otherwise, and it is the most valuable output this directory produces.
- **a transcription error** — the number was read wrong. Re-read it. This is
  common and not embarrassing; it is why `provenance.who` exists.

⛔ **Never widen a tolerance to make a delta go away.** The tolerance in an
observation states the vendor's own display precision, and nothing else. If a
delta exceeds it, the answer is a `divergences.json` row with a reason, or a fix
— never a bigger number in the fixture.

## Files

- `observations/*.json` — one file per observation. Schema below.
- `divergences.json` — the named, deliberate differences from vendor behaviour.
  Each row must carry a `probe` that DISCRIMINATES: a case whose value differs
  under the two conventions, so the row cannot rot into a description of nothing.
- `tools/vendor_truth.py` — the runner. `--check`, `--coverage`, `--selfcheck`.
- `tests/test_vendor_truth.py` — the rail, including the positive control that
  proves the harness can detect a planted disagreement.

## Observation schema

```jsonc
{
  "id": "sma20-aapl-daily-2026",        // unique, kebab, names symbol+tf
  "shape": "stateless",                  // stateless | seeded | stateful — see below
  "script": {
    "dialect": "pine",                   // pine | thinkscript | pcf
    "source": "//@version=5\nindicator(\"x\")\nplot(ta.sma(close, 20))\n",
    "plot": "plot0"                      // WHICH plotted line the values are from
  },
  "engine": {
    "formula": "sma(close, 20)",         // what OUR translator produced
    "ast": { "...": "canonical tree" }   // recorded so the Python lane needs no node
  },
  "market": {
    "symbol": "AAPL",
    "timeframe": "1D",
    "bars": [ { "t": 20260102, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1000 } ]
  },
  "vendor": {
    "readDecimals": 2,                   // how many the vendor DISPLAYED
    "values": { "20260210": 187.43 }     // bar `t` → the plotted value, verbatim
  },
  "provenance": {
    "platform": "TradingView",
    "platformVersion": "Pine v5, web, 2026-08",
    "who": "…",
    "when": "2026-08-29",
    "chartUrl": null,
    "note": "read from the Data Window, not the tooltip"
  }
}
```

### The three shapes, and why the roster is exactly these

Coverage is measured over **shapes**, not over scripts, because the failure modes
live in the shapes:

- **`stateless`** — bar *i*'s value is a function of a fixed window ending at *i*
  (`sma`, `wma`, `stdev`). If we are wrong here we are wrong about arithmetic,
  which is the least likely and easiest to fix.
- **`seeded`** — a recursive smoother whose answer depends on how the FIRST value
  was chosen (`rma`/Wilder, `ema`). Two engines can implement identical
  recurrences and diverge forever because one seeded with an SMA and the other
  with the first close. **This is where a silent divergence is most likely and
  hardest to notice**, because it decays rather than persisting: the two curves
  converge, so a delta that is glaring at bar 30 is invisible at bar 300 and the
  fixture window decides whether you see it.
- **`stateful`** — a value carrying a decision forward across bars (supertrend,
  a flip that latches). A divergence here does not decay, it **latches** — one
  disagreement about one bar changes every later bar, so it is the shape where a
  small maths difference produces a completely different indicator.

A `--coverage` run that reports a shape at zero is telling you the class of bug
this repo currently cannot see.
