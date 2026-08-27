"""The TC2000 remainder — `aroonUp`/`aroonDown`/`bop` declared, `WSTOC` and
`OBV` ruled, and the A5 partition measured rather than wished.

═══════════════════════════════════════════════════════════════════════════════
THE CITATIONS. Fetched 2026-08-27, quoted verbatim, because "cheap to map" is
not a licence to infer — this programme's most expensive defect was a comment
claiming a language published no precedence table when it publishes a 12-level
one, and that sentence is why nobody looked for two silent mistranslations.
═══════════════════════════════════════════════════════════════════════════════

`help.tc2000.com/m/69445/l/745531` (the Worden PCF syntax table) publishes
SYNTAX ONLY — no formulas — for every name in this task:

    AROONUP(x, z)   / AROONUPx.z    x=Period, z=Offset
    AROONDOWN(x, z) / AROONDOWNx.z  x=Period, z=Offset
    BOP(y, z)       / BOPy.z        y=SMA,    z=Offset
    OBV(y, z)       / OBVy.z        y=SMA,    z=Offset
    WSTOC(x, y, z)  / WSTOCx.y.z    x=Period, y=SMA, z=Offset

⛔ SO THE FORMULA MUST COME FROM THE INVENTOR OR THE VENDOR'S OWN INDICATOR
PAGE, NEVER FROM THE SYNTAX ROW. Three of the five resolve; two do not.

── AROON — Tushar Chande. `chartschool.stockcharts.com/.../aroon`, verbatim:

    Aroon-Up   = ((25 - Days Since 25-day High)/25) x 100
    Aroon-Down = ((25 - Days Since 25-day Low)/25) x 100

  "Days Since" is the number of periods elapsed since the most recent x-day
  high/low. ⭐ OUR `highestbars` IS EXACTLY "Days Since" — the positive distance
  back to the extreme (`_functions_arg_extreme`, most-recent-bar-wins).

  ⚠️ ONE CONFLICT IN THE SOURCES, RESOLVED BY ARITHMETIC RATHER THAN BY PICKING
  AN AUTHORITY, and recorded because it is the only inference in this file.
  The fetched summary of that page asserts a 25-period Aroon "examines the prior
  25 bars ... rather than 26". That contradicts the page's OWN formula: every
  published description gives Aroon the range 0–100, and

      window = n bars   -> Days Since maxes at n-1 -> Aroon-Up floors at 4, never 0
      window = n+1 bars -> Days Since maxes at n   -> Aroon-Up reaches 0

  Only the `n+1` window can print the published minimum. Pine ships the same
  reading (`ta.aroonup` is built on `ta.highestbars(high, length + 1)`), so the
  window here is `n + 1` and the test below asserts a 0 is reachable.

  ⭐ AND THE SIGN QUESTION FROM W2a.5 CLOSES HERE. Pine's `highestbars` is
  NON-POSITIVE and ours is the positive distance, so Pine writes
  `100 * (hb + n) / n` where we write `100 * (n - hb) / n`. The formulas look
  opposite and compute the SAME number — which is exactly why `ta.highestbars`
  had to be refused rather than mapped across.

── BOP — Igor Livshin's Balance of Power. Already this repo's own PCF expansion
   (`pcf.js`, Worden's definition): the `n`-bar average of
   `(close - open) / (high - low)`.

── WSTOC — REFUSED, AND NOW WITH A CITATION INSTEAD OF AN ASSERTION.
   `help.tc2000.com/m/69445/l/755879-worden-stochastics`, verbatim:

       "Worden Stochastic = (100/n-1)(Rank)"

   "The Rank represents the position of the most recent closing price when all
   closing values during the period are arranged in ascending order, starting
   from 0 for the lowest value." … "The resultant value is then smoothed using a
   specified smoothing constant."

   And the vendor states the difference outright: "its calculation is based on
   the Price Close rank within a list of observations WHILE a standard Stochastic
   calculation answers the question 'What percentage of the n-period Close Range
   is represented by the current Price observation?'" — with a worked example
   where the same five closes give **25** (Worden) against **16.7** (standard).

   ⛔ IT IS A RANK. This table declares no rank/percentile function, so the
   formula is INEXPRESSIBLE — not "different", which is what the old reason said
   without saying why. ⭐ THE UNBLOCKER IS COUNTABLE: declare a `rank(src, n)`
   returning the ascending position of the current bar's value in its window,
   and `WSTOC(x, y, z)` becomes `sma(100 / (x - 1) * rank(close, x), y)`.

── OBV — REFUSED, and A5 did not account for it. `OBVy.z`'s `y` is an SMA, and
   TC2000's own indicator page describes OBV as the standard cumulative running
   total, adding that "the numerical value of OBV is statistically irrelevant,
   just as it would be with a cumulative advance/decline line."
   `OBV20` is therefore the SMA **of a running total from the first bar** —
   still a fact about where the fetch started, which is precisely why
   `_functions_excluded.obv` refuses the level. ⭐ THE BOUNDED FORM `obvN(n)`
   (W2a.5) is what a member can write instead, and the refusal names it.
"""
from __future__ import annotations

import math
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import ast_conformance as ac  # noqa: E402
from api.services import ast_interpret, ast_table  # noqa: E402

NUM = lambda v: {"type": "num", "value": v}                        # noqa: E731
SER = lambda n: {"type": "series", "name": n}                      # noqa: E731
OP = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731
CALL = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731


def bars_of(rows):
    """`(o, h, l, c)` -> bars. Volume is constant; none of these read it."""
    return [{"t": 1780000000 + i * 300, "o": o, "h": h, "l": lo, "c": c, "v": 1000}
            for i, (o, h, lo, c) in enumerate(rows)]


#: ⛔⛔ THE HIGH AND THE LOW MOVE INDEPENDENTLY, AND THE BODY IS NOT ALWAYS
#: ZERO. Both halves are corrections the mutation sweep forced, and each was
#: hiding a whole class of defect behind a green test:
#:
#:   ⚰️ `low = high - 2.0` put the low's extreme on the SAME BAR as the high's,
#:      so `aroonDown` reading `high` was invisible -- and so was the PCF row
#:      mapping `AROONDOWN` to `aroonUp`. Two mutations, no red test.
#:   ⚰️ `open == close` on every bar made `(close - open) / (high - low)` zero
#:      everywhere, so BOP was identically 0 and a SUM, a MEAN or a private
#:      average all agreed. The whole `bop` section passed vacuously.
#:
#: So: `high` peaks at bar 4 and again at 22; `low` bottoms at bar 12 and again
#: at 30 -- deliberately different bars -- and the body alternates sign with a
#: magnitude that varies, so the ratio is a real series rather than a constant.
def _shape():
    highs = [12, 14, 16, 18, 30, 17, 16, 15, 14, 13,
             12, 11, 13, 11, 12, 13, 14, 15, 16, 17,
             18, 19, 31, 21, 22, 23, 24, 25, 26, 27,
             28, 29, 20, 32, 33, 34, 35, 36, 37, 38]
    lows = [8, 9, 10, 11, 12, 11, 10, 9, 8, 7,
            6, 5, 1, 6, 7, 8, 9, 10, 11, 12,
            13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
            2, 20, 15, 24, 25, 26, 27, 28, 29, 30]
    rows = []
    for i, (h, lo) in enumerate(zip(highs, lows)):
        mid = (h + lo) / 2.0
        # a body that changes sign and size, always inside the bar's range
        # period 7, coprime with the 5-bar window under test: a period that
        # DIVIDES the window averages to exactly zero and the column is constant
        # again -- the same vacuity in a new disguise, caught on the first run.
        body = ((i % 7) - 3) * (h - lo) / 8.0
        o = mid - body / 2.0
        c = mid + body / 2.0
        rows.append((o, float(h), float(lo), c))
    return rows


SHAPE = _shape()
BARS = bars_of(SHAPE)

#: ⚠️ A MALFORMED BAR, ON PURPOSE AND NOWHERE NEAR THE MAIN FIXTURE. A bar
#: whose range is zero while its body is not cannot occur in real data (`low`
#: bounds `open` and `close`), so it is the ONLY way to reach `(c-o)/(h-l)` =
#: +/-Infinity -- which is the one input where `bop`'s finite-collapse and the
#: operator path could disagree. Hand-built because the claim in `_fn_bop`'s
#: docstring is about that seam, and a claim with no reachable input is a
#: claim nobody can check.
DEGENERATE = bars_of([(10.0, 12.0, 8.0, 11.0),
                      (11.0, 13.0, 9.0, 12.0),
                      (12.0, 14.0, 10.0, 13.0),
                      (13.0, 15.0, 15.0, 14.0),   # high == low, body != 0
                      (14.0, 16.0, 12.0, 15.0),
                      (15.0, 17.0, 13.0, 16.0),
                      (16.0, 18.0, 14.0, 17.0),
                      (17.0, 19.0, 15.0, 18.0)])


def at(col, i):
    v = col[i]
    return None if (v is None or (isinstance(v, float) and math.isnan(v))) else v


def days_since_extreme(values, i, n, want_max):
    """THE PUBLISHED DEFINITION, written from the words and not from the code.

    "the number of periods elapsed since the most recent x-day high/low", over a
    window of `n + 1` bars ending at `i`. Returns None where the window runs off
    the front of the series.
    """
    lo = i - n
    if lo < 0:
        return None
    window = values[lo:i + 1]
    best = max(window) if want_max else min(window)
    # the MOST RECENT bar holding it, counted back from `i`
    for k in range(len(window) - 1, -1, -1):
        if window[k] == best:
            return (len(window) - 1) - k
    return None


def aroon_oracle(values, n, want_max):
    out = []
    for i in range(len(values)):
        d = days_since_extreme(values, i, n, want_max)
        out.append(None if d is None else 100.0 * (n - d) / n)
    return out


# ═══════════════════════════════════════════════════════════════════════════ #
# 1. AROON — against the published formula, computed independently
# ═══════════════════════════════════════════════════════════════════════════ #

def test_aroonUp_matches_the_published_formula_over_a_shaped_series():
    n = 10
    col = ast_interpret.interpret(CALL("aroonUp", NUM(n)), BARS, {})
    want = aroon_oracle([b["h"] for b in BARS], n, True)
    for i in range(len(BARS)):
        assert at(col, i) == (None if want[i] is None else pytest.approx(want[i])), (
            i, at(col, i), want[i])
    # …and the warm-up is exactly the `n` bars whose window runs off the front.
    assert [i for i in range(len(BARS)) if at(col, i) is None] == list(range(n))


def test_aroonDown_mirrors_it_on_the_low():
    n = 10
    col = ast_interpret.interpret(CALL("aroonDown", NUM(n)), BARS, {})
    want = aroon_oracle([b["l"] for b in BARS], n, False)
    for i in range(len(BARS)):
        assert at(col, i) == (None if want[i] is None else pytest.approx(want[i])), (
            i, at(col, i), want[i])


def test_aroon_reaches_BOTH_published_ENDS_which_is_what_fixes_the_window_at_n_plus_1():
    """⛔ THE ARITHMETIC THAT SETTLED THE CITATION CONFLICT, AS A TEST.

    Aroon's published range is 0-100. With an `n`-bar window "days since" maxes
    at `n-1` and Aroon-Up could never print 0 — it would floor at `100/n`. Only
    the `n+1` window reaches the published minimum. So this asserts BOTH ends
    occur, which is a claim about the window width and not about a fixture.
    """
    n = 10
    up = ast_interpret.interpret(CALL("aroonUp", NUM(n)), BARS, {})
    finite = [v for v in up if v is not None]
    assert max(finite) == pytest.approx(100.0), max(finite)
    assert min(finite) == pytest.approx(0.0), min(finite)
    # …and 0 is reachable ONLY because the window is n+1: the bar `n` back is
    # still inside it. A 25-bar window would floor this column at 10.0.
    assert any(v == pytest.approx(0.0) for v in finite)


def test_aroon_is_the_arithmetic_of_highestbars_which_is_why_it_costs_no_new_maths():
    """⭐ THE COMPOSITION, PINNED. `aroonUp(n)` is `100 * (n - highestbars(high,
    n+1)) / n`. Asserting it here means the declared entry cannot drift from the
    arg-extreme ruling `_functions_arg_extreme` fixed — a second implementation
    of "days since the high" is exactly the drift `_functions_excluded.variance`
    refuses `variance` to avoid."""
    n = 10
    declared = ast_interpret.interpret(CALL("aroonUp", NUM(n)), BARS, {})
    composed = ast_interpret.interpret(
        OP("/", OP("*", NUM(100.0),
                   OP("-", NUM(n), CALL("highestbars", SER("high"), NUM(n + 1)))),
           NUM(n)), BARS, {})
    for i in range(len(BARS)):
        a, b = at(declared, i), at(composed, i)
        assert (a is None) == (b is None), (i, a, b)
        if a is not None:
            assert a == pytest.approx(b), (i, a, b)
    assert sum(1 for v in declared if v is not None) >= 30


# ═══════════════════════════════════════════════════════════════════════════ #
# 2. BOP — equal to the composition it replaces
# ═══════════════════════════════════════════════════════════════════════════ #

def test_bop_equals_the_sma_of_the_published_ratio():
    """⛔ THE DECLARED ENTRY AND THE ARITHMETIC MUST BE ONE NUMBER. `bop` is a
    composition with a published identity, so it is declared (a member looks for
    "Balance of Power") — but it is implemented over the SHIPPED rolling mean, so
    there is no second average to drift from the one `sma` uses."""
    n = 5
    declared = ast_interpret.interpret(CALL("bop", NUM(n)), BARS, {})
    ratio = OP("/", OP("-", SER("close"), SER("open")),
               OP("-", SER("high"), SER("low")))
    composed = ast_interpret.interpret(CALL("sma", ratio, NUM(n)), BARS, {})
    for i in range(len(BARS)):
        a, b = at(declared, i), at(composed, i)
        assert (a is None) == (b is None), (i, a, b)
        if a is not None:
            assert a == pytest.approx(b, rel=1e-9), (i, a, b)
    assert sum(1 for v in declared if v is not None) >= 30


def test_aroonUp_and_aroonDown_read_DIFFERENT_FIELDS_and_the_fixture_can_tell():
    """⛔ THE MUTATION THAT SURVIVED THE FIRST FIXTURE. `aroonDown` reading
    `high` produces a perfectly plausible 0-100 column, and on a series where
    `low = high - 2` it produces the IDENTICAL column -- so nothing was red.

    This asserts the two legs DISAGREE on this fixture, which is the property
    that makes every other aroon case in this file able to fail. It also covers
    the PCF row: `AROONDOWN` pointed at `aroonUp` is the same defect one layer up.
    """
    up = ast_interpret.interpret(CALL("aroonUp", NUM(10)), BARS, {})
    down = ast_interpret.interpret(CALL("aroonDown", NUM(10)), BARS, {})
    differing = [i for i in range(len(BARS))
                 if at(up, i) is not None and at(up, i) != at(down, i)]
    assert len(differing) >= 20, (len(differing), differing[:8])
    # …and the extremes really do sit on different bars, which is WHY they differ.
    highs = [b["h"] for b in BARS]
    lows = [b["l"] for b in BARS]
    assert highs.index(max(highs)) != lows.index(min(lows))


def test_bop_is_a_REAL_SERIES_on_this_fixture_not_a_constant_zero():
    """⛔ THE OTHER SURVIVOR. With `open == close` on every bar the ratio is 0
    everywhere, so `bop` was identically zero and a rolling SUM, a rolling MEAN
    and a private average were indistinguishable. This asserts the column varies
    and takes both signs, which is what makes the equality case above load-bearing.
    """
    col = ast_interpret.interpret(CALL("bop", NUM(5)), BARS, {})
    finite = [v for v in col if v is not None]
    assert len(finite) >= 30, len(finite)
    assert any(v > 0 for v in finite), finite[:8]
    assert any(v < 0 for v in finite), finite[:8]
    assert len(set(round(v, 9) for v in finite)) > 5, sorted(set(finite))[:6]


def test_bop_matches_the_composition_even_on_a_bar_whose_RANGE_IS_ZERO():
    """⛔ THE SEAM `_fn_bop`'s DOCSTRING CLAIMS, MEASURED. It says the ratio goes
    through the same IEEE division and finite-collapse the operator path uses, so
    a zero-range bar answers exactly what the composition answers. That claim is
    only checkable on a bar real data cannot produce -- `low` bounds `open` and
    `close`, so a zero range forces a zero body and the ratio is 0/0 either way.
    `DEGENERATE` carries the malformed bar that reaches +/-Infinity instead."""
    n = 3
    declared = ast_interpret.interpret(CALL("bop", NUM(n)), DEGENERATE, {})
    ratio = OP("/", OP("-", SER("close"), SER("open")),
               OP("-", SER("high"), SER("low")))
    composed = ast_interpret.interpret(CALL("sma", ratio, NUM(n)), DEGENERATE, {})
    for i in range(len(DEGENERATE)):
        a, b = at(declared, i), at(composed, i)
        assert (a is None) == (b is None), (i, a, b)
        if a is not None:
            assert a == pytest.approx(b, rel=1e-9), (i, a, b)
    # ⛔ AND THE DEGENERATE BAR REALLY IS UNCOMPUTABLE, so this is not a pair of
    # all-finite columns agreeing for a trivial reason.
    assert at(declared, 3) is None and at(declared, 4) is None
    assert sum(1 for v in declared if v is not None) >= 2


# ═══════════════════════════════════════════════════════════════════════════ #
# 3. THE TWO REFUSALS — by name, with a reason true of the input
# ═══════════════════════════════════════════════════════════════════════════ #

def test_stochWorden_is_NOT_declared_and_the_reason_is_the_RANK():
    """⛔ A RANK, NOT A RANGE — and the refusal has to say so. The old reason
    said only that it "is a different formula", which is true of any two
    formulas and tells a member nothing about what would change it."""
    assert "stochWorden" not in ast_table.TABLE["functions"]
    excluded = ast_table.TABLE["_functions_excluded"]
    assert "stochWorden" in excluded, sorted(excluded)
    reason = excluded["stochWorden"]
    low = reason.lower()
    for phrase in ("rank", "100/n-1", "ascending"):
        assert phrase in low, (phrase, reason[:200])
    # ⭐ AND IT NAMES WHAT WOULD UNBLOCK IT, countably.
    assert "rank(" in low, reason[:200]


def test_the_obv_SPELLING_is_refused_for_a_reason_true_of_ITS_input():
    """⛔ `OBV20` IS THE SMA OF A RUNNING TOTAL, not a windowed sum. The bounded
    `obvN(n)` this lane declared in W2a.5 is a DIFFERENT quantity, and the
    refusal must say that rather than quietly pointing the spelling at it."""
    excluded = ast_table.TABLE["_functions_excluded"]
    reason = excluded["obv"]
    assert "obvN(n)" in reason, reason[-200:]
    # the cited half: the vendor's own words about the level
    assert "statistically irrelevant" in reason.lower(), reason[-400:]
    assert "obv" not in ast_table.TABLE["functions"]


# ═══════════════════════════════════════════════════════════════════════════ #
# 4. ⭐ A5 — THE PARTITION, MEASURED. TOTAL AND DISJOINT.
# ═══════════════════════════════════════════════════════════════════════════ #

#: ⛔ THE SPELLINGS THAT CANNOT READ, EACH WITH ITS REASON. A4 was written before
#: anyone measured it and turned out unreachable by construction; this is the
#: partition that stops A5 repeating it. A count is falsifiable — a target is not.
NEVER_READ = {
    "RSI14 < 30":
        "Worden's own table says its RSI is NOT Wilder's, and `WRSI` is the one "
        "that maps. Pointing `RSI` at this table's Wilder RSI is the MIN/lowest trap.",
    "RSI(14, 1, 0) < 30":
        "the same formula in the call spelling.",
    "WSTOC14.3.0 < 20":
        "a RANK, not a range: `(100/n-1)(Rank)`. This table declares no rank "
        "function, so it is inexpressible until one is declared.",
    "MS20 > 0":
        "MoneyStream is Worden-proprietary and its formula is not published.",
    "TSV20 > 0":
        "Time Segmented Volume is Worden-proprietary and its formula is not published.",
    "OBV20 > 0":
        "`OBVy` is the SMA of a CUMULATIVE running total, which is a fact about "
        "where the fetch started — the exact ground `_functions_excluded.obv` "
        "refuses on. `obvN(n)` is the bounded quantity, not this one.",
}

#: ⚠️ REACHABLE, AND NOT IN THIS TASK. Two moving averages this table does not
#: declare. Named so the remaining path to A5's number is a list rather than a gap.
REACHABLE_ELSEWHERE = {
    "FAVGC20 > C": "front-weighted moving average — a new table entry, not an oscillator",
    "HAVGC20 > C": "Hull moving average — a new table entry, not an oscillator",
}
def _run_node(driver_body):
    """Drive the SHIPPED reader through node, via the conformance tool's own plumbing.

    ⛔ NOT A HAND-ROLLED `node script.mjs`. `pcf.js` imports `closedTable.json`, and a
    bare node run needs an import attribute for that; `ast_conformance` already solves
    it with a loader hook, and its `_node_run` also pins the argv/stdin/encoding rules
    this repo has paid for (a `-t` containing a quote SPLIT under cmd.exe; a cp1252
    decode turned one box-drawing character into a TypeError). Reusing it inherits
    those fixes instead of re-earning them — my first draft resolved the import
    RELATIVE TO THE SCRIPT and died with `MODULE_NOT_FOUND`.

    ⚠️ THE DRIVER IS A LIST OF LINES, JOINED. Not a string with `\\n` escapes: this
    file was mangled twice by building JS source through escaped newlines inside a
    shell heredoc, which turned `\\n` into real line breaks mid-literal. A list has no
    escaping to get wrong.
    """
    header = [
        "import { register } from 'node:module'",
        "import { pathToFileURL } from 'node:url'",
        "register('./jsonhook.mjs', import.meta.url)",
        "let raw = ''",
        "process.stdin.setEncoding('utf8')",
        "for await (const chunk of process.stdin) raw += chunk",
        "const payload = JSON.parse(raw)",
        "const { parsePcf } = await import(pathToFileURL(payload.pcf).href)",
    ]
    driver = "\n".join(header + driver_body) + "\n"
    ast_dir = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast"
    # ⛔ `_node_run` REQUIRES AN `{ok: true, ...}` ENVELOPE and raises
    # `LaneUnavailable` on anything else, so the driver wraps its result and this
    # unwraps it. A bare object printed straight out reads to that helper as a
    # refused lane -- which is a confusing way to be told your JSON was fine.
    return ac._node_run(driver, {
        "pcf": str(ast_dir / "pcf.js"),
        "vocab": str(ast_dir / "pcf.vocabulary.test.js"),
    })["data"]


def _pcf_outcomes():
    """Every shipped vocabulary spelling -> whether the SHIPPED reader reads it.

    ⛔ THE VOCABULARY IS READ OUT OF `pcf.vocabulary.test.js` ITSELF, never copied
    here. A second copy would let this file agree with a list nobody updated — and
    what that yardstick says IS the subject of A5.
    """
    return _run_node([
        "import { readFileSync } from 'node:fs'",
        "const src = readFileSync(payload.vocab, 'utf8')",
        "// CRLF-tolerant: the yardstick is a CRLF file, so a pattern ending in a bare newline never matched it.",
        r"const m = /const VOCABULARY = (\{[\s\S]*?\r?\n\})/.exec(src)",
        "const VOCAB = (0, eval)('(' + m[1] + ')')",
        "const out = {}",
        "for (const [group, list] of Object.entries(VOCAB)) {",
        "  for (const s of list) {",
        "    let ok = false",
        "    try { const r = parsePcf(s); ok = !!(r && r.ok) } catch { ok = false }",
        "    out[s] = { group, ok }",
        "  }",
        "}",
        "process.stdout.write(JSON.stringify({ ok: true, data: out }))",
    ])


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node")
def test_A5_is_a_PARTITION_total_and_disjoint_and_the_ceiling_is_MEASURED():
    """⭐⭐ A5 SAYS "66/71 read; MS/TSV/non-Wilder RSI refuse". THE FIVE IT NAMES ARE
    RIGHT AND THE NUMBER IS NOT REACHABLE — measured, not hoped for.

    A4 was written the same way and turned out unreachable by construction (15/24
    against a real ceiling of 8). The fix there was to record the ceiling with the
    partition asserted TOTAL and DISJOINT; this does it up front.

    ⛔ THE SIXTH PERMANENT REFUSAL A5 DID NOT ACCOUNT FOR IS `OBV20`. Worden spells it
    `OBVy.z` where `y` is an SMA, so it is the mean OF A CUMULATIVE RUNNING TOTAL —
    the ground `_functions_excluded.obv` has refused since this table opened, and TC2000's
    own page agrees the level "is statistically irrelevant". W2a.5 declared the bounded
    `obvN(n)` precisely because that level is unusable; pointing `OBV20` at it would be
    the MIN/lowest trap.
    """
    outcomes = _pcf_outcomes()
    reading = {s for s, v in outcomes.items() if v["ok"]}
    refusing = {s for s, v in outcomes.items() if not v["ok"]}

    # ⛔ TOTAL AND DISJOINT — the shape A4's correction demanded.
    assert reading | refusing == set(outcomes)
    assert not (reading & refusing)
    assert len(outcomes) == 71, len(outcomes)

    # every refusal is one of the two DECLARED kinds and nothing else, so a NEW
    # refusal cannot hide inside the ceiling.
    assert refusing == set(NEVER_READ) | set(REACHABLE_ELSEWHERE), sorted(refusing)

    # …and the three this task fixed really do read now.
    for src in ("AROONUP25 > 70", "AROONDOWN25 < 30", "BOP20 > 0"):
        assert src in reading, src

    assert len(reading) == 63, len(reading)
    # ⭐ THE CEILING, DERIVED: 71 minus the six that can never read.
    assert len(outcomes) - len(NEVER_READ) == 65


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node")
def test_every_spelling_this_task_CLAIMS_also_COMPUTES_rather_than_merely_parsing():
    """⛔⛔ A COUNT IS NOT THE DELIVERABLE — "read" IS.

    A4 moved 4 -> 8 and the lane then REFUSED three of those gains, because they
    translated their CHROME and left their subject as a refused column: *"a
    relative-strength-vs-SPY screen with no SPY in it."* So every spelling this task
    turns green is walked end to end over the real corpus bars and must produce a
    column that ANSWERS — not merely a tree that parsed.
    """
    trees = _run_node([
        "const out = {}",
        "for (const s of ['AROONUP25 > 70', 'AROONDOWN25 < 30', 'BOP20 > 0']) {",
        "  const r = parsePcf(s)",
        "  out[s] = r && r.ok ? r.ast : null",
        "}",
        "process.stdout.write(JSON.stringify({ ok: true, data: out }))",
    ])

    bars = ac.corpus_bars()
    for src, tree in trees.items():
        assert tree is not None, src
        col = ast_interpret.interpret(tree, bars, {})
        finite = [v for v in col if v is not None]
        assert len(finite) > 400, (src, len(finite))
        # a 0/1 comparison column — and BOTH answers occur. A column that is
        # constantly false is the "screen with no SPY in it" shape wearing a number.
        assert set(finite) <= {0.0, 1.0}, (src, sorted(set(finite))[:5])
        assert len(set(finite)) == 2, (src, sorted(set(finite)))


@pytest.mark.skipif(not ac.js_lane_available(), reason="no node")
def test_the_three_declared_entries_agree_with_the_JS_lane_on_their_own_numbers():
    cases = [{"id": "aroon_up", "ast": CALL("aroonUp", NUM(10))},
             {"id": "aroon_down", "ast": CALL("aroonDown", NUM(10))},
             {"id": "bop_five", "ast": CALL("bop", NUM(5))}]
    js = ac.run_js(cases, BARS)
    for case in cases:
        py = ast_interpret.interpret(case["ast"], BARS, {})
        col = js[case["id"]]
        assert len(col) == len(BARS), case["id"]
        for i in range(len(BARS)):
            a, b = at(py, i), col[i]
            assert (a is None) == (b is None), (case["id"], i, a, b)
            if a is not None:
                assert a == pytest.approx(b, rel=1e-9), (case["id"], i, a, b)
        assert sum(1 for v in col if v is not None) >= 30, case["id"]
