"""``barsAgo`` -- Pine's ``x[e]`` with a PER-BAR index -- in the PYTHON lane (C38).

The JS lane is pinned to the same two captures by
``app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c38HistoryRead.test.js``
(through the member door) and to the rule by
``app/src/components/chart/engine/ast/pine.historyRead.test.js``. This file is the
mirror's half, and it asks three different questions:

* **the vendor** -- does this lane's column equal TradingView's, bar for bar, on the
  two probes that measured the rule (``vw-offset-na-spy-1d-2026-09-30``: an ``na``
  offset reads the CURRENT bar; ``vw-mbb-auto-spy-1d-2026-09-30``: offsets 0..399
  with no ``max_bars_back`` read the vendor's own bars)?
* **the other lane** -- do the two committed corpus cases agree with the JS
  interpreter on every bar, the withheld ones included?
* **the withholding** -- is the root withheld where the read cannot be answered,
  rather than answered off a ``NaN``?

⚠️ The probes key their rows on ``bar_index``, which TradingView counts from SPY's
first bar. The 8,175 earlier bars are committed in another capture
(``vw-bool-cast-spy-1d-2026-09-28``, ``history.startsAtBar0``), so they are joined in
front and the join is checked against the vendor's OWN ``bar_index`` control column
before anything is compared.
"""
import json
import math
import sys
from pathlib import Path

import pytest

from api.services import ast_interpret

ROOT = Path(__file__).resolve().parent.parent
HARNESS = ROOT / "tests" / "fixtures" / "vendor" / "harness"
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import ast_conformance as ac  # noqa: E402


def _series(name):
    return {"type": "series", "name": name}


def _num(v):
    return {"type": "num", "value": v}


def _call(name, args):
    return {"type": "call", "name": name, "args": args}


def _op(name, args):
    return {"type": "op", "name": name, "args": args}


NA = _op("/", [_num(0), _num(0)])


def _capture(name):
    return json.loads((HARNESS / f"{name}.json").read_text(encoding="utf-8"))


def _column(cap, title):
    pid = next(p["id"] for p in cap["study"]["plots"] if p["title"] == title)
    k = cap["plotValues"]["fields"].index(pid)
    by_time = {r[0]: r[k] for r in cap["plotValues"]["rows"]}
    return [by_time.get(r[0]) for r in cap["bars"]["rows"]]


def _joined_bars(cap, control):
    """The probe's bars with TradingView's own earlier bars joined in front.

    Refuses unless the probe's first bar lands at exactly the index the vendor's
    ``bar_index`` control column prints for it -- true only when the history is
    gap-free and starts at the vendor's bar 0."""
    hist = _capture("vw-bool-cast-spy-1d-2026-09-28")
    assert hist["history"]["startsAtBar0"] is True
    first = cap["bars"]["rows"][0][0]
    earlier = [r for r in hist["bars"]["rows"] if r[0] < first]
    b0 = _column(cap, control)[0]
    assert len(earlier) == b0, (len(earlier), b0)
    rows = earlier + cap["bars"]["rows"]
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5] or 0} for r in rows]
    return bars, b0


def _close(a, b):
    return abs(a - b) <= max(1e-9, 1e-12 * abs(b))


# --------------------------------------------------------------------------- #
# the vendor
# --------------------------------------------------------------------------- #

def test_close_at_na_is_the_bars_own_close_on_every_bar_of_the_offset_na_probe():
    cap = _capture("vw-offset-na-spy-1d-2026-09-30")
    bars, b0 = _joined_bars(cap, "E00_bar_index_CONTROL")
    # the probe: int e = bar_index % 3 == 0 ? na : 1 ; plot(close[e]) -- the tree the
    # member door writes for it (buffer 2: `e` is `na` or 1)
    e = _op("?:", [_op("==", [_call("mod", [_series("barindex"), _num(3)]), _num(0)]), NA, _num(1)])
    read = _call("barsAgo", [_series("close"), e, _num(2)])
    ours = ast_interpret.interpret(read, bars, {}, opts={"historyFromListing": True})[b0:]
    vendor = _column(cap, "E02_close_at_e")
    is_na = _column(cap, "E01_e_is_na")
    assert len(ours) == len(vendor) == 300
    for i, (o, v) in enumerate(zip(ours, vendor)):
        assert o is not None and _close(o, v), (i, o, v)
    # non-vacuity: 100 na-offset bars, and on each of them the read is the bar's own close
    na_bars = [i for i, x in enumerate(is_na) if x == 1]
    assert len(na_bars) == 100
    for i in na_bars:
        assert _close(ours[i], cap["bars"]["rows"][i][4]), i
    # ...and `na(close[e]) ? 1 : 0` is the vendor's 0 everywhere
    is_na_tree = _op("?:", [_call("na", [read]), _num(1), _num(0)])
    assert ast_interpret.interpret(is_na_tree, bars, {}, opts={"historyFromListing": True})[b0:] == \
        [float(x) for x in _column(cap, "E03_close_at_e_is_na")]


def test_offsets_to_399_with_no_declared_buffer_read_the_vendors_own_bars():
    cap = _capture("vw-mbb-auto-spy-1d-2026-09-30")
    bars, b0 = _joined_bars(cap, "M00_bar_index_CONTROL")
    read = _call("barsAgo", [_series("close"), _call("mod", [_series("barindex"), _num(400)]), _num(400)])
    ours = ast_interpret.interpret(read, bars, {}, opts={"historyFromListing": True})[b0:]
    vendor = _column(cap, "M02_close_at_k")
    k = _column(cap, "M01_k")
    assert max(k) == 399                                   # the bound's last served offset
    assert sum(1 for i, x in enumerate(k) if x > i) == 225  # reads BEFORE the probe's window
    for i, (o, v) in enumerate(zip(ours, vendor)):
        assert o is not None and _close(o, v), (i, o, v)


def test_CONTROL_the_same_tree_on_the_probes_300_bars_alone_withholds_what_it_cannot_read():
    """Without the earlier bars the first 225 reads name a bar this window does not
    hold. They are WITHHELD (None), never answered -- and never the vendor's value."""
    cap = _capture("vw-mbb-auto-spy-1d-2026-09-30")
    b0 = _column(cap, "M00_bar_index_CONTROL")[0]
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5] or 0} for r in cap["bars"]["rows"]]
    k = _op("+", [_series("barindex"), _num(b0)])
    read = _call("barsAgo", [_series("close"), _call("mod", [k, _num(400)]), _num(400)])
    ours = ast_interpret.interpret(read, bars, {})
    vendor = _column(cap, "M02_close_at_k")
    assert ours[:225] == [None] * 225
    for i in range(225, 300):
        assert _close(ours[i], vendor[i]), i
    # `na(close[k]) ? 1 : 0` is withheld there too -- NOT a confident 1 (the vendor says 0)
    is_na = ast_interpret.interpret(_op("?:", [_call("na", [read]), _num(1), _num(0)]), bars, {})
    assert is_na[:225] == [None] * 225
    assert is_na[225:] == [0.0] * 75


# --------------------------------------------------------------------------- #
# the rule, by hand
# --------------------------------------------------------------------------- #

def _bars(n=12):
    return [{"t": 1700000000 + i * 86400, "o": 10.0 + i, "h": 12.0 + i, "l": 9.0 + i,
             "c": 100.0 + i, "v": 1000.0 + i} for i in range(n)]


def test_the_function_by_hand():
    src = [100.0 + i for i in range(12)]
    back = [math.nan, 1, 0, 3, math.nan, 2, 5, 0, 1, 4, math.nan, 11]
    out = ast_interpret.FN["barsAgo"](src, back, 12)
    assert out[0] == 100.0            # na -> the bar itself
    assert out[1] == 100.0
    assert out[3] == 100.0
    assert out[6] == 101.0
    assert out[10] == 110.0           # na -> the bar itself
    assert out[11] == 100.0           # 11 back: the buffer's last readable count


@pytest.mark.parametrize("bad", [3, -1, 1.5, math.inf])
def test_a_count_the_rule_cannot_read_is_not_computable(bad):
    src = [100.0 + i for i in range(6)]
    out = ast_interpret.FN["barsAgo"](src, [0, 0, 0, bad, 0, 0], 3)
    assert math.isnan(out[3])
    assert out[4] == 104.0


def test_the_root_is_withheld_within_reach_of_an_unreadable_count():
    read = _call("barsAgo", [_series("close"), _call("mod", [_series("barindex"), _num(4)]), _num(3)])
    tree = _op("?:", [_call("na", [_call("sma", [read, _num(2)])]), _num(1), _num(0)])
    # count 3 on bars 3, 7, 11 is AT the buffer; reach = 2 bars past each
    assert ast_interpret.history_read_mask(tree, _bars(), {}) == [0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1]
    out = ast_interpret.interpret(tree, _bars(), {})
    assert [v is None for v in out] == [False, False, False, True, True, True, False, True, True, True, False, True]


def test_a_read_before_the_first_bar_is_withheld_unless_the_series_starts_at_the_listing():
    two_back = _op("+", [_num(2), _op("*", [_series("close"), _num(0)])])
    tree = _op("?:", [_call("na", [_call("barsAgo", [_series("close"), two_back, _num(3)])]), _num(1), _num(0)])
    windowed = ast_interpret.interpret(tree, _bars(), {})
    assert windowed[:2] == [None, None] and windowed[2:] == [0.0] * 10
    listed = ast_interpret.interpret(tree, _bars(), {}, opts={"historyFromListing": True})
    assert listed[:2] == [1.0, 1.0] and listed[2:] == [0.0] * 10


def test_a_tree_with_no_per_bar_read_has_no_mask():
    assert ast_interpret.history_read_mask(_call("sma", [_series("close"), _num(3)]), _bars(), {}) is None
    every_na = _call("barsAgo", [_series("close"), NA, _num(3)])
    assert ast_interpret.history_read_mask(every_na, _bars(), {}) is None
    assert ast_interpret.interpret(every_na, _bars(), {}) == [100.0 + i for i in range(12)]


def test_the_lookback_is_the_buffer_plus_what_the_source_needs():
    read = _call("barsAgo", [_call("sma", [_series("close"), _num(5)]),
                             _call("mod", [_series("barindex"), _num(4)]), _num(4)])
    assert ast_interpret.max_lookback(read) == 5 + 4


# --------------------------------------------------------------------------- #
# the other lane
# --------------------------------------------------------------------------- #

CORPUS_CASES = (
    "bars_ago_a_per_bar_count_na_and_past_the_buffer",
    "bars_ago_under_na_is_withheld_not_answered",
)


def test_the_two_corpus_cases_agree_with_the_js_interpreter_on_every_bar():
    corpus = ac.load_corpus()
    cases = [c for c in corpus["cases"] if c["id"] in CORPUS_CASES]
    assert sorted(c["id"] for c in cases) == sorted(CORPUS_CASES)
    bars = ac.corpus_bars(corpus)
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    verdict = ac.compare_lanes(js, py)
    assert verdict["differences"] == [], verdict["differences"][:5]
    # non-vacuity: both a number and a withheld bar appear in each case, in both lanes
    for cid in CORPUS_CASES:
        for lane in (js, py):
            col = lane[cid]
            assert len(col) == len(bars)
            assert any(v is None for v in col), cid
            assert any(v is not None for v in col), cid
    # the withholding case never answers a 1 -- the wrong value it exists to prevent
    assert 1.0 not in py["bars_ago_under_na_is_withheld_not_answered"]
    assert 1 not in js["bars_ago_under_na_is_withheld_not_answered"]
    assert 0.0 in py["bars_ago_under_na_is_withheld_not_answered"]
