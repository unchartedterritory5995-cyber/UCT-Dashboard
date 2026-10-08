"""Wave 13 lane 13I-1 -- the technical fingerprint (`api/services/journal_two/tech_fingerprint.py`).

What is pinned here, and why each is a separate rail:

  * EVERY FIELD against a HAND-COMPUTED value from one fixture bar series (`_fixture`), with the
    arithmetic written beside it. These catch a formula that moves.
  * The fingerprint EQUALS the screener's own functions on the same bars -- the rail IMPORTS
    them rather than restating them. This catches a private copy creeping in: mutate the
    screener's formula and the hand pins go red while this one stays green, which is the
    proof that the fingerprint reuses the formula instead of carrying one.
  * A past as-of uses only bars up to that day (future bars change nothing), and its RS rank
    reads "not available".
  * Missing data is LABELLED -- never a zero, never a default.
  * The pattern engine is read confirmed-only, inside its own window, and a read failure is
    TRANSIENT (never frozen).

Bars come from the fixture only: the readers are replaced, so nothing here reaches a bars store,
a screener database, the pattern store or a vendor.
"""
from __future__ import annotations

import ast
import datetime as dt
from pathlib import Path

import pytest

from api.services.journal_two import tech_fingerprint as tfp

REPO = Path(__file__).resolve().parents[1]


# ── the fixture ───────────────────────────────────────────────────────────────

def _sessions(n: int, end=dt.date(2026, 9, 30)) -> list[dt.date]:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= dt.timedelta(days=1)
    return list(reversed(out))


def _fixture() -> list[dict]:
    """260 weekday sessions ending 2026-09-30:

      S1  bars   0-199  flat at 50          o 50  h 51  l 49  c 50   v 1,000,000
      S2  bars 200-229  an advance          c = 51..80 (one a bar), h c+1, l c-1, o c-0.5
      S3  bars 230-259  a 30-bar flat base, j = 0..29:
            j even  c 98  h 100  l 94  o 97
            j odd   c 96  h  98  l 92  o 95
            j 0     o 95  h 100  l 94  c 98      (gaps up off the advance: the base opens at its high)
            j 10    o 94  h  95  l 92  c 93      (the base's low close)
            j 25    o 98  h 100  l 97  c 99      (the base's high close)
            volume 1,000,000 - 20,000*j          (strictly falling: the last bar is the 20-bar low)
    """
    bars: list[dict] = []
    for _ in range(200):
        bars.append({"o": 50.0, "h": 51.0, "l": 49.0, "c": 50.0, "v": 1_000_000})
    for i in range(30):
        c = 51.0 + i
        bars.append({"o": c - 0.5, "h": c + 1, "l": c - 1, "c": c, "v": 1_000_000})
    for j in range(30):
        if j == 0:
            b = {"o": 95.0, "h": 100.0, "l": 94.0, "c": 98.0}
        elif j == 10:
            b = {"o": 94.0, "h": 95.0, "l": 92.0, "c": 93.0}
        elif j == 25:
            b = {"o": 98.0, "h": 100.0, "l": 97.0, "c": 99.0}
        elif j % 2 == 0:
            b = {"o": 97.0, "h": 100.0, "l": 94.0, "c": 98.0}
        else:
            b = {"o": 95.0, "h": 98.0, "l": 92.0, "c": 96.0}
        b["v"] = 1_000_000 - 20_000 * j
        bars.append(b)
    for d, b in zip(_sessions(len(bars)), bars):
        b["t"] = int(d.strftime("%Y%m%d"))
    return bars


#: SPY rising 2 a session: the ticker is flat, so its RS line falls.
SPY = [400.0 + 2 * k for k in range(60)]
LAST = "2026-09-30"


def _values(fields: dict) -> dict:
    return {k: v["value"] for k, v in fields.items()}


@pytest.fixture
def store(monkeypatch):
    """Replace every reader with the fixture. `state` is mutable per test."""
    state = {"bars": _fixture(), "spy": SPY, "row": None, "patterns": [], "floor": "2026-09-23",
             "pattern_error": None}

    def bars(sym, as_of):
        cut = int(as_of.replace("-", ""))
        return [dict(b) for b in state["bars"] if b["t"] <= cut][-tfp.BARS_WINDOW:]

    def patterns(sym):
        if state["pattern_error"]:
            raise state["pattern_error"]
        return list(state["patterns"])

    monkeypatch.setattr(tfp, "_read_bars", bars)
    monkeypatch.setattr(tfp, "_read_spy_closes", lambda as_of: list(state["spy"]))
    monkeypatch.setattr(tfp, "_read_row", lambda sym: state["row"])
    monkeypatch.setattr(tfp, "_read_confirmed_patterns", patterns)
    monkeypatch.setattr(tfp, "_confirmed_window_floor", lambda: state["floor"])
    return state


# ── every field, hand-computed ────────────────────────────────────────────────

def test_every_field_equals_its_hand_computed_value():
    v = _values(tfp.fields_from_bars(_fixture(), SPY))
    # ADR% (21 sessions = base j 9..29): ranges are 6 on every bar but j10 (95-92=3, c 93) and
    # j25 (100-97=3, c 99). Ten odd j at c 96, nine even j at c 98:
    # (10*6/96 + 9*6/98 + 3/93 + 3/99) / 21 = 1.2385815 / 21 = 0.0589801 -> 5.90
    assert v["adr_pct"] == 5.9
    # SMA10 (j 20..29) = (5*98 + 4*96 + 99) / 10 = 973/10 = 97.3; (96 - 97.3)/97.3 = -1.336%
    assert v["pct_vs_sma10"] == -1.34
    # SMA20 (j 10..29) = (93 + 5*96 + 4*98 + 973) / 20 = 1938/20 = 96.9; (96-96.9)/96.9 = -0.929%
    assert v["pct_vs_sma20"] == -0.93
    # SMA50 = (the base, 2908 + the advance's last 20, 61..80 = 1410) / 50 = 86.36 -> +11.163%
    assert v["pct_vs_sma50"] == 11.16
    # SMA200 = (2908 + 51..80 = 1965 + 140*50) / 200 = 11873/200 = 59.365 -> +61.711%
    assert v["pct_vs_sma200"] == 61.71
    # 96 < SMA20 96.9, so not full-bull; SMA20 96.9 > SMA50 86.36, so not bear -> partial
    assert v["ma_stack"] == "partial"
    # close 96 sits below the 10-day EMA (a weighting of closes >= 93, mostly 96-99 and
    # ending 98,96,98,99,98,96,98,96), so close > EMA10 fails and the stack is not intact
    assert v["ema_stack_intact"] is False
    # the ticker is flat while SPY rises 2 a session: the ratio's slope is negative
    assert v["rs_line_trend"] == "down"
    # base: 30 bars (a 31st reaches the advance's low of 79: (100-79)/100 = 21% > the 15% ceiling);
    # depth (100 - 92) / 100 = 8%
    assert v["base_length_bars"] == 30
    assert v["base_depth_pct"] == 8.0
    # pullback from the 20-bar high: (100 - 96) / 100 = 4%
    assert v["pullback_depth_pct"] == 4.0
    # volume falls every bar, so the last bar is the 20-bar (4-week) low
    assert v["vol_nweek_low"] == 20
    # close CV (j 20..29): mean 97.3; squared deviations 5*0.49 + 4*1.69 + 2.89 = 12.1;
    # variance 1.21, sd 1.1; 1.1/97.3 = 1.1305%
    assert v["close_cv_pct"] == 1.13
    # pole (last 22 closes, j 8..29): peak 99 (j25) over the trough before it, 93 (j10):
    # (99-93)/93 = 6.45% -> 6.5
    assert v["pole_pct"] == 6.5


def test_no_field_is_missing_on_the_full_fixture():
    fields = tfp.fields_from_bars(_fixture(), SPY)
    assert {k: f["missing"] for k, f in fields.items() if f["missing"]} == {}
    assert all(f["source"] == "bars" for f in fields.values())


# ── reused, never re-derived ──────────────────────────────────────────────────

def test_the_fingerprint_IS_the_screener_functions_output_on_the_same_bars():
    """Imports the screener's functions and compares -- the rail restates no formula."""
    from api.services.screener import base_catalog, candles, setup_score, technicals

    bars = technicals.usable_bars(_fixture()[-tfp.BARS_WINDOW:])
    tech = technicals.compute_technicals(bars)
    multi = candles.multi_candle(bars)
    setup = setup_score.compute(bars, pole_pct=tech["pole_pct"])
    base = base_catalog.flat_base_state(bars)
    closes = [b["c"] for b in bars]

    v = _values(tfp.fields_from_bars(_fixture(), SPY))
    for col in ("adr_pct", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "ma_stack", "pole_pct"):
        assert v[col] == tech[col], col
    for col in ("pullback_depth_pct", "close_cv_pct"):
        assert v[col] == multi[col], col
    assert v["vol_nweek_low"] == setup["vol_nweek_low"]
    assert v["ema_stack_intact"] == setup["ema_stack_intact"]
    assert v["rs_line_trend"] == technicals.rs_line_trend(closes, SPY)
    assert v["pct_vs_sma10"] == technicals._pct(closes[-1], technicals._sma(closes, 10))
    assert v["base_length_bars"] == base["bars"]
    assert v["base_depth_pct"] == round(base["depth"] * 100, 2)


def test_the_module_carries_no_indicator_arithmetic_of_its_own():
    """No private SMA/EMA/stdev helper in the fingerprint module: every number comes from a
    screener function. A `def _sma`/`def _ema`/... here would be a second authority."""
    tree = ast.parse((REPO / "api/services/journal_two/tech_fingerprint.py").read_text(encoding="utf-8"))
    defs = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    banned = {"_sma", "_ema", "_pct", "_pole_pct", "_linear_slope", "rs_line_trend", "_atr",
              "multi_candle", "flat_base_state", "compute_technicals"}
    assert not (defs & banned), defs & banned
    # non-vacuity: the walk does see this module's own functions
    assert {"compute", "fields_from_bars"} <= defs


# ── the as-of ─────────────────────────────────────────────────────────────────

def test_a_past_as_of_uses_only_bars_up_to_that_day(store):
    past = "2026-09-15"
    fp = tfp.compute("ABC", past)
    assert fp["mode"] == "bars" and fp["as_of"] == past
    cut = [b for b in _fixture() if b["t"] <= 20260915]
    assert _values(fp["fields"]) | {"rs_rank": None, "patterns": None} == \
        _values(tfp.fields_from_bars(cut, SPY)) | {"rs_rank": None, "patterns": None}
    # Future bars cannot move it: rewrite every bar after the day and recompute.
    for b in store["bars"]:
        if b["t"] > 20260915:
            b.update(c=b["c"] * 3, h=b["h"] * 3, l=b["l"] * 3, o=b["o"] * 3, v=7)
    assert tfp.compute("ABC", past)["fields"] == fp["fields"]


def test_rs_rank_on_a_past_day_reads_not_available(store):
    store["row"] = {"bars_asof": "20260930", "rs_rank": 97, "adr_pct": 5.9}
    fp = tfp.compute("ABC", "2026-09-15")
    assert fp["fields"]["rs_rank"] == {"value": None, "source": "screener_row",
                                       "missing": "rank_is_nightly_only"}


def test_today_reads_the_nightly_row_and_computes_only_what_it_lacks(store):
    store["row"] = {"bars_asof": "20260930", "rs_rank": 94, "adr_pct": 7.77, "pct_vs_sma20": 1.11,
                    "pct_vs_sma50": 2.22, "pct_vs_sma200": 3.33, "ma_stack": "full-bull",
                    "ema_stack_intact": 1, "rs_line_trend": "up", "pullback_depth_pct": 4.44,
                    "vol_nweek_low": 15, "candle_score": 80, "close_cv_pct": 5.55, "pole_pct": 6.66}
    # 2026-10-02: no session between the row's day and the requested one -> nightly.
    fp = tfp.compute("ABC", "2026-10-02")
    f = fp["fields"]
    assert (fp["mode"], fp["as_of"], fp["requested_as_of"]) == ("nightly", LAST, "2026-10-02")
    assert f["rs_rank"] == {"value": 94, "source": "screener_row", "missing": None}
    assert f["adr_pct"]["value"] == 7.77 and f["adr_pct"]["source"] == "screener_row"
    assert f["ema_stack_intact"]["value"] is True
    assert f["vol_nweek_low"]["value"] == 15
    # the row holds no 10-day distance or base: computed on bars cut at the ROW's day
    assert f["pct_vs_sma10"] == {"value": -1.34, "source": "bars", "missing": None}
    assert f["base_length_bars"]["value"] == 30


def test_a_stale_nightly_row_is_not_read_for_a_later_session(store):
    """A row from 2026-09-15 does not describe 2026-09-30: a session lies between them."""
    store["row"] = {"bars_asof": "20260915", "rs_rank": 94, "adr_pct": 7.77}
    fp = tfp.compute("ABC", LAST)
    assert fp["mode"] == "bars" and fp["fields"]["adr_pct"]["value"] == 5.9


def test_a_null_row_column_is_labelled_not_invented(store):
    store["row"] = {"bars_asof": "20260930", "rs_rank": None, "candle_score": None}
    f = tfp.compute("ABC", LAST)["fields"]
    assert f["rs_rank"] == {"value": None, "source": "screener_row", "missing": "not_in_screener_row"}
    assert f["vol_nweek_low"]["missing"] == "not_enough_history"


def test_a_future_day_and_a_bad_symbol_are_refused():
    with pytest.raises(tfp.FingerprintRequestError):
        tfp.normalize_as_of("2999-01-01")
    with pytest.raises(tfp.FingerprintRequestError):
        tfp.normalize_symbol("NOT A TICKER")
    with pytest.raises(tfp.FingerprintRequestError):
        tfp.normalize_as_of("Sept 30")


# ── missing data is labelled ──────────────────────────────────────────────────

def test_short_history_is_labelled_per_field(store):
    store["bars"] = _fixture()[-15:]
    store["spy"] = []
    f = tfp.compute("ABC", LAST)["fields"]
    miss = {k: v["missing"] for k, v in f.items()}
    assert miss["pct_vs_sma20"] == miss["pct_vs_sma50"] == miss["pct_vs_sma200"] == "not_enough_history"
    assert miss["ma_stack"] == "not_enough_history"
    assert miss["base_length_bars"] == miss["base_depth_pct"] == "not_enough_history"
    assert miss["vol_nweek_low"] == "not_enough_history"
    assert miss["rs_line_trend"] == "no_benchmark"
    assert miss["rs_rank"] == "rank_is_nightly_only"
    # and what 15 sessions CAN answer is answered, not withheld
    assert f["pct_vs_sma10"]["missing"] is None and f["close_cv_pct"]["missing"] is None
    for k, v in f.items():
        assert (v["value"] is None) == (v["missing"] is not None), k


def test_no_bars_at_all_is_no_bars_everywhere(store):
    store["bars"] = []
    fp = tfp.compute("ABC", LAST)
    assert fp["as_of"] is None
    assert {v["missing"] for k, v in fp["fields"].items() if k != "rs_rank"} == {"no_bars"}
    assert all(v["value"] is None for v in fp["fields"].values())


def test_not_at_a_volume_low_is_0_which_is_not_missing():
    bars = _fixture()
    bars[-1]["v"] = 5_000_000           # computable, and NOT a 2/3/4-week low
    f = tfp.fields_from_bars(bars, SPY)["vol_nweek_low"]
    assert f == {"value": 0, "source": "bars", "missing": None}


def test_no_flat_base_is_said_so():
    bars = _fixture()
    # replace the base with a steady climb: no horizontal window ends at the last bar
    climb = [dict(b) for b in bars[:230]]
    for i in range(30):
        c = 81.0 + 3 * i
        climb.append({"o": c - 1, "h": c + 1, "l": c - 1.5, "c": c, "v": 1_000_000, "t": bars[230 + i]["t"]})
    f = tfp.fields_from_bars(climb, SPY)
    assert f["base_length_bars"]["missing"] == f["base_depth_pct"]["missing"] == "no_flat_base"


# ── the pattern engine: read-only, confirmed-only ─────────────────────────────

def test_patterns_are_the_confirmed_verdicts_on_or_before_the_as_of(store):
    store["patterns"] = [
        {"setup": "vcp", "asof_date": "2026-09-29", "vision_confidence": 81.25, "key_level": 100.1,
         "rationale": "never copied"},
        {"setup": "htf", "asof_date": "2026-10-01", "vision_confidence": 77.0, "key_level": None},
    ]
    p = tfp.compute("ABC", LAST)["fields"]["patterns"]
    assert p == {"value": [{"setup": "vcp", "asof_date": "2026-09-29", "confidence": 81.2,
                            "key_level": 100.1}],
                 "source": "pattern_vision", "missing": None}


def test_patterns_before_the_confirmed_window_read_not_available(store):
    store["patterns"] = [{"setup": "vcp", "asof_date": "2026-09-01", "vision_confidence": 90}]
    p = tfp.compute("ABC", "2026-09-01")["fields"]["patterns"]
    assert p["missing"] == "patterns_current_window_only" and p["value"] is None


def test_an_unreadable_pattern_store_is_transient_and_a_missing_table_is_empty(store):
    import sqlite3
    store["pattern_error"] = sqlite3.OperationalError("disk I/O error")
    fp = tfp.compute("ABC", LAST)
    assert fp["fields"]["patterns"]["missing"] == "patterns_unavailable"
    assert tfp.has_transient_gap(fp) is True
    store["pattern_error"] = sqlite3.OperationalError("no such table: pattern_verdicts")
    fp = tfp.compute("ABC", LAST)
    assert fp["fields"]["patterns"] == {"value": [], "source": "pattern_vision", "missing": None}
    assert tfp.has_transient_gap(fp) is False


def test_the_pattern_read_is_the_routes_confirmed_only_branch_and_touches_no_detector():
    src = (REPO / "api/services/journal_two/tech_fingerprint.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module:
            imported.add(n.module)
    assert "api.services.pattern_vision" in imported          # the confirmed store
    assert not any(m.startswith("api.services.pattern_engine") for m in imported), imported
    called = {n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None)
              for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert "get_confirmed" in called                          # non-vacuity: the walk sees calls
    for forbidden in ("get_active_detections", "init_db", "put_verdict", "judge_ticker"):
        assert forbidden not in called, forbidden
    assert not any(m.split(".")[0] in ("anthropic", "openai") for m in imported), imported


def test_the_flag_defaults_off_and_is_on_the_payload_table(monkeypatch):
    from api.routers import auth as auth_router
    assert auth_router.NOTEBOOK_FLAGS[tfp.FLAG] is False
    monkeypatch.delenv(tfp.FLAG, raising=False)
    assert tfp.enabled() is False
    monkeypatch.setenv(tfp.FLAG, "1")
    assert tfp.enabled() is True
