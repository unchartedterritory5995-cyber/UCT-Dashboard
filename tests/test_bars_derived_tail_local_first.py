"""Derived timeframes (30m, 60m) have ONE derivation path: from the STORED 15m base.

Measured on production 2026-11-11 09:42 ET: SPY tf=30 bars=1120 first answer had NO
bars from today (last bar = the previous evening's 19:30), `delta-deadline`,
`tail_status: unverified`, and a retry ~3 s later the same — while SPY tf=15, the rows
the 30m is resampled from (#1037), was current in the same store. The tail repair
asked the provider for whole days of 15m, stored only the resample, and outlived the
2.5 s ceiling at the open.

INVARIANT (property test below): after any sequence of base writes, local repairs and
provider deltas, every stored derived bucket equals the resample of the stored base
rows in that bucket, and the derived tail reaches the base tail's bucket.

Also pinned: a request blocks on the provider only when a CLOSED bucket is missing
(1m ONON/SOFI and SPY/IWM 15m `sd-deadline` ~2.5 s with current data).

Synthetic stores (a real bars.db in a temp dir), a frozen clock, and a provider that
records every call. No real market data.
"""
from __future__ import annotations

import random
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import orjson
import pytest

from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")
# Wednesday 2026-11-11 (a regular NYSE session) 09:42:30 ET — the production instant.
_NOW = datetime(2026, 11, 11, 9, 42, 30, tzinfo=_ET)


class _Clock:
    def __init__(self, instant: datetime):
        self.instant = instant


def _frozen_datetime(clock: _Clock):
    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return clock.instant.astimezone(tz)
            return clock.instant.astimezone().replace(tzinfo=None)

        @classmethod
        def utcnow(cls):
            return clock.instant.astimezone(timezone.utc).replace(tzinfo=None)
    return _Frozen


class _FrozenTime:
    def __init__(self, clock: _Clock, real):
        self._clock, self._real = clock, real

    def time(self) -> float:
        return self._clock.instant.timestamp()

    def __getattr__(self, name):
        return getattr(self._real, name)


class _Client:
    _api_key = "FAKE"


@pytest.fixture
def env(tmp_path, monkeypatch):
    from api.services import bars_sqlite as sq
    monkeypatch.setattr(sq, "_DB_PATH", str(tmp_path / "bars.db"))
    sq.bump_db_epoch()
    sq.init_db()
    clock = _Clock(_NOW)
    monkeypatch.setattr(bars_fetch, "datetime", _frozen_datetime(clock))
    monkeypatch.setattr(bars_fetch, "_time", _FrozenTime(clock, bars_fetch._time))
    monkeypatch.setattr(bars_fetch, "_tail_verified", {})
    monkeypatch.setattr(bars_fetch, "_inflight", {})
    monkeypatch.delenv("BARS_INTRADAY_ASYNC_HEAL", raising=False)
    monkeypatch.delenv("BARS_LIVE_COVERAGE_ENABLED", raising=False)
    bars_fetch.cache.clear()
    bars_fetch.set_request_interactive(False)
    bars_fetch.end_request_budget()

    # The provider: records every call; by default blocks until released (never past
    # teardown) — a "slow provider at the open" — and answers nothing.
    release = threading.Event()
    calls: list[str] = []
    prov = {"answer": None}

    def _provider(client, url):
        calls.append(url)
        if prov["answer"] is not None:
            return prov["answer"](url)
        release.wait(10)
        return []
    monkeypatch.setattr(bars_fetch, "_get_client", lambda: _Client())
    monkeypatch.setattr(bars_fetch, "_paginate_massive_aggs", _provider)
    yield sq, calls, clock, prov
    release.set()
    time.sleep(0.05)
    bars_fetch.cache.clear()
    sq.bump_db_epoch()


def _ts(y, mo, d, h, mi) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=_ET).timestamp())


def _session_rows(y, mo, d, step_min, start=(4, 0), end=(20, 0), seed=0):
    """Plausible synthetic bars every `step_min` from `start` to before `end` (ET)."""
    out = []
    t = _ts(y, mo, d, *start)
    stop = _ts(y, mo, d, *end)
    i = 0
    while t < stop:
        p = 10.0 + ((i + seed) % 7) * 0.01
        out.append({"t": t, "o": p, "h": p + 0.05, "l": p - 0.05, "c": p + 0.01,
                    "v": 100 + i + seed})
        t += step_min * 60
        i += 1
    return out


def _seed(sq, tf_target: str, base_today_end=(9, 45), base_overlap=True):
    """Target stored through 11-10 (stale); the 15m base runs into today."""
    hist = _session_rows(2026, 11, 9, 15) + _session_rows(2026, 11, 10, 15)
    target = bars_fetch._resample_derived(tf_target, hist)
    sq.put_bars("SPY", tf_target, target)
    base = hist + _session_rows(2026, 11, 11, 15, end=base_today_end)
    if not base_overlap:
        base = [b for b in base if b["t"] >= _ts(2026, 11, 11, 4, 0)]
    sq.put_bars("SPY", "15", base)
    return target


def _row_dicts(rows):
    return [dict(t=r[0], o=r[1], h=r[2], l=r[3], c=r[4], v=r[5]) for r in rows]


@pytest.mark.parametrize("tf", ["30", "60"])
def test_stale_derived_tf_first_answer_is_rebuilt_from_stored_15m_without_the_provider(env, tf):
    sq, calls, _, _ = env
    target = _seed(sq, tf)
    assert target[-1]["t"] < _ts(2026, 11, 11, 0, 0), "precondition: target tail is yesterday"
    bars_fetch.start_request_budget()
    t0 = time.perf_counter()
    try:
        resp = bars_fetch._get_bars_inner("SPY", tf, 60)
    finally:
        bars_fetch.end_request_budget()
    took = time.perf_counter() - t0
    bars = orjson.loads(resp.body)["bars"]
    want_last = _ts(2026, 11, 11, 9, 30)
    assert bars[-1]["t"] == want_last, "the first answer must reach today's forming bucket"
    assert calls == [], "the stored 15m covered the gap: no provider call"
    assert took < 1.0, f"first answer took {took:.2f}s"
    assert bars_fetch.get_serve_layer() == "derived-local"
    assert bars_fetch.intraday_tail_status("SPY", tf, bars[-1]["t"])["tail_status"] == "current"
    assert sq.get_last_ts("SPY", tf) == want_last, "persisted for the next read"
    today15 = _row_dicts(sq.get_bars_since("SPY", "15", _ts(2026, 11, 11, 0, 0)))
    want = bars_fetch._resample_derived(tf, today15)
    got = [b for b in bars if b["t"] >= _ts(2026, 11, 11, 0, 0)]
    assert [(b["t"], b["v"]) for b in got] == [(b["t"], b["v"]) for b in want]


def test_CONTROL_stale_base_still_asks_the_provider_only_from_the_rebuilt_tail(env, monkeypatch):
    sq, calls, _, _ = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)
    _seed(sq, "30", base_today_end=(9, 0))          # 15m stops at 08:45: not current
    bars_fetch._get_bars_inner("SPY", "30", 60)
    assert len(calls) == 1, "a base that is not current cannot answer"
    assert sq.get_last_ts("SPY", "30") == _ts(2026, 11, 11, 8, 30), "covered part rebuilt locally"
    assert "/range/15/minute/2026-11-11/" in calls[0], "provider asked only from the rebuilt tail"


def test_base_that_does_not_overlap_the_target_tail_is_never_used(env, monkeypatch):
    sq, calls, _, _ = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)
    target = _seed(sq, "30", base_overlap=False)    # 15m only began today
    bars_fetch._get_bars_inner("SPY", "30", 60)
    assert len(calls) == 1
    assert sq.get_last_ts("SPY", "30") == target[-1]["t"], "no fabricated contiguous tail"


def test_a_thinner_base_never_downgrades_the_stored_overlap_bucket(env):
    sq, *_ = env
    target = _seed(sq, "30")
    last = target[-1]
    sq.put_bars("SPY", "30", [dict(last, v=10 ** 9)])          # stored bucket is "fuller"
    d = bars_fetch._local_derived_tail("SPY", "30", last["t"])
    assert d is not None
    assert all(b["t"] > last["t"] for b in d["rows"])


def test_derived_tail_inherits_the_bases_verification(env):
    sq, *_ = env
    _seed(sq, "30")
    bars_fetch._mark_tail_verified("SPY", "15", _NOW.timestamp() - 5)
    r = bars_fetch._local_tail_repair("SPY", "30", sq.get_last_ts("SPY", "30"))
    assert r is not None and r[1] is True
    assert bars_fetch.tail_verified_through("SPY", "30") == _NOW.timestamp() - 5


def test_provider_delta_for_a_derived_tf_persists_its_base_first(env):
    """The provider's 15m answer for a 30m repair lands in the 15m store, so the base
    the derived store is built from is the base the next 15m/30m/60m read sees."""
    sq, calls, _, prov = env
    hist = _session_rows(2026, 11, 10, 15)
    sq.put_bars("SPY", "30", bars_fetch._resample_derived("30", hist))
    truth = hist + _session_rows(2026, 11, 11, 15, end=(9, 45))
    prov["answer"] = lambda url: [dict(t=b["t"] * 1000, o=b["o"], h=b["h"], l=b["l"],
                                       c=b["c"], v=b["v"]) for b in truth]
    bars_fetch._heal_intraday_tail("SPY", "30", sq.get_last_ts("SPY", "30"), tail_only=True)
    assert len(calls) == 1
    assert sq.get_last_ts("SPY", "15") == truth[-1]["t"], "the base was persisted"
    assert sq.get_last_ts("SPY", "30") == _ts(2026, 11, 11, 9, 30)


def test_kill_switch(env, monkeypatch):
    sq, *_ = env
    _seed(sq, "30")
    monkeypatch.setattr(bars_fetch, "_LOCAL_DERIVE_ENABLED", False)
    assert bars_fetch._local_derived_tail("SPY", "30", sq.get_last_ts("SPY", "30")) is None


# ── INVARIANT: derived store == resample(stored base), over random histories ─

def _assert_derived_matches_base(sq, tf, since, now, reach=True):
    base = _row_dicts(sq.get_bars_since("SPY", "15", since - 1))
    have = {b["t"] for b in base}
    want = {b["t"]: b for b in bars_fetch._resample_derived(tf, base)}
    got = _row_dicts(sq.get_bars_since("SPY", tf, since - 1))
    step = 3600 if tf == "60" else int(tf) * 60
    for b in got:
        w = want.get(b["t"])
        assert w is not None, f"derived bucket {b['t']} has no base rows"
        assert (b["o"], b["h"], b["l"], b["c"], b["v"]) == pytest.approx(
            (w["o"], w["h"], w["l"], w["c"], w["v"])), f"bucket {b['t']} != resample(base)"
        # F4: no derived bucket spans an INTERIOR base hole (a missing in-session slot
        # with stored base after it; slots past the base tail simply have not landed)
        end = min(bars_fetch._bucket_end(tf, b["t"], step), int(now) + 1, base[-1]["t"])
        for s_ in range(b["t"], end, 900):
            if bars_fetch._base_slot_in_session(s_):
                assert s_ in have, f"derived bucket {b['t']} spans a base hole at {s_}"
    if reach and base:
        assert got and got[-1]["t"] == bars_fetch._derived_bucket_start(tf, base[-1]["t"]), \
            "the derived tail reaches the base tail's bucket"


@pytest.mark.parametrize("tf", ["30", "60"])
@pytest.mark.parametrize("seed", range(12))
def test_INVARIANT_derived_store_is_the_resample_of_the_stored_base(env, tf, seed):
    """Random interleavings of base heals (WITH random holes), local repairs and
    provider deltas: the derived store always equals resample(stored base), never
    spans a base hole, and a full repair always reaches the base tail."""
    sq, calls, clock, prov = env
    rnd = random.Random(seed * 101 + int(tf))
    truth = (_session_rows(2026, 11, 10, 15, seed=seed)
             + _session_rows(2026, 11, 11, 15, end=(16, 0), seed=seed))
    day0 = _ts(2026, 11, 10, 0, 0)
    cut = rnd.randrange(8, 60)
    sq.put_bars("SPY", "15", truth[:cut])
    sq.put_bars("SPY", tf, bars_fetch._resample_derived(tf, truth[:cut]))
    base_n = cut
    now = datetime(2026, 11, 11, 9, 35, tzinfo=_ET)

    def _answer(url):
        frm = url.split("/minute/")[1].split("/")[0]
        lo = int(datetime.strptime(frm, "%Y-%m-%d").replace(tzinfo=_ET).timestamp())
        hi = clock.instant.timestamp()
        return [dict(t=b["t"] * 1000, o=b["o"], h=b["h"], l=b["l"], c=b["c"], v=b["v"])
                for b in truth if lo <= b["t"] <= hi]
    prov["answer"] = _answer

    for _step in range(10):
        now = datetime.fromtimestamp(now.timestamp() + rnd.randrange(60, 1800), _ET)
        clock.instant = now
        op = rnd.random()
        visible = [b for b in truth if b["t"] <= now.timestamp()]
        if op < 0.4 and base_n < len(visible):
            # the 15m base's own heal lands newer rows, sometimes with a hole
            new_n = rnd.randrange(base_n + 1, len(visible) + 1)
            chunk = visible[base_n:new_n]
            if len(chunk) > 2 and rnd.random() < 0.5:
                del chunk[rnd.randrange(0, len(chunk) - 1)]
            sq.put_bars("SPY", "15", chunk)
            base_n = new_n
        last = sq.get_last_ts("SPY", tf)
        full = op < 0.7
        if full:
            bars_fetch._heal_intraday_tail("SPY", tf, last, tail_only=True)
        else:
            bars_fetch._local_tail_repair("SPY", tf, last)
        _assert_derived_matches_base(sq, tf, day0, now.timestamp(), reach=full)


def test_F4_derivation_stops_at_a_base_hole_and_does_not_inherit_proof(env):
    sq, *_ = env
    _seed(sq, "30")
    c = sq._conn()
    c.execute("DELETE FROM ohlcv WHERE ticker='SPY' AND tf='15' AND ts=?",
              (_ts(2026, 11, 11, 6, 15),))
    c.commit()
    bars_fetch._mark_tail_verified("SPY", "15", _NOW.timestamp())
    r = bars_fetch._local_tail_repair("SPY", "30", sq.get_last_ts("SPY", "30"))
    assert r is not None and r[1] is False, "a truncated derivation is not current"
    assert r[0] == _ts(2026, 11, 11, 5, 30), "stops at the last complete bucket"
    assert bars_fetch.tail_verified_through("SPY", "30") is None, "no proof inherited"


def test_F4_half_day_close_is_not_a_hole(env):
    """2026-11-27 (day after Thanksgiving) closes at 13:00; extended ends 17:00."""
    sq, _, clock, _ = env
    clock.instant = datetime(2026, 11, 27, 18, 0, tzinfo=_ET)
    rows = _session_rows(2026, 11, 27, 15, end=(17, 0))
    sq.put_bars("SPY", "15", rows)
    assert bars_fetch._first_missing_base_slot(
        "SPY", rows[0]["t"], int(clock.instant.timestamp())) is None


# ── F3: a derived repair never punches a hole into its base ─────────────────

def test_F3_base_fetch_starts_at_the_stored_base_tail(env):
    sq, calls, _, prov = env
    sq.put_bars("SPY", "15", _session_rows(2026, 11, 6, 15))    # base tail: Fri 11-06
    sq.put_bars("SPY", "30", bars_fetch._resample_derived("30", _session_rows(2026, 11, 10, 15)))
    prov["answer"] = lambda url: []
    bars_fetch._delta_intraday("SPY", "30", sq.get_last_ts("SPY", "30"), tail_only=True)
    assert "/range/15/minute/2026-11-06/" in calls[0], "fetch reaches back to the base tail"


def test_F3_base_far_behind_is_not_written(env):
    sq, calls, _, prov = env
    sq.put_bars("SPY", "15", _session_rows(2026, 10, 1, 15))   # > 14 days behind
    sq.put_bars("SPY", "30", bars_fetch._resample_derived("30", _session_rows(2026, 11, 10, 15)))
    today = _session_rows(2026, 11, 11, 15, end=(9, 45))
    prov["answer"] = lambda url: [dict(t=b["t"] * 1000, o=b["o"], h=b["h"], l=b["l"],
                                       c=b["c"], v=b["v"]) for b in today]
    out = bars_fetch._delta_intraday("SPY", "30", sq.get_last_ts("SPY", "30"), tail_only=True)
    assert sq.get_last_ts("SPY", "15") == _ts(2026, 10, 1, 19, 45), "no hole punched in 15m"
    assert out and out[-1]["t"] == _ts(2026, 11, 11, 9, 30), "target still derived from the fetch"


# ── F1/F2: what a request may block on ──────────────────────────────────────

def _seed_fine(sq, tf: str, end):
    step = int(tf)
    rows = _session_rows(2026, 11, 10, step) + _session_rows(2026, 11, 11, step, end=end)
    sq.put_bars("SPY", tf, rows)
    return rows


@pytest.mark.parametrize("tf,end,last", [("1", (9, 42), (9, 41)), ("15", (9, 30), (9, 15))])
def test_sealed_newest_closed_bucket_waits_only_briefly_and_announces_the_forming_bucket(
        env, tf, end, last):
    sq, calls, _, _ = env
    rows = _seed_fine(sq, tf, end)
    assert rows[-1]["t"] == _ts(2026, 11, 11, *last)
    step = int(tf) * 60
    # proven complete: the provider answered after the bucket's end + lag
    bars_fetch._mark_tail_verified("SPY", tf, rows[-1]["t"] + step + bars_fetch._SEAL_LAG_S)
    t0 = time.perf_counter()
    resp = bars_fetch._get_bars_inner("SPY", tf, 60)
    took = time.perf_counter() - t0
    body = orjson.loads(resp.body)
    assert body["bars"][-1]["t"] == rows[-1]["t"]
    assert len(calls) == 1, "the forming bucket's repair ran"
    assert bars_fetch._FORMING_WAIT_SECONDS - 0.1 <= took < bars_fetch._FORMING_WAIT_SECONDS + 0.5
    assert bars_fetch.get_serve_layer() == "sd-forming"
    assert body["forming_pending"] == _ts(2026, 11, 11, *last) + step, \
        "a forming bucket the answer lacks is announced, never silently dropped"


@pytest.mark.parametrize("tf,end", [("1", (9, 42)), ("15", (9, 30))])
def test_F2_a_bucket_stored_while_forming_is_not_sealed(env, monkeypatch, tf, end):
    """Same tail timestamp, but the only proof predates the bucket's end (it was
    written while forming): the repair keeps the full wait."""
    sq, calls, _, _ = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 1.2)
    rows = _seed_fine(sq, tf, end)
    step = int(tf) * 60
    bars_fetch._mark_tail_verified("SPY", tf, rows[-1]["t"] + step - 20)   # mid-bucket
    t0 = time.perf_counter()
    bars_fetch._get_bars_inner("SPY", tf, 60)
    assert time.perf_counter() - t0 >= 1.1
    assert bars_fetch.get_serve_layer() == "sd-deadline"


@pytest.mark.parametrize("tf,end", [("1", (9, 41)), ("15", (9, 15))])
def test_CONTROL_a_tail_missing_a_closed_bucket_keeps_the_full_wait(env, monkeypatch, tf, end):
    sq, calls, _, _ = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 1.2)
    _seed_fine(sq, tf, end)                        # the newest closed bucket is missing
    t0 = time.perf_counter()
    bars_fetch._get_bars_inner("SPY", tf, 60)
    took = time.perf_counter() - t0
    assert took >= 1.1, "a closed bucket is missing: the repair is worth the full wait"
    assert bars_fetch.get_serve_layer() == "sd-deadline"


@pytest.mark.parametrize("tf", ["1", "5", "15", "30", "60"])
@pytest.mark.parametrize("minute", [0, 1, 14, 29, 31, 59, 61, 389])
def test_INVARIANT_short_wait_only_for_a_proven_sealed_newest_closed_bucket(env, tf, minute):
    """Over instants across the session: the short wait applies iff the tail holds the
    newest closed bucket AND proof postdates its end; one bucket behind, or proof from
    before the end (stored while forming), keeps the full ceiling."""
    _, _, clock, _ = env
    clock.instant = datetime.fromtimestamp(_ts(2026, 11, 11, 9, 30) + minute * 60 + 17, _ET)
    frontier = bars_fetch.expected_completed_ext_bucket(tf)
    step = 3600 if tf == "60" else int(tf) * 60
    end = bars_fetch._bucket_end(tf, frontier, step)
    bars_fetch._tail_verified.clear()
    bars_fetch._mark_tail_verified("SPY", tf, end - 1)
    assert bars_fetch._repair_wait("SPY", tf, frontier) is None, "proof predates the end"
    bars_fetch._mark_tail_verified("SPY", tf, end + bars_fetch._SEAL_LAG_S)
    assert bars_fetch._repair_wait("SPY", tf, frontier) == bars_fetch._FORMING_WAIT_SECONDS
    behind = bars_fetch._ext_bucket_start(tf, frontier - 1)
    assert bars_fetch._repair_wait("SPY", tf, behind) is None
