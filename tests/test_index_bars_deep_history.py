"""Deep settled intraday history for SPX / NDX from FMP (`api/index_bars.py`, 2026-11-21, coordinator ruling).

Fred RS's RS line on SPY 5m / 30m was blank before about 60 days back (Yahoo's intraday depth) where TradingView
draws it. FMP serves complete settled 5-minute sessions years back; the store backfills them ONCE, then increments,
and the served series prepends a contiguous run of them before Yahoo's first day, behind a seam check. Every price
below is SYNTHETIC, in the shape of FMP's `/stable/historical-chart/5min` (newest first, `date` = the bar's START as
ET wall-clock text).

Railed here:
  H1 a 13:00 half-day is complete at 42 five-minute bars, a holiday is no session (never asked, never a hole), and
     the prepended run crosses both;
  H2 a page FMP cuts: the session the cut falls in is partial and completed by the next pass; the sessions the
     answer never reached are not recorded and stay due;
  H3 the SETTLED guard: a session is asked only once REPAIR_SETTLE_S after its close;
  H4 FMP failing (an error, no key) leaves the served series exactly Yahoo's; a failed call is retried after an hour;
  H5 the SEAM: a junction session beyond the measured noise is not joined; within it, it is;
  H6 overlap parity to the cent on settled sessions, the newest excluded;
  H7 the store is written atomically (a failed replace leaves the old store and no temp file) and a truncated
     store serves nothing from it;
  H8 a request thread never parses the store; the prefix is built off the request and then reused;
  H9 the kill switch serves Yahoo only;
  H10 the run never holds a hole: it stops at the first session the store lacks;
  H11 the answer's history_rev moves with the store, and the record reaches the answer's fields;
  H12 the call budget: at most `max_fetches` a pass, and 0 once every session is complete.
"""
import datetime as dt
import json
import os
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from api import index_bars
from api.services import fmp_client, yf_util
from api.services import intraday_gap_audit as gap

ET = ZoneInfo("America/New_York")
NOV21, NOV24, NOV25, NOV26, NOV27, NOV28 = (dt.date(2025, 11, d) for d in (21, 24, 25, 26, 27, 28))
DEC1, DEC2, DEC3, DEC4, DEC5 = (dt.date(2025, 12, d) for d in (1, 2, 3, 4, 5))
#: Friday 2025-12-05 12:00 ET: every session up to Thursday 12-04 has settled; 12-05 is in progress.
NOW = dt.datetime(2025, 12, 5, 12, 0, tzinfo=ET).timestamp()
SESSIONS = [NOV21, NOV24, NOV25, NOV26, NOV28, DEC1, DEC2, DEC3, DEC4]    # NOV27 is Thanksgiving


def _bars(d, base):
    """The 5-minute bars of session `d` on the calendar's grid (a half-day stops at 13:00): t, o, h, l, c, v."""
    out = []
    for i, t in enumerate(gap.expected_rth_buckets("5", d)):
        p = base + i
        out.append({"t": t, "o": p, "h": p + 0.75, "l": p - 0.5, "c": p + 0.25, "v": 100})
    return out


def _base(d):
    return 6000.0 + (d - NOV21).days * 10


def _fmp_rows(d, edit=None):
    rows = []
    for b in _bars(d, _base(d)):
        when = dt.datetime.fromtimestamp(b["t"], ET).strftime("%Y-%m-%d %H:%M:%S")
        r = {"date": when, "open": b["o"], "low": b["l"], "high": b["h"], "close": b["c"], "volume": 100}
        r.update((edit or {}).get(when[11:16], {}))
        rows.append(r)
    return list(reversed(rows))


def _yahoo(days):
    return [b for d in days for b in _bars(d, _base(d))]


@pytest.fixture(autouse=True)
def sandbox(monkeypatch, tmp_path):
    from tests.market_intel_breadth_fixtures import install_loopback_only_guard
    refused = install_loopback_only_guard(monkeypatch)
    yf_reads = []
    monkeypatch.setattr(yf_util, "bounded_call",
                        lambda fn, default, *a, **k: yf_reads.append(repr(fn)) or default)
    monkeypatch.setattr(index_bars, "_DISK_DIR", str(tmp_path / "index_bars_cache"))
    monkeypatch.setattr(index_bars, "DEEP_DAYS", 14)
    monkeypatch.setattr(index_bars, "_now", lambda: NOW)
    monkeypatch.setattr(index_bars, "_deep_prefix", {})
    monkeypatch.setattr(index_bars, "_deep_seam_logged", {})
    monkeypatch.delenv("INDEX_INTRADAY_DEEP_ENABLED", raising=False)
    yield
    assert yf_reads == [], f"a test reached yfinance: {yf_reads}"
    assert refused == [], f"a test opened a network connection: {refused}"


@pytest.fixture
def fmp(monkeypatch):
    """A fake `fmp_client.get_index_intraday` answering every session in [from, to] newest first; `cap` cuts an
    answer to its newest N rows (as a capped page would); `edits[iso]` changes rows; `raise_` raises."""
    rec = {"calls": [], "cap": None, "edits": {}, "raise_": None, "missing": set()}

    def fake(sym, interval, from_date, to_date, *, timeout=None):
        rec["calls"].append((sym, interval, from_date, to_date))
        if rec["raise_"] is not None:
            raise rec["raise_"]
        lo, hi = dt.date.fromisoformat(from_date), dt.date.fromisoformat(to_date)
        rows = []
        d = hi
        while d >= lo:
            if gap._is_session(d) and d.isoformat() not in rec["missing"]:
                rows += _fmp_rows(d, rec["edits"].get(d.isoformat()))
            d -= dt.timedelta(days=1)
        if rec["cap"]:
            rows = rows[:rec["cap"]]
        if not rows:
            raise fmp_client._ERR.not_found("FMP: no data for this request")
        return SimpleNamespace(value=rows, degraded=None)

    monkeypatch.setattr(fmp_client, "get_index_intraday", fake)
    return rec


def _fill(now=NOW):
    for _ in range(20):
        st = index_bars.deep_step("^GSPC", now=now, max_fetches=50)
        if not st["asked"]:
            return st
    raise AssertionError("the store never completed")


def _store():
    return index_bars._load_deep(index_bars._deep_path("^GSPC"))["days"]


def _merge(days, tf="5"):
    return index_bars._merge_deep("SPX", tf, _yahoo(days))


# ── H1 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_half_day_is_complete_at_42_bars_a_holiday_is_no_session_and_the_run_crosses_both(fmp):
    _fill()
    days = _store()
    assert set(days) == {d.isoformat() for d in SESSIONS}, "every settled session, no holiday, not today"
    assert days[NOV28.isoformat()]["state"] == "complete" and len(days[NOV28.isoformat()]["bars"]) == 42
    assert NOV27.isoformat() not in days
    out, rec = _merge([DEC1, DEC2, DEC3, DEC4, DEC5])
    assert rec["joined"] and rec["sessions"] == 5 and rec["from"] == NOV21.isoformat()
    pre = [b for b in out if b["t"] < out[len(out) - len(_yahoo([DEC1, DEC2, DEC3, DEC4, DEC5]))]["t"]]
    assert len(pre) == 78 * 4 + 42
    assert [b["t"] for b in out] == sorted(b["t"] for b in out), "one ordered series"


def test_the_30m_and_60m_grids_roll_up_complete_buckets_including_the_half_days(fmp):
    _fill()
    for tf, full, half in (("30", 13, 7), ("60", 7, 4)):
        yahoo = [b for d in (DEC1, DEC2, DEC3, DEC4) for b in index_bars._roll_into_buckets(
            index_bars.DEEP_TFS[tf], d, {b["t"]: b for b in _bars(d, _base(d))}, 300).values()]
        out, rec = index_bars._merge_deep("SPX", tf, sorted(yahoo, key=lambda b: b["t"]))
        assert rec["joined"], rec
        assert len(out) - len(yahoo) == full * 4 + half, (tf, len(out) - len(yahoo))


# ── H2 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_page_fmp_cuts_completes_on_the_next_pass_and_the_unreached_sessions_stay_due(fmp):
    fmp["cap"] = 100                               # the newest 78 + the last 22 of the session before
    st = index_bars.deep_step("^GSPC", now=NOW, max_fetches=1)
    days = _store()
    assert st["asked"] == 1
    assert days[DEC4.isoformat()]["state"] == "complete"
    assert days[DEC3.isoformat()]["state"] == "partial" and len(days[DEC3.isoformat()]["bars"]) == 22
    assert DEC2.isoformat() not in days and DEC1.isoformat() not in days, "not reached: not recorded"
    index_bars.deep_step("^GSPC", now=NOW, max_fetches=1)
    days = _store()
    assert days[DEC3.isoformat()]["state"] == "complete", "the session split across two calls is whole"
    assert len(days[DEC3.isoformat()]["bars"]) == 78


# ── H3 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_session_is_asked_only_once_it_has_settled(fmp):
    close = dt.datetime(2025, 12, 5, 16, 0, tzinfo=ET).timestamp()
    index_bars.deep_step("^GSPC", now=close + 10 * 60, max_fetches=50)
    assert DEC5.isoformat() not in _store(), "10 minutes after the close is not settled"
    assert all(c[3] != DEC5.isoformat() for c in fmp["calls"]), "and it is not even asked"
    index_bars.deep_step("^GSPC", now=close + index_bars.REPAIR_SETTLE_S + 60, max_fetches=50)
    assert _store()[DEC5.isoformat()]["state"] == "complete"


# ── H4 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_fmp_failing_serves_yahoo_exactly_and_a_failed_call_is_retried_after_an_hour(fmp):
    fmp["raise_"] = RuntimeError("HTTP 503")
    st = index_bars.deep_step("^GSPC", now=NOW, max_fetches=50)
    assert st["asked"] == 3 and not st["changed"], "three 6-day pages cover the 9 sessions; all failed"
    assert all(v["state"] == "error" for v in _store().values())
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    out, rec = index_bars._merge_deep("SPX", "5", list(yahoo))
    assert out == yahoo and rec["joined"] is False
    fmp["raise_"] = None
    fmp["calls"].clear()
    index_bars.deep_step("^GSPC", now=NOW + 60, max_fetches=50)
    assert not fmp["calls"], "an errored session is not asked again inside the hour"
    index_bars.deep_step("^GSPC", now=NOW + index_bars.DEEP_ERROR_RETRY_S + 1, max_fetches=50)
    assert fmp["calls"]


def test_no_fmp_key_asks_nothing_and_records_nothing(monkeypatch):
    def not_configured(*a, **k):
        raise fmp_client._ERR.not_configured("FMP: no key on this process")      # as `_fetch` raises it
    monkeypatch.setattr(fmp_client, "get_index_intraday", not_configured)
    st = index_bars.deep_step("^GSPC", now=NOW)
    assert st["stopped"] == "not-configured" and st["asked"] == 0
    assert not os.path.exists(index_bars._deep_path("^GSPC"))


def test_the_refresh_path_serves_yahoo_exactly_when_the_store_holds_nothing(monkeypatch):
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda sym, interval, period, div: [dict(b) for b in yahoo])
    monkeypatch.setattr(index_bars, "repair_rth_holes", lambda sym, tf, out: (out, {"history_rev": None}))
    info = {}
    out = index_bars._fetch_full_series("SPX", "5", info)
    assert out == yahoo and "deep" not in (info.get("repair") or {})


# ── H5 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_junction_beyond_the_measured_noise_is_not_joined(fmp):
    fmp["edits"][DEC1.isoformat()] = {"10:00": {"close": 6150.0 * 1.02}}      # 2% off on one bar
    _fill()
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    out, rec = index_bars._merge_deep("SPX", "5", list(yahoo))
    assert out == yahoo, "nothing joined"
    assert rec["joined"] is False and "differs" in rec["reason"] and rec["seam"]["d"] == DEC1.isoformat()


def test_a_junction_within_the_measured_noise_is_joined(fmp):
    row = _fmp_rows(DEC1)[-7]                        # 10:00
    fmp["edits"][DEC1.isoformat()] = {"10:00": {"close": row["close"] + 1.0}}  # $1 on ~6100: 1.6e-4
    _fill()
    out, rec = _merge([DEC1, DEC2, DEC3, DEC4, DEC5])
    assert rec["joined"] is True and rec["sessions"] == 5
    assert rec["seam"]["compared"] == 78 and rec["seam"]["equal"] == 77


def test_a_junction_the_store_does_not_hold_is_not_joined(fmp):
    fmp["missing"].add(DEC1.isoformat())
    _fill()
    out, rec = _merge([DEC1, DEC2, DEC3, DEC4, DEC5])
    assert rec["joined"] is False and "does not hold" in rec["reason"]


# ── H6 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_overlap_parity_is_to_the_cent_on_settled_sessions_and_excludes_the_newest(fmp):
    _fill()
    out, rec = _merge([DEC1, DEC2, DEC3, DEC4])         # DEC4 is the newest Yahoo session: excluded
    ov = rec["overlap"]
    assert ov == {"sessions": 3, "compared": 78 * 3, "equal": 78 * 3, "worst_rel": 0.0}, ov


# ── H7 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_store_is_replaced_atomically_and_a_failed_write_leaves_the_old_one(fmp, monkeypatch):
    _fill()
    path = index_bars._deep_path("^GSPC")
    before = open(path, "rb").read()

    def boom(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(index_bars.os, "replace", boom)
    assert index_bars._save_deep(path, {"days": {}, "changed_at": 1}) is False
    assert open(path, "rb").read() == before
    assert not [f for f in os.listdir(os.path.dirname(path)) if f.endswith(".tmp")], "no temp file left"


def test_a_truncated_store_serves_nothing_from_it(fmp):
    _fill()
    path = index_bars._deep_path("^GSPC")
    raw = open(path, "rb").read()
    with open(path, "wb") as fh:
        fh.write(raw[: len(raw) // 2])
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    out, rec = index_bars._merge_deep("SPX", "5", list(yahoo))
    assert out == yahoo and rec["joined"] is False


# ── H8 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_request_thread_never_parses_the_store_and_reuses_a_prefix_built_off_it(fmp, monkeypatch):
    _fill()
    loads = []
    real = index_bars._load_deep
    monkeypatch.setattr(index_bars, "_load_deep", lambda p: loads.append(p) or real(p))
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    with index_bars._on_request_thread():
        out, rec = index_bars._merge_deep("SPX", "5", list(yahoo))
    assert out == yahoo and rec.get("pending") and loads == []
    out, rec = index_bars._merge_deep("SPX", "5", list(yahoo))          # a background refresh builds it
    assert rec["joined"] and len(loads) == 1
    with index_bars._on_request_thread():
        out2, rec2 = index_bars._merge_deep("SPX", "5", list(yahoo))
    assert out2 == out and rec2["joined"] and len(loads) == 1, "reused, not parsed again"


# ── H9 ────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_kill_switch_serves_yahoo_only(fmp, monkeypatch):
    _fill()
    monkeypatch.setenv("INDEX_INTRADAY_DEEP_ENABLED", "0")
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    assert index_bars._merge_deep("SPX", "5", list(yahoo)) == (yahoo, None)


def test_only_spx_and_ndx_on_their_intraday_grids_get_deep_history(fmp):
    _fill()
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    for sym, tf in (("XSP", "5"), ("RUT", "5"), ("VIX", "5"), ("SPX", "1"), ("SPX", "D")):
        assert index_bars._merge_deep(sym, tf, list(yahoo)) == (yahoo, None), (sym, tf)


# ── H10 ───────────────────────────────────────────────────────────────────────────────────────────────
def test_the_run_stops_at_the_first_session_the_store_lacks(fmp):
    fmp["missing"].add(NOV25.isoformat())
    _fill()
    out, rec = _merge([DEC1, DEC2, DEC3, DEC4, DEC5])
    assert rec["joined"] and rec["from"] == NOV26.isoformat() and rec["sessions"] == 2


# ── H11 ───────────────────────────────────────────────────────────────────────────────────────────────
def test_the_answer_carries_the_record_and_history_rev_moves_with_the_store(fmp, monkeypatch):
    _fill()
    yahoo = _yahoo([DEC1, DEC2, DEC3, DEC4, DEC5])
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda sym, interval, period, div: [dict(b) for b in yahoo])
    monkeypatch.setattr(index_bars, "repair_rth_holes", lambda sym, tf, out: (out, {"history_rev": 5}))
    info = {}
    out = index_bars._fetch_full_series("SPX", "5", info)
    rev = index_bars._load_deep(index_bars._deep_path("^GSPC"))["changed_at"]
    assert info["repair"]["history_rev"] == rev and rev > 5
    fields = index_bars._repair_fields(info["repair"], out)
    assert fields["deep"]["joined"] and fields["deep"]["from"] == NOV21.isoformat()
    assert fields["deep"]["seam"]["equal"] == 78
    # ⭐ (2026-11-22) the prefix's newest session: Yahoo's own bars begin the session after it (NOV27 is Thanksgiving)
    assert fields["deep"]["through"] == NOV28.isoformat()
    first_yahoo = min(b["t"] for b in yahoo)
    newest_prefix = max(b["t"] for b in out if b["t"] < first_yahoo)
    assert index_bars._et_date(newest_prefix).isoformat() == fields["deep"]["through"]


# ── H12 ───────────────────────────────────────────────────────────────────────────────────────────────
def test_a_pass_makes_at_most_its_budget_and_none_once_complete(fmp):
    st = index_bars.deep_step("^GSPC", now=NOW, max_fetches=1)
    assert st["asked"] == 1 and len(fmp["calls"]) == 1
    _fill()
    fmp["calls"].clear()
    st = index_bars.deep_step("^GSPC", now=NOW + 3600, max_fetches=50)
    assert st["asked"] == 0 and fmp["calls"] == [], "steady state: no call"


def test_the_backfill_waits_for_the_boot_settle_and_never_runs_on_the_warm_thread(monkeypatch):
    src = open(index_bars.__file__, encoding="utf-8").read()
    warm = src[src.index("def warm_indices"):src.index("def start_index_warm")]
    assert "deep_step" not in warm and "deep_backfill_pass" not in warm
    refresh = src[src.index("def _refresh("):src.index("def _kick_bg_refresh")]
    assert "deep_step" not in refresh
    slept = []
    monkeypatch.setattr(index_bars, "_DEEP_T0", index_bars.time.monotonic())
    monkeypatch.setattr(index_bars.time, "sleep", lambda s: slept.append(s) or monkeypatch.setattr(
        index_bars, "_DEEP_T0", index_bars._DEEP_T0 - s))
    from api.services import bg_lane
    monkeypatch.setattr(bg_lane, "enabled", lambda environ=None: False)
    index_bars._deep_settle_wait()
    assert sum(slept) >= index_bars.DEEP_BOOT_SETTLE_S - 1


# ── H13 (2026-11-22) ──────────────────────────────────────────────────────────────────────────────────────
def test_the_5m_grid_is_served_at_most_its_own_depth_while_the_coarser_grids_use_the_whole_store(fmp, monkeypatch):
    _fill()
    monkeypatch.setattr(index_bars, "DEEP_5M_SERVED_DAYS", 5)          # 12-05 minus 5 days: sessions from 11-30
    out5, rec5 = _merge([DEC4, DEC5])
    assert rec5["from"] == DEC1.isoformat(), rec5["from"]
    yahoo = [b for d in (DEC4, DEC5) for b in index_bars._roll_into_buckets(
        "30", d, {b["t"]: b for b in _bars(d, _base(d))}, 300).values()]
    out30, rec30 = index_bars._merge_deep("SPX", "30", sorted(yahoo, key=lambda b: b["t"]))
    assert rec30["from"] == NOV21.isoformat(), "15 / 30 / 60 keep the whole store"
