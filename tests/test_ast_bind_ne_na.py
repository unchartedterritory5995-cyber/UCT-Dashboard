"""C29 -- a comparison with an `na` operand is FALSE in Pine, `!=` included.

The witness is `vw-ne-na-spy-1d-2026-09-30.json` (probe UCTPROBE_NE_NA): `x` is
`na` on even bars and `close` on odd ones. This rail reads that capture (never a
typed copy of its numbers) and asks the Python fold the same questions the probe
asked TradingView, bar for bar.
"""
import json
import math
import pathlib

from api.services import ast_bind as B

CAP = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "vendor" / "harness" / "vw-ne-na-spy-1d-2026-09-30.json"


def _load():
    cap = json.loads(CAP.read_text(encoding="utf-8"))
    titles = {p["id"]: p["title"] for p in cap["study"]["plots"]}
    fields = cap["plotValues"]["fields"]
    cols = {titles.get(f, f): [r[i] for r in cap["plotValues"]["rows"]] for i, f in enumerate(fields)}
    bf = cap["bars"]["fields"]
    closes = {r[bf.index("time")]: r[bf.index("close")] for r in cap["bars"]["rows"]}
    return cols, closes


def test_ne_and_eq_with_an_na_operand_fold_to_what_tradingview_printed():
    cols, closes = _load()
    ne, eq = B._BINARY["!="], B._BINARY["=="]
    checked = 0
    for k, t in enumerate(cols["time"]):
        close = closes[t]
        x = math.nan if cols["Q00_bar_index_CONTROL"][k] % 2 == 0 else close
        assert ne(x, close) == cols["Q02_x_ne_close"][k], k
        assert eq(x, close) == cols["Q03_x_eq_close"][k], k
        assert ne(x, x) == cols["Q04_x_ne_x"][k], k
        assert ne(math.nan, close) == cols["Q10_na_var_ne_close"][k], k
        checked += 1
    assert checked == 300


def test_control_the_capture_distinguishes_na_from_a_value():
    # Non-vacuity: the probe's na bars and value bars must both be present, and
    # the vendor's `x != close` must be 0 on both (so a fold answering 1 on the
    # na bars -- JavaScript/Python's own `nan != close` -- would be caught).
    cols, _ = _load()
    na_bars = [k for k, v in enumerate(cols["Q01_x_is_na"]) if v == 1]
    assert na_bars and len(na_bars) < len(cols["Q01_x_is_na"])
    assert all(cols["Q02_x_ne_close"][k] == 0 for k in na_bars)
    assert (math.nan != 1.0) is True
