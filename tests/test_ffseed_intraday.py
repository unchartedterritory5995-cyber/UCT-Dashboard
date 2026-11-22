"""The first-frame seed's intraday completeness: the post-close pass (api/services/ffseed_intraday.py)
and, in api/services/ffseed.py, the proof a 5m / 15m / 30m / 60m symbol is packed by, the measure of a
pack's tails and the per-timeframe refusal.

The defect these pin (measured 2026-11-21, build 20261121T0137Z as of 2026-11-20): the worker's store held
intraday rows that stopped mid-session, the last one a bucket caught while forming, and the builder packed
them because their date was the as-of day's.

What is pinned:
  * a store holding a forming bucket is never packed as complete: without the pass's proof nothing is
    packed; after the pass the pack holds the provider's whole session and the forming values are gone;
    a write after the proof voids it;
  * the pass asks the provider for 5m and 15m only, derives 30m / 60m from the STORED 15m with the serve
    path's own derivation over exactly the days it refetched, runs only in the quiet gap between its
    session's extended close and the next session's open, stops at its deadline and at the gap's end,
    leaves a series it cannot join alone, and costs nothing the second time;
  * an answer is WHOLE only when it holds bars of the as-of day and no other record of that day (the
    stored 1m, 5m, 15m, 30m, 60m, the other timeframe's answer) shows a trade in a later bucket; an empty
    answer never proves anything; a wholesale store change voids every proof;
  * a re-derived 30m / 60m write carries its 15m base's own check instant, never the wall clock;
  * a refused gated timeframe is retried on later ticks, bounded (in the process too, and an unreadable
    count is spent), only while the quiet gap is open (its rebuild too), and only when a refused
    timeframe (or the 15m it derives from) proved more; a force runs only in its session's quiet gap
    and gives its refusals fresh retries;
  * a rebuild of a session already published keeps the delta from the build devices held before that
    session (and keeps that build on R2), and keeps the published split list when its own read fails;
  * the measure (symbols whose last bar is the session's last regular bucket) on full, short and
    early-close fixtures;
  * the refusal: a gated timeframe under either floor is not published and not named, the others are;
  * D and 1m are not gated and not refused with them.
"""
import json
import logging
import threading
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_sqlite as bs, ffseed, ffseed_format as fmt
from api.services import ffseed_intraday as intraday
from api.services import ffseed_onemin as onemin

ET = ZoneInfo("America/New_York")
WED, THU, FRI = date(2026, 11, 18), date(2026, 11, 19), date(2026, 11, 20)
SAT, SUN, MON = date(2026, 11, 21), date(2026, 11, 22), date(2026, 11, 23)
HALF = date(2026, 11, 27)                      # the day after Thanksgiving: the regular session ends 13:00
RTH_BARS = {"5": 78, "15": 26, "30": 13, "60": 7}


def et(d: date, h: int, m: int) -> int:
    return int(datetime(d.year, d.month, d.day, h, m, tzinfo=ET).timestamp())


AFTER = float(et(FRI, 20, 30))                 # Friday's extended session has ended
_REAL_FETCH = intraday._fetch                  # the autouse fixture below replaces the module's with a tripwire


@pytest.fixture(autouse=True)
def _private_and_offline(monkeypatch, tmp_path):
    """The ledger goes to a private directory, and no test reaches a vendor or R2."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    for name in ("FFSEED_MIN_TAIL_PCT", "FFSEED_INTRADAY_BACKFILL", "FFSEED_1M_BACKFILL"):
        monkeypatch.delenv(name, raising=False)
    for tf in ffseed.SEED_TFS:
        monkeypatch.delenv(f"FFSEED_MIN_TAIL_PCT_{tf}", raising=False)
        monkeypatch.delenv(f"FFSEED_MIN_SYMBOLS_{tf}", raising=False)

    def _offline(session_iso):
        raise RuntimeError("offline in tests")
    monkeypatch.setattr(ffseed, "_massive_split_rows", _offline)
    monkeypatch.setattr(ffseed, "_fmp_cached_splits", lambda sym: [])
    monkeypatch.setattr(intraday, "_fetch", lambda *a, **k: (_ for _ in ()).throw(AssertionError("vendor call")))
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "get_bytes", lambda key: None)


def bar(t: int, px: float = 100.0, v: int = 1000) -> dict:
    return {"t": t, "o": round(px, 4), "h": round(px + 0.5, 4), "l": round(px - 0.5, 4),
            "c": round(px + 0.25, 4), "v": v}


def day_bars(d: date, step: int, first: int = 4 * 60, last: int = 20 * 60, v: int = 1000) -> list:
    """Every `step`-minute bucket of [first, last) ET minutes of `d`, as the provider answers a timespan."""
    return [bar(et(d, m // 60, m % 60), 100 + m / 1000, v) for m in range(first, last, step)]


def provider(calls: list, fail=(), empty=(), cut=None):
    """The vendor's aggregates at a timespan for whole ET days: every bucket of 04:00-20:00. `cut` =
    {(symbol, tf): ET minute}: that answer's last day stops BEFORE that minute (a truncated answer)."""
    cut = cut or {}

    def fetch(sym, tf, frm, to):
        calls.append((sym, tf, frm, to))
        if sym in fail:
            raise RuntimeError("provider down")
        if sym in empty:
            return []
        out, d = [], frm
        while d <= to:
            if ffseed.is_trading_day(d):
                out += day_bars(d, int(tf), last=cut.get((sym, tf), 20 * 60) if d == to else 20 * 60)
            d += timedelta(days=1)
        return out
    return fetch


class FakeStore:
    """An in-memory series store with the facts the pass reads: rows, tails and a revision that changes
    on every write."""

    def __init__(self):
        self.rows, self.revs, self.writes, self.checked = {}, {}, 0, {}
        self._lock = threading.Lock()

    def put(self, sym, tf, rows, checked_at=0.0):
        with self._lock:
            held = self.rows.setdefault((sym, tf), {})
            for b in rows:
                held[int(b["t"])] = dict(b)
            self.writes += 1
            self.revs[(sym, tf)] = self.writes
            self.checked.setdefault((sym, tf), []).append(checked_at)     # each write's check instant
        return len(rows)

    def rev(self, sym, tf):
        return self.revs.get((sym, tf), 0)

    def last_ts(self, sym, tf):
        held = self.rows.get((sym, tf))
        return max(held) if held else None

    def day_tail(self, sym, tf, d):
        lo, hi = intraday.day_bounds(d)
        ts = [t for t in self.rows.get((sym, tf), {}) if lo <= t < hi]
        return max(ts) if ts else None

    def derive(self, sym, tf, from_ts):
        """`bars_fetch._derive_from_stored_base` over this store: its bucket start, resampler and filter."""
        fb = bars_fetch._derived_bucket_start(tf, from_ts)
        base = [b for t, b in sorted(self.rows.get((sym, "15"), {}).items()) if t > fb - 1]
        return [b for b in bars_fetch._resample_derived(tf, base) if b["t"] >= fb]

    def read(self, sym, tf, count):
        rows = [b for _, b in sorted(self.rows.get((sym, tf), {}).items())][-count:]
        return rows, len(rows)

    def kw(self, fetch, **more):
        return dict(fetch=fetch, derive=self.derive, store=self.put, rev=self.rev, last_ts=self.last_ts,
                    day_tail=self.day_tail, n_workers=1, now=AFTER, **more)


def forming(d: date, at_h: int, at_m: int) -> dict:
    """What one mid-session fetch at `at_h:at_m` ET left in a store: 5m and 15m up to the bucket that was
    forming (partial values), 30m and 60m the resample of that 15m."""
    cut = at_h * 60 + at_m
    out = {}
    for tf in ("5", "15"):
        step = int(tf)
        rows = day_bars(d, step, last=cut // step * step)
        rows.append({"t": et(d, 0, 0) + (cut // step * step) * 60, "o": 99.0, "h": 99.1, "l": 98.9,
                     "c": 99.0, "v": 7})                    # the forming bucket: a sliver of its volume
        out[tf] = rows
    for tf in ("30", "60"):
        out[tf] = bars_fetch._resample_derived(tf, out["15"])
    return out


# ---- the grid, the roles and the settle point are the serve path's ------------------------------

@pytest.mark.parametrize("tf, full, half", [
    ("1", "15:59", "12:59"), ("5", "15:55", "12:55"), ("15", "15:45", "12:45"),
    ("30", "15:30", "12:30"), ("60", "15:30", "12:30"),
])
def test_the_last_regular_bucket_follows_the_stored_grid_and_early_closes(tf, full, half):
    def hm(ts):
        return datetime.fromtimestamp(ts, ET).strftime("%Y-%m-%d %H:%M")
    assert hm(ffseed.last_rth_bucket_ts(tf, FRI)) == f"2026-11-20 {full}"
    assert hm(ffseed.last_rth_bucket_ts(tf, HALF)) == f"2026-11-27 {half}"
    # and it is the bucket the serve path calls a complete regular session's tail
    assert bars_fetch.session_complete(tf, ffseed.last_rth_bucket_ts(tf, FRI), "rth") is True
    assert bars_fetch.session_complete(tf, ffseed.last_rth_bucket_ts(tf, FRI) - 60, "rth") is False


def test_the_gated_timeframes_and_their_roles_come_from_the_serve_path():
    assert ffseed.GATED_TFS == ("5", "15", "30", "60")
    assert intraday.tf_roles() == (("5", "15"), ("30", "60"), "15")
    assert intraday.settled_at(FRI) == et(FRI, 20, 0) + intraday.SETTLE_S
    assert intraday.settled_at(HALF) == et(HALF, 17, 0) + intraday.SETTLE_S


def test_first_day_keeps_a_series_contiguous_or_leaves_it_alone():
    assert intraday.first_day(FRI, None, 5) == FRI                       # nothing stored: this starts it
    assert intraday.first_day(FRI, et(FRI, 10, 0), 5) == FRI             # part of the session held
    assert intraday.first_day(FRI, et(date(2026, 11, 23), 9, 30), 5) == FRI   # a later session held too
    assert intraday.first_day(FRI, et(THU, 10, 15), 5) == THU            # stops yesterday: from there
    assert intraday.first_day(FRI, et(date(2026, 11, 13), 15, 55), 5) is None  # 7 days back, reach 5: alone
    assert intraday.first_day(FRI, et(date(2026, 11, 13), 15, 55), 14) == date(2026, 11, 13)
    assert intraday.reach_days() == 30


# ---- the pass ------------------------------------------------------------------------------------

def test_the_pass_fetches_5m_and_15m_and_derives_30m_and_60m_from_the_stored_15m():
    st, calls = FakeStore(), []
    month_back = [bar(et(date(2026, 10, 20), 10, 0))]
    for tf, rows in forming(FRI, 10, 16).items():
        st.put("CUR", tf, rows)                      # holds part of the session, a forming bucket last
        st.put("BAD", tf, rows)
        st.put("GONE", tf, rows)                     # held rows, then an EMPTY answer
        st.put("LAG", tf, forming(THU, 10, 16)[tf] if tf == "30" else rows)   # its 30m stopped a day earlier
        st.put("FAR30", tf, month_back if tf == "30" else rows)                # its 30m is beyond every reach
    for tf, rows in forming(THU, 10, 16).items():
        st.put("YDAY", tf, rows)                     # stopped yesterday
        st.put("OLD", tf, month_back)                # a month back: beyond every reach
    syms = ["CUR", "YDAY", "OLD", "BAD", "EMPTY", "NEW", "GONE", "LAG", "FAR30"]
    stats = intraday.complete_session(FRI, syms, **st.kw(provider(calls, fail={"BAD"}, empty={"EMPTY", "GONE"})))
    # the provider is asked at 5m and at 15m, never for a derived timeframe; from the stored tail's day;
    # and the 15m from the OLDEST of the 15m / 30m / 60m tails, because those days are re-derived
    assert sorted(calls) == sorted(
        [(s, tf, FRI, FRI) for s in ("CUR", "BAD", "EMPTY", "NEW", "GONE", "FAR30") for tf in ("5", "15")]
        + [("YDAY", tf, THU, FRI) for tf in ("5", "15")] + [("LAG", "5", FRI, FRI), ("LAG", "15", THU, FRI)])
    assert stats["requests"] == 16
    for tf in ("5", "15"):
        t = stats["tfs"][tf]
        got = (t["done"], t["failed"], t["empty"], t["behind"], t["short_answer"], t["current"])
        assert got == (5, 1, 2, 1, 0, 0), tf
    t30, t60 = stats["tfs"]["30"], stats["tfs"]["60"]
    assert (t30["done"], t30["no_base"], t30["behind"], t30["empty"]) == (4, 4, 1, 0)      # FAR30: behind
    assert (t60["done"], t60["no_base"], t60["behind"], t60["empty"]) == (5, 4, 0, 0)
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert all(proven(s, tf) for s in ("CUR", "YDAY", "NEW", "LAG") for tf in ffseed.GATED_TFS)
    # an EMPTY answer never proves anything: not with nothing stored, not with rows held
    assert not any(proven(s, tf) for s in ("OLD", "BAD", "EMPTY", "GONE") for tf in ffseed.GATED_TFS)
    assert st.rows[("GONE", "15")] == {b["t"]: b for b in forming(FRI, 10, 16)["15"]}
    assert ("EMPTY", "5") not in st.rows
    assert proven("FAR30", "15") and proven("FAR30", "60") and not proven("FAR30", "30")
    assert st.rows[("FAR30", "30")] == {b["t"]: b for b in month_back}                     # left alone
    # the stored derived buckets ARE the resample of the stored 15m over the refetched days, forming
    # buckets replaced: LAG's 30m from THURSDAY, the day its own tail was on
    for sym, days in (("CUR", (FRI,)), ("YDAY", (THU, FRI)), ("NEW", (FRI,)), ("LAG", (THU, FRI))):
        whole15 = [b for d in days for b in day_bars(d, 15)]
        assert [b for _, b in sorted(st.rows[(sym, "15")].items())] == whole15, sym
        for tf in ("30", "60"):
            want = {b["t"]: b for b in bars_fetch._resample_derived(tf, whole15)}
            got = {t: b for t, b in st.rows[(sym, tf)].items() if t >= et(days[0], 4, 0)}
            assert got == want, (sym, tf)
        assert st.rows[(sym, "30")][et(FRI, 10, 0)]["v"] == 2000        # two whole 15m bars, not 1000 + 7
        assert st.last_ts(sym, "5") == et(FRI, 19, 55)


def test_an_answer_is_whole_only_when_no_other_record_of_the_day_shows_a_later_trade():
    st, calls = FakeStore(), []
    for tf, rows in forming(FRI, 10, 16).items():
        st.put("BEHIND", tf, rows)                    # held to 10:15
    st.put("MIN", "1", day_bars(FRI, 1, last=16 * 60))   # its stored minutes run to 15:59
    stops = {("BEHIND", "5"): 9 * 60 + 50,            # NOT empty, and stops before the held 10:15
             ("FIVE", "5"): 13 * 60,                  # nothing held: the 5m answer stops at 12:55, the 15m is whole
             ("FIFT", "15"): 13 * 60,                 # the 15m answer stops at 12:45, the 5m is whole
             ("MIN", "5"): 13 * 60, ("MIN", "15"): 13 * 60,     # both stop together; the stored 1m says 15:59
             ("THIN", "5"): 13 * 60, ("THIN", "15"): 13 * 60}   # both stop together and nothing says otherwise
    stats = intraday.complete_session(FRI, ["BEHIND", "FIVE", "FIFT", "MIN", "THIN"],
                                      **st.kw(provider(calls, cut=stops)))
    t5, t15, t30 = stats["tfs"]["5"], stats["tfs"]["15"], stats["tfs"]["30"]
    assert (t5["done"], t5["short_answer"]) == (2, 3)         # FIFT, THIN | BEHIND, FIVE, MIN
    assert (t15["done"], t15["short_answer"]) == (3, 2)       # BEHIND, FIVE, THIN | FIFT, MIN
    assert (t30["done"], t30["no_base"]) == (3, 2) and stats["tfs"]["60"]["done"] == 3
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert [tf for tf in ffseed.GATED_TFS if proven("BEHIND", tf)] == ["15", "30", "60"]
    assert [tf for tf in ffseed.GATED_TFS if proven("FIVE", tf)] == ["15", "30", "60"]
    assert [tf for tf in ffseed.GATED_TFS if proven("FIFT", tf)] == ["5"]
    assert [tf for tf in ffseed.GATED_TFS if proven("MIN", tf)] == []
    # a symbol that simply stopped trading at 12:55 is complete: every record agrees on where it ended
    assert [tf for tf in ffseed.GATED_TFS if proven("THIN", tf)] == ["5", "15", "30", "60"]
    assert st.last_ts("THIN", "5") == et(FRI, 12, 55) and st.last_ts("THIN", "60") == et(FRI, 12, 30)
    # a short answer writes nothing: the held rows stay, a new series is not started
    assert st.rows[("BEHIND", "5")] == {b["t"]: b for b in forming(FRI, 10, 16)["5"]}
    assert ("FIVE", "5") not in st.rows and ("FIFT", "15") not in st.rows and ("MIN", "5") not in st.rows
    # the rule itself, on each grid (60m: the 09:30-anchored session hour)
    assert intraday.later_trade("5", et(FRI, 15, 55), [("a", et(FRI, 15, 59))]) is None
    assert intraday.later_trade("5", et(FRI, 15, 50), [("a", et(FRI, 15, 59))]) == ("a", et(FRI, 15, 59))
    assert intraday.later_trade("15", et(FRI, 15, 45), [("a", et(FRI, 15, 55)), ("b", et(FRI, 16, 0))]) == \
        ("b", et(FRI, 16, 0))
    assert intraday.later_trade("60", et(FRI, 15, 30), [("a", et(FRI, 15, 59))]) is None
    assert intraday.later_trade("60", et(FRI, 14, 30), [("a", et(FRI, 15, 30))]) == ("a", et(FRI, 15, 30))
    assert intraday.last_bar_of_day(day_bars(THU, 5) + day_bars(FRI, 5, last=600), FRI) == et(FRI, 9, 55)
    assert intraday.last_bar_of_day(day_bars(THU, 5), FRI) is None and intraday.last_bar_of_day([], FRI) is None


def test_the_stored_thirty_and_sixty_minute_bars_of_the_day_are_records_too():
    """Both answers stop at 12:55 / 12:45 and agree with each other, but the store already holds a later
    30m (S30) or 60m (S60) bar of that day: a trade the provider's 5m and 15m must hold. Nothing else in
    the store contradicts the answers, so only the stored 30m / 60m tail can refuse them."""
    st, calls = FakeStore(), []
    st.put("S30", "30", [bar(et(FRI, 15, 30))])
    st.put("S60", "60", [bar(et(FRI, 14, 30))])                  # the 14:30 hour of the session grid
    stops = {(s, tf): 13 * 60 for s in ("S30", "S60", "THIN") for tf in ("5", "15")}
    stats = intraday.complete_session(FRI, ["S30", "S60", "THIN"], **st.kw(provider(calls, cut=stops)))
    assert (stats["tfs"]["5"]["short_answer"], stats["tfs"]["15"]["short_answer"]) == (2, 2)
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert [tf for tf in ffseed.GATED_TFS if proven("S30", tf)] == []
    assert [tf for tf in ffseed.GATED_TFS if proven("S60", tf)] == []
    assert [tf for tf in ffseed.GATED_TFS if proven("THIN", tf)] == ["5", "15", "30", "60"]   # the control
    assert ("S30", "5") not in st.rows and st.rows[("S30", "30")] == {et(FRI, 15, 30): bar(et(FRI, 15, 30))}


class _Wall:
    """`ffseed_intraday`'s wall clock (`time.time`), set by the test; its monotonic clock is the real one."""

    def __init__(self, t: float):
        self.t = t

    def time(self) -> float:
        return self.t

    @staticmethod
    def monotonic() -> float:
        import time as _time
        return _time.monotonic()


def _void_the_thirty(st: FakeStore, sym: str) -> None:
    st.put(sym, "30", [dict(bar(et(FRI, 15, 30)), v=5)])          # any later write voids the 30m proof only


def test_a_rederived_series_carries_its_base_check_instant_not_the_wall_clock(monkeypatch):
    """A 30m / 60m write is the resample of the stored 15m, so it is as old as the 15m's provider check:
    when the 15m is `current` (proven by an earlier pass), the re-derived write carries the instant that
    earlier pass checked the 15m at, never the time of the re-derivation (a newer check's seal wins)."""
    wall = _Wall(1000.0)
    monkeypatch.setattr(intraday, "time", wall)
    st, calls = FakeStore(), []
    intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    assert st.checked[("AAA", "15")] == [1000.0] and st.checked[("AAA", "30")] == [1000.0]
    _void_the_thirty(st, "AAA")
    wall.t = 5000.0                                              # the next pass, an hour later
    again = intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    assert again["requests"] == 0 and again["tfs"]["15"]["current"] == 1 and again["tfs"]["30"]["done"] == 1
    assert st.checked[("AAA", "30")][-1] == 1000.0               # the 15m's own check, not 5000
    assert intraday.known_complete(FRI, rev=st.rev)("AAA", "30")


def test_a_rederived_series_whose_base_entry_names_no_instant_takes_the_settle_instant(monkeypatch):
    """A ledger entry written before the check instant was recorded: the derived write claims the
    session's settle instant, which no check of the pass can predate, never the wall clock."""
    wall = _Wall(intraday.settled_at(FRI) + 600.0)
    monkeypatch.setattr(intraday, "time", wall)
    st, calls = FakeStore(), []
    intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    with open(intraday._ledger_path(), encoding="ascii") as f:
        led = json.load(f)
    for entries in led["tfs"].values():
        for sym in entries:
            entries[sym] = entries[sym][:2]                      # [revision, first day]: no instant
    with open(intraday._ledger_path(), "w", encoding="ascii") as f:
        json.dump(led, f)
    _void_the_thirty(st, "AAA")
    wall.t += 3600.0
    again = intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    assert again["requests"] == 0 and again["tfs"]["30"]["done"] == 1
    assert st.checked[("AAA", "30")][-1] == float(intraday.settled_at(FRI))


def test_a_late_run_is_held_to_the_as_of_days_own_rows_and_an_empty_answer_never_proves():
    """The store already holds a LATER day (the pass ran late): the stored tail is not of the as-of day,
    and the answer is still held to the as-of day's own stored rows."""
    st, calls = FakeStore(), []
    for sym in ("LATE0", "LATE1", "LATE2"):
        for tf, rows in forming(FRI, 10, 16).items():
            st.put(sym, tf, rows)
        for tf in ("5", "15"):
            st.put(sym, tf, day_bars(MON, int(tf), last=9 * 60 + 45))
    assert st.last_ts("LATE0", "5") == et(MON, 9, 40) and st.day_tail("LATE0", "5", FRI) == et(FRI, 10, 15)
    stops = {("LATE1", "5"): 9 * 60 + 50, ("LATE1", "15"): 9 * 60 + 45}      # non-empty, short of 10:15
    stats = intraday.complete_session(FRI, ["LATE0", "LATE1", "LATE2"],
                                      **st.kw(provider(calls, empty={"LATE0"}, cut=stops)))
    assert sorted(calls) == [(s, tf, FRI, FRI) for s in ("LATE0", "LATE1", "LATE2") for tf in ("15", "5")]
    for tf in ("5", "15"):
        t = stats["tfs"][tf]
        assert (t["done"], t["empty"], t["short_answer"]) == (1, 1, 1), tf
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert not any(proven(s, tf) for s in ("LATE0", "LATE1") for tf in ffseed.GATED_TFS)
    assert all(proven("LATE2", tf) for tf in ffseed.GATED_TFS)
    assert st.day_tail("LATE2", "5", FRI) == et(FRI, 19, 55) and st.day_tail("LATE2", "30", FRI) == et(FRI, 19, 30)
    # nothing after the as-of day was resampled from 15m rows the pass did not read
    assert st.day_tail("LATE2", "30", MON) is None and st.day_tail("LATE2", "60", MON) is None
    assert st.day_tail("LATE2", "15", MON) == et(MON, 9, 30)


def test_the_pass_runs_only_in_the_quiet_gap_between_its_session_and_the_next():
    assert intraday.cannot_run(FRI, et(FRI, 16, 30)) == "session not settled"
    assert intraday.cannot_run(FRI, et(FRI, 20, 0) + intraday.SETTLE_S - 1) == "session not settled"
    for ok in (et(FRI, 20, 1), et(SAT, 12, 0), et(SUN, 23, 0), et(MON, 3, 59)):
        assert intraday.cannot_run(FRI, ok) is None
    for late in (et(MON, 4, 0), et(MON, 10, 0), et(MON, 21, 0), et(date(2026, 11, 24), 2, 0)):
        assert intraday.cannot_run(FRI, late) == "a later session has begun (2026-11-23)"
    # a holiday is not a session: Wednesday's gap runs through Thanksgiving to Friday 04:00
    wed = date(2026, 11, 25)
    assert intraday.cannot_run(wed, et(date(2026, 11, 26), 12, 0)) is None
    assert intraday.cannot_run(wed, et(HALF, 4, 0)) == "a later session has begun (2026-11-27)"
    st, calls = FakeStore(), []
    stats = intraday.complete_session(FRI, ["AAA"], **{**st.kw(provider(calls)), "now": float(et(MON, 10, 0))})
    assert stats["skipped"] == "a later session has begun (2026-11-23)" and calls == [] and stats["requests"] == 0
    assert not intraday.known_complete(FRI, rev=st.rev)("AAA", "5")


def test_a_pass_still_running_when_the_gap_closes_stops_there():
    st, calls, t = FakeStore(), [], [0.0]
    inner = provider(calls)

    def slow(sym, tf, frm, to):
        t[0] += 10.0                               # every provider call takes 10 s
        return inner(sym, tf, frm, to)

    # 15 s before Monday's extended open, the default 90-minute deadline
    stats = intraday.complete_session(FRI, ["AAA", "BBB"], **{**st.kw(slow, clock=lambda: t[0]),
                                                              "now": float(et(MON, 4, 0) - 15)})
    assert [c[:2] for c in calls] == [("AAA", "5"), ("AAA", "15")]
    assert stats["tfs"]["5"]["not_reached"] == 1 and stats["tfs"]["15"]["not_reached"] == 1
    assert not intraday.known_complete(FRI, rev=st.rev)("BBB", "5")


def test_two_workers_prove_every_symbol_once(monkeypatch):
    monkeypatch.setattr(intraday, "_SAVE_EVERY", 7)             # the ledger is saved while both threads mark
    st, calls = FakeStore(), []
    syms = [f"S{i:02d}" for i in range(40)]
    for sym in syms[::2]:
        for tf, rows in forming(FRI, 10, 16).items():
            st.put(sym, tf, rows)
    stats = intraday.complete_session(FRI, syms, **{**st.kw(provider(calls)), "n_workers": 2})
    assert stats["requests"] == 80 and len(calls) == 80 and len(set(calls)) == 80
    assert [stats["tfs"][tf]["done"] for tf in ffseed.GATED_TFS] == [40, 40, 40, 40]
    assert sum(sum(v for k, v in t.items() if k not in ("done", "rows")) for t in stats["tfs"].values()) == 0
    proven = intraday.known_complete(FRI, rev=st.rev)             # read back from the file on disk
    assert all(proven(s, tf) for s in syms for tf in ffseed.GATED_TFS)
    assert all(st.last_ts(s, "30") == et(FRI, 19, 30) for s in syms)


def test_the_pass_never_runs_before_the_extended_session_has_ended():
    st, calls = FakeStore(), []
    stats = intraday.complete_session(FRI, ["AAA"], **{**st.kw(provider(calls)), "now": float(et(FRI, 16, 30))})
    assert stats["skipped"] == "session not settled" and calls == [] and stats["requests"] == 0
    assert not intraday.known_complete(FRI, rev=st.rev)("AAA", "5")
    stats = intraday.complete_session(FRI, ["AAA"], **{**st.kw(provider(calls)), "now": float(et(FRI, 20, 2))})
    assert "skipped" not in stats and len(calls) == 2


def test_the_pass_stops_at_its_deadline_and_proves_nothing_it_did_not_reach():
    st, calls, t = FakeStore(), [], [0.0]
    inner = provider(calls)

    def slow(sym, tf, frm, to):
        t[0] += 10.0                               # every provider call takes 10 s
        return inner(sym, tf, frm, to)

    stats = intraday.complete_session(FRI, ["AAA", "BBB"], **st.kw(slow, deadline=15.0, clock=lambda: t[0]))
    assert [c[:2] for c in calls] == [("AAA", "5"), ("AAA", "15")]
    assert stats["tfs"]["5"]["not_reached"] == 1 and stats["tfs"]["15"]["not_reached"] == 1
    assert stats["tfs"]["30"]["no_base"] == 1 and stats["tfs"]["60"]["no_base"] == 1
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert all(proven("AAA", tf) for tf in ffseed.GATED_TFS)
    assert not any(proven("BBB", tf) for tf in ffseed.GATED_TFS)


def test_a_second_pass_costs_nothing_and_a_later_write_voids_the_proof():
    st, calls = FakeStore(), []
    intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    assert len(calls) == 2
    again = intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    assert len(calls) == 2 and again["requests"] == 0
    assert [again["tfs"][tf]["current"] for tf in ffseed.GATED_TFS] == [1, 1, 1, 1]
    # a write to the 15m after the proof (any writer): its proof is void, and so the pass asks again
    # and derives 30m / 60m again from the rows now stored
    st.put("AAA", "15", [dict(bar(et(FRI, 15, 45)), v=5)])
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert not proven("AAA", "15") and proven("AAA", "5")
    third = intraday.complete_session(FRI, ["AAA"], **st.kw(provider(calls)))
    assert [c[:2] for c in calls[2:]] == [("AAA", "15")] and third["requests"] == 1
    assert third["tfs"]["30"]["done"] == 1 and third["tfs"]["60"]["done"] == 1
    assert st.rows[("AAA", "15")][et(FRI, 15, 45)]["v"] == 1000
    assert all(intraday.known_complete(FRI, rev=st.rev)("AAA", tf) for tf in ffseed.GATED_TFS)
    # the ledger is one session's: another as-of day reads nothing from it
    assert not intraday.known_complete(THU, rev=st.rev)("AAA", "5")


def test_a_provider_answer_that_never_reached_the_store_proves_nothing():
    st, calls = FakeStore(), []
    stats = intraday.complete_session(FRI, ["AAA"], **{**st.kw(provider(calls)), "store": lambda *a: 0})
    assert stats["tfs"]["5"]["failed"] == 1 and stats["tfs"]["15"]["failed"] == 1
    assert stats["tfs"]["30"]["no_base"] == 1
    assert not any(intraday.known_complete(FRI, rev=st.rev)("AAA", tf) for tf in ffseed.GATED_TFS)


def test_the_default_read_is_the_range_read_and_never_a_derived_timeframe(monkeypatch):
    seen = []
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_range",
                        lambda sym, tf, frm, to, raise_errors=False: seen.append((sym, tf, frm, to, raise_errors)) or [])
    assert _REAL_FETCH("ZZ", "15", THU, FRI) == []
    assert seen == [("ZZ", "15", "2026-11-19", "2026-11-20", True)]
    for tf in ("30", "60"):
        with pytest.raises(ValueError, match="derived"):
            _REAL_FETCH("ZZ", tf, FRI, FRI)
    assert len(seen) == 1


def test_the_default_write_is_the_range_repair_write(monkeypatch):
    seen = {}

    class _Check:
        def __init__(self, t):
            seen["checked"] = t

        def __enter__(self):
            seen["inside"] = True

        def __exit__(self, *a):
            seen["inside"] = False

    monkeypatch.setattr(bars_fetch, "_provider_write", _Check)
    monkeypatch.setattr(bs, "put_bars", lambda sym, tf, rows, **k: seen.update(put=(sym, tf, len(rows), seen.get("inside"))) or len(rows))
    assert intraday._store("ZZ", "15", [{"t": 1}], 123.0) == 1
    assert seen["checked"] == 123.0 and seen["put"] == ("ZZ", "15", 1, True)


# ---- a store holding a forming bucket is never packed as complete (the real store) ---------------

@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "bars.db"))
    bs.bump_db_epoch()
    bs.init_db()
    yield tmp_path
    bs.bump_db_epoch()


def _seed_the_defect(sym: str) -> None:
    """Thursday whole, Friday as ONE mid-morning fetch left it (the measured shape)."""
    whole15 = day_bars(THU, 15)
    bs.put_bars(sym, "5", day_bars(THU, 5))
    bs.put_bars(sym, "15", whole15)
    for tf in ("30", "60"):
        bs.put_bars(sym, tf, bars_fetch._resample_derived(tf, whole15))
    for tf, rows in forming(FRI, 10, 16).items():
        bs.put_bars(sym, tf, rows)


def test_a_store_holding_a_forming_bucket_is_never_packed_as_complete(store):
    sym = "ZZFORM"
    _seed_the_defect(sym)
    # the defect's shape: every series' newest row IS of the as-of day (the old check), and stops mid-morning
    for tf, hm in (("5", (10, 15)), ("15", (10, 15)), ("30", (10, 0)), ("60", (9, 30))):
        assert bs.get_last_ts(sym, tf) == et(FRI, *hm)
    # 1. nobody proved the session complete: nothing of it is packed
    for tf in ffseed.GATED_TFS:
        data, st = ffseed.build_tf(tf, [sym], FRI, "B0")
        assert (st["symbols"], st["incomplete"], st["reach_last"]) == (0, 1, 0), tf
        assert fmt.read_trailer(data)["symbols"] == {}
    # 2. the pass (the provider's whole session, the real write, the real derivation, the store's own revision)
    calls = []
    stats = intraday.complete_session(FRI, [sym], fetch=provider(calls), n_workers=1, now=AFTER)
    assert sorted(calls) == [(sym, "15", FRI, FRI), (sym, "5", FRI, FRI)]
    assert all(stats["tfs"][tf]["done"] == 1 for tf in ffseed.GATED_TFS)
    stored15 = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                for r in bs.get_bars_since(sym, "15", et(FRI, 4, 0) - 1)]
    assert stored15 == day_bars(FRI, 15)
    for tf in ffseed.GATED_TFS:
        data, st = ffseed.build_tf(tf, [sym], FRI, "B1")
        assert (st["symbols"], st["incomplete"], st["reach_last"], st["tail_share"]) == (1, 0, 1, 1.0), tf
        seed = fmt.read_served(data, sym)
        fri = [b for b in seed if b["t"] >= et(FRI, 0, 0)]
        assert len(fri) == RTH_BARS[tf] and fri[-1]["t"] == ffseed.last_rth_bucket_ts(tf, FRI)
        # the session's rows are the provider's (5m, 15m) or the resample of the stored 15m (30m, 60m):
        # the forming bucket's sliver (v 7, prices near 99) is gone
        want = day_bars(FRI, int(tf)) if tf in ("5", "15") else bars_fetch._resample_derived(tf, stored15)
        want = [b for b in want if ffseed.is_rth_bar(b["t"])]
        assert [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in fri] == \
               [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in want], tf
    # 3. a later write to a series (here: another mid-session style row) voids its proof
    bs.put_bars(sym, "30", [dict(bar(et(FRI, 15, 30)), v=3)])
    data, st = ffseed.build_tf("30", [sym], FRI, "B2")
    assert (st["symbols"], st["incomplete"]) == (0, 1)
    data, st = ffseed.build_tf("60", [sym], FRI, "B2")
    assert (st["symbols"], st["incomplete"]) == (1, 0)


def test_the_real_derivation_rebuilds_exactly_the_refetched_days(store):
    """`bars_fetch._derive_from_stored_base` over more than one day, on the real store: Wednesday (not
    refetched) is untouched, Thursday and Friday are the resample of the provider's whole 15m."""
    w15 = day_bars(WED, 15)
    for sym in ("ZZYDAY", "ZZLAG"):
        bs.put_bars(sym, "5", day_bars(WED, 5))
        bs.put_bars(sym, "15", w15)
        for tf in ("30", "60"):
            bs.put_bars(sym, tf, bars_fetch._resample_derived(tf, w15))
    for tf, rows in forming(THU, 10, 16).items():
        bs.put_bars("ZZYDAY", tf, rows)              # every series stopped Thursday mid-morning
    t15 = day_bars(THU, 15)
    bs.put_bars("ZZLAG", "5", day_bars(THU, 5))      # Thursday whole at 5m, 15m and 60m ...
    bs.put_bars("ZZLAG", "15", t15)
    bs.put_bars("ZZLAG", "60", bars_fetch._resample_derived("60", t15))
    bs.put_bars("ZZLAG", "30", forming(THU, 10, 16)["30"])          # ... but its 30m stopped mid-morning
    for tf in ("5", "15", "60"):
        bs.put_bars("ZZLAG", tf, forming(FRI, 10, 16)[tf])          # and Friday as one fetch left it
    wed_before = {(s, tf): bs.get_bars_before(s, tf, 1000, et(THU, 0, 0) - 1)
                  for s in ("ZZYDAY", "ZZLAG") for tf in ("30", "60")}
    calls = []
    stats = intraday.complete_session(FRI, ["ZZYDAY", "ZZLAG"], fetch=provider(calls), n_workers=2, now=AFTER)
    assert sorted(calls) == [("ZZLAG", "15", THU, FRI), ("ZZLAG", "5", FRI, FRI),
                             ("ZZYDAY", "15", THU, FRI), ("ZZYDAY", "5", THU, FRI)]
    assert [stats["tfs"][tf]["done"] for tf in ffseed.GATED_TFS] == [2, 2, 2, 2]
    whole15 = day_bars(THU, 15) + day_bars(FRI, 15)
    for sym in ("ZZYDAY", "ZZLAG"):
        for tf in ("30", "60"):
            got = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                   for r in bs.get_bars_since(sym, tf, et(THU, 0, 0) - 1)]
            assert got == bars_fetch._resample_derived(tf, whole15), (sym, tf)
            assert bs.get_bars_before(sym, tf, 1000, et(THU, 0, 0) - 1) == wed_before[(sym, tf)], (sym, tf)
            data, st = ffseed.build_tf(tf, [sym], FRI, "B")
            assert (st["symbols"], st["incomplete"], st["reach_last"]) == (1, 0, 1), (sym, tf)
            seed = fmt.read_served(data, sym)
            assert len([b for b in seed if b["t"] >= et(THU, 0, 0)]) == 2 * RTH_BARS[tf]


def test_the_stored_tail_of_a_day_is_read_under_a_later_day(store):
    sym = "ZZLATE"
    bs.put_bars(sym, "5", forming(FRI, 10, 16)["5"])
    assert intraday._stored_day_tail(sym, "5", FRI) == et(FRI, 10, 15)
    bs.put_bars(sym, "5", day_bars(MON, 5, last=9 * 60 + 45))       # a later session is stored too
    assert bs.get_last_ts(sym, "5") == et(MON, 9, 40)
    assert intraday._stored_day_tail(sym, "5", FRI) == et(FRI, 10, 15)
    assert intraday._stored_day_tail(sym, "5", MON) == et(MON, 9, 40)
    assert intraday._stored_day_tail(sym, "5", THU) is None and intraday._stored_day_tail(sym, "5", SAT) is None
    assert intraday._stored_day_tail("ZZNONE", "5", FRI) is None


def test_a_store_replaced_wholesale_voids_every_proof(store):
    sym = "ZZFLOOR"
    _seed_the_defect(sym)
    intraday.complete_session(FRI, [sym], fetch=provider([]), n_workers=1, now=AFTER)
    assert all(intraday.known_complete(FRI)(sym, tf) for tf in ffseed.GATED_TFS)
    bs.bump_store_floor("test: a snapshot was installed")
    assert not any(intraday.known_complete(FRI)(sym, tf) for tf in ffseed.GATED_TFS)
    for tf in ffseed.GATED_TFS:
        data, st = ffseed.build_tf(tf, [sym], FRI, "B")
        assert (st["symbols"], st["incomplete"]) == (0, 1), tf
    # and the next pass asks again
    calls = []
    intraday.complete_session(FRI, [sym], fetch=provider(calls), n_workers=1, now=AFTER)
    assert len(calls) == 2 and all(intraday.known_complete(FRI)(sym, tf) for tf in ffseed.GATED_TFS)


def test_a_rederived_series_sealed_after_its_bases_recorded_check_is_rewritten_and_proven(store, monkeypatch):
    """The real store. After the nightly pass (15m checked at t1), a request-path check of the 15m at t2
    finds nothing new and SEALS it (a seal is not a write: the 15m proof stands); the 30m read path then
    rebuilds the 30m from that 15m (a write: the 30m proof is void) and seals it at the 15m seal's own
    check, t2 (bars_fetch._local_tail_repair). The retry pass re-derives the 30m from the same 15m: a
    write claiming t1 would lose to the t2 seal (bars_sqlite._drop_stale_sealed drops every row, put_bars
    returns 0) and the 30m would stay unproven. The rows it resamples were checked at t2."""
    sym = "ZZSEAL"
    wall = _Wall(float(intraday.settled_at(FRI) + 300))           # the nightly pass asks at 20:06
    monkeypatch.setattr(intraday, "time", wall)
    intraday.complete_session(FRI, [sym], fetch=provider([]), n_workers=1, now=AFTER)
    assert all(intraday.known_complete(FRI)(sym, tf) for tf in ffseed.GATED_TFS)
    t1, t2 = wall.t, wall.t + 1800.0
    lo, _hi = intraday.day_bounds(FRI)
    end = float(et(FRI, 20, 0))
    bs.record_sealed(sym, "15", end, float(lo), t2)
    bs.put_bars(sym, "30", bars_fetch._derive_from_stored_base(sym, "30", lo))
    bs.record_sealed(sym, "30", end, float(lo), t2)
    proven = intraday.known_complete(FRI)
    assert proven(sym, "15") and not proven(sym, "30") and proven(sym, "60")
    assert bs.series_meta(sym, "15")["sealed_checked_at"] == t2 == bs.series_meta(sym, "30")["sealed_checked_at"]
    wrote = []
    real_store = intraday._store

    def spy(s, tf, rows, ck):
        n = real_store(s, tf, rows, ck)
        wrote.append((tf, ck, n))
        return n
    monkeypatch.setattr(intraday, "_store", spy)
    wall.t = t2 + 1800.0                                           # the retry pass, an hour after t1
    again = intraday.complete_session(FRI, [sym], fetch=provider([]), n_workers=1, now=AFTER)
    assert again["requests"] == 0 and again["tfs"]["15"]["current"] == 1 and again["tfs"]["60"]["current"] == 1
    assert len(wrote) == 1 and wrote[0][2] > 0, wrote              # put_bars wrote the re-derived rows
    assert wrote[0][:2] == ("30", t2) and t1 < t2                  # at the newest check of the rows it resamples
    assert (again["tfs"]["30"]["done"], again["tfs"]["30"]["failed"]) == (1, 0)
    assert intraday.known_complete(FRI)(sym, "30")


# ---- the measure: full, short and early-close fixtures -------------------------------------------

def _table(asof: date, tf: str, tails: dict) -> dict:
    """symbol -> its last regular bucket's ET minute (None = the whole session) on `asof`, after a whole
    prior session."""
    step, out = int(tf), {}
    prior = onemin.prev_session(asof)
    for sym, upto in tails.items():
        rows = day_bars(prior, step)
        rows += day_bars(asof, step) if upto is None else day_bars(asof, step, last=upto + step)
        out[(sym, tf)] = rows
    return out


def _read(table):
    def read(sym, tf, count):
        rows = table.get((sym, tf), [])
        return rows[-count:], len(rows[-count:])
    return read


def _yes(sym, tf):
    return True


def test_the_measure_counts_the_symbols_whose_last_bar_is_the_last_regular_bucket():
    table = _table(FRI, "5", {"FULL": None, "FULL2": None, "THIN": 15 * 60 + 40, "CUT": 10 * 60 + 15})
    data, st = ffseed.build_tf("5", ["FULL", "FULL2", "THIN", "CUT"], FRI, "B", read=_read(table), complete=_yes)
    assert st["last_bucket"] == et(FRI, 15, 55)
    assert (st["symbols"], st["reach_last"], st["tail_share"]) == (4, 2, 0.5)
    assert ffseed.completeness_of("5", st) == {"last_bucket": et(FRI, 15, 55), "reach_last": 2, "share": 0.5,
                                               "floor": 0.9, "proven": True}
    # 15:55 on a full day is not the last bucket's neighbour: one bucket short does not count
    table = _table(FRI, "5", {"NEAR": 15 * 60 + 50})
    assert ffseed.build_tf("5", ["NEAR"], FRI, "B", read=_read(table), complete=_yes)[1]["reach_last"] == 0


@pytest.mark.parametrize("tf, last_min", [("5", 12 * 60 + 55), ("15", 12 * 60 + 45), ("30", 12 * 60 + 30)])
def test_the_measure_on_an_early_close_day(tf, last_min):
    # the provider's day runs past 13:00 (post-market): the regular session's last bucket is still 12:5x
    table = _table(HALF, tf, {"FULL": None, "SHORT": 11 * 60})
    data, st = ffseed.build_tf(tf, ["FULL", "SHORT"], HALF, "B", read=_read(table), complete=_yes)
    assert st["last_bucket"] == et(HALF, 0, 0) + last_min * 60
    assert (st["symbols"], st["reach_last"], st["tail_share"]) == (2, 1, 0.5)
    assert fmt.read_served(data, "FULL")[-1]["t"] == st["last_bucket"]     # nothing from 13:00 on is packed
    assert fmt.read_served(data, "SHORT")[-1]["t"] == et(HALF, 11, 0)


def test_the_sixty_minute_measure_uses_the_session_grid():
    whole15 = day_bars(THU, 15) + day_bars(FRI, 15)
    cut15 = day_bars(THU, 15) + day_bars(FRI, 15, last=14 * 60 + 30)
    table = {("FULL", "60"): bars_fetch._resample_derived("60", whole15),
             ("CUT", "60"): bars_fetch._resample_derived("60", cut15)}
    data, st = ffseed.build_tf("60", ["FULL", "CUT"], FRI, "B", read=_read(table), complete=_yes)
    assert st["last_bucket"] == et(FRI, 15, 30) and (st["symbols"], st["reach_last"]) == (2, 1)


# ---- the refusal -----------------------------------------------------------------------------------

def _daily(asof: date, syms) -> dict:
    days, d = [], asof - timedelta(days=40)
    while d <= asof:
        if ffseed.is_trading_day(d):
            days.append(d)
        d += timedelta(days=1)
    return {(s, "D"): [{"t": x.isoformat(), "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 7} for x in days]
            for s in syms}


NOW = datetime(2026, 11, 21, 1, 37, tzinfo=ZoneInfo("UTC"))
SYMS = ["AAA", "BBB", "CCC"]


def _short_table() -> dict:
    """5m: one symbol whole, two cut mid-session (33% reach the last bucket). 1m and D whole."""
    table = _table(FRI, "5", {"AAA": None, "BBB": 10 * 60 + 15, "CCC": 13 * 60})
    table.update(_table(FRI, "1", {s: None for s in SYMS}))
    table.update(_daily(FRI, SYMS))
    return table


def test_a_timeframe_under_the_completeness_floor_is_refused_alone(monkeypatch):
    table, handed = _short_table(), []
    built = ffseed.build(tfs=["1", "5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW,
                         min_symbols=1, complete=_yes, on_pack=lambda tf, data, entry: handed.append(tf))
    m = built["manifest"]
    assert set(m["tfs"]) == {"1", "D"} and handed == ["1", "D"]        # 5m: never handed over, never named
    r = m["refused"]["5"]
    assert r["reason"] == "1 of 3 symbols reach the session's last bucket (33.3%), floor 90%"
    assert r["complete"] == {"last_bucket": et(FRI, 15, 55), "reach_last": 1, "share": 0.3333, "floor": 0.9,
                             "proven": True}
    assert (m["tfs"]["1"]["symbols"], m["tfs"]["D"]["symbols"]) == (3, 3)
    # the floor is the timeframe's own variable, read at build time
    monkeypatch.setenv("FFSEED_MIN_TAIL_PCT_5", "30")
    m = ffseed.build(tfs=["1", "5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, min_symbols=1,
                     complete=_yes)["manifest"]
    assert set(m["tfs"]) == {"1", "5", "D"} and "refused" not in m
    assert m["tfs"]["5"]["complete"]["share"] == 0.3333 and m["tfs"]["5"]["complete"]["floor"] == 0.3
    monkeypatch.setenv("FFSEED_MIN_TAIL_PCT_5", "34")
    m = ffseed.build(tfs=["1", "5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, min_symbols=1,
                     complete=_yes)["manifest"]
    assert set(m["tfs"]) == {"1", "D"}


def test_a_whole_timeframe_is_published_and_records_its_completeness():
    table = _table(FRI, "5", {"AAA": None, "BBB": None, "CCC": None})
    table.update(_daily(FRI, SYMS))
    m = ffseed.build(tfs=["5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, min_symbols=1,
                     complete=_yes)["manifest"]
    assert set(m["tfs"]) == {"5", "D"} and "refused" not in m
    assert m["tfs"]["5"]["complete"] == {"last_bucket": et(FRI, 15, 55), "reach_last": 3, "share": 1.0,
                                         "floor": 0.9, "proven": True}
    assert m["tfs"]["5"]["skipped"]["incomplete"] == 0
    assert "complete" not in m["tfs"]["D"]                               # a daily pack has no intraday tail


def test_unproven_symbols_are_left_out_and_the_symbol_floor_then_refuses_the_timeframe_alone(monkeypatch):
    table = _table(FRI, "5", {"AAA": None, "BBB": None, "CCC": None})
    table.update(_daily(FRI, SYMS))
    monkeypatch.setattr(ffseed, "MIN_SYMBOLS", 2)
    only_aaa = lambda sym, tf: sym == "AAA"                               # noqa: E731
    m = ffseed.build(tfs=["5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, complete=only_aaa)["manifest"]
    assert set(m["tfs"]) == {"D"}
    assert m["refused"]["5"]["reason"] == "1 symbols, floor 2" and m["refused"]["5"]["incomplete"] == 2
    # nothing fit at all: nothing is published
    with pytest.raises(ffseed.SeedBuildError, match="no timeframe is fit to publish: tf 5: 1 symbols, floor 2"):
        ffseed.build(tfs=["5"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, complete=only_aaa)
    # and a floor on D still refuses the whole build, a gated timeframe before it or not
    monkeypatch.setenv("FFSEED_MIN_SYMBOLS_D", "4")
    with pytest.raises(ffseed.SeedBuildError, match="tf D: 3 symbols, floor 4: refusing to publish"):
        ffseed.build(tfs=["5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, complete=_yes)


def test_a_refused_timeframe_is_never_uploaded_and_the_manifest_says_so(monkeypatch):
    from api.services import data_sync
    table, puts = _short_table(), {}
    monkeypatch.setattr(data_sync, "credentials_ok", lambda: True)
    monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: puts.update({k: b}) or True)
    monkeypatch.setattr(ffseed, "prune", lambda *a: [])
    m = ffseed.build_and_publish(tfs=["1", "5", "D"], symbols=SYMS, asof=FRI, read=_read(table), min_symbols=1,
                                 complete=_yes)
    assert list(puts) == [m["tfs"]["1"]["key"], m["tfs"]["D"]["key"], "ffseed/latest.json"]
    published = json.loads(puts["ffseed/latest.json"])
    assert set(published["tfs"]) == {"1", "D"} and set(published["refused"]) == {"5"}
    assert not any("/5.ffs" in k for k in puts)


# ---- D and 1m are not gated ----------------------------------------------------------------------

def test_daily_and_one_minute_are_built_without_the_proof_and_never_refused_with_the_others():
    table = _short_table()
    asked = []

    def nobody(sym, tf):
        asked.append(tf)
        return False                                 # no intraday series is proven complete

    built = ffseed.build(tfs=["1", "5", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW,
                         min_symbols=1, complete=nobody)
    m = built["manifest"]
    assert set(asked) == {"5"}                       # the proof is never asked about 1m or D
    assert set(m["tfs"]) == {"1", "D"} and set(m["refused"]) == {"5"}
    assert m["refused"]["5"]["reason"] == "0 symbols, floor 1" and m["refused"]["5"]["incomplete"] == 3
    # their packs are exactly what the builder made before the gate existed: every symbol, same bytes
    for tf in ("1", "D"):
        pb = fmt.PackBuilder(tf, asof=FRI.isoformat(), build=m["build"], depth=ffseed.depth_for(tf))
        for sym in SYMS:
            pb.add_served(sym, ffseed.select_window(table[(sym, tf)], tf, ffseed.depth_for(tf), 20261120))
        assert built["packs"][tf] == pb.finish(), tf
        assert m["tfs"][tf]["skipped"]["incomplete"] == 0
    # 1m is measured (no floor, no proof); D is not an intraday pack
    assert m["tfs"]["1"]["complete"] == {"last_bucket": et(FRI, 15, 59), "reach_last": 3, "share": 1.0,
                                         "floor": None, "proven": False}
    assert "complete" not in m["tfs"]["D"]
    # the default proof is the pass's ledger: with none written (this test's private DATA_DIR) nothing
    # intraday is packed, and 1m and D still are
    m = ffseed.build(tfs=["1", "5", "15", "30", "60", "D"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW,
                     min_symbols=1)["manifest"]
    assert set(m["tfs"]) == {"1", "D"} and set(m["refused"]) == set(ffseed.GATED_TFS)


def test_a_short_one_minute_pack_is_measured_and_still_published():
    table = _table(FRI, "1", {"AAA": None, "BBB": 10 * 60 + 15, "CCC": 13 * 60})
    m = ffseed.build(tfs=["1"], symbols=SYMS, asof=FRI, read=_read(table), now=NOW, min_symbols=1)["manifest"]
    assert set(m["tfs"]) == {"1"} and "refused" not in m
    assert m["tfs"]["1"]["complete"]["share"] == 0.3333


# ---- the nightly sequence ------------------------------------------------------------------------

@pytest.fixture
def seq(monkeypatch):
    log = []
    monkeypatch.setattr(onemin, "backfill", lambda asof, **kw: log.append(("1m", asof)) or {"not_reached": 0})
    monkeypatch.setattr(onemin, "retention", lambda asof: log.append(("retention", asof)))
    monkeypatch.setattr(intraday, "complete_session", lambda asof, **kw: log.append(("intraday", asof)) or {})

    def bp(asof):
        log.append(("publish", asof))
        return {"build": "B", "asof": asof.isoformat(), "tfs": {}, "refused": {"30": {"reason": "x"}}}
    monkeypatch.setattr(ffseed, "build_and_publish", bp)
    return log


def test_nightly_completes_the_intraday_session_after_the_1m_pass_and_before_the_build(seq, monkeypatch):
    ffseed.nightly(FRI)
    assert seq == [("1m", FRI), ("intraday", FRI), ("publish", FRI), ("retention", FRI)]
    assert ffseed._read_marker() == 20261120
    seq.clear()
    monkeypatch.setenv("FFSEED_INTRADAY_BACKFILL", "0")          # off: the build then refuses what is unproven
    ffseed.nightly(FRI)
    assert seq == [("1m", FRI), ("publish", FRI), ("retention", FRI)]


def test_a_failed_intraday_pass_never_stops_the_publish(seq, monkeypatch):
    def boom(asof, **kw):
        raise RuntimeError("x")
    monkeypatch.setattr(intraday, "complete_session", boom)
    assert ffseed.nightly(FRI)["asof"] == "2026-11-20"
    assert seq == [("1m", FRI), ("publish", FRI), ("retention", FRI)]


# ---- a refused gated timeframe is not final for the night ----------------------------------------

@pytest.fixture
def night(monkeypatch):
    """The builder loop with the provider-facing parts stubbed. `script["passes"]` is what each intraday
    pass returns and `script["refusals"]` the timeframes each build refuses, in order (the last repeats;
    an exception in either list is raised)."""
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "credentials_ok", lambda: True)
    monkeypatch.setattr(ffseed, "_force_spent_said", "")
    # the process-level state a test must not inherit from another (a fresh worker process)
    monkeypatch.setattr(ffseed, "_force_gap_said", "", raising=False)
    monkeypatch.setattr(ffseed, "_retry_runs", {}, raising=False)
    monkeypatch.delenv("FFSEED_GATED_RETRIES", raising=False)
    monkeypatch.delenv("FFSEED_FORCE_ASOF", raising=False)
    log, script, builds = [], {"passes": [], "refusals": []}, [0]

    def take(key, default):
        q = script[key]
        item = q.pop(0) if len(q) > 1 else (q[0] if q else default)
        if isinstance(item, Exception):
            raise item
        return item

    def the_pass(asof, **kw):
        log.append(("pass", asof))
        return take("passes", {"tfs": {"5": {"done": 0}}})

    def bp(asof):
        refused = list(take("refusals", []))
        builds[0] += 1
        log.append(("publish", asof, tuple(refused)))
        m = {"build": f"B{builds[0]}", "asof": asof.isoformat(),
             "tfs": {tf: {"symbols": 1, "bytes": 1} for tf in ffseed.SEED_TFS if tf not in refused}}
        if refused:
            m["refused"] = {tf: {"reason": "x"} for tf in refused}
        return m

    monkeypatch.setattr(onemin, "backfill", lambda asof, **kw: {"not_reached": 0})
    monkeypatch.setattr(onemin, "retention", lambda asof: None)
    monkeypatch.setattr(intraday, "complete_session", the_pass)
    monkeypatch.setattr(ffseed, "build_and_publish", bp)
    return log, script


def at(d: date, h: int, m: int) -> datetime:
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ET)


def test_a_refused_gated_timeframe_is_retried_on_a_later_tick_until_it_is_published(night):
    log, script = night
    script["passes"] = [{"tfs": {"30": {"done": 0}}}, {"tfs": {"30": {"done": 12}, "60": {"done": 12}}}]
    script["refusals"] = [["30", "60"], []]
    ffseed._write_marker(20261119)
    m1 = ffseed.tick(at(FRI, 20, 20))
    assert sorted(m1["refused"]) == ["30", "60"] and ffseed._read_marker() == 20261120
    assert ffseed._read_retry() == {"asof": "2026-11-20", "tries": 0, "tfs": ["30", "60"]}
    assert ffseed.gated_retry_due(at(FRI, 20, 50)) == FRI
    m2 = ffseed.tick(at(FRI, 20, 50))                       # the next tick: the pass again, then the build
    assert m2["build"] == "B2" and "refused" not in m2 and set(m2["tfs"]) == set(ffseed.SEED_TFS)
    assert log == [("pass", FRI), ("publish", FRI, ("30", "60")), ("pass", FRI), ("publish", FRI, ())]
    assert ffseed._read_retry() == {} and ffseed.gated_retry_due(at(FRI, 21, 20)) is None
    assert ffseed.tick(at(FRI, 21, 20)) is None and len(log) == 4


def test_the_gated_retry_is_bounded_and_does_not_republish_when_the_pass_proved_nothing_new(night, monkeypatch):
    log, script = night
    script["passes"] = [{"tfs": {"30": {"done": 0}}}, {"tfs": {"30": {"done": 0, "current": 9}}},
                        {"tfs": {"30": {"done": 5}}}]
    script["refusals"] = [["30"]]                           # every build refuses it
    ffseed._write_marker(20261119)
    ffseed.tick(at(FRI, 20, 20))
    assert ffseed.tick(at(FRI, 20, 50)) is None            # retry 1: nothing new proved, nothing published
    assert log == [("pass", FRI), ("publish", FRI, ("30",)), ("pass", FRI)]
    assert ffseed._read_retry()["tries"] == 1
    m = ffseed.tick(at(FRI, 21, 20))                        # retry 2: 5 more series, a rebuild, still refused
    assert m["build"] == "B2" and sorted(m["refused"]) == ["30"]
    assert ffseed._read_retry() == {"asof": "2026-11-20", "tries": 2, "tfs": ["30"]}
    for later in (at(FRI, 21, 50), at(SAT, 9, 0), at(SUN, 9, 0)):
        assert ffseed.gated_retry_due(later) is None and ffseed.tick(later) is None     # the bound: 2
    assert log == [("pass", FRI), ("publish", FRI, ("30",)), ("pass", FRI), ("pass", FRI), ("publish", FRI, ("30",))]
    monkeypatch.setenv("FFSEED_GATED_RETRIES", "3")         # read at tick time
    assert ffseed.gated_retry_due(at(SAT, 9, 30)) == FRI
    monkeypatch.setenv("FFSEED_INTRADAY_BACKFILL", "0")     # no pass, no retry
    assert ffseed.gated_retry_due(at(SAT, 9, 30)) is None


def test_a_retry_is_counted_before_its_work_so_a_failure_inside_it_cannot_loop(night):
    log, script = night
    script["passes"] = [{"tfs": {"30": {"done": 0}}}, RuntimeError("the provider client died"),
                        {"tfs": {"30": {"done": 4}}}]
    script["refusals"] = [["30"], ffseed.SeedBuildError("tf D: 3 symbols, floor 1500: refusing to publish")]
    ffseed._write_marker(20261119)
    ffseed.tick(at(FRI, 20, 20))
    assert ffseed.tick(at(FRI, 20, 50)) is None            # retry 1: the pass raised
    assert ffseed._read_retry()["tries"] == 1
    with pytest.raises(ffseed.SeedBuildError):             # retry 2: the rebuild was unfit to publish
        ffseed.tick(at(FRI, 21, 20))
    assert ffseed._read_retry()["tries"] == 2
    assert ffseed.tick(at(FRI, 21, 50)) is None and ffseed.gated_retry_due(at(FRI, 21, 50)) is None
    assert log == [("pass", FRI), ("publish", FRI, ("30",)), ("pass", FRI), ("pass", FRI)]


def test_the_retry_waits_for_the_quiet_gap_and_never_runs_in_a_later_session(night, monkeypatch):
    log, script = night
    # FFSEED_BUILD_AFTER_MIN below the extended close: the build runs at 16:35, the pass cannot yet
    monkeypatch.setattr(ffseed, "BUILD_AFTER_MIN", 16 * 60 + 30)
    script["passes"] = [{"skipped": "session not settled", "tfs": {}}, {"tfs": {"5": {"done": 9}}}]
    script["refusals"] = [list(ffseed.GATED_TFS), []]
    ffseed._write_marker(20261119)
    m1 = ffseed.tick(at(FRI, 16, 35))
    assert sorted(m1["tfs"]) == ["1", "D"] and ffseed._read_marker() == 20261120     # D and 1m are out
    for early in (at(FRI, 17, 5), at(FRI, 19, 35), at(FRI, 20, 0)):
        assert ffseed.tick(early) is None                  # not settled: no pass, no try spent
    assert len(log) == 2 and ffseed._read_retry()["tries"] == 0
    m2 = ffseed.tick(at(FRI, 20, 5))
    assert "refused" not in m2 and set(m2["tfs"]) == set(ffseed.SEED_TFS) and ffseed._read_retry() == {}
    # a refusal still pending when the next session opens is left to that session's own build
    monkeypatch.setattr(ffseed, "BUILD_AFTER_MIN", 20 * 60 + 15)
    ffseed._write_retry({"asof": "2026-11-20", "tries": 0, "tfs": ["30"]})
    n = len(log)
    assert ffseed.gated_retry_due(at(SUN, 12, 0)) == FRI   # the weekend is the gap
    for later in (at(MON, 4, 0), at(MON, 10, 0), at(MON, 16, 30), at(MON, 20, 5)):
        assert ffseed.gated_retry_due(later) is None, later
        assert ffseed.tick(later) is None and len(log) == n and ffseed._read_retry()["tries"] == 0
    script["passes"], script["refusals"] = [{"tfs": {"5": {"done": 1}}}], [[]]
    m3 = ffseed.tick(at(MON, 20, 20))                       # Monday's own build
    assert m3["asof"] == "2026-11-23" and ffseed._read_retry() == {}


def _force_friday(script, monkeypatch):
    script["passes"] = [{"tfs": {"60": {"done": 0}}}, {"tfs": {"60": {"done": 3}}}]
    script["refusals"] = [["60"], []]
    ffseed._write_marker(20261120)                          # Friday is already published
    monkeypatch.setenv("FFSEED_FORCE_ASOF", "2026-11-20")


def test_a_forced_rebuild_that_refused_is_retried_without_touching_the_forced_marker(night, monkeypatch):
    log, script = night
    _force_friday(script, monkeypatch)
    m1 = ffseed.tick(at(SAT, 10, 0))
    assert sorted(m1["refused"]) == ["60"] and ffseed._read_forced() == "2026-11-20"
    m2 = ffseed.tick(at(SAT, 10, 30))                       # not the force again: the gated retry
    assert m2["build"] == "B2" and "refused" not in m2 and ffseed._read_forced() == "2026-11-20"
    assert log == [("pass", FRI), ("publish", FRI, ("60",)), ("pass", FRI), ("publish", FRI, ())]
    assert ffseed.tick(at(SAT, 11, 0)) is None and ffseed.tick(at(SAT, 11, 30)) is None and len(log) == 4


def test_a_forced_rebuild_that_refuses_says_so(night, monkeypatch, caplog):
    log, script = night
    _force_friday(script, monkeypatch)
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    ffseed.tick(at(SAT, 10, 0))
    said = [r.getMessage() for r in caplog.records if "forced rebuild of 2026-11-20 REFUSED" in r.getMessage()]
    assert len(said) == 1 and "['60']" in said[0] and ".last_ffseed_forced" in said[0]


def test_a_spent_force_says_so_once_and_names_the_file(night, monkeypatch, caplog):
    log, script = night
    _force_friday(script, monkeypatch)
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    for minute in (0, 30):
        ffseed.tick(at(SAT, 10, minute))
    ffseed.tick(at(SAT, 11, 0))
    ffseed.tick(at(SAT, 11, 30))
    spent = [r.getMessage() for r in caplog.records if "already force-built" in r.getMessage()]
    assert len(spent) == 1 and ".last_ffseed_forced" in spent[0] and "FFSEED_FORCE_ASOF=2026-11-20" in spent[0]


def test_a_force_after_its_sessions_quiet_gap_closed_is_refused_and_not_spent(night, monkeypatch, caplog):
    """Friday is still the newest closed session on Monday until 20:15, but its quiet gap closed at 04:00:
    a force then could only publish every gated timeframe refused, and would burn the force."""
    log, script = night
    _force_friday(script, monkeypatch)
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    for minute in (0, 30):
        assert ffseed.tick(at(MON, 10, minute)) is None
    assert log == [] and ffseed._read_forced() == ""
    said = [r.getMessage() for r in caplog.records if "FFSEED_FORCE_ASOF=2026-11-20" in r.getMessage()]
    assert len(said) == 1 and "a later session has begun (2026-11-23)" in said[0] and "not spent" in said[0]


def test_a_force_before_its_sessions_quiet_gap_waits_for_it(night, monkeypatch, caplog):
    log, script = night
    monkeypatch.setattr(ffseed, "BUILD_AFTER_MIN", 16 * 60 + 30)      # Friday is the newest closed at 16:30
    _force_friday(script, monkeypatch)
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    for early in (at(FRI, 16, 45), at(FRI, 19, 45)):
        assert ffseed.tick(early) is None
    assert log == [] and ffseed._read_forced() == ""
    said = [r.getMessage() for r in caplog.records if "FFSEED_FORCE_ASOF=2026-11-20" in r.getMessage()]
    assert len(said) == 1 and "session not settled" in said[0]
    m = ffseed.tick(at(FRI, 20, 5))                                   # the gap is open: the force runs
    assert m["asof"] == "2026-11-20" and ffseed._read_forced() == "2026-11-20"
    assert log == [("pass", FRI), ("publish", FRI, ("60",))]


def test_a_force_gives_its_refusals_fresh_retries_and_says_how_many(night, monkeypatch, caplog):
    log, script = night
    script["passes"] = [{"tfs": {"60": {"done": 0}}}] * 4 + [{"tfs": {"60": {"done": 3}}}]
    script["refusals"] = [["60"], ["60"], []]
    ffseed._write_marker(20261119)
    for t in (at(FRI, 20, 20), at(FRI, 20, 50), at(FRI, 21, 20)):     # the nightly and both retries
        ffseed.tick(t)
    assert ffseed._read_retry()["tries"] == 2 and ffseed.gated_retry_due(at(SAT, 9, 0)) is None
    monkeypatch.setenv("FFSEED_FORCE_ASOF", "2026-11-20")
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    m = ffseed.tick(at(SAT, 10, 0))
    assert sorted(m["refused"]) == ["60"] and ffseed._read_retry()["tries"] == 0
    said = [r.getMessage() for r in caplog.records if "forced rebuild of 2026-11-20 REFUSED" in r.getMessage()]
    assert len(said) == 1 and "2 gated retries" in said[0]
    m = ffseed.tick(at(SAT, 10, 30))                                  # the retry the line promised
    assert m is not None and "refused" not in m and log[-2:] == [("pass", FRI), ("publish", FRI, ())]


@pytest.mark.parametrize("env", ["FFSEED_GATED_RETRIES", "FFSEED_INTRADAY_BACKFILL"])
def test_a_forced_rebuild_whose_refusal_cannot_be_retried_says_so(night, monkeypatch, caplog, env):
    log, script = night
    _force_friday(script, monkeypatch)
    monkeypatch.setenv(env, "0")
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    ffseed.tick(at(SAT, 10, 0))
    said = [r.getMessage() for r in caplog.records if "forced rebuild of 2026-11-20 REFUSED" in r.getMessage()]
    assert len(said) == 1 and "will NOT be retried" in said[0] and f"{env}=0" in said[0]
    assert ffseed.tick(at(SAT, 10, 30)) is None


# ---- the retry's own bounds: what it counts, when it rebuilds -------------------------------------

def test_a_retry_whose_count_cannot_be_written_is_still_bounded_in_process(night, tmp_path):
    log, script = night
    script["passes"] = [{"tfs": {"30": {"done": 0}}}]                 # no pass ever proves anything
    script["refusals"] = [["30"]]
    ffseed._write_marker(20261119)
    ffseed.tick(at(FRI, 20, 20))
    assert ffseed._read_retry()["tries"] == 0
    (tmp_path / ".ffseed_gated_retry.tmp").mkdir()                   # from here on the state cannot be written
    for h in range(1, 6):
        ffseed.tick(at(SAT, h, 0))
    assert log == [("pass", FRI), ("publish", FRI, ("30",)), ("pass", FRI), ("pass", FRI)]
    assert ffseed._read_retry()["tries"] == 0                         # the file never moved: the process counted


@pytest.mark.parametrize("tries", ["two", 1.5, True, -1, None])
def test_a_retry_count_that_is_not_a_whole_number_is_spent_never_zero(night, tmp_path, tries):
    (tmp_path / ".ffseed_gated_retry").write_text(
        json.dumps({"asof": "2026-11-20", "tries": tries, "tfs": ["30"]}), encoding="ascii")
    assert ffseed.gated_retry_due(at(SAT, 9, 0)) is None
    ffseed.note_refused(FRI, {"refused": {"30": {"reason": "x"}}})    # a rebuild of that session refused it again
    assert ffseed.gated_retry_due(at(SAT, 9, 0)) is None
    ffseed.note_refused(MON, {"refused": {"30": {"reason": "x"}}})    # another session starts its own count
    assert ffseed._read_retry()["tries"] == 0 and ffseed.gated_retry_due(at(MON, 21, 0)) == MON


def test_a_retry_whose_pass_ends_after_the_quiet_gap_closed_does_not_rebuild(night, monkeypatch, caplog):
    log, script = night
    t = [0.0]
    monkeypatch.setattr(ffseed, "_mono", lambda: t[0], raising=False)
    inner = intraday.complete_session

    def half_an_hour(asof, **kw):
        t[0] += 1800.0
        return inner(asof, **kw)
    monkeypatch.setattr(intraday, "complete_session", half_an_hour)
    script["passes"] = [{"tfs": {"30": {"done": 0}}}, {"tfs": {"30": {"done": 5}}}]
    script["refusals"] = [["30"]]
    ffseed._write_marker(20261119)
    ffseed.tick(at(FRI, 20, 20))
    m = ffseed.tick(at(SUN, 12, 0))                                   # ends 12:30 Sunday: rebuilt
    assert m is not None and log[-1] == ("publish", FRI, ("30",))
    caplog.set_level(logging.WARNING, logger="api.services.ffseed")
    n = len(log)
    assert ffseed.tick(at(MON, 3, 40)) is None                        # ends 04:10 Monday: the gap has closed
    assert log[n:] == [("pass", FRI)] and ffseed._read_retry()["tries"] == 2
    assert any("after the quiet gap closed" in r.getMessage() for r in caplog.records)


def test_a_retry_rebuilds_only_when_a_refused_timeframe_or_its_base_proved_more(night):
    log, script = night
    script["refusals"] = [["30"]]
    script["passes"] = [{"tfs": {"30": {"done": 0}}},
                        {"tfs": {"5": {"done": 40}, "60": {"done": 40}, "30": {"done": 0}}},   # only the others
                        {"tfs": {"15": {"done": 2}, "30": {"done": 0}}}]                     # 30m's own base
    ffseed._write_marker(20261119)
    ffseed.tick(at(FRI, 20, 20))
    assert ffseed.tick(at(FRI, 20, 50)) is None and log[-1] == ("pass", FRI)
    m = ffseed.tick(at(FRI, 21, 20))
    assert m["build"] == "B2" and log[-1] == ("publish", FRI, ("30",))


def test_what_a_retry_counts_as_new_for_the_refused_timeframes():
    s = {"tfs": {"5": {"done": 7}, "15": {"done": 3}, "30": {"done": 1}, "60": {"done": 0}}}
    assert ffseed._proved_for_refused(s, ["30"]) == 4                 # its own and its 15m base's
    assert ffseed._proved_for_refused(s, ["60"]) == 3
    assert ffseed._proved_for_refused(s, ["5"]) == 7                  # 5m derives from nothing
    assert ffseed._proved_for_refused(s, ["15"]) == 3
    assert ffseed._proved_for_refused(s, ["5", "60"]) == 10
    assert ffseed._proved_for_refused(s, []) == 11                    # none named: every timeframe counts
    assert ffseed._proved_for_refused({"tfs": {}}, ["30"]) == 0


# ---- what a rebuild of a session already published republishes ---------------------------------

class FakeR2:
    """The bucket as build_and_publish and prune see it: objects by key, listed by prefix, deleted by key."""

    def __init__(self):
        self.objs = {}

    def put(self, key, data, content_type):
        self.objs[key] = bytes(data)
        return True

    def get(self, key):
        return self.objs.get(key)

    def builds(self):
        return sorted({k.split("/")[1] for k in self.objs if k.count("/") == 2})

    def get_paginator(self, _name):
        return self

    def paginate(self, Bucket, Prefix):                               # noqa: N803 - boto's names
        return [{"Contents": [{"Key": k} for k in sorted(self.objs) if k.startswith(Prefix)]}]

    def delete_object(self, Bucket, Key):                             # noqa: N803
        self.objs.pop(Key, None)


@pytest.fixture
def r2(monkeypatch):
    from api.services import data_sync
    b = FakeR2()
    monkeypatch.setattr(data_sync, "credentials_ok", lambda: True)
    monkeypatch.setattr(data_sync, "put_bytes", b.put)
    monkeypatch.setattr(data_sync, "get_bytes", b.get)
    monkeypatch.setattr(data_sync, "_client", lambda: b)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "bucket")
    monkeypatch.delenv("FFSEED_KEEP", raising=False)
    return b


def _utc(d: date, h: int, m: int) -> datetime:
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ZoneInfo("UTC"))


TUE = date(2026, 11, 24)


def test_a_same_session_rebuild_keeps_the_delta_from_the_previous_session_and_keeps_that_build(r2):
    """Devices hold Thursday's build overnight. Friday's first build diffs against it; a retry that
    republishes Friday must still give them a delta (not every full pack), and must not prune it."""
    from api.services import ffseed_delta as dl
    table = _table(FRI, "5", {s: None for s in SYMS})
    table.update(_daily(MON, SYMS))
    kw = dict(symbols=SYMS, read=_read(table), min_symbols=1, complete=_yes)
    b0 = ffseed.build_and_publish(tfs=["D"], asof=THU, now=_utc(FRI, 1, 31), **kw)       # no 5m on Thursday
    b1 = ffseed.build_and_publish(tfs=["5", "D"], asof=FRI, now=_utc(SAT, 1, 37), **kw)  # Friday's first
    b2 = ffseed.build_and_publish(tfs=["5", "D"], asof=FRI, now=_utc(SAT, 2, 7), **kw)   # Friday's retry
    assert b1["tfs"]["D"]["delta"]["base"] == b0["build"] and "delta" not in b1["tfs"]["5"]
    assert b2["tfs"]["D"]["delta"]["base"] == b0["build"]
    # a timeframe Thursday's build did not have: from the build that has it
    assert b2["tfs"]["5"]["delta"]["base"] == b1["build"]
    assert r2.builds() == sorted([b0["build"], b1["build"], b2["build"]])
    b3 = ffseed.build_and_publish(tfs=["5", "D"], asof=FRI, now=_utc(SAT, 2, 37), **kw)  # a second retry
    assert b3["tfs"]["D"]["delta"]["base"] == b0["build"] and b3["tfs"]["5"]["delta"]["base"] == b2["build"]
    assert r2.builds() == sorted([b0["build"], b2["build"], b3["build"]])      # the night's first goes, not b0
    # a device on Thursday's build applies the retry's delta and holds exactly the retry's pack
    held, new, d = r2.get(b0["tfs"]["D"]["key"]), r2.get(b3["tfs"]["D"]["key"]), b3["tfs"]["D"]["delta"]
    got = dl.apply_delta(held, r2.get(d["key"]))
    for sym in SYMS:
        want = fmt.decode_symbol(new, fmt.read_trailer(new), sym)
        assert all(list(got[sym][k]) == list(want[k]) for k in fmt.COLUMNS), sym
    # the next session's first build diffs against the newest build, and the older ones go
    b4 = ffseed.build_and_publish(tfs=["D"], asof=MON, now=_utc(TUE, 1, 31), **kw)
    assert b4["tfs"]["D"]["delta"]["base"] == b3["build"]
    assert r2.builds() == sorted([b3["build"], b4["build"]])


def test_a_same_session_rebuild_whose_split_read_failed_keeps_the_published_list(r2):
    kw = dict(tfs=["D"], symbols=SYMS, read=_read(_daily(MON, SYMS)), min_symbols=1)
    held = {"session": "2026-11-23", "symbols": {"BBB": 2.0}}
    b1 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 1, 37), splits=lambda a, s: held, **kw)
    assert b1["splits"] == held
    b2 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 2, 7), **kw)          # the read fails (offline)
    assert b2["splits"] == held and json.loads(r2.get("ffseed/latest.json"))["splits"] == held
    fresh = {"session": "2026-11-23", "symbols": {}}
    b3 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 2, 37), splits=lambda a, s: fresh, **kw)
    assert b3["splits"] == fresh                                              # an answer wins over the held list
    # another session's list is never carried over: the next session without an answer has none
    b4 = ffseed.build_and_publish(asof=MON, now=_utc(TUE, 1, 31), **kw)
    assert "splits" not in b4


def _d_only():
    return dict(tfs=["D"], symbols=SYMS, read=_read(_daily(MON, SYMS)), min_symbols=1)


def _applies(r2: FakeR2, held_key: str, delta_key: str, new_key: str) -> bool:
    """A device holding `held_key`'s pack that applies the delta holds exactly `new_key`'s pack."""
    from api.services import ffseed_delta as dl
    got, new = dl.apply_delta(r2.get(held_key), r2.get(delta_key)), r2.get(new_key)
    return all(list(got[s][k]) == list(fmt.decode_symbol(new, fmt.read_trailer(new), s)[k])
               for s in SYMS for k in fmt.COLUMNS)


def test_a_rebuild_whose_recorded_base_is_gone_diffs_against_the_published_build(r2):
    b0 = ffseed.build_and_publish(asof=THU, now=_utc(FRI, 1, 31), **_d_only())
    b1 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 1, 37), **_d_only())
    for key in [k for k in r2.objs if k.startswith(f"ffseed/{b0['build']}/")]:
        del r2.objs[key]                                       # the recorded base is gone from R2
    b2 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 2, 7), **_d_only())
    d = b2["tfs"]["D"]["delta"]                                # a delta all the same, from the published build
    assert d["base"] == b1["build"]
    assert _applies(r2, b1["tfs"]["D"]["key"], d["key"], b2["tfs"]["D"]["key"])


@pytest.mark.parametrize("tfs", [7, "D", ["D"]])
def test_a_malformed_recorded_base_reads_as_no_record_and_never_stops_a_rebuild(r2, tmp_path, tfs):
    ffseed.build_and_publish(asof=THU, now=_utc(FRI, 1, 31), **_d_only())
    b1 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 1, 37), **_d_only())
    path = tmp_path / ".ffseed_delta_base.json"
    rec = json.loads(path.read_text(encoding="ascii"))
    rec["manifest"]["tfs"] = tfs                               # still kind ffseed, still a build id
    path.write_text(json.dumps(rec), encoding="ascii")
    b2 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 2, 7), **_d_only())
    assert b2["tfs"]["D"]["delta"]["base"] == b1["build"]     # as with no record: the published build


def test_a_malformed_published_manifest_reads_as_none_and_never_stops_a_build(r2):
    r2.objs["ffseed/latest.json"] = json.dumps({"kind": fmt.KIND, "build": "20261120T0131Z",
                                                "asof": "2026-11-19", "tfs": 7}).encode()
    b1 = ffseed.build_and_publish(asof=FRI, now=_utc(SAT, 1, 37), **_d_only())
    assert set(b1["tfs"]) == {"D"} and "delta" not in b1["tfs"]["D"]
