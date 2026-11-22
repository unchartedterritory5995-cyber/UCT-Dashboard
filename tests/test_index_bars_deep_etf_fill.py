"""THE ETF FILL (`api/index_bars.py`, owner ruling 2026-11-22: "you can use spy or whatever else is needed fully").

FMP never answers some 5-minute slots of settled SPX sessions (measured: 2026-08-14 13:15; 2024-05-03 and 2024-05-06
10:30; 2024-05-30 10:45-11:45 ET, absent from its 5min AND 1min answers after three asks). The deep run stopped at the
first such session, so Fred RS's 5 / 15 / 30 had 9 sessions of history before Yahoo's. A session still PARTIAL after
DEEP_PARTIAL_RETRIES is now completed from the index's ETF (SPY for ^GSPC), scaled by the ratio at the hole's edges.
Every price below is SYNTHETIC; the ETF is the index / 10 unless a rail says otherwise.

Railed here:
  F1  a single missing slot is filled from the ETF at the edge ratio, the run crosses the session, the record names it,
      and FMP's own bars are untouched;
  F2  no fill before the session's FMP retries are spent;
  F3  edge ratios that disagree beyond DEEP_FILL_RATIO_DRIFT refuse the fill (the run stops there), and a refusal is
      asked again only after DEEP_NEGATIVE_TTL_S;
  F4  a hole longer than DEEP_FILL_MAX_SLOTS is refused;
  F5  an ETF slot missing inside the hole refuses the fill;
  F6  an ETF wick beyond DEEP_FILL_WICK_MAX of the body is held at the body; volume is 0;
  F7  the kill switch: no ETF read, and the run stops at the partial session exactly as before;
  F8  FMP answering the slot later wins over the fill;
  F9  a hole at the session's first or last slot uses its one edge; two holes in a session each get their own ratio;
  F10 the ETF read keeps only that session's bars and is shed-tolerant (no bars: asked again next pass);
  F11 the backfill pass runs the fill after FMP's step and the 30m grid rolls through a filled slot.
"""
import datetime as dt

import pytest

from api import index_bars
from api.services import intraday_gap_audit as gap
from tests.test_index_bars_deep_history import (  # noqa: F401 - the fixtures apply here too
    DEC1, DEC2, DEC3, DEC4, DEC5, ET, NOW, NOV21, _bars, _base, _fill, _store, _yahoo, fmp, sandbox)

HOLE = "13:15"


def _ts(d, hhmm):
    h, m = map(int, hhmm.split(":"))
    return int(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=ET).timestamp())


@pytest.fixture
def etf(monkeypatch):
    """A fake `_proxy_session_bars`: the session's true synthetic bars / 10; `scale[iso][hhmm]` divides a slot by
    another number, `drop[iso]` removes slots, `wick[iso][hhmm]` overrides fields; every read is recorded."""
    rec = {"reads": [], "scale": {}, "drop": {}, "wick": {}, "empty": set()}

    def fake(proxy, d, lane="5"):
        rec["reads"].append((proxy, d.isoformat()))
        if d.isoformat() in rec["empty"]:
            return {}
        out = {}
        for b in _bars(d, _base(d)):
            hhmm = dt.datetime.fromtimestamp(b["t"], ET).strftime("%H:%M")
            if hhmm in rec["drop"].get(d.isoformat(), ()):
                continue
            k = rec["scale"].get(d.isoformat(), {}).get(hhmm, 10.0)
            x = {f: b[f] / k for f in ("o", "h", "l", "c")}
            x.update(rec["wick"].get(d.isoformat(), {}).get(hhmm, {}))
            out[b["t"]] = x
        return out

    monkeypatch.setattr(index_bars, "_proxy_session_bars", fake)
    return rec


def _hole(fmp, d, *slots):
    fmp["edits"][d.isoformat()] = {s: {"close": None} for s in slots}   # a row FMP's parser drops


def _true(d, hhmm):
    return next(b for b in _bars(d, _base(d)) if b["t"] == _ts(d, hhmm))


def _from(d, hhmm, k):
    """A scale for every slot of session `d` from `hhmm` to the close."""
    return {dt.datetime.fromtimestamp(t, ET).strftime("%H:%M"): k
            for t in gap.expected_rth_buckets("5", d) if t >= _ts(d, hhmm)}


def _merge5():
    return index_bars._merge_deep("SPX", "5", _yahoo([DEC4, DEC5]))


# ── F1 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_single_missing_slot_is_filled_at_the_edge_ratio_and_the_run_crosses_it(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    e = _store()[DEC2.isoformat()]
    assert e["state"] == "partial" and e["tries"] == index_bars.DEEP_PARTIAL_RETRIES
    held = list(e["bars"])
    out, rec = _merge5()
    assert rec["from"] == DEC3.isoformat(), "before the fill the run stops at the partial session"
    index_bars._deep_prefix.clear()
    st = index_bars.deep_fill_step("^GSPC", now=NOW)
    assert st == {"sym": "^GSPC", "read": 1, "filled": 1, "refused": 0}
    assert etf["reads"] == [("SPY", DEC2.isoformat())]
    e = _store()[DEC2.isoformat()]
    assert e["bars"] == held, "FMP's bars are never edited"
    assert e["fill"]["state"] == "filled" and e["fill"]["slots"] == 1 and e["fill"]["src"] == "SPY"
    out, rec = _merge5()
    assert rec["joined"] and rec["from"] == NOV21.isoformat(), rec
    assert rec["filled"] == [{"d": DEC2.isoformat(), "slots": 1, "src": "SPY"}]
    got = next(b for b in out if b["t"] == _ts(DEC2, HOLE))
    want = _true(DEC2, HOLE)
    assert (got["o"], got["c"]) == (want["o"], want["c"])
    assert got["v"] == 0


# ── F2 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_no_fill_before_the_sessions_fmp_retries_are_spent(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    index_bars.deep_step("^GSPC", now=NOW, max_fetches=50)
    assert _store()[DEC2.isoformat()]["tries"] == 1
    assert index_bars.deep_fill_step("^GSPC", now=NOW)["read"] == 0
    assert etf["reads"] == []


# ── F3 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_edge_ratios_that_disagree_refuse_the_fill_and_the_refusal_waits_its_ttl(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    etf["scale"][DEC2.isoformat()] = _from(DEC2, "13:20", 10.0 * (1 + 3 * index_bars.DEEP_FILL_RATIO_DRIFT))
    st = index_bars.deep_fill_step("^GSPC", now=NOW)
    assert st["refused"] == 1
    f = _store()[DEC2.isoformat()]["fill"]
    assert f["state"] == "refused" and "edge ratios differ" in f["reason"]
    out, rec = _merge5()
    assert rec["from"] == DEC3.isoformat() and rec["filled"] == []
    assert index_bars.deep_fill_step("^GSPC", now=NOW + 3600)["read"] == 0, "not asked again inside the TTL"
    etf["scale"].clear()
    st = index_bars.deep_fill_step("^GSPC", now=NOW + index_bars.DEEP_NEGATIVE_TTL_S + 1)
    assert st["filled"] == 1


def test_a_drift_inside_the_bound_fills(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    etf["scale"][DEC2.isoformat()] = _from(DEC2, "13:20", 10.0 * (1 + 0.5 * index_bars.DEEP_FILL_RATIO_DRIFT))
    assert index_bars.deep_fill_step("^GSPC", now=NOW)["filled"] == 1
    assert _store()[DEC2.isoformat()]["fill"]["worst_drift"] > 0


def test_bad_prints_on_the_bars_bordering_the_hole_do_not_move_the_ratio(fmp, etf):
    # 2024-05-03's shape: the two bars next to the hole read 10.021 / 10.0375 against a steady 10.029
    _hole(fmp, DEC2, HOLE)
    _fill()
    etf["scale"][DEC2.isoformat()] = {"13:10": 10.0 * (1 + 1.5e-3), "13:20": 10.0 * (1 + 1.5e-3)}   # a mean would move 2.5e-4
    assert index_bars.deep_fill_step("^GSPC", now=NOW)["filled"] == 1
    b = _store()[DEC2.isoformat()]["fill"]["bars"][0]
    assert b["c"] == _true(DEC2, HOLE)["c"], "the median of the edge windows ignores one bad print a side"


def test_the_edge_window_stops_at_its_bound_and_skips_slots_either_side_lacks(fmp, etf):
    assert index_bars.DEEP_FILL_EDGE_BARS == 6
    exp = gap.expected_rth_buckets("5", DEC2)
    have = {t: {"o": 30.0, "c": 30.0} for t in exp}
    proxy = {t: {"o": 1.0, "c": 1.0} for t in exp}
    for i in (28, 27, 26):
        have[exp[i]] = {"o": 10.0, "c": 10.0}
    for i in (25, 24, 23):
        have[exp[i]] = {"o": 20.0, "c": 20.0}
    del proxy[exp[29]]                         # the ETF lacks the first slot: skipped, not counted
    # 6 held: three at 10, three at 20 -> 15. A window of 5 gives 10, of 7 gives 20, counting the skipped slot 20 too.
    assert index_bars._edge_ratio(exp, 29, -1, have, proxy) == 15.0
    assert index_bars._edge_ratio(exp, -1, -1, have, proxy) is None


# ── F4 / F5 ───────────────────────────────────────────────────────────────────────────────────────────
def test_a_hole_longer_than_the_bound_is_refused(fmp, etf):
    slots = [dt.datetime.fromtimestamp(t, ET).strftime("%H:%M")
             for t in gap.expected_rth_buckets("5", DEC2)[10:10 + index_bars.DEEP_FILL_MAX_SLOTS + 1]]
    _hole(fmp, DEC2, *slots)
    _fill()
    index_bars.deep_fill_step("^GSPC", now=NOW)
    f = _store()[DEC2.isoformat()]["fill"]
    assert f["state"] == "refused" and "slots missing" in f["reason"]


def test_a_hole_at_the_bound_fills(fmp, etf):
    slots = [dt.datetime.fromtimestamp(t, ET).strftime("%H:%M")
             for t in gap.expected_rth_buckets("5", DEC2)[10:10 + index_bars.DEEP_FILL_MAX_SLOTS]]
    _hole(fmp, DEC2, *slots)
    _fill()
    index_bars.deep_fill_step("^GSPC", now=NOW)
    assert _store()[DEC2.isoformat()]["fill"]["slots"] == index_bars.DEEP_FILL_MAX_SLOTS


def test_an_etf_slot_missing_inside_the_hole_refuses_the_fill(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    etf["drop"][DEC2.isoformat()] = {HOLE}
    index_bars.deep_fill_step("^GSPC", now=NOW)
    f = _store()[DEC2.isoformat()]["fill"]
    assert f["state"] == "refused" and "ETF has no bar" in f["reason"]


# ── F6 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_an_etf_wick_beyond_the_bound_is_held_at_the_body(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    w = _true(DEC2, HOLE)
    etf["wick"][DEC2.isoformat()] = {HOLE: {"l": w["l"] / 10 * 0.989, "h": w["h"] / 10}}
    index_bars.deep_fill_step("^GSPC", now=NOW)
    b = _store()[DEC2.isoformat()]["fill"]["bars"][0]
    assert b["l"] == min(b["o"], b["c"]), "the 1.1% low print is held at the body"
    assert b["h"] == round(w["h"], 2), "a wick inside the bound is kept"
    assert b["v"] == 0


# ── F7 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_kill_switch_reads_no_etf_and_serves_the_unfilled_run(fmp, etf, monkeypatch):
    _hole(fmp, DEC2, HOLE)
    _fill()
    index_bars.deep_fill_step("^GSPC", now=NOW)
    index_bars._deep_prefix.clear()
    monkeypatch.setenv("INDEX_INTRADAY_DEEP_FILL_ENABLED", "0")
    etf["reads"].clear()
    _store_before = _store()
    assert index_bars.deep_fill_step("^GSPC", now=NOW + 10 ** 7)["read"] == 0 and etf["reads"] == []
    assert _store() == _store_before
    out, rec = _merge5()
    assert rec["from"] == DEC3.isoformat() and rec["filled"] == [], "exactly the run before the fill"
    assert index_bars.deep_fill_enabled({"INDEX_INTRADAY_DEEP_FILL_ENABLED": "off"}) is False
    assert index_bars.deep_fill_enabled({}) is True


def test_the_kill_switch_set_before_any_fill_reads_no_etf(fmp, etf, monkeypatch):
    _hole(fmp, DEC2, HOLE)
    _fill()
    monkeypatch.setenv("INDEX_INTRADAY_DEEP_FILL_ENABLED", "0")
    assert index_bars.deep_fill_step("^GSPC", now=NOW) == {"sym": "^GSPC", "read": 0, "filled": 0, "refused": 0}
    assert etf["reads"] == [] and "fill" not in _store()[DEC2.isoformat()]


# ── F8 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_fmp_answering_the_slot_later_wins_over_the_fill(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    etf["scale"][DEC2.isoformat()] = {HOLE: 10.0 * (1 + 4e-4)}     # the fill is near, not equal
    index_bars.deep_fill_step("^GSPC", now=NOW)
    index_bars._deep_prefix.clear()
    out, _ = _merge5()
    assert next(b for b in out if b["t"] == _ts(DEC2, HOLE))["c"] != _true(DEC2, HOLE)["c"]
    fmp["edits"].clear()                                          # FMP answers the slot at its weekly re-ask
    index_bars.deep_step("^GSPC", now=NOW + index_bars.DEEP_NEGATIVE_TTL_S + 1, max_fetches=50)
    assert _store()[DEC2.isoformat()]["state"] == "complete"
    index_bars._deep_prefix.clear()
    out, rec = _merge5()
    assert next(b for b in out if b["t"] == _ts(DEC2, HOLE))["c"] == _true(DEC2, HOLE)["c"]
    assert rec["filled"] == []


def test_a_held_fmp_bar_wins_inside_the_merge(fmp, etf):
    _hole(fmp, DEC2, HOLE)
    _fill()
    index_bars.deep_fill_step("^GSPC", now=NOW)
    path = index_bars._deep_path("^GSPC")
    data = index_bars._load_deep(path)
    e = data["days"][DEC2.isoformat()]
    t_other = _ts(DEC2, "13:10")
    e["fill"]["bars"].append({"t": t_other, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 0})   # a stray filled slot
    index_bars._save_deep(path, data)
    index_bars._deep_prefix.clear()
    out, _ = _merge5()
    assert next(b for b in out if b["t"] == t_other)["c"] == _true(DEC2, "13:10")["c"]


# ── F9 ────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("slot", ["09:30", "15:55"])
def test_a_hole_at_the_sessions_edge_uses_its_one_edge(fmp, etf, slot):
    _hole(fmp, DEC2, slot)
    _fill()
    assert index_bars.deep_fill_step("^GSPC", now=NOW)["filled"] == 1
    b = _store()[DEC2.isoformat()]["fill"]["bars"][0]
    assert b["t"] == _ts(DEC2, slot) and b["c"] == _true(DEC2, slot)["c"]


def test_two_holes_in_one_session_each_take_their_own_edge_ratio(fmp, etf):
    _hole(fmp, DEC2, "10:30", HOLE)
    _fill()
    # the ETF's ratio moves between the holes (a dividend-free drift inside the bound at each hole)
    etf["scale"][DEC2.isoformat()] = _from(DEC2, "12:00", 10.0 * 1.0004)
    assert index_bars.deep_fill_step("^GSPC", now=NOW)["filled"] == 1
    bars = {b["t"]: b for b in _store()[DEC2.isoformat()]["fill"]["bars"]}
    assert bars[_ts(DEC2, "10:30")]["c"] == _true(DEC2, "10:30")["c"]
    assert bars[_ts(DEC2, HOLE)]["c"] == _true(DEC2, HOLE)["c"], "the second hole's ratio is its own edges'"


# ── F10 ───────────────────────────────────────────────────────────────────────────────────────────────
def test_the_etf_read_keeps_only_the_session_and_an_empty_read_is_asked_again(fmp, etf, monkeypatch):
    _hole(fmp, DEC2, HOLE)
    _fill()
    etf["empty"].add(DEC2.isoformat())
    st = index_bars.deep_fill_step("^GSPC", now=NOW)
    assert st == {"sym": "^GSPC", "read": 1, "filled": 0, "refused": 0}
    assert "fill" not in _store()[DEC2.isoformat()], "a shed read records nothing"
    etf["empty"].clear()
    assert index_bars.deep_fill_step("^GSPC", now=NOW)["filled"] == 1


def test_proxy_session_bars_parses_the_store_answer_and_keeps_one_session(monkeypatch):
    import json
    import sys
    import types
    asked = []
    day = _bars(DEC2, 600.0) + _bars(DEC3, 610.0)

    class R:
        body = json.dumps({"bars": day}).encode()

    fake = types.ModuleType("api.routers.bars")
    fake.serve_bars = lambda *a, **k: asked.append((a, k)) or R()
    monkeypatch.setitem(sys.modules, "api.routers.bars", fake)
    import api.routers as routers
    monkeypatch.setattr(routers, "bars", fake, raising=False)
    out = index_bars._proxy_session_bars("SPY", DEC2)
    assert asked == [(("SPY", "5"), {"bars": 400, "to": DEC3.isoformat(), "warm": 1})]
    assert sorted(out) == [b["t"] for b in _bars(DEC2, 600.0)]
    assert set(out[min(out)]) == {"o", "h", "l", "c"}


# ── F11 ───────────────────────────────────────────────────────────────────────────────────────────────
def test_the_pass_runs_the_fill_and_the_30m_grid_rolls_through_a_filled_slot(fmp, etf, monkeypatch):
    _hole(fmp, DEC2, HOLE)
    _fill()
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda *a: None)
    monkeypatch.setattr(index_bars, "_deep_turn", lambda: __import__("contextlib").nullcontext())
    passes = index_bars.deep_backfill_pass(now=NOW)
    spx = next(p for p in passes if p["sym"] == "^GSPC")
    assert spx["fill"]["filled"] == 1
    yahoo = [b for d in (DEC4, DEC5) for b in index_bars._roll_into_buckets(
        "30", d, {b["t"]: b for b in _bars(d, _base(d))}, 300).values()]
    index_bars._deep_prefix.clear()
    out, rec = index_bars._merge_deep("SPX", "30", sorted(yahoo, key=lambda b: b["t"]))
    assert rec["joined"] and rec["from"] == NOV21.isoformat() and rec["filled"][0]["d"] == DEC2.isoformat()
    b13 = next(b for b in out if b["t"] == _ts(DEC2, "13:00"))
    assert b13["c"] == _true(DEC2, "13:25")["c"] and b13["o"] == _true(DEC2, "13:00")["o"]
