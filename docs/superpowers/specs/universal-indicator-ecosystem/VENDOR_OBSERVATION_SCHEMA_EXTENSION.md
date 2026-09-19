# Vendor-observation schema extension proposal — synthetic-input provenance

**Status:** 🟡 PROPOSED (the `input` field, below), minimal, additive-only,
tested for forward-compatibility. **PLUS a second ruling, ALREADY IMPLEMENTED
AND TESTED as of 2026-09-05 (see "Addendum" at the end): vendor-observed and
UCT-parity-verified are different claims, and `tools/vendor_truth.py` is now
patched so a pre-implementation observation (`engine.ast: null`) can never
inflate a parity count.** Not yet used by any real observation (none exist in
`tests/fixtures/vendor/observations/` today).

## The gap

`tests/fixtures/vendor/README.md`'s observation schema assumes every
observation's computation runs over `market.bars` — real OHLCV read off a
vendor chart, per the schema's own load-bearing rule ("an observation carries
the vendor's own bars... this is not optional"). The `OWNER_VENDOR_CAPTURE_
PACKET_V3.md` oracle breaks that assumption for three of its four checks:
`ta.rising`, `ta.median`, and `ta.percentrank` are evaluated over a
`bar_index`-derived synthetic series (`raw`), not real price. `ta.bbw` also
uses the same synthetic series in this particular capture, though it need not
in general.

**Two bad options, both rejected:**
- Put the synthetic values inside `market.bars`'s `o`/`h`/`l`/`c`/`v` fields,
  pretending they are OHLCV. This is exactly the "a plausible number is worse
  than no number" failure the vendor-truth directory exists to prevent,
  applied to the bars field itself — a future reader would have no way to
  tell a real quote from a fabricated one just by looking at `market.bars`.
- Leave `market.bars` empty for a synthetic-input observation. This violates
  the schema's own stated, load-bearing rule that an observation always
  carries the vendor's own bars (needed here for a different reason than
  usual: proving which real chart was actually open when the vendor's builtin
  ran, since a Pine script still executes in the context of *some* chart even
  when its own formula ignores that chart's prices).

## The proposal

One new **optional**, sibling top-level key: `input`.

```jsonc
{
  "id": "ta-rising-runmax-vs-monotone-2026-09",
  "shape": "stateless",
  "script": { "dialect": "pine", "source": "...", "plot": "rising_builtin" },
  "engine": { "formula": null, "ast": null },   // not yet implemented in the
                                                  // engine -- see below
  "market": {
    "symbol": "AAPL", "timeframe": "1D",
    "bars": [ /* the REAL bars that were actually on the chart -- untouched,
                 never fabricated, exactly as the existing rule requires */ ]
  },
  "input": {
    "kind": "synthetic",                          // "synthetic" | "market"
    "formula": "phase = bar_index % 25; raw = phase==24 ? 6.0 : ...",
    "valuesAtProbe": {
      "phase": 24, "raw": 6.0,
      "raw[1]": 3.0, "raw[2]": 5.0, "raw[3]": 1.0, "raw[4]": 9.0
    }
  },
  "vendor": { "readDecimals": 6, "values": { "<bar-t-of-the-probe-row>": 1 } },
  "provenance": { "platform": "TradingView", "platformVersion": "Pine v5, web",
                   "who": "...", "when": "2026-09-05", "chartUrl": null }
}
```

- **`market.bars` is never touched or overloaded** — it stays exactly what
  the schema already requires: the real chart's real bars, for provenance
  (which real chart environment produced this run), never the computation's
  actual input.
- **`input.kind`** makes synthetic-vs-market unambiguous by construction — a
  reader (human or `vendor_truth.py`) can tell instantly which observations
  read real price and which don't, rather than inferring it from whether the
  numbers "look like a stock price."
- **`input.formula` + `input.valuesAtProbe`** carry exactly what actually drove
  the compared result — the thing `market.bars` would have carried if the
  computation were price-based.
- **Omitted entirely for an ordinary market-data observation** — this is
  purely additive; every existing (i.e., hypothetical, since none exist yet)
  or future plain-market observation is valid with no `input` key at all.

## Why this doesn't require a `vendor_truth.py` code change to be safe

Verified directly, not assumed: `tools/vendor_truth.py`'s observation loading
(`load_observations`, `evaluate`, `check`) reads specific keys via plain
`.get()`/dict-indexing and validates only that the fields IT needs are present
(`REQUIRED_PROVENANCE`, `vendor.values` non-empty) — it does not reject an
observation for carrying an extra, unrecognized top-level key. An `input`
field is therefore inert to the current tooling: present, ignored, safe. A
future patch that wants to actually USE `input` (e.g. to render a synthetic-vs-
market badge in a coverage report) can add that reader without a migration,
because every observation written before this proposal — there are currently
zero — remains valid with or without the key.

**Tested, not just argued**: `tests/test_vendor_truth.py::
test_a_SYNTHETIC_INPUT_field_is_forward_compatible_and_does_not_break_check`
constructs an observation carrying this exact proposed `input` field alongside
an untouched, real `market.bars`, and asserts `vendor_truth.check()` still
returns 0 and reports the same "1 observations, 1 compared values" it would
without the field. Run directly for this proposal:

```
python -m pytest tests/test_vendor_truth.py -v
→ 16 passed (was 15 before this test was added)
```

## Addendum, 2026-09-05 — the RISK-018-shaped conflation risk, found and closed

Owner review asked a sharper question than "is this schema addition safe": **can
an observation whose `engine.formula`/`engine.ast` are `null` (exactly what
every `ta.rising`/`ta.bbw`/`ta.percentrank`/`ta.median` observation will be,
since none of the four are implemented yet) be silently counted as if it were
UCT vendor-parity evidence, simply because the observation FILE is structurally
complete?**

**Tested directly rather than reasoned about**: before this addendum, calling
`vendor_truth.compare()` on such an observation raised `TableRefusal: not a
canonical node got None` — `evaluate()` calls `interpret(obs["engine"]["ast"],
...)` unconditionally, with no null guard. This is LOUD (the harness's own
stated philosophy: silence is never success), but it is the wrong kind of loud
— it would crash `check()`'s entire run, for every OTHER real observation too,
the moment a single pre-implementation observation existed in the store.
Neither the crash nor a hypothetical silent-pass would have been acceptable.

**The distinction implemented, named explicitly rather than left implicit:**

- **`vendor_observed` / "vendor semantics captured"** — a real screen value
  exists; `engine.ast` is `null` because no UCT implementation exists yet.
  This is real, valuable, pre-implementation research evidence.
- **`parity_comparable`** — `engine.ast` is present; `vendor_truth.check()`
  actually runs the comparison and reports MATCH or DELTA for it this run.
- **There is no third, separately-stored `parity_verified` flag.** Per this
  proposal's own "don't invent a second authority" reasoning above, whether a
  `parity_comparable` observation currently PASSES is `check()`'s own live
  output each run — baking a `parity_verified: true` boolean into the
  observation file would create exactly the drift risk (a stored claim that
  can silently stop matching a re-derivable truth) this whole directory's
  philosophy exists to prevent. "Verified" is a fact about the LATEST run,
  not a property an observation file gets to assert about itself.

**Derived from `engine.ast`'s presence, not a fourth stored status field** —
deliberately, for the identical reason: a separately-written `status:
"vendor_semantics_only"` string could drift from whether `engine.ast` is
actually null (someone adds an AST later and forgets to flip the flag, or vice
versa). `engine.ast is None` already IS the fact these labels describe: there
is nothing to derive it FROM except itself.

**What changed in `tools/vendor_truth.py`** (small, targeted, this is Track A
vendor-harness infrastructure, not Track F implementation):
- `check()` now partitions observations into `comparable` (`engine.ast` is
  not `None`) and `semantics_only` (`engine.ast is None`) before doing
  anything else. Only `comparable` observations are ever passed to
  `compare()`/`evaluate()`. The denominator line names both counts explicitly
  (`"N observations held, M parity-comparable, K vendor-semantics-only... T
  compared values"`), and every semantics-only observation is listed by id so
  it is never silently absent from the report either.
- **If ZERO observations are parity-comparable — even though some are held —
  `check()` now REFUSES (exit 2) rather than printing a vacuous "0 deltas,
  pass."** This is the same shape as the file's own pre-existing empty-store
  refusal, reached through a different door: holding only vendor-semantics-
  only evidence is a real and useful state, but it must never read as "parity
  verified, nothing wrong."
- `coverage()` similarly reports `parity-comparable` and `vendor-semantics-
  only` counts separately, per shape, rather than one merged "N observations"
  figure — and also refuses (exit 2) if only semantics-only observations are
  held.

**Tested, not just argued** — `tests/test_vendor_truth.py::
TestVendorSemanticsOnlyIsNeverParity` (6 new tests): a null-ast observation no
longer crashes `check()`; it's named in the report but excluded from the
compared-values count; a store holding ONLY semantics-only observations
refuses rather than passing; a REAL delta among comparable observations still
fails even with semantics-only observations present (proving the two
populations are scored independently, neither diluting the other);
`coverage()` separates the two counts; `coverage()` also refuses when nothing
held is comparable. Full suite re-run:

```
python -m pytest tests/test_vendor_truth.py -v
→ 22 passed (was 16 before this addendum; +6 new, 0 broken)
```

## What this proposal does NOT do

- Does not implement `ta.rising`/`ta.bbw`/`ta.percentrank`/`ta.median` in the
  engine — `engine.formula`/`engine.ast` stay `null` for these four until a
  ruling lands in `closedTable.json::_functions_excluded` and an
  implementation follows; the observation itself is still valid and useful
  as pre-implementation evidence regardless.
- Does not touch `tools/vendor_truth.py`'s actual code. If a future task wants
  to render `input.kind` in `--coverage` output or similar, that's a separate,
  small, reviewable change — not bundled into this proposal or into landing
  the first real observation.
- Does not create a second observation-store format. This is one optional key
  on the existing schema, in the existing directory, read by the existing
  tool.
