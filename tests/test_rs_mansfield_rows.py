"""UCT Mansfield RS (`rsMansfield`, 2026-11-18): the server row, its provider, and ONE AUTHORITY.

Under the RS split the slim UCT RS Line has no Reading switch, so the Mansfield column the
rsLine row computes under `view: "mansfield"` had no chart to draw it. `rsMansfield` is that
Reading on a pane of its own, and it adds NO MATHS. This file holds the claims that make that
true rather than said:

* THE WIRE IS THE rsLine ROW'S MANSFIELD READING, BYTE FOR BYTE: the same two columns, the
  same JSON bytes, the same readout block, on daily, weekly and intraday bars, at the default
  and a member's own length, against SPY and another benchmark;
* THE DRAWN VALUES ARE THE COMMITTED FIXTURE: on `tests/fixtures/indicators/rs_mansfield.json`
  (the file both lanes already meet on, `test_indicator_golden.py`) the `mansfield` column is
  `relative_strength.mansfield_column` rounded to four places, exactly, and within the
  fixture's own `relTol` of every expected cell; the cross dot is the fixture's, exactly;
* ONE LIST: the rsLine Reading's family and this row's wire columns are one tuple, and the
  row's `mansfieldLength` is the rsLine row's own declaration.

The generic row <-> provider contract (every declared column sent, every contract path
present, the lane end to end, the blank states, the shared core) is
`tests/test_rs_split_rows.py`, where `rsMansfield` sits beside its four siblings; the JS
definition is diffed against the row by `tests/test_rs_split_js_rows.py`.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.routers import signature as sig
from api.services import relative_strength as rsm
from api.services.indicator_compute import _round_series
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import _fetcher, _hermetic_reads, _long_daily  # noqa: F401 - autouse by name
from tests.test_rs_split_rows import _fresh_core, split_rows  # noqa: F401 - fixtures are used by name

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "indicators" / "rs_mansfield.json"


@pytest.fixture
def both_rows(split_rows, monkeypatch):
    """The split rows AND the rsLine v4 row (rev 5, the shape production serves with
    RS_V2_ENABLED and RS_V3_ENABLED on), so the two lanes can be asked the same question."""
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    return split_rows


def _mansfield(sym, tf, **inputs):
    rsp.rs_core_reset()
    return sig._rs_mansfield_provider(sym, tf, rd.resolve_inputs("rsMansfield", inputs))


def _rs_line_mansfield_reading(sym, tf, **inputs):
    rsp.rs_core_reset()
    return sig._rs_line_provider(sym, tf, rd.resolve_inputs("rsLine", dict(inputs, view="mansfield")))


def _case():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


# ── the row ───────────────────────────────────────────────────────────────────

def test_the_row_is_the_rsline_reading_one_list_one_length_declaration():
    row = next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsMansfield")
    assert row["columns"] == list(rd.RS_MANSFIELD_WIRE_COLUMNS) == ["mansfield", "dotMansfieldCross"]
    # ONE LIST: the rsLine Reading keeps exactly these on its wire, read from this tuple.
    assert rsp._RS_VIEW_FAMILIES["mansfield"] == rd.RS_MANSFIELD_WIRE_COLUMNS
    assert set(rd.RS_MANSFIELD_WIRE_COLUMNS) <= set(rd.RS_PHASE2A_WIRE_COLUMNS)
    # ONE DECLARATION: the length input is the rsLine v4 row's, field for field.
    v4 = {i["key"]: i for i in rd._rs_line_row(True, True)["inputs"]}
    by_key = {i["key"]: i for i in row["inputs"]}
    assert by_key["mansfieldLength"] == v4["mansfieldLength"] == {
        "key": "mansfieldLength", "type": "int", "default": rsm.DEFAULT_MANSFIELD_LENGTH,
        "min": rsm.MANSFIELD_LENGTH_RANGE[0], "max": rsm.MANSFIELD_LENGTH_RANGE[1]}
    assert row["meta"]["name"] == "UCT Mansfield RS"
    assert "view" not in by_key and "showMansfield" not in by_key, "no Reading switch: one indicator, one reading"


def test_the_resolver_clamps_the_length_and_drops_presentation_keys(split_rows):
    out = rd.resolve_inputs("rsMansfield", {"mansfieldLength": 99999, "color": "#fff", "view": "ratio",
                                            "showMansfield": False})
    assert out == {"benchmark": "SPY", "customBenchmark": "", "sectorBenchmark": "XLK", "themeBenchmark": "",
                   "mansfieldLength": rsm.MANSFIELD_LENGTH_RANGE[1]}


# ── ONE AUTHORITY: the wire is the rsLine row's Mansfield Reading, byte for byte ──

@pytest.mark.parametrize("tf, inputs", [
    ("D", {}),                                            # the default: 200 bars against SPY
    ("D", {"mansfieldLength": 52, "benchmark": "RSP"}),   # a member's own length and benchmark
    ("W", {"mansfieldLength": 52}),                       # Weinstein's weekly 52
    ("5", {"mansfieldLength": 50}),                       # intraday: the line draws, the dot is blank
])
def test_the_wire_is_the_rsline_mansfield_reading_byte_for_byte(both_rows, monkeypatch, tf, inputs):
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily(n=900)))
    mine = _mansfield("NVDA", tf, **inputs)
    line = _rs_line_mansfield_reading("NVDA", tf, **inputs)
    assert line["payload"]["inputs"]["view"] == "mansfield", "the rsLine lane really answered its Mansfield Reading"
    for col in rd.RS_MANSFIELD_WIRE_COLUMNS:
        assert json.dumps(mine["columns"][col]) == json.dumps(line["columns"][col]), col
    assert mine["times"] == line["times"]
    assert json.dumps(mine["payload"]["mansfield"], sort_keys=True) == json.dumps(line["payload"]["mansfield"], sort_keys=True)
    drawn = [v for v in mine["columns"]["mansfield"] if v is not None]
    assert len(drawn) > 100, "not vacuous: the line draws"
    dots = [v for v in mine["columns"]["dotMansfieldCross"] if v is not None]
    if tf == "5":
        assert dots == [], "intraday the cross dot is blank (the rsLine rule)"
    else:
        assert dots and set(dots) == {0.0}, "not vacuous: crosses up fire, each a dot at zero"


def test_the_drawn_values_are_the_committed_fixture_and_the_wires_mansfield_column(both_rows, monkeypatch):
    """`rs_mansfield.json`, 70 weekly bars with a benchmark gap at bar 40, length 10."""
    case = _case()
    bars, bench, length = case["bars"], case["benchmarkBars"], case["params"]["length"]
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher({"XYZ": bars, "SPY": bench}))
    env = _mansfield("XYZ", "W", mansfieldLength=length)
    got = env["columns"]["mansfield"]
    # (1) EXACTLY the wire's `mansfield_column` over the RS line, at the wire's four places.
    assert json.dumps(got) == json.dumps(_round_series(rsm.mansfield_column(rsm.rs_line(bars, bench), length), 4))
    # (2) and the fixture's hand-derived cells: None <-> None, and every value within the
    # fixture's own relTol once the four-place rounding (half a unit: 5e-5) is allowed for.
    exp = case["expected"]["mansfield"]
    assert len(got) == len(exp) == len(bars)
    for i, (g, e) in enumerate(zip(got, exp)):
        assert (g is None) == (e is None), f"mansfield[{i}]: {g!r} vs {e!r}"
        if e is not None:
            assert abs(g - e) <= 5e-5 + case["relTol"] * abs(e), f"mansfield[{i}]: {g!r} != {e!r}"
            assert math.isclose(g, round(e, 4), abs_tol=1e-12), f"mansfield[{i}]: {g!r} is not {e!r} at four places"
    # (3) the cross dot is the fixture's, exactly (crosses UP only, 0.0 on the zero line).
    assert env["columns"]["dotMansfieldCross"] == case["expected"]["dotMansfieldCross"]
    assert [i for i, v in enumerate(env["columns"]["dotMansfieldCross"]) if v is not None] == [43]
    # (4) the readout block reads the same last bar.
    block = env["payload"]["mansfield"]
    assert block["length"] == length and block["value"] == pytest.approx(exp[-1], rel=1e-12)
    assert block["crossBarsAgo"] == int(case["expected"]["mansfieldCrossBarsAgo"][-1])


# ── what is specific to this row ──────────────────────────────────────────────

def test_a_short_history_says_so_and_a_live_answer_prints_no_reason(split_rows, monkeypatch):
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily(n=900)))
    live = _mansfield("NVDA", "D")
    assert live["payload"]["legend"]["blankReason"] is None
    assert live["payload"]["legend"]["summary"] == live["payload"]["mansfield"]["summary"]
    assert live["payload"]["state"] == "ok" and live["payload"]["inputs"]["mansfieldLength"] == 200
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily(n=150)))
    short = _mansfield("NVDA", "D")       # 150 bars cannot fill a 200-bar average
    assert all(v is None for col in short["columns"].values() for v in col)
    assert short["payload"]["legend"] == {"summary": "not enough bars yet", "blankReason": "not enough bars yet"}


def test_the_cache_key_leads_with_the_row_rev_and_shape_and_carries_the_length(split_rows, monkeypatch):
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily(n=300)))
    seen = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.append((k, ttl)))
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-18")
    _mansfield("NVDA", "D", mansfieldLength=52)
    (key, ttl), = seen
    assert key.startswith(f"sig:rsMansfield1p{rsp._RS_MANSFIELD_PAYLOAD_SHAPE}:NVDA:D:")
    assert '"mansfieldLength": 52' in key and key.endswith(":2026-11-18")
    assert 60 < ttl <= 3 * 24 * 3600, "D: to the next session close"


def test_the_card_reads_the_rsline_rows_measured_evidence_and_a_new_pull_moves_the_key(split_rows, monkeypatch):
    """(2026-11-18) The card's evidence: rsMansfield carries rsLine's own `payload.evidence` block, so its card
    reads `scalar:evidence.sentence.mansfield` as rsLine's Mansfield card does (the same column, the same measured
    `mansfield_cross_up`), and the evidence asof rides the cache key (a new 04:30 pull is never hidden)."""
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(_long_daily(n=300)))
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-18")
    block = {"asof": "2026-11-18", "horizon": 63, "signals": {"mansfield": None},
             "sentence": {"mansfield": "MEASURED: the sentence the evidence job wrote"}, "baseline": None, "source": "artifact"}
    monkeypatch.setattr(rsp, "_rs_evidence", lambda: block)
    seen = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.append(k))
    for asof in ("2026-11-17", "2026-11-18"):
        monkeypatch.setattr(rsp, "_rs_evidence_asof", lambda a=asof: a)
        env = _mansfield("NVDA", "D")
        assert env["payload"]["evidence"]["sentence"]["mansfield"] == block["sentence"]["mansfield"]
    assert len(seen) == 2 and seen[0] != seen[1], "the evidence asof moves the key"
    assert all(k.endswith(":2026-11-18") for k in seen) and ":e2026-11-17:" in seen[0]
