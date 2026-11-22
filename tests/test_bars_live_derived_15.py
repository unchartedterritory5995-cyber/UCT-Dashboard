"""15m (and so 30m/60m) rebuilt on the READ path from the live 5m (2026-11-17).

On the bars tier a covered ticker's 5m series is current by construction (the universe
stream writes every bucket). While the stream PROVES it (`bars_live_store
.proven_through_s(ticker, "5")`), 15m takes the stored 5m as its base and the 15m/30m/60m
tail is rebuilt locally before the read decides anything: no provider call, the forming
bucket is current, and no wait at a bucket boundary for a bucket that has not printed.

Without the proof every path is exactly as before (the CONTROL tests).

INVARIANT (property test below): after any sequence of stream-like 5m writes and reads,
stored 15m == resample(stored 5m) and stored 30m/60m == resample(stored 15m) over the
live window, and not one provider call is made.

Synthetic stores (a real bars.db in a temp dir), a frozen clock, a stubbed live-store
proof, and a provider that records every call. No real market data.
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
from api.services import bars_live_store as bls

_ET = ZoneInfo("America/New_York")
# Wednesday 2026-11-11 (a regular NYSE session) 09:42:30 ET.
_NOW = datetime(2026, 11, 11, 9, 42, 30, tzinfo=_ET)
_DAY0 = int(datetime(2026, 11, 11, 0, 0, tzinfo=_ET).timestamp())


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


def _ts(y, mo, d, h, mi) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=_ET).timestamp())


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
    bars_fetch.cache.clear()
    bars_fetch.set_request_interactive(False)
    bars_fetch.end_request_budget()

    # The live store: SPY's 5m is covered and proven through `live["proof"]` (None = the
    # stream is silent / the ticker is not covered / the flag is off).
    live = {"proof": None}
    monkeypatch.setattr(bls, "proven_through_s",
                        lambda t, tf="5": live["proof"] if (str(t).upper() == "SPY" and tf == "5") else None)
    monkeypatch.setattr(bls, "covered",
                        lambda t, tf: tf == "5" and str(t).upper() == "SPY" and live["proof"] is not None)

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
    yield sq, calls, clock, live
    release.set()
    time.sleep(0.05)
    bars_fetch.cache.clear()
    sq.bump_db_epoch()


def _rows(y, mo, d, step_min, start=(4, 0), end=(20, 0), seed=0, skip=()):
    """Plausible synthetic bars every `step_min` from `start` to before `end` (ET)."""
    out = []
    t = _ts(y, mo, d, *start)
    stop = _ts(y, mo, d, *end)
    i = 0
    while t < stop:
        if t not in skip:
            p = 10.0 + ((i * 7 + seed) % 11) * 0.01
            out.append({"t": t, "o": p, "h": p + 0.05 + (i % 3) * 0.01, "l": p - 0.05,
                        "c": p + 0.01, "v": 100 + i + seed})
        t += step_min * 60
        i += 1
    return out


_HIST_DAYS = ((2026, 11, 6), (2026, 11, 9), (2026, 11, 10))


def _seed(sq, live, *, five_end=(9, 45), stale=("15", "30", "60")):
    """5m through today's `five_end` (its last bucket forming); the targets stored
    through yesterday (the provider's own resample of the same history)."""
    hist5 = [b for d in _HIST_DAYS for b in _rows(*d, 5)]
    today5 = _rows(2026, 11, 11, 5, end=five_end)
    sq.put_bars("SPY", "5", hist5 + today5)
    hist15 = bars_fetch._resample_derived("15", hist5)
    sq.put_bars("SPY", "15", hist15)
    for tf in ("30", "60"):
        sq.put_bars("SPY", tf, bars_fetch._resample_derived(tf, hist15))
    live["proof"] = int(_NOW.timestamp()) // 60 * 60       # minute 09:41 delivered
    return hist5 + today5


def _dicts(rows):
    return [dict(t=r[0], o=r[1], h=r[2], l=r[3], c=r[4], v=r[5]) for r in rows]


def _today(sq, tf):
    return _dicts(sq.get_bars_since("SPY", tf, _DAY0 - 1))


def _read(tf, bars=30):
    bars_fetch.start_request_budget()
    try:
        return bars_fetch._get_bars_inner("SPY", tf, bars)
    finally:
        bars_fetch.end_request_budget()


def _same(a, b):
    return [(x["t"], round(x["o"], 6), round(x["h"], 6), round(x["l"], 6), round(x["c"], 6), int(x["v"]))
            for x in a] == [(x["t"], round(x["o"], 6), round(x["h"], 6), round(x["l"], 6),
                             round(x["c"], 6), int(x["v"])) for x in b]


# ── the read path ─────────────────────────────────────────────────────────────

def test_stale_15m_first_answer_is_the_live_5m_resample_without_the_provider(env):
    sq, calls, _, live = env
    _seed(sq, live)
    t0 = time.perf_counter()
    resp = _read("15")
    took = time.perf_counter() - t0
    bars = orjson.loads(resp.body)["bars"]
    assert bars[-1]["t"] == _ts(2026, 11, 11, 9, 30), "reaches today's forming bucket"
    assert calls == [], "the live 5m covered the gap: no provider call"
    assert took < 1.0, f"first answer took {took:.2f}s"
    want = bars_fetch._resample_derived("15", _today(sq, "5"))
    assert _same(_today(sq, "15"), want), "stored 15m == resample(live 5m)"
    assert bars_fetch.intraday_tail_status("SPY", "15", bars[-1]["t"])["tail_status"] == "current"


@pytest.mark.parametrize("tf", ["30", "60"])
def test_stale_30m_60m_first_answer_rides_15m_rebuilt_from_the_live_5m(env, tf):
    sq, calls, _, live = env
    _seed(sq, live)
    bars = orjson.loads(_read(tf).body)["bars"]
    assert bars[-1]["t"] == _ts(2026, 11, 11, 9, 30)
    assert calls == [], "15m was rebuilt from 5m first, then the target from 15m"
    assert sq.get_last_ts("SPY", "15") == _ts(2026, 11, 11, 9, 30)
    assert _same(_today(sq, tf), bars_fetch._resample_derived(tf, _today(sq, "15")))


def test_the_forming_15m_bucket_follows_the_live_5m_inside_it(env):
    """15m already holds the forming 09:30 bucket, built when 5m reached 09:35; the stream
    has since written 09:35's final values and opened 09:40. The read serves the bucket
    as the 5m now says, not as it was (the old rule only ever added NEWER buckets)."""
    sq, calls, _, live = env
    _seed(sq, live, five_end=(9, 40))                       # 5m through the 09:35 bucket
    _read("15")
    early = {b["t"]: b for b in _today(sq, "15")}[_ts(2026, 11, 11, 9, 30)]
    # the stream moves on inside the bucket: 09:35 final, 09:40 forming
    sq.put_bars("SPY", "5", [{"t": _ts(2026, 11, 11, 9, 35), "o": 10.0, "h": 11.0, "l": 9.5,
                              "c": 10.5, "v": 5000},
                             {"t": _ts(2026, 11, 11, 9, 40), "o": 10.5, "h": 10.6, "l": 10.4,
                              "c": 10.55, "v": 700}])
    bars_fetch.cache.clear()
    bars = orjson.loads(_read("15").body)["bars"]
    last = bars[-1]
    assert last["t"] == _ts(2026, 11, 11, 9, 30)
    assert last["h"] == 11.0 and last["c"] == 10.55, "the bucket carries the new 5m"
    assert last["v"] > early["v"]
    assert calls == []


def test_at_a_bucket_boundary_the_read_does_not_wait_for_an_unprinted_bucket(env, monkeypatch):
    """09:45:20: the 09:45 bucket has not printed in the stream yet (its first minute
    lands seconds after it closes). The stream proves 5m through 09:45:00, so the 15m
    tail at 09:30 is complete: served at once. Without the rule the read waits out the
    provider ceiling for a bucket nobody has (`test_forming_bucket_repair_blocks_...`)."""
    sq, calls, clock, live = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 1.0)
    _seed(sq, live, five_end=(9, 45))                       # through the 09:40 bucket
    _read("15")
    clock.instant = datetime(2026, 11, 11, 9, 45, 20, tzinfo=_ET)
    live["proof"] = _ts(2026, 11, 11, 9, 45)                # minute 09:44 delivered
    bars_fetch.cache.clear()
    t0 = time.perf_counter()
    bars = orjson.loads(_read("15").body)["bars"]
    took = time.perf_counter() - t0
    assert took < 0.5, f"waited {took:.2f}s for a bucket that has not printed"
    assert calls == []
    assert bars[-1]["t"] == _ts(2026, 11, 11, 9, 30)
    assert bars_fetch.intraday_tail_status("SPY", "15", bars[-1]["t"])["tail_status"] != "unverified"


def test_the_since_poll_reads_the_rebuilt_tail_without_the_provider(env):
    sq, calls, _, live = env
    _seed(sq, live)
    resp = bars_fetch._get_bars_since_response("SPY", "15", 30, str(_ts(2026, 11, 11, 9, 0)))
    bars = orjson.loads(resp.body)["bars"]
    assert bars and bars[-1]["t"] == _ts(2026, 11, 11, 9, 30)
    assert calls == []


def test_the_since_poll_carries_the_forming_bucket_as_the_live_5m_now_says(env):
    """The chart's catch-up poll asks for bars after 09:15; the forming 09:30 bucket was
    stored when 5m reached 09:35, and the stream has moved on inside it since."""
    sq, calls, _, live = env
    _seed(sq, live, five_end=(9, 40))
    _read("15")
    sq.put_bars("SPY", "5", [{"t": _ts(2026, 11, 11, 9, 35), "o": 10.0, "h": 12.0, "l": 9.5,
                              "c": 10.5, "v": 5000},
                             {"t": _ts(2026, 11, 11, 9, 40), "o": 10.5, "h": 10.6, "l": 10.4,
                              "c": 10.45, "v": 700}])
    bars_fetch.cache.clear()
    resp = bars_fetch._get_bars_since_response("SPY", "15", 30, str(_ts(2026, 11, 11, 9, 15)))
    last = orjson.loads(resp.body)["bars"][-1]
    assert last["t"] == _ts(2026, 11, 11, 9, 30)
    assert last["h"] == 12.0 and last["c"] == 10.45
    assert calls == []


def test_a_tail_that_has_not_caught_up_with_the_live_5m_is_not_fresh(env):
    """If the read-path rebuild was shed (a held write lock), the stale 15m must not be
    called fresh just because the 5m is: the normal repair runs instead."""
    sq, _, _, live = env
    _seed(sq, live)
    stale = sq.get_last_ts("SPY", "15")
    assert stale < _DAY0
    assert bars_fetch._needs_fresh(stale, "15", "SPY") is True
    _read("15")
    caught_up = sq.get_last_ts("SPY", "15")
    assert bars_fetch._needs_fresh(caught_up, "15", "SPY") is False


def test_the_derived_series_carries_the_streams_proof(env):
    sq, _, _, live = env
    _seed(sq, live)
    assert bars_fetch.tail_verified_through("SPY", "60") != live["proof"], "precondition"
    _read("60")
    for tf in ("15", "60"):
        assert bars_fetch.tail_verified_through("SPY", tf) == live["proof"]


def test_a_live_derived_answer_is_cached_as_briefly_as_a_covered_series(env):
    sq, _, _, live = env
    _seed(sq, live)
    _read("15")
    bars_fetch.cache.clear()
    resp = _read("15")
    assert resp.headers["cache-control"] == "public, max-age=5"


# ── guards ────────────────────────────────────────────────────────────────────

def test_CONTROL_without_the_streams_proof_nothing_changes(env, monkeypatch):
    sq, calls, _, live = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)
    _seed(sq, live)
    live["proof"] = None
    _read("15")
    assert len(calls) == 1, "no proof: 15m is a provider series as before"
    assert sq.get_last_ts("SPY", "15") < _DAY0, "nothing derived from the 5m"
    assert bars_fetch._derived_base_tf("SPY", "15") is None


def test_kill_switch(env, monkeypatch):
    sq, calls, _, live = env
    monkeypatch.setattr(bars_fetch, "_REQUEST_DEADLINE_SECONDS", 0.3)
    monkeypatch.setattr(bars_fetch, "_LIVE_DERIVE_15_ENABLED", False)
    _seed(sq, live)
    _read("15")
    assert len(calls) == 1
    assert sq.get_last_ts("SPY", "15") < _DAY0


def test_a_target_older_than_the_live_window_is_never_rebuilt_from_5m(env):
    """The live tier vouches for BACKFILL_DAYS of 5m; a 15m tail from before that window
    could span 5m the tier never repaired, so it is left to the provider."""
    sq, _, _, live = env
    _seed(sq, live)
    old = _rows(2026, 10, 20, 5)
    sq.put_bars("SPY", "5", old)
    c = sq._conn()
    c.execute("DELETE FROM ohlcv WHERE ticker='SPY' AND tf='15'")
    c.commit()
    sq.put_bars("SPY", "15", bars_fetch._resample_derived("15", old))
    last = sq.get_last_ts("SPY", "15")
    assert last < bars_fetch._live_window_floor()
    assert bars_fetch._local_derived_tail("SPY", "15", last) is None


def test_a_thinner_live_derivation_never_downgrades_a_stored_bucket(env):
    sq, _, _, live = env
    _seed(sq, live)
    _read("15")
    b = _ts(2026, 11, 11, 9, 15)
    row = {x["t"]: x for x in _today(sq, "15")}[b]
    sq.put_bars("SPY", "15", [dict(row, v=10 ** 9)])        # e.g. the provider's fuller bucket
    last = sq.get_last_ts("SPY", "15")
    d = bars_fetch._local_derived_tail("SPY", "15", b)
    assert d is None or all(x["t"] != b for x in d["rows"])
    assert {x["t"]: x for x in _today(sq, "15")}[b]["v"] == 10 ** 9
    assert sq.get_last_ts("SPY", "15") == last


def test_a_read_with_nothing_to_rebuild_starts_no_writer_thread(env, monkeypatch):
    sq, _, _, live = env
    _seed(sq, live)
    _read("60")                                              # 15m and 60m caught up
    jobs = []
    real = bars_fetch._bounded_job
    monkeypatch.setattr(bars_fetch, "_bounded_job", lambda key, *a, **k: (jobs.append(key), real(key, *a, **k))[1])
    for tf in ("15", "60"):
        bars_fetch.cache.clear()
        _read(tf)
    assert not [k for k in jobs if k.startswith("lderive_live_")], jobs


def test_an_unchanged_tail_is_not_rewritten(env, monkeypatch):
    sq, _, _, live = env
    _seed(sq, live)
    _read("15")
    writes = []
    real = sq.put_bars
    monkeypatch.setattr(sq, "put_bars", lambda *a, **k: (writes.append(a[:2]), real(*a, **k))[1])
    assert bars_fetch._local_derived_tail("SPY", "15", sq.get_last_ts("SPY", "15")) is None
    bars_fetch.cache.clear()
    _read("15")
    assert ("SPY", "15") not in writes


# ── INVARIANT ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(10))
def test_INVARIANT_derived_stores_are_the_resample_of_their_live_base(env, seed):
    """Stream-like 5m writes (the forming bucket updated in place, new buckets appended,
    thin names skipping buckets) interleaved with reads of random tfs: stored 15m always
    equals resample(stored 5m) from today's first bucket through the 5m tail, 30m/60m
    equal resample(stored 15m), the tail reaches the 5m's bucket, and the provider is
    never asked."""
    sq, calls, clock, live = env
    rnd = random.Random(seed)
    _seed(sq, live, five_end=(4, 30))
    t = _ts(2026, 11, 11, 4, 30)
    clock.instant = datetime.fromtimestamp(t + 30, _ET)
    live["proof"] = t
    forming = None
    for _step in range(40):
        # the stream: maybe update the forming bucket, maybe open the next one
        if forming is not None and rnd.random() < 0.6:
            f = dict(forming)
            f["h"] = max(f["h"], f["c"] + rnd.random() * 0.1)
            f["l"] = min(f["l"], f["c"] - rnd.random() * 0.1)
            f["c"] = round(f["l"] + (f["h"] - f["l"]) * rnd.random(), 4)
            f["v"] += rnd.randrange(1, 500)
            sq.put_bars("SPY", "5", [f])
            forming = f
        adv = rnd.choice([60, 120, 300, 300, 600, 900])
        clock.instant = datetime.fromtimestamp(clock.instant.timestamp() + adv, _ET)
        now = int(clock.instant.timestamp())
        bucket = now // 300 * 300
        if (forming is None or bucket > forming["t"]) and rnd.random() < 0.85:   # thin: skip
            p = 10 + rnd.random()
            forming = {"t": bucket, "o": p, "h": p + 0.02, "l": p - 0.02, "c": p, "v": rnd.randrange(1, 300)}
            sq.put_bars("SPY", "5", [forming])
        live["proof"] = now // 60 * 60
        tf = rnd.choice(["15", "30", "60"])
        bars_fetch.cache.clear()
        _read(tf)
        b5 = _today(sq, "5")
        s15 = _today(sq, "15")
        assert _same(s15, bars_fetch._resample_derived("15", b5)), f"step {_step}: 15m != resample(5m)"
        if tf != "15":
            assert _same(_today(sq, tf), bars_fetch._resample_derived(tf, s15)), \
                f"step {_step}: {tf} != resample(15m)"
            assert _today(sq, tf)[-1]["t"] == bars_fetch._derived_bucket_start(tf, b5[-1]["t"])
        assert s15[-1]["t"] == bars_fetch._derived_bucket_start("15", b5[-1]["t"])
    assert calls == [], "the live 5m answered every read"
