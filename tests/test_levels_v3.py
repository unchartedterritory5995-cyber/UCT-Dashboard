"""Levels v3 (2026-10-18): v2's chart-reading levels plus a guaranteed near support / resistance
(api/services/levels_v3.py), served to members under a dated tier stamp with a fail-closed fallback to C2.

Rails:
  * PARITY: drawn_levels reproduces the frozen lab drawer (lab/levels_v3/drawer_v3.draw_levels) on a vendored
    fixture of daily bars (24 fresh confirmation charts, 600 bars each, plus 4 seeded synthetic walks), case by
    case, in order. Generated ONCE by lab/levels_v3_confirm/make_fixture.py; bars and levels only.
  * the fixture can tell v3 from the C2 drawer it replaces, and from v2 alone;
  * NO LOOKAHEAD on synthetic bars (so it runs in CI): wild bars after the as-of bar change nothing, a forming
    last bar is dropped;
  * shape: at most 4 levels, nearest the close first, a support below the close whenever the prior-day low is;
  * labels (F3): never 'round', never a bare 'level', never 'swing H' below the close or 'swing L' above it;
  * the verbatim blocks still hash as the module says they do;
  * the dated tier stamp: auto_structures serves v3 only under MEMBER_LEVELS_ROUND and falls back to C2 on a
    missing / wrong stamp, a malformed result or a crash (F2: the first fallback per process logs at WARNING,
    later ones at DEBUG, every one is counted);
  * R1 / F1: one cache slot per symbol, reused only for the same (last bar, forming, session) state, and never
    iterated or deleted from (a threaded rail and an AST rail);
  * the session gate: v3 only on a COMPLETED session's bar (barspack's authority, driven with a fixed clock):
    mid-session -> C2, after the close -> v3, weekend -> v3, clock unknown -> C2;
  * member prose: no `why` carries a lab token (pdl, pph, near_s, *_fallback, d10, ...).
"""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import random
import re
import sys
import threading
from pathlib import Path

import numpy as np
import pytest

from api.services import auto_draw, auto_structures, barspack, levels_v2, levels_v3

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "levels_v3_parity.json"
SRC = Path(levels_v3.__file__).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def parity():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _got(bars, forming=False):
    out = levels_v3.drawn_levels([tuple(r) for r in bars], last_bar_forming=forming)
    return [{"price": h["price"], "t_from": h["t_from"], "label": h["label"]} for h in out["horizontals"]]


def _synthetic(seed, n=420):
    """a seeded random walk on real weekday dates (the lab's week keys parse the timestamp as a date)."""
    rng = random.Random(seed)
    d, days = datetime.date(2023, 1, 2), []
    while len(days) < n:
        if d.weekday() < 5:
            days.append(int(d.strftime("%Y%m%d")))
        d += datetime.timedelta(days=1)
    p, out = 40.0 + seed % 17, []
    for ts in days:
        o = p * (1 + rng.gauss(0, 0.01))
        c = o * (1 + rng.gauss(0.0004, 0.022))
        h = max(o, c) * (1 + abs(rng.gauss(0, 0.009)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, 0.009)))
        out.append((ts, round(o, 2), round(h, 2), round(lo, 2), round(c, 2), float(int(rng.uniform(1e5, 5e6)))))
        p = c
    return out


# ------------------------------------------------------------------------------------------------ parity + shape

def test_fixture_is_bars_and_levels_only(parity):
    s = parity["source"]
    assert "levels_v3" in s["study"]
    assert (s["near_atr"], s["sep_atr"], s["cap"], s["k_v2"]) == (
        levels_v3.NEAR_ATR, levels_v3.SEP_ATR, levels_v3.CAP, levels_v3.K_V2)
    cases = parity["cases"]
    assert len(cases) >= 24
    for c in cases:
        assert set(c) == {"name", "bars", "expect"}, c["name"]
        assert re.fullmatch(r"(case|synthetic)_\d+", c["name"]), c["name"]
        assert all(len(r) == 6 for r in c["bars"]) and len(c["bars"]) >= 200, c["name"]
        assert all(set(h) == {"price", "t_from", "label"} for h in c["expect"]), c["name"]


def test_drawn_levels_reproduce_the_lab_drawer(parity):
    bad = [(c["name"], _got(c["bars"]), c["expect"]) for c in parity["cases"] if _got(c["bars"]) != c["expect"]]
    assert bad == []


def test_the_fixture_tells_v3_from_c2_and_from_v2_alone(parity):
    # controls: a port that silently returned C2's levels, or v2's three, could not pass the parity rail
    differ_c2 = differ_v2 = 0
    for c in parity["cases"]:
        rows = [tuple(r) for r in c["bars"]]
        exp = sorted(h["price"] for h in c["expect"])
        c2 = auto_draw.drawn_set(auto_draw.clean_bars(rows))
        differ_c2 += sorted(h["price"] for h in c2["horizontals"]) != exp
        v2 = levels_v2.drawn_levels(rows)
        differ_v2 += sorted(h["price"] for h in v2["horizontals"]) != exp
    assert differ_c2 >= len(parity["cases"]) // 2
    assert differ_v2 >= len(parity["cases"]) // 4


def _check_shape(bars, hs):
    a = np.array([[float(x) for x in r] for r in bars])
    i = len(a) - 1
    close, pdl = float(a[i, 4]), float(a[i, 3])
    assert 1 <= len(hs) <= levels_v3.CAP == 4
    assert [abs(h["price"] - close) for h in hs] == sorted(abs(h["price"] - close) for h in hs)
    if pdl < close:
        assert any(h["price"] < close for h in hs)       # the guarantee: never a chart with no support drawn
    for h in hs:
        assert h["label"] and h["label"] not in ("round", "level")
        if h["label"] == "swing H":
            assert h["price"] >= close
        if h["label"] == "swing L":
            assert h["price"] <= close
        if h["label"] == "old high / flip":
            assert h["price"] < close
        if h["label"] == "old low / flip":
            assert h["price"] > close


def test_shape_and_labels_on_the_fixture(parity):
    seen = set()
    for c in parity["cases"]:
        hs = levels_v3.drawn_levels([tuple(r) for r in c["bars"]])["horizontals"]
        _check_shape(c["bars"], hs)
        seen |= {h["label"] for h in hs}
    assert "old high / flip" in seen        # control: the F3 relabel is exercised, not vacuous


@pytest.mark.parametrize("seed", range(12))
def test_shape_and_labels_on_synthetic_walks(seed):
    bars = _synthetic(seed)
    out = levels_v3.drawn_levels(bars)
    assert out["round"] == levels_v3.LEVELS_V3_ROUND
    _check_shape(bars, out["horizontals"])


# ---------------------------------------------------------------------------------------------- no lookahead (CI)

@pytest.mark.parametrize("seed", range(8))
def test_no_lookahead_future_bars_change_nothing(seed):
    rows = _synthetic(100 + seed)
    a = np.array([[float(x) for x in r] for r in rows])
    i = len(a) - 1
    base = levels_v3.draw_levels(a, i)
    assert base
    rng = random.Random(seed)
    last, fut = a[-1].copy(), []
    d = datetime.datetime.strptime(str(int(last[0])), "%Y%m%d").date()
    for _ in range(40):   # wild future bars: new highs, lows, gaps and volume far outside the history
        d += datetime.timedelta(days=1 if d.weekday() < 4 else 3)
        p = float(last[4]) * rng.choice([0.5, 0.8, 1.3, 2.0])
        fut.append([int(d.strftime("%Y%m%d")), p, p * 1.2, p * 0.7, p * rng.choice([0.9, 1.1]), 1e9])
    a2 = np.vstack([a, np.array(fut)])
    assert levels_v3.draw_levels(a2, i) == base


@pytest.mark.parametrize("seed", range(6))
def test_a_forming_last_bar_is_dropped(seed):
    rows = _synthetic(200 + seed)
    want = _got(rows)
    last = rows[-1]
    nxt = datetime.datetime.strptime(str(last[0]), "%Y%m%d").date() + datetime.timedelta(days=3)
    forming = (int(nxt.strftime("%Y%m%d")), last[4], last[4] * 1.4, last[4] * 0.6, last[4] * 1.3, 5e9)
    assert _got(rows + [forming], forming=True) == want
    assert _got(rows + [forming], forming=False) != want     # control: the forming bar WOULD change the drawing


def test_too_few_bars_draw_nothing():
    rows = [(20240101 + k, 10.0, 10.5, 9.5, 10.0, 1000) for k in range(20)]
    assert levels_v3.drawn_levels(rows) is None
    assert levels_v3.drawn_levels([]) is None


def _block(name):
    b = SRC.index("# ---- BEGIN VERBATIM %s\n" % name)
    b = SRC.index("\n", b) + 1
    e = SRC.index("# ---- END VERBATIM %s" % name)
    return SRC[b:e]


def test_the_verbatim_blocks_hash_as_declared():
    assert hashlib.sha256(_block("lab/levels_v3/v3core.py").encode("utf-8")).hexdigest() == \
        levels_v3.CORE_BLOCK_SHA256
    assert hashlib.sha256(_block("lab/levels_v3/drawer_v3.py").encode("utf-8")).hexdigest() == \
        levels_v3.DRAWER_BLOCK_SHA256


# ------------------------------------------------------------------------------------------------ member prose

_LAB_TOKENS = re.compile(r"\b(pdh|pdl|pph|ppl|d10h?|d10l|wkh|wkl|pwh|pwl|hi52|lo52|ath|vshelf|pivot|near_[sr])\b"
                         r"|_fallback|\(.*\)")


def _all_member_levels(parity):
    for c in parity["cases"]:
        yield from levels_v3.drawn_levels([tuple(r) for r in c["bars"]])["horizontals"]
    for seed in range(12):
        yield from levels_v3.drawn_levels(_synthetic(seed))["horizontals"]


def test_no_member_why_carries_a_lab_token(parity):
    hs = list(_all_member_levels(parity))
    bad = [h["why"] for h in hs if not h["why"] or _LAB_TOKENS.search(h["why"])]
    assert bad == []
    whys = " ".join(h["why"] for h in hs)
    for prose in ("nearest support", "touches", "ATR below price", "ATR above price"):
        assert prose in whys          # control: real prose is there, the rail is not passing on blanks


def test_the_lab_token_rail_can_fail():
    for leaked in ("pivot, pph", "pdl (pdl)", "gap (near_s)", "prior-day high pdh_fallback", "d10h"):
        assert _LAB_TOKENS.search(leaked), leaked


# ------------------------------------------------------------------------------------------- the dated tier stamp

#: every member series below ends on Friday 2026-10-16, a full NYSE session
LAST = 20261016
_REAL_DONE = barspack._last_complete_session_ymd
MID_SESSION = datetime.datetime(2026, 10, 16, 11, 0)
AFTER_CLOSE = datetime.datetime(2026, 10, 16, 17, 0)
WEEKEND = datetime.datetime(2026, 10, 17, 12, 0)


def _ending(rows, last=LAST):
    """the series re-dated (weekdays) so its last bar is `last`; prices unchanged."""
    d, days = datetime.datetime.strptime(str(last), "%Y%m%d").date(), []
    while len(days) < len(rows):
        if d.weekday() < 5:
            days.append(int(d.strftime("%Y%m%d")))
        d -= datetime.timedelta(days=1)
    days.reverse()
    return [(t,) + tuple(r[1:]) for t, r in zip(days, rows)]


_ROWS = None


def _rows():
    global _ROWS
    if _ROWS is None:
        c = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"][0]
        _ROWS = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                 for r in _ending([tuple(x) for x in c["bars"]])]
    return _ROWS


def _clock(monkeypatch, at):
    """drive barspack's session authority -- read by BOTH last_bar_forming and the v3 gate -- with a fixed
    wall clock; at=None is an unknown clock."""
    if at is None:
        monkeypatch.setattr(barspack, "_last_complete_session_ymd", lambda now=None: None)
    else:
        monkeypatch.setattr(barspack, "_last_complete_session_ymd",
                            lambda now=None: _REAL_DONE(at.replace(tzinfo=barspack._ET)))


@pytest.fixture
def fresh_fallback_state(monkeypatch):
    monkeypatch.setattr(auto_structures, "_levels_fallback_warned", False)
    monkeypatch.setattr(auto_structures, "LEVELS_FALLBACKS", {"crash": 0, "rejected": 0})
    auto_structures._DRAWN_CACHE.clear()
    yield
    auto_structures._DRAWN_CACHE.clear()


def _drawn(monkeypatch, v3=None, raise_=False, rows=None, at=AFTER_CLOSE, sym="ZZTEST"):
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda s: rows if rows is not None else _rows())
    _clock(monkeypatch, at)
    if raise_:
        def boom(*a, **k):
            raise RuntimeError("x")
        monkeypatch.setattr(levels_v3, "drawn_levels", boom)
    elif v3 is not None:
        monkeypatch.setattr(levels_v3, "drawn_levels", lambda *a, **k: v3)
    out = auto_structures.drawn_for(sym)
    auto_structures._DRAWN_CACHE.clear()
    return out


def _c2(forming=False):
    rows = [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in _rows()]
    return auto_draw.drawn_set(auto_draw.clean_bars(rows), last_bar_forming=forming)["horizontals"]


def test_the_stamped_v3_levels_replace_the_c2_levels(monkeypatch, fresh_fallback_state):
    out = _drawn(monkeypatch)
    assert out["levels_tier"] == {"round": auto_structures.MEMBER_LEVELS_ROUND, "source": "levels_v3",
                                  "asof_t": LAST}
    assert out["horizontals"] and all(h["source"] == "levels_v3" for h in out["horizontals"])
    assert out["horizontals"] != _c2()
    assert out["trendlines"] is not None
    assert auto_structures.LEVELS_FALLBACKS == {"crash": 0, "rejected": 0}


def test_the_member_round_is_a_literal_equal_to_the_drawing_round():
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}-v3", auto_structures.MEMBER_LEVELS_ROUND)
    assert auto_structures.MEMBER_LEVELS_ROUND == levels_v3.LEVELS_V3_ROUND
    assert auto_structures.LEVELS_V3_MAX == levels_v3.CAP
    # a literal ON PURPOSE: auto_structures must not import the drawing's own round
    as_src = Path(auto_structures.__file__).read_text(encoding="utf-8")
    assert 'MEMBER_LEVELS_ROUND = "%s"' % levels_v3.LEVELS_V3_ROUND in as_src


# --------------------------------------------------------------------------------------------- the session gate

def _spy_v3(monkeypatch):
    calls = []
    real = levels_v3.drawn_levels

    def spy(*a, **k):
        calls.append(1)
        return real(*a, **k)
    monkeypatch.setattr(levels_v3, "drawn_levels", spy)
    return calls


def test_mid_session_serves_C2_and_never_draws_v3(monkeypatch, fresh_fallback_state):
    calls = _spy_v3(monkeypatch)
    out = _drawn(monkeypatch, at=MID_SESSION)
    assert out["last_bar_forming"] is True
    assert "levels_tier" not in out
    assert out["horizontals"] == _c2(forming=True)
    assert calls == []
    assert auto_structures.LEVELS_FALLBACKS == {"crash": 0, "rejected": 0}     # a policy, not a fallback


def test_after_the_close_serves_v3_as_of_that_session(monkeypatch, fresh_fallback_state):
    out = _drawn(monkeypatch, at=AFTER_CLOSE)
    assert out["levels_tier"]["source"] == "levels_v3" and out["levels_tier"]["asof_t"] == LAST


def test_weekend_serves_v3_as_of_friday(monkeypatch, fresh_fallback_state):
    out = _drawn(monkeypatch, at=WEEKEND)
    assert out["levels_tier"]["source"] == "levels_v3" and out["levels_tier"]["asof_t"] == LAST


def test_an_unknown_session_clock_serves_C2(monkeypatch, fresh_fallback_state):
    calls = _spy_v3(monkeypatch)
    out = _drawn(monkeypatch, at=None)
    assert "levels_tier" not in out
    assert out["horizontals"] == _c2(forming=False)
    assert calls == []


def test_a_clock_that_raises_serves_C2(monkeypatch, fresh_fallback_state):
    def boom(now=None):
        raise RuntimeError("no clock")
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda s: _rows())
    monkeypatch.setattr(barspack, "_last_complete_session_ymd", boom)
    out = auto_structures.drawn_for("ZZCLK")
    assert out is not None and "levels_tier" not in out


def test_levels_session_state_reads_the_authority():
    st = auto_structures.levels_session_state
    et = barspack._ET
    assert st(LAST, MID_SESSION.replace(tzinfo=et)) == "forming"
    assert st(LAST, AFTER_CLOSE.replace(tzinfo=et)) == "complete"
    assert st(LAST, WEEKEND.replace(tzinfo=et)) == "complete"
    assert st(None, AFTER_CLOSE.replace(tzinfo=et)) == "unknown"
    assert st("garbage", AFTER_CLOSE.replace(tzinfo=et)) == "unknown"


def test_a_v3_drawing_at_another_session_is_rejected(monkeypatch, fresh_fallback_state):
    good = levels_v3.drawn_levels([(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in _rows()])
    out = _drawn(monkeypatch, v3={**good, "asof_t": LAST - 1})
    assert "levels_tier" not in out and auto_structures.LEVELS_FALLBACKS["rejected"] == 1


# ------------------------------------------------------------------------------------------------ stamp fallbacks

_H = {"source": "levels_v3", "label": "PDL", "price": 10.0, "t_from": 20240101}


@pytest.mark.parametrize("bad", [
    None,
    {"round": "2026-10-18", "asof_t": LAST, "horizontals": [_H]},          # v2's stamp is not v3's
    {"round": "2026-01-01-v3", "asof_t": LAST, "horizontals": [_H]},
    {"asof_t": LAST, "horizontals": [_H]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": []},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "price": float("nan")}]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "source": "levels_v2"}]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "t_from": "20240101"}]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "label": "round"}]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "label": "level"}]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "label": ""}]},
    {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [_H] * 5},
])
def test_a_missing_wrong_or_malformed_stamp_keeps_the_c2_levels(monkeypatch, fresh_fallback_state, bad):
    out = _drawn(monkeypatch, v3=bad if bad is not None else {"round": None})
    assert "levels_tier" not in out
    assert out["horizontals"] == _c2()
    assert auto_structures.LEVELS_FALLBACKS["rejected"] == 1


def test_four_well_formed_levels_are_accepted(monkeypatch, fresh_fallback_state):
    ok = {"round": "2026-10-18-v3", "asof_t": LAST, "horizontals": [{**_H, "price": 10.0 + k} for k in range(4)]}
    out = _drawn(monkeypatch, v3=ok)
    assert out["levels_tier"]["source"] == "levels_v3" and len(out["horizontals"]) == 4


def test_a_crash_in_v3_keeps_the_c2_levels(monkeypatch, fresh_fallback_state):
    out = _drawn(monkeypatch, raise_=True)
    assert "levels_tier" not in out
    assert out["horizontals"] == _c2()
    assert auto_structures.LEVELS_FALLBACKS == {"crash": 1, "rejected": 0}


def test_F2_the_first_fallback_warns_once_and_every_one_is_counted(monkeypatch, fresh_fallback_state, caplog):
    caplog.set_level(logging.DEBUG, logger=auto_structures._log.name)
    for _ in range(3):
        _drawn(monkeypatch, raise_=True)
    _drawn(monkeypatch, v3={"round": "nope"})
    warns = [r for r in caplog.records if r.levelno == logging.WARNING and "[levels-v3]" in r.getMessage()]
    debugs = [r for r in caplog.records if r.levelno == logging.DEBUG and "[levels-v3]" in r.getMessage()]
    assert len(warns) == 1
    assert len(debugs) == 3
    assert auto_structures.LEVELS_FALLBACKS == {"crash": 3, "rejected": 1}


def test_F2_a_served_v3_drawing_logs_nothing(monkeypatch, fresh_fallback_state, caplog):
    caplog.set_level(logging.DEBUG, logger=auto_structures._log.name)
    _drawn(monkeypatch)
    assert not [r for r in caplog.records if "[levels-v3]" in r.getMessage()]


def test_F2_counting_and_warn_once_hold_under_threads(monkeypatch, fresh_fallback_state, caplog):
    caplog.set_level(logging.WARNING, logger=auto_structures._log.name)
    old = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        ts = [threading.Thread(target=lambda: [auto_structures._levels_fallback("crash", "T", "x")
                                               for _ in range(500)]) for _ in range(8)]
        [t.start() for t in ts]
        [t.join() for t in ts]
    finally:
        sys.setswitchinterval(old)
    assert auto_structures.LEVELS_FALLBACKS["crash"] == 4000
    assert len([r for r in caplog.records if "[levels-v3]" in r.getMessage()]) == 1


# ---------------------------------------------------------------------------------------------- R1 / F1: the cache

def test_R1_one_slot_per_symbol_keyed_on_last_bar_forming_and_session(monkeypatch, fresh_fallback_state):
    rows = list(_rows())
    calls = []
    real = auto_draw.drawn_set

    def counting(*a, **k):
        calls.append(1)
        return real(*a, **k)

    monkeypatch.setattr(auto_draw, "drawn_set", counting)
    state = {"rows": rows[:-1]}
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda s: state["rows"])
    _clock(monkeypatch, AFTER_CLOSE)

    first = auto_structures.drawn_for("ZZR1")
    again = auto_structures.drawn_for("zzr1")
    assert len(calls) == 1 and again is first                      # same bar, same state -> cached

    state["rows"] = rows                                             # a new session's bar arrives
    newer = auto_structures.drawn_for("ZZR1")
    assert len(calls) == 2 and newer is not first

    _clock(monkeypatch, MID_SESSION)                                 # same last bar, now forming
    auto_structures.drawn_for("ZZR1")
    assert len(calls) == 3

    _clock(monkeypatch, None)                                        # clock lost: not the cached drawing
    auto_structures.drawn_for("ZZR1")
    assert len(calls) == 4

    assert list(auto_structures._DRAWN_CACHE) == ["ZZR1"]            # ONE slot per symbol
    assert auto_structures._DRAWN_CACHE["ZZR1"][1] == (LAST, False, "unknown")


def test_F1_drawn_for_never_iterates_or_deletes_from_the_shared_cache():
    import ast
    import inspect
    import textwrap
    fn = ast.parse(textwrap.dedent(inspect.getsource(auto_structures.drawn_for)))
    seen = 0
    for node in ast.walk(fn):
        if isinstance(node, (ast.For, ast.comprehension)):
            assert "_DRAWN_CACHE" not in ast.unparse(node.iter)
        if isinstance(node, ast.Delete):
            assert "_DRAWN_CACHE" not in ast.unparse(node)
        if isinstance(node, ast.Name) and node.id == "_DRAWN_CACHE":
            seen += 1
    assert seen >= 2          # control: the walk really sees the function's cache reads and writes


def test_F1_concurrent_reads_never_raise(monkeypatch, fresh_fallback_state):
    """many threads, many symbols, a cache already holding thousands of entries: the old sweep (iterate the
    shared dict to delete the symbol's stale keys) raised 'dictionary changed size during iteration'."""
    tiny = {"horizontals": [], "trendlines": [], "asof_t": LAST, "last_bar_forming": False, "omitted": []}
    monkeypatch.setattr(auto_structures, "_daily_bars",
                        lambda s: [{"t": LAST, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    monkeypatch.setattr(auto_draw, "drawn_set", lambda *a, **k: dict(tiny))
    monkeypatch.setattr(auto_structures, "_levels_v3", lambda *a, **k: None)
    _clock(monkeypatch, AFTER_CLOSE)
    for k in range(20000):
        auto_structures._DRAWN_CACHE["PRE%d" % k] = (0.0, None, None)
    errors = []

    def worker(n):
        try:
            for j in range(400):
                auto_structures.drawn_for("S%d_%d" % (n, j))
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))

    old = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        ts = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
        [t.start() for t in ts]
        [t.join() for t in ts]
    finally:
        sys.setswitchinterval(old)
    assert errors == []
