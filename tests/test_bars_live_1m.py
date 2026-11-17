"""Live 1m coverage on the serving tier (BARS_LIVE_1M_ENABLED, 2026-11-16).

A 1m read whose stored tail was older than the freshness rule paid a 1.2-2.0 s provider
fetch on the request path. Each AM minute is a complete 1m bar, so the stream keeps a
1m series current the way it keeps 5m: on demand, for tickers a member read, after a
repair for the current epoch. Flag off = byte-identical to before. All data synthetic.
"""
import asyncio
import json
import sqlite3
import threading
import time as _real_time
import types
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_live_store as bls, bars_sqlite

_ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm, ss=0) -> int:
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=_ET).timestamp())


TUE = (2026, 11, 10)


def M(hh, mm, ss=0) -> int:
    return et(*TUE, hh, mm, ss)


NOW = M(10, 7, 30)                 # 10:07:30 ET: the 10:07 minute is forming
E1 = (M(9, 7, 30)) * 1000          # the socket connected an hour ago
E2 = E1 + 3_000_000
FFB = M(9, 10)


def _row(sym, t, o=10.0, h=11.0, l=9.0, c=10.5, v=100):
    return [sym, t, o, h, l, c, v]


def _bar(t, o=10.0, h=11.0, l=9.0, c=10.5, v=100):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def _freeze_store(monkeypatch, now_ts):
    fake = types.SimpleNamespace(**{k: getattr(_real_time, k) for k in dir(_real_time)
                                    if not k.startswith("__")})
    fake.time = lambda: float(now_ts)
    monkeypatch.setattr(bls, "time", fake)

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromtimestamp(now_ts, tz)
    monkeypatch.setattr(bls, "datetime", _DT)


def _freeze_reads(monkeypatch, now_ts):
    fake = types.SimpleNamespace(**{k: getattr(_real_time, k) for k in dir(_real_time)
                                    if not k.startswith("__")})
    fake.time = lambda: float(now_ts)
    monkeypatch.setattr(bars_fetch, "_time", fake)

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromtimestamp(now_ts, tz)

        @classmethod
        def utcnow(cls):
            return datetime.utcfromtimestamp(now_ts)
    monkeypatch.setattr(bars_fetch, "datetime", _DT)


@pytest.fixture
def written(monkeypatch, tmp_path):
    """1m coverage armed, the store's writes captured in order as (tf, sym, t, bar)."""
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    db = sqlite3.connect(str(tmp_path / "bars.db"), check_same_thread=False)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: db)
    out = []

    def _many(tf, by):
        out.extend((tf, s, b["t"], b) for s, bs in by.items() for b in bs)
        return sum(len(v) for v in by.values())
    monkeypatch.setattr(bars_sqlite, "put_bars_many", _many)
    monkeypatch.setattr(bars_sqlite, "put_bars",
                        lambda s, tf, bars: out.extend((tf, s, b["t"], b) for b in bars) or len(bars))
    tails: dict = {}
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda s, tf: tails.get((s, tf)))
    _freeze_store(monkeypatch, NOW)
    bls._reset_for_tests()
    bars_fetch.set_request_interactive(True)
    yield _Writes(out, tails)
    bars_fetch.set_request_interactive(False)
    bls._reset_for_tests()


class _Writes:
    """The captured writes; `tails` stands in for the store's stored 1m tails."""

    def __init__(self, out, tails):
        self._out = out
        self.tails = tails

    def tf1(self, sym=None):
        return [(s, t, b) for tf, s, t, b in self._out if tf == "1" and (sym is None or s == sym)]

    def final1(self, sym):
        """The last value written per minute: what the store holds."""
        return {t: b for s, t, b in self.tf1(sym)}

    def clear(self):
        self._out.clear()


def _push(m1=(), wm=None, epoch=E1, ffb=FFB, seq=1, with_m1=True, rows=()):
    p = {"epoch_ms": epoch, "seq": seq, "first_full_bucket_ms": ffb * 1000,
         "watermark_ms": wm, "rows": list(rows), "minutes": []}
    if with_m1:
        p["m1"] = [list(r) for r in m1]
    return bls.ingest(p)


def _fake_fetch(monkeypatch, one=(), fail=False):
    calls = []

    def _f(sym, mult, frm, to):
        calls.append({"sym": sym, "mult": mult, "frm": str(frm), "to": str(to),
                      "thread": threading.current_thread().name})
        if fail:
            raise RuntimeError("provider down")
        return [dict(b) for b in one]
    monkeypatch.setattr(bls, "_fetch", _f)
    return calls


# ── flag off: nothing changes ──────────────────────────────────────────────────

def test_with_the_1m_flag_off_minutes_are_ignored_and_nothing_changes(written, monkeypatch):
    monkeypatch.delenv("BARS_LIVE_1M_ENABLED", raising=False)
    out = _push(m1=[_row("AAA", M(10, 5))], wm=M(10, 5) * 1000)
    assert out == {"accepted": 0, "epoch_ms": E1}            # the reply of today
    bls._covered1.add("AAA")                                  # even a stray entry...
    _push(m1=[_row("AAA", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    assert written.tf1() == []                                # ...is never written
    assert bls._recent1 == {} and bls._urgent1 == []
    assert bls.covered("AAA", "1") is False
    assert bls.proven_through_s("AAA", "1") is None
    assert bls.history_complete("AAA", "1") is False
    with bls._lock:
        body = bls._checkpoint_body_locked()
    assert set(body) == {"v", "epoch_ms", "first_full_bucket_ms", "watermark_ms", "covered",
                         "gaps", "complete"}
    assert "m1" not in bls.status()


def test_with_the_1m_flag_off_needs_fresh_is_what_it_was(written, monkeypatch):
    _freeze_reads(monkeypatch, M(10, 7, 3))
    _push(m1=[], wm=M(10, 6) * 1000)
    bls._covered1.add("AAA")
    monkeypatch.delenv("BARS_LIVE_1M_ENABLED", raising=False)
    with_cov = [bars_fetch._needs_fresh(t, "1", "AAA") for t in (M(10, 6), M(9, 40))]
    monkeypatch.delenv("BARS_LIVE_COVERAGE_ENABLED", raising=False)
    without = [bars_fetch._needs_fresh(t, "1", "AAA") for t in (M(10, 6), M(9, 40))]
    assert with_cov == without == [True, True]


# ── the store ─────────────────────────────────────────────────────────────────

def test_minutes_are_written_only_for_covered_tickers(written):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    out = _push(m1=[_row("AAA", M(10, 5), v=70), _row("BBB", M(10, 5), v=80)],
                wm=M(10, 5) * 1000, seq=2)
    assert [(s, t) for s, t, _ in written.tf1()] == [("AAA", M(10, 5))]
    assert out["m1"] == 1
    assert {"AAA", "BBB"} <= set(bls._recent1[M(10, 5)])     # both held for a repair


def test_covered_needs_the_stream_and_the_minutes_alive(written, monkeypatch):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    assert bls.covered("AAA", "1") is True
    bls._s1["m1_last_push_mono"] = bls._now_mono() - bls.STREAM_ALIVE_S - 1  # minutes stopped
    assert bls.covered("AAA", "1") is False
    bls._s1["m1_last_push_mono"] = bls._now_mono()
    monkeypatch.setattr(bls, "STREAM_ALIVE_S", -1)                          # the feed went quiet
    assert bls.covered("AAA", "1") is False


def test_a_read_queues_a_repair_only_for_a_member_and_never_runs_it_inline(written, monkeypatch):
    calls = _fake_fetch(monkeypatch, fail=True)
    assert bls.covered("AAA", "1") is False                   # no minutes flowing yet
    assert bls._urgent1 == []
    _push(m1=[], wm=M(10, 4) * 1000)
    bars_fetch.set_request_interactive(False)                 # a warm/prewarm sweep
    assert bls.covered("AAA", "1") is False and bls._urgent1 == []
    bars_fetch.set_request_interactive(True)

    async def _on_the_loop():
        return bls.covered("AAA", "1")
    assert asyncio.run(_on_the_loop()) is False               # from an event loop: queued only
    assert bls.covered("AAA", "1") is False                   # deduplicated
    assert bls._urgent1 == ["AAA"] and calls == []


def test_an_urgent_repair_covers_the_ticker_and_later_minutes_keep_it_current(written, monkeypatch):
    _push(m1=[_row("AAA", M(10, 5), o=10, h=13, l=9, c=12, v=70)], wm=M(10, 5) * 1000)
    assert bls.covered("AAA", "1") is False
    calls = _fake_fetch(monkeypatch, one=[_bar(M(10, 4)), _bar(M(10, 5), v=1),
                                          _bar(M(10, 6)), _bar(M(10, 7), v=3)])  # 10:07 is forming
    assert bls._m1_pass() == 1
    assert len(calls) == 1 and calls[0]["thread"].startswith("bars-live-1m-")
    assert calls[0]["mult"] == 1 and "-" in calls[0]["frm"]   # nothing stored: the bounded depth
    assert calls[0]["to"] == str(M(10, 7) * 1000 - 1)         # through the newest CLOSED minute
    final = written.final1("AAA")
    assert sorted(final) == [M(10, 4), M(10, 5), M(10, 6)]    # the forming minute never lands
    assert bls.covered("AAA", "1") is True
    assert bls.history_complete("AAA", "1") is True
    assert bls._s1["repairs_full"] == 1
    written.clear()
    _push(m1=[_row("AAA", M(10, 6), v=55), _row("BBB", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    assert [(s, t, b["v"]) for s, t, b in written.tf1()] == [("AAA", M(10, 6), 55)]
    assert bls.proven_through_s("AAA", "1") == M(10, 7)


def test_the_stream_minute_beats_the_provider_minute(written, monkeypatch):
    _push(m1=[_row("AAA", M(10, 5), o=10, h=13, l=9, c=12, v=70)], wm=M(10, 5) * 1000)
    _fake_fetch(monkeypatch, one=[_bar(M(10, 4), v=5), _bar(M(10, 5), o=99, h=99, l=99, c=99, v=1)])
    assert bls._repair1_one("AAA", E1) is True
    final = written.final1("AAA")
    assert (final[M(10, 5)]["h"], final[M(10, 5)]["v"]) == (13, 70)
    assert final[M(10, 4)]["v"] == 5                          # a minute only the provider has stays


def test_a_minute_landing_during_the_repair_is_not_lost(written, monkeypatch):
    _push(m1=[_row("AAA", M(10, 4))], wm=M(10, 4) * 1000)
    _fake_fetch(monkeypatch, one=[_bar(M(10, 4))])
    real = bls._recent_rows1_locked

    def _late_push(sym):
        rows = real(sym)
        # A push lands between the overlay snapshot and the coverage flip: AAA is not
        # covered yet, so that push does not write its minute.
        assert bls._ingest_m1_locked({"m1": [_row("AAA", M(10, 6), o=5, h=9, l=5, c=9, v=4)]}) == []
        monkeypatch.setattr(bls, "_recent_rows1_locked", real)
        return rows
    monkeypatch.setattr(bls, "_recent_rows1_locked", _late_push)
    assert bls._repair1_one("AAA", E1) is True
    final = written.final1("AAA")
    assert (final[M(10, 6)]["h"], final[M(10, 6)]["v"]) == (9, 4)


def test_a_failed_repair_never_covers_and_is_not_retried_at_once(written, monkeypatch):
    _push(m1=[], wm=M(10, 4) * 1000)
    _fake_fetch(monkeypatch, fail=True)
    assert bls.covered("AAA", "1") is False
    assert bls._m1_pass() == 0
    assert "AAA" not in bls._covered1 and bls._s1["repairs_failed"] == 1
    assert bls.covered("AAA", "1") is False and bls._urgent1 == []   # inside RETRY1_S
    assert bls._repairing1 == set()


def test_a_stored_tail_is_refetched_from_itself(written, monkeypatch):
    written.tails[("AAA", "1")] = M(9, 58)
    _push(m1=[], wm=M(10, 4) * 1000)
    calls = _fake_fetch(monkeypatch, one=[_bar(M(9, 58))])
    assert bls._repair1_one("AAA", E1) is True
    assert calls[0]["frm"] == str(M(9, 58) * 1000)
    assert bls.history_complete("AAA", "1") is False          # a tail is not a full history


def test_a_new_epoch_uncovers_and_repairs_from_where_the_feed_stopped(written, monkeypatch):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    _push(m1=[_row("AAA", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    _push(m1=[], epoch=E2, ffb=M(10, 10))                     # a new socket
    assert bls._covered1 == set() and bls.covered("AAA", "1") is False
    assert bls._gap1_from == {"AAA": M(10, 5)}                # the 5m bucket of the 10:06 watermark
    assert bls._recover1 == ["AAA"] and bls._recent1 == {}
    calls = _fake_fetch(monkeypatch, one=[_bar(M(10, 5)), _bar(M(10, 6))])
    assert bls._m1_pass() == 1
    assert calls[0]["frm"] == str(M(10, 5) * 1000)            # one small refetch, not the depth
    assert bls.covered("AAA", "1") is True and bls._gap1_from == {}
    assert bls._s1["repairs_gap"] == 1


def test_a_push_without_minutes_uncovers_every_1m_ticker(written):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    _push(with_m1=False, wm=M(10, 5) * 1000, seq=2)
    assert bls._covered1 == set() and bls._s1["feed_lost"] == 1
    assert "AAA" in bls._gap1_from
    assert bls.m1_alive() is False


def test_a_minute_outside_the_extended_session_is_never_written(written):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    _push(m1=[_row("AAA", M(19, 59)), _row("AAA", M(21, 0)), _row("AAA", M(3, 30))],
          wm=M(21, 0) * 1000, seq=2)
    assert [t for _, t, _ in written.tf1("AAA")] == [M(19, 59)]
    assert M(21, 0) not in bls._recent1 and M(3, 30) not in bls._recent1


def test_the_recent_minutes_ring_is_bounded(written, monkeypatch):
    monkeypatch.setattr(bls, "RECENT1_S", 600)
    monkeypatch.setattr(bls, "RECENT1_MAX", 50)
    _push(m1=[_row(f"S{i}", M(10, k)) for i in range(30) for k in range(5)], wm=M(10, 4) * 1000)
    assert bls._recent1_meta["n"] <= 50
    assert bls._recent1_meta["n"] == sum(len(s) for s in bls._recent1.values())
    assert M(10, 4) in bls._recent1                           # the newest minutes are kept
    _push(m1=[_row("S0", M(10, 30))], wm=M(10, 30) * 1000, seq=2)
    assert sorted(bls._recent1) == [M(10, 30)]                # older than RECENT1_S: dropped
    _push(m1=[_row("S1", M(10, 1))], wm=M(10, 30) * 1000, seq=3)
    assert sorted(bls._recent1) == [M(10, 30)]                # too old to hold


# ── coverage survives a restart of this tier ─────────────────────────────────

def _restart():
    bls._ckpt["last_mono"] = None
    assert bls.save_checkpoint(force=True) is True
    bls._reset_for_tests()
    return bls.load_checkpoint()


def test_the_same_socket_after_a_restart_is_1m_covered_at_once(written):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    bls._history1_complete.add("AAA")
    bls._gap1_from["BBB"] = M(10, 0)
    assert _restart() == 2
    assert bls._covered1 == set()
    out = _push(m1=[], wm=M(10, 5) * 1000, seq=40)            # the web pod's next push
    assert not out.get("resync")
    assert bls._covered1 == {"AAA"} and bls.covered("AAA", "1") is True
    assert bls._gap1_from == {"BBB": M(10, 0)} and bls.history_complete("AAA", "1")


def test_a_new_socket_after_a_restart_repairs_1m_from_where_it_stopped(written):
    _push(m1=[], wm=M(10, 4) * 1000)
    bls._covered1.add("AAA")
    _push(m1=[], wm=M(10, 6) * 1000, seq=2)
    _restart()
    assert _push(m1=[], epoch=E2, ffb=M(10, 10), seq=3).get("resync") is True
    assert bls._gap1_from == {"AAA": M(10, 5)} and bls._recover1 == ["AAA"]
    _push(m1=[], epoch=E2, ffb=M(10, 10))                     # its fresh start
    assert bls._covered1 == set() and bls._recover1 == ["AAA"]


def test_an_older_checkpoint_without_1m_fields_still_loads(written):
    body = {"v": 1, "epoch_ms": E1, "first_full_bucket_ms": FFB * 1000,
            "watermark_ms": M(10, 4) * 1000, "covered": ["AAA"], "gaps": {}, "complete": []}
    c = bars_sqlite._conn()
    c.execute(bls._CKPT_DDL)
    c.execute("INSERT OR REPLACE INTO live_cov_ckpt(id, saved_at, body) VALUES (1, ?, ?)",
              (float(NOW), json.dumps(body)))
    c.commit()
    assert bls.load_checkpoint() == 1
    _push(m1=[], wm=M(10, 5) * 1000, seq=9)
    assert bls._covered5 == {"AAA"} and bls._covered1 == set()


# ── the read side ─────────────────────────────────────────────────────────────

def _covered_at(monkeypatch, wm_minute, now_ts):
    _push(m1=[], wm=wm_minute * 1000)
    bls._covered1.add("AAA")
    _freeze_reads(monkeypatch, now_ts)


def test_a_covered_fresh_1m_tail_needs_no_fetch(written, monkeypatch):
    _covered_at(monkeypatch, M(10, 6), M(10, 7, 3))
    assert bars_fetch._needs_fresh(M(10, 6), "1", "AAA") is False
    # A thin covered name is VERIFIED by the stream through its newest written minute.
    assert bars_fetch.tail_verified_through("AAA", "1") == M(10, 7)
    assert bars_fetch.intraday_tail_status("AAA", "1", M(9, 40))["tail_status"] == "verified"
    assert bars_fetch._needs_fresh(M(9, 40), "1", "AAA") is False


def test_an_uncovered_1m_tail_is_judged_exactly_as_before(written, monkeypatch):
    _covered_at(monkeypatch, M(10, 6), M(10, 7, 3))
    on = [bars_fetch._needs_fresh(t, "1", "BBB") for t in (M(10, 6), M(10, 3), M(9, 40))]
    monkeypatch.delenv("BARS_LIVE_1M_ENABLED", raising=False)
    off = [bars_fetch._needs_fresh(t, "1", "BBB") for t in (M(10, 6), M(10, 3), M(9, 40))]
    assert on == off == [True, True, True]


def test_the_1m_proof_may_trail_a_minute_boundary_only_briefly(written, monkeypatch):
    # 10:07:03: the stream has written through 10:05 (proof 10:06); 10:06 is landing.
    _covered_at(monkeypatch, M(10, 5), M(10, 7, 3))
    assert bars_fetch.intraday_tail_status("AAA", "1", M(9, 40))["tail_status"] == "unverified"
    assert bars_fetch._needs_fresh(M(9, 40), "1", "AAA") is False
    # Fixed instants, NOT derived from the constant (a control that follows the knob
    # cannot catch the knob moving): AM delivery + flush is ~2-8 s, so a proof still
    # trailing 29 s after the boundary is excused and one trailing 31 s is a lagging feed.
    _freeze_reads(monkeypatch, M(10, 7, 29))
    assert bars_fetch._needs_fresh(M(9, 40), "1", "AAA") is False
    _freeze_reads(monkeypatch, M(10, 7, 31))
    assert bars_fetch._needs_fresh(M(9, 40), "1", "AAA") is True   # a lagging feed is repaired


def test_end_to_end_a_covered_1m_read_is_served_from_sqlite(monkeypatch, tmp_path):
    """Real SQLite: the stream's minute lands and a covered tf=1 read is answered from
    the store without touching any provider."""
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite._drop_local_conn()
    bars_sqlite.init_db()
    _freeze_store(monkeypatch, NOW)
    _freeze_reads(monkeypatch, NOW)
    bls._reset_for_tests()
    try:
        hist = [_bar(M(10, 5) - 60 * i) for i in range(0, 600)]
        bars_sqlite.put_bars("AAA", "1", hist)

        def _no_provider(*a, **k):
            raise AssertionError("a covered read must not reach a provider")
        monkeypatch.setattr(bars_fetch, "_fetch_intraday", _no_provider)
        monkeypatch.setattr(bars_fetch, "_delta_intraday", _no_provider)
        monkeypatch.setattr(bars_fetch, "_maybe_kick_deepfill", lambda *a, **k: None)
        _push(m1=[], wm=M(10, 5) * 1000)
        bls._covered1.add("AAA")
        out = _push(m1=[_row("AAA", M(10, 6), h=12, v=777)], wm=M(10, 6) * 1000, seq=2)
        assert out["m1"] == 1
        bars_fetch.cache.delete_prefix("bars_AAA_1_")
        bars_fetch.set_request_interactive(True)
        resp = bars_fetch._get_bars_inner("AAA", "1", 600)
        assert bars_fetch.get_serve_layer() == "sqlite"
        body = json.loads(resp.body)
        assert body["bars"][-1]["v"] == 777 and body["bars"][-1]["h"] == 12
    finally:
        bars_fetch.set_request_interactive(False)
        bars_sqlite._drop_local_conn()
        bls._reset_for_tests()
