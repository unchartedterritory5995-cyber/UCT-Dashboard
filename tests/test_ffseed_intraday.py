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
    path's own derivation, never runs before the extended session has ended, stops at its deadline,
    leaves a series it cannot join alone, and costs nothing the second time;
  * the measure (symbols whose last bar is the session's last regular bucket) on full, short and
    early-close fixtures;
  * the refusal: a gated timeframe under either floor is not published and not named, the others are;
  * D and 1m are not gated and not refused with them.
"""
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_sqlite as bs, ffseed, ffseed_format as fmt
from api.services import ffseed_intraday as intraday
from api.services import ffseed_onemin as onemin

ET = ZoneInfo("America/New_York")
WED, THU, FRI = date(2026, 11, 18), date(2026, 11, 19), date(2026, 11, 20)
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


def provider(calls: list, fail=(), empty=()):
    """The vendor's aggregates at a timespan for whole ET days: every bucket of 04:00-20:00."""
    def fetch(sym, tf, frm, to):
        calls.append((sym, tf, frm, to))
        if sym in fail:
            raise RuntimeError("provider down")
        if sym in empty:
            return []
        out, d = [], frm
        while d <= to:
            if ffseed.is_trading_day(d):
                out += day_bars(d, int(tf))
            d += timedelta(days=1)
        return out
    return fetch


class FakeStore:
    """An in-memory series store with the three facts the pass reads: rows, tails and a revision that
    changes on every write."""

    def __init__(self):
        self.rows, self.revs, self.writes = {}, {}, 0

    def put(self, sym, tf, rows, checked_at=0.0):
        held = self.rows.setdefault((sym, tf), {})
        for b in rows:
            held[int(b["t"])] = dict(b)
        self.writes += 1
        self.revs[(sym, tf)] = self.writes
        return len(rows)

    def rev(self, sym, tf):
        return self.revs.get((sym, tf), 0)

    def last_ts(self, sym, tf):
        held = self.rows.get((sym, tf))
        return max(held) if held else None

    def first_ts(self, sym, tf):
        held = self.rows.get((sym, tf))
        return min(held) if held else None

    def derive(self, sym, tf, from_ts):
        base = [b for t, b in sorted(self.rows.get((sym, "15"), {}).items()) if t >= from_ts]
        return bars_fetch._resample_derived(tf, base)      # the serve path's resampler

    def read(self, sym, tf, count):
        rows = [b for _, b in sorted(self.rows.get((sym, tf), {}).items())][-count:]
        return rows, len(rows)

    def kw(self, fetch, **more):
        return dict(fetch=fetch, derive=self.derive, store=self.put, rev=self.rev, last_ts=self.last_ts,
                    first_ts=self.first_ts, n_workers=1, now=AFTER, **more)


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
    for tf, rows in forming(FRI, 10, 16).items():
        st.put("CUR", tf, rows)                      # holds part of the session, a forming bucket last
    for tf, rows in forming(THU, 10, 16).items():
        st.put("YDAY", tf, rows)                     # stopped yesterday
    for tf in ("5", "15", "30", "60"):
        st.put("OLD", tf, [bar(et(date(2026, 10, 20), 10, 0))])      # a month back: beyond every reach
        st.put("BAD", tf, forming(FRI, 10, 16)[tf])
        st.put("GONE", tf, forming(FRI, 10, 16)[tf])                 # held rows, then an EMPTY answer
    st.put("HOLE", "30", forming(THU, 10, 16)["30"])                 # a 30m tail its (absent) 15m cannot join
    stats = intraday.complete_session(FRI, ["CUR", "YDAY", "OLD", "BAD", "EMPTY", "NEW", "HOLE", "GONE"],
                                      **st.kw(provider(calls, fail={"BAD"}, empty={"EMPTY", "GONE"})))
    # the provider is asked at 5m and at 15m, never for a derived timeframe, and from the stored tail's day
    assert sorted(calls) == sorted(
        [(s, tf, FRI, FRI) for s in ("CUR", "BAD", "EMPTY", "NEW", "HOLE", "GONE") for tf in ("5", "15")]
        + [("YDAY", tf, THU, FRI) for tf in ("5", "15")])
    assert stats["requests"] == 14
    for tf in ("5", "15"):
        t = stats["tfs"][tf]
        got = (t["done"], t["failed"], t["short_answer"], t["behind"], t["empty"], t["current"])
        assert got == (5, 1, 1, 1, 1, 0), tf
    t30, t60 = stats["tfs"]["30"], stats["tfs"]["60"]
    assert (t30["done"], t30["no_base"], t30["behind"], t30["empty"]) == (4, 3, 1, 1)      # HOLE: behind
    assert (t60["done"], t60["no_base"], t60["behind"], t60["empty"]) == (5, 3, 0, 1)
    proven = intraday.known_complete(FRI, rev=st.rev)
    assert all(proven(s, tf) for s in ("CUR", "YDAY", "NEW", "EMPTY") for tf in ffseed.GATED_TFS)
    # nothing stored and an empty answer: complete (and nothing to pack). Rows held and an answer that
    # does not reach them: NOT complete, the held rows may be the forming ones
    assert not any(proven(s, tf) for s in ("OLD", "BAD", "GONE") for tf in ffseed.GATED_TFS)
    assert st.rows[("GONE", "15")] == {b["t"]: b for b in forming(FRI, 10, 16)["15"]}
    assert proven("HOLE", "15") and proven("HOLE", "60") and not proven("HOLE", "30")
    assert st.rows[("HOLE", "30")] == {b["t"]: b for b in forming(THU, 10, 16)["30"]}      # left alone
    # the stored derived buckets ARE the resample of the stored 15m, forming buckets replaced, both days
    for sym, days in (("CUR", (FRI,)), ("YDAY", (THU, FRI)), ("NEW", (FRI,))):
        whole15 = [b for d in days for b in day_bars(d, 15)]
        for tf in ("30", "60"):
            want = {b["t"]: b for b in bars_fetch._resample_derived(tf, whole15)}
            got = {t: b for t, b in st.rows[(sym, tf)].items() if t >= et(days[0], 4, 0)}
            assert got == want, (sym, tf)
        assert st.rows[(sym, "30")][et(FRI, 10, 0)]["v"] == 2000        # two whole 15m bars, not 1000 + 7
        assert st.last_ts(sym, "5") == et(FRI, 19, 55)


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
