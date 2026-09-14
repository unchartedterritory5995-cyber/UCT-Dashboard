"""Rails for the two-tier artifact cache + coalescer (03 §3.6, §3.2; step 2.5, Lane B).

Every rule the module claims is asserted here against real behaviour, and every one of these rails
has a mutation in `docs/discord-render/instruments/mutation_harness_cache.py` that makes it go RED —
a rail nobody has seen fail is not a rail.

Fixture instants are fixed, never `now()`: a TTL test that reads the real clock is a test of how long
the test took to run. 2026-09-11 is a Friday, so 11:00 ET is `rth`, 17:00 ET is `post` and Saturday
2026-09-12 is `weekend` — the three TTL regimes, each pinned by name below rather than assumed.

⛔⛔ NO TEST IN THIS FILE MAY EVER RESOLVE L2'S PRODUCTION DEFAULT. `/data/discord_render_cache`
resolves to `C:\\data\\discord_render_cache` on this box — the owner's LIVE data root — and a test
that reaches one does not fail, it succeeds against production. Two independent protections, both
load-bearing and neither sufficient alone:

  1. the repo-root `conftest.py` derives `DISCORD_RENDER_CACHE_DIR` by AST and redirects it to a
     per-session sandbox before any module is imported (asserted below, with a control);
  2. the autouse fixture here blanks it, so every cache built WITHOUT an explicit root is L1-only
     and the L2 rails each name their own root under `tmp_path`.

⭐ (2) is not belt-and-braces over (1): it also gives every test its own empty volume. A shared L2
directory would make each test's result depend on which tests ran before it, which is the thing a
durable cache is FOR and therefore the thing a test of one must not inherit.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import threading
import time

import pytest

import conftest as rootconf
from api.services.discord_render import artifact_cache as ac
from api.services.discord_render import contracts, freshness as fr

RTH_NOW = dt.datetime(2026, 9, 11, 11, 0, tzinfo=fr.ET)      # Friday, mid-session
POST_NOW = dt.datetime(2026, 9, 11, 17, 0, tzinfo=fr.ET)     # Friday, extended
CLOSED_NOW = dt.datetime(2026, 9, 12, 11, 0, tzinfo=fr.ET)   # Saturday


@pytest.fixture(autouse=True)
def _no_ambient_volume(monkeypatch):
    """⛔ Every cache built with no explicit root in this file is L1-ONLY. See the module docstring:
    a test that inherits an ambient L2 directory inherits every earlier test's writes, and one that
    inherits the PRODUCTION default writes to the owner's live `/data`."""
    monkeypatch.setenv("DISCORD_RENDER_CACHE_DIR", "")


def _env(as_of="2026-09-11", *, tf="D", now=RTH_NOW):
    return fr.envelope(as_of, tf=tf, provider="bars_store", now=now)


def _png(n=64):
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * n


def test_the_session_fixtures_are_the_states_this_file_claims():
    """A control on every TTL assertion below: if these three drift, the TTL tests are measuring
    something other than the regime they are named for."""
    assert fr.session_state(RTH_NOW) == fr.RTH
    assert fr.session_state(POST_NOW) == fr.POST
    assert fr.session_state(CLOSED_NOW) == fr.WEEKEND


# ── 1 · the key is the DATA's vintage, never the wall clock ─────────────────


def test_the_key_cannot_read_a_clock_at_all(monkeypatch):
    """⛔⛔ THE STRUCTURAL VERSION OF THE RULE. If `key_for` consulted the clock — or the session,
    which is the clock wearing a hat — the same closed-market input would key differently every
    second, the hit rate would collapse, and §3.10's determinism claim would be unobservable because
    no two runs would ever share an entry to compare."""
    class _Exploding:
        @staticmethod
        def time():
            raise AssertionError("key_for read the wall clock")

    monkeypatch.setattr(ac, "time", _Exploding)
    monkeypatch.setattr(ac, "session_state", lambda *a, **k: pytest.fail("key_for read the session"))

    key = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, envelope=_env())
    assert ac.fingerprint(key)


def test_the_same_input_keys_the_same_a_minute_later():
    env = _env()
    first = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, envelope=env)
    time.sleep(0.01)
    second = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, envelope=env)
    assert first == second and ac.fingerprint(first) == ac.fingerprint(second)

    # The control: a key built from the wall clock DOES move, so the assertion above is not passing
    # because `fingerprint` is blind to its third part.
    a = ac.key_for("chart", {"ticker": "NVDA"}, vintage="2026-09-11T20:00:00Z")
    b = ac.key_for("chart", {"ticker": "NVDA"}, vintage="2026-09-11T20:00:01Z")
    assert ac.fingerprint(a) != ac.fingerprint(b)


def test_an_unknown_vintage_keys_stably_rather_than_by_the_clock():
    """⛔ `None` is a vintage, not a hole. Two runs over the same unmeasured input still share an
    entry — otherwise "unknown" would be the one case determinism could never be measured in."""
    one = ac.key_for("chart", {"ticker": "NVDA"}, envelope=None)
    two = ac.key_for("chart", {"ticker": "NVDA"}, vintage=None)
    assert one.vintage is None and ac.fingerprint(one) == ac.fingerprint(two)
    # and it is NOT the same entry as a known vintage
    assert ac.fingerprint(one) != ac.fingerprint(ac.key_for("chart", {"ticker": "NVDA"}, envelope=_env()))
    # ⛔ nor the same entry as an EMPTY vintage. "we could not tell" and "the upstream said nothing"
    # are different facts, and a key that folds the first into the second serves one for the other.
    assert ac.fingerprint(one) != ac.fingerprint(ac.key_for("chart", {"ticker": "NVDA"}, vintage=""))


def test_two_data_versions_are_two_entries_and_neither_serves_the_other():
    c = ac.ArtifactCache()
    old = ac.key_for("chart", {"ticker": "NVDA"}, vintage="2026-09-10T20:00:00Z")
    new = ac.key_for("chart", {"ticker": "NVDA"}, vintage="2026-09-11T20:00:00Z")
    c.put(old, ac.Artifact(data=b"old-png"))
    assert c.get(new) is None
    assert c.get(old).data == b"old-png"


def test_argument_order_is_not_a_second_entry():
    assert ac.key_for("chart", {"tf": "D", "ticker": "NVDA"}, vintage="v") == \
           ac.key_for("CHART", {"ticker": "NVDA", "tf": "D"}, vintage="v")


def test_a_key_refuses_two_authorities_over_one_vintage():
    with pytest.raises(ValueError):
        ac.key_for("chart", {"ticker": "NVDA"}, vintage="v1", envelope=_env())


# ── 2 · a miss is None ──────────────────────────────────────────────────────


def test_a_miss_is_None_and_never_an_exception():
    """⛔ A store that raises on a miss makes every call site wrap it, and the one that forgets is
    the bug. There is nothing to catch."""
    c = ac.ArtifactCache()
    assert c.get(ac.key_for("chart", {"ticker": "NOPE"}, vintage="v")) is None
    assert c.stats()["misses"] == 1


def test_an_expired_entry_is_a_miss_not_a_hit_the_caller_must_recheck():
    """⛔ EXPIRY IS DECIDED HERE. Handing back something expired and trusting the caller to notice is
    how a stand-in gets served an hour later with nobody able to say which layer chose it."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, envelope=_env())
    c.put(key, ac.Artifact(data=_png(), envelope=_env(), stored_at=RTH_NOW.timestamp()))
    assert c.get(key, now=RTH_NOW + dt.timedelta(seconds=5)) is not None
    assert c.get(key, now=RTH_NOW + dt.timedelta(seconds=ac.RTH_TTL_S + 5)) is None
    assert c.stats()["expired"] == 1
    # and it is gone, not merely hidden
    assert len(c) == 0


def test_the_extended_session_gets_its_own_longer_ttl():
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, envelope=_env(now=POST_NOW))
    c.put(key, ac.Artifact(data=_png(), stored_at=POST_NOW.timestamp()))
    assert c.get(key, now=POST_NOW + dt.timedelta(seconds=60)) is not None   # past RTH's 30 s
    assert c.get(key, now=POST_NOW + dt.timedelta(seconds=ac.EXTENDED_TTL_S + 5)) is None


def test_a_closed_session_entry_has_no_age_expiry_because_the_key_owns_that_boundary():
    """⛔ "Closed until the next session open" is enforced by the KEY, not by a timer: the next
    session opening changes the data version, which changes the key, which makes this entry
    unreachable. A number here would be a second authority over a boundary that already has one."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, envelope=_env(now=CLOSED_NOW))
    c.put(key, ac.Artifact(data=_png(), stored_at=CLOSED_NOW.timestamp()))
    assert ac.ttl_s(fr.WEEKEND) is None
    assert c.get(key, now=CLOSED_NOW + dt.timedelta(hours=10)) is not None


# ── 3 · stored_at and the envelope are different numbers, both kept ─────────


def test_stale_None_survives_the_round_trip_as_None_and_never_as_False():
    """⛔⛔ THE LAUNDERING DEFECT, IN ONE ASSERTION. `False` says "we checked and it is fine";
    `None` says "we could not tell". A cache that converts the second into the first makes every
    downstream badge decision wrong in the direction nobody notices."""
    unknown = fr.envelope(None, tf="D", now=RTH_NOW)
    assert unknown.stale is None, "the fixture itself must carry the unknown verdict"

    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, envelope=unknown)
    c.put(key, ac.Artifact(data=_png(), envelope=unknown, stored_at=RTH_NOW.timestamp()))

    back = c.get(key, now=RTH_NOW)
    assert back.stale is None
    assert back.stale is not False
    assert back.envelope.stale is None
    assert back.badge is None, "an unknown vintage is an ABSENT badge, not a reassuring one"

    # and the other shape of "unknown": no envelope at all.
    assert ac.Artifact(data=_png()).stale is None
    assert ac.Artifact(data=_png()).stale is not False


def test_all_three_verdicts_survive_the_round_trip():
    """The control on the test above: if the round trip flattened everything to `None` it would
    also pass, and prove nothing."""
    c = ac.ArtifactCache()
    cases = {
        None: fr.envelope(None, tf="D", now=RTH_NOW),
        False: fr.envelope("2026-09-11", tf="D", now=RTH_NOW),
        True: fr.envelope("2026-09-04", tf="D", now=RTH_NOW),
    }
    for expected, env in cases.items():
        assert env.stale is expected, f"fixture for {expected!r} does not carry that verdict"
        key = ac.key_for("chart", {"ticker": "NVDA", "case": str(expected)}, envelope=env)
        c.put(key, ac.Artifact(data=_png(), envelope=env, stored_at=RTH_NOW.timestamp()))
        assert c.get(key, now=RTH_NOW).stale is expected


def test_a_week_old_chart_is_not_labelled_cached_thirty_seconds_ago():
    """⛔ `stored_at` DECIDES EVICTION; THE ENVELOPE DECIDES WHAT THE MEMBER IS TOLD. A cache that
    kept only the first would hand back a week-old chart stamped with the moment it was cached —
    true, and completely misleading."""
    week_old = fr.envelope("2026-09-04", tf="D", now=RTH_NOW)
    assert week_old.stale is True
    art = ac.Artifact(data=_png(), envelope=week_old, stored_at=RTH_NOW.timestamp())

    assert art.cached_at_et == "11:00:00"                 # when WE cached it
    assert art.cached_stamp == "cached 11:00:00 ET"
    assert "2026-09-04" in (art.badge or "")              # how old the DATA is
    assert art.badge != art.cached_stamp


def test_a_hit_does_not_refresh_stored_at():
    """⛔ AN LRU HERE WOULD NEED ITS OWN ACCESS CLOCK. Bumping `stored_at` on read would put a second
    meaning on one field, and `cached_stamp` — which a member reads — would start lying."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, envelope=_env())
    c.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))
    first = c.get(key, now=RTH_NOW).stored_at
    second = c.get(key, now=RTH_NOW + dt.timedelta(seconds=10)).stored_at
    assert first == second == RTH_NOW.timestamp()


# ── 4 · bounded, with deterministic eviction ───────────────────────────────


def test_the_entry_cap_evicts_the_oldest_by_stored_at_not_by_insertion_order():
    """⛔ INSERTED LAST IS NOT STORED LAST. The two orders are deliberately opposed here, so an
    eviction that quietly reverts to "first in, first out" cannot pass."""
    c = ac.ArtifactCache(max_entries=2, max_bytes=10_000_000)
    base = RTH_NOW.timestamp()
    keys = {}
    for name, offset in (("newest", 300), ("middle", 200), ("oldest", 100)):   # inserted newest-first
        keys[name] = ac.key_for("chart", {"ticker": name}, vintage="v")
        c.put(keys[name], ac.Artifact(data=_png(), stored_at=base + offset))

    assert len(c) == 2
    assert c.get(keys["oldest"], now=RTH_NOW) is None, "the oldest stored_at must be the victim"
    assert c.get(keys["newest"], now=RTH_NOW + dt.timedelta(seconds=300)) is not None
    assert c.get(keys["middle"], now=RTH_NOW + dt.timedelta(seconds=200)) is not None


def test_eviction_is_deterministic_when_two_entries_share_a_stored_at():
    """Two entries cached in the same clock tick must still evict in ONE defined order, or an
    eviction test is really a test of the platform's clock resolution."""
    survivors = []
    for _ in range(2):
        c = ac.ArtifactCache(max_entries=1, max_bytes=10_000_000)
        same = RTH_NOW.timestamp()
        a = ac.key_for("chart", {"ticker": "AAA"}, vintage="v")
        b = ac.key_for("chart", {"ticker": "BBB"}, vintage="v")
        c.put(a, ac.Artifact(data=_png(), stored_at=same))
        c.put(b, ac.Artifact(data=_png(), stored_at=same))
        survivors.append(c.get(a, now=RTH_NOW) is None)
    assert survivors == [True, True], "the earlier insertion is the victim, every run"


def test_the_byte_cap_evicts_until_it_fits():
    c = ac.ArtifactCache(max_entries=1000, max_bytes=3000)
    base = RTH_NOW.timestamp()
    keys = []
    for i in range(4):
        k = ac.key_for("chart", {"ticker": f"T{i}"}, vintage="v")
        keys.append(k)
        c.put(k, ac.Artifact(data=b"x" * 1000, stored_at=base + i))
    assert c.stats()["bytes"] <= 3000
    assert len(c) == 3
    assert c.get(keys[0], now=RTH_NOW) is None
    assert c.stats()["evicted_bytes"] == 1000


def test_an_artifact_larger_than_the_whole_cap_is_refused_and_evicts_nothing():
    """⛔ Accepting it would evict every other entry to make room for something that still does not
    fit — one oversized payload emptying the cache for everybody."""
    c = ac.ArtifactCache(max_entries=10, max_bytes=2000)
    keep = ac.key_for("chart", {"ticker": "KEEP"}, vintage="v")
    c.put(keep, ac.Artifact(data=b"y" * 500, stored_at=RTH_NOW.timestamp()))

    huge = ac.key_for("chart", {"ticker": "HUGE"}, vintage="v")
    c.put(huge, ac.Artifact(data=b"z" * 9000, stored_at=RTH_NOW.timestamp()))

    assert c.get(huge, now=RTH_NOW) is None
    assert c.get(keep, now=RTH_NOW) is not None
    assert c.stats()["refused_oversize"] == 1
    assert c.stats()["evicted_entries"] == 0


def test_a_non_bytes_payload_is_charged_a_nominal_fee_rather_than_a_shallow_guess():
    """`sys.getsizeof` on a dict reports the SHALLOW size, so a big flow card would be charged a few
    hundred bytes. A cap that under-counts by orders of magnitude is not a cap."""
    assert ac.artifact_bytes(b"abc") == 3
    assert ac.artifact_bytes("abc") == 3
    assert ac.artifact_bytes({"rows": list(range(1000))}) == ac.NOMINAL_BYTES


def test_replacing_a_key_does_not_double_count_its_bytes():
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    c.put(key, ac.Artifact(data=b"x" * 100, stored_at=RTH_NOW.timestamp()))
    c.put(key, ac.Artifact(data=b"x" * 250, stored_at=RTH_NOW.timestamp()))
    assert len(c) == 1 and c.stats()["bytes"] == 250


# ── 5 · coalescing ─────────────────────────────────────────────────────────


def _wait_for(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


def test_identical_work_in_flight_shares_one_production():
    """⛔ PART OF THE CONTRACT, NOT AN OPTIMISATION: ten members asking for the same chart at the
    open otherwise produce ten renders on a pod with four render slots."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v1")
    calls, release, started = [], threading.Event(), threading.Event()

    def produce():
        calls.append(1)
        started.set()
        release.wait(5)
        return b"png"

    out = {}
    leader = threading.Thread(target=lambda: out.setdefault("v", c.coalesce(key, produce, budget_s=5)))
    leader.start()
    assert started.wait(5), "the leader never began producing"

    got = []
    followers = [threading.Thread(target=lambda: got.append(c.coalesce(key, produce, budget_s=5)))
                 for _ in range(3)]
    for t in followers:
        t.start()
    assert _wait_for(lambda: c.stats()["coalesced_followers"] == 3), "followers never joined"

    release.set()
    for t in followers:
        t.join(10)
    leader.join(10)

    assert len(calls) == 1, f"produced {len(calls)} times; coalescing did nothing"
    assert got == [b"png"] * 3 and out["v"] == b"png"


def test_a_follower_whose_budget_expires_gets_a_miss_not_a_hang():
    """⛔ AND IT WAITS ON ITS OWN BUDGET — the one it would have spent producing — so it is never
    worse off than not coalescing."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "SLOW"}, vintage="v1")
    started = threading.Event()

    def slow():
        started.set()
        time.sleep(0.6)
        return b"png"

    leader = threading.Thread(target=lambda: c.coalesce(key, slow, budget_s=5))
    leader.start()
    assert started.wait(5)

    began = time.monotonic()
    result = c.coalesce(key, lambda: pytest.fail("a follower must not produce"), budget_s=0.05)
    waited = time.monotonic() - began

    assert result is None, "the follower was handed the leader's value after its own budget expired"
    assert waited < 0.5, f"the follower waited {waited:.2f}s on a 0.05s budget"
    assert c.stats()["follower_timeouts"] == 1
    leader.join(10)


@pytest.mark.parametrize("budget", [0, None])
def test_a_follower_with_no_budget_left_does_not_wait_at_all(budget):
    """⛔ `None` IS THE ONE THAT MATTERS: handed straight to `Event.wait` it blocks FOREVER, which is
    the hang this whole contract exists to forbid. No budget left is not a reason to wait; it is the
    reason not to."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "SLOW"}, vintage="v1")
    started, release = threading.Event(), threading.Event()

    def slow():
        started.set()
        release.wait(5)
        return b"png"

    leader = threading.Thread(target=lambda: c.coalesce(key, slow, budget_s=5))
    leader.start()
    assert started.wait(5)

    began = time.monotonic()
    assert c.coalesce(key, lambda: pytest.fail("must not produce"), budget_s=budget) is None
    assert time.monotonic() - began < 0.2
    release.set()
    leader.join(10)


def test_a_leaders_failure_releases_its_followers_immediately_with_a_miss():
    """⛔ The leader keeps its own exception — swallowing a caller's failure turns a broken upstream
    into a confident `None`. A follower gets a MISS, never a traceback from a job it did not make,
    and it gets it at once rather than waiting out a budget for an answer that is never coming."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "BOOM"}, vintage="v1")
    started, go = threading.Event(), threading.Event()
    leader_saw = {}

    def boom():
        started.set()
        go.wait(5)
        raise RuntimeError("upstream down")

    def run_leader():
        try:
            c.coalesce(key, boom, budget_s=5)
        except RuntimeError as e:
            leader_saw["e"] = str(e)

    leader = threading.Thread(target=run_leader)
    leader.start()
    assert started.wait(5)

    got, done = [], threading.Event()

    def follow():
        got.append(c.coalesce(key, lambda: pytest.fail("must not produce"), budget_s=5))
        done.set()

    follower = threading.Thread(target=follow)
    follower.start()
    assert _wait_for(lambda: c.stats()["coalesced_followers"] == 1)

    began = time.monotonic()
    go.set()
    assert done.wait(3), "the follower waited out its budget for an answer that was never coming"
    assert time.monotonic() - began < 2.0
    assert got == [None]
    leader.join(10)
    assert leader_saw.get("e") == "upstream down", "the leader's own failure was swallowed"
    assert c.stats()["leader_failures"] == 1


def test_a_caller_arriving_after_the_flight_finished_starts_a_new_production():
    """⛔ The flight is retired BEFORE the waiters are released. Joining a finished flight would hand
    a later caller a value it never asked for, produced before its request existed."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v1")
    assert c.coalesce(key, lambda: b"first", budget_s=1) == b"first"
    assert c.coalesce(key, lambda: b"second", budget_s=1) == b"second"
    assert c.stats()["in_flight"] == 0


def test_different_keys_never_coalesce_with_each_other():
    """The control on every coalescing test above: if everything shared one flight they would all
    pass for the wrong reason."""
    c = ac.ArtifactCache()
    a = ac.key_for("chart", {"ticker": "AAA"}, vintage="v")
    b = ac.key_for("chart", {"ticker": "BBB"}, vintage="v")
    assert c.coalesce(a, lambda: b"a", budget_s=1) == b"a"
    assert c.coalesce(b, lambda: b"b", budget_s=1) == b"b"
    assert c.stats()["coalesced_followers"] == 0


# ── 6 · thread safety ──────────────────────────────────────────────────────


class _CountingLock:
    """A lock that records being taken, so "the critical section is guarded" is a MEASUREMENT."""

    def __init__(self) -> None:
        self._inner = threading.Lock()
        self.taken = 0

    def __enter__(self):
        self.taken += 1
        return self._inner.__enter__()

    def __exit__(self, *exc):
        return self._inner.__exit__(*exc)


def test_every_public_call_takes_the_lock():
    """⛔ THE RENDER WORKERS ARE REAL THREADS (§3.2, a dedicated pool of 6). Each call is checked
    separately so a lock deleted from ONE of them cannot hide behind the others."""
    c = ac.ArtifactCache()
    c._lock = _CountingLock()
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")

    before = c._lock.taken
    c.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))
    assert c._lock.taken > before, "put did not take the lock"

    before = c._lock.taken
    c.get(key, now=RTH_NOW)
    assert c._lock.taken > before, "get did not take the lock"

    before = c._lock.taken
    c.coalesce(key, lambda: b"x", budget_s=1)
    assert c._lock.taken > before, "coalesce did not take the lock"


def test_the_lock_is_not_held_across_a_production():
    """⛔ A coalescer that serialises the work it exists to share is worse than no coalescer: the
    second caller would block on the LOCK rather than on the flight, and `budget_s` would mean
    nothing. Measured by a second thread reaching the store while a production is in progress."""
    c = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    started, release, reached = threading.Event(), threading.Event(), threading.Event()

    def produce():
        started.set()
        release.wait(5)
        return b"png"

    leader = threading.Thread(target=lambda: c.coalesce(key, produce, budget_s=5))
    leader.start()
    assert started.wait(5)

    def other():
        c.get(ac.key_for("chart", {"ticker": "OTHER"}, vintage="v"))
        reached.set()

    threading.Thread(target=other).start()
    assert reached.wait(2), "the store was locked for the whole production"
    release.set()
    leader.join(10)


def test_concurrent_puts_keep_the_byte_accounting_exact():
    c = ac.ArtifactCache(max_entries=10_000, max_bytes=100_000_000)
    threads, per_thread, size = 8, 250, 100
    start = threading.Barrier(threads)

    def worker(w):
        start.wait(10)
        for i in range(per_thread):
            c.put(ac.key_for("chart", {"ticker": f"T{w}_{i}"}, vintage="v"),
                  ac.Artifact(data=b"x" * size, stored_at=RTH_NOW.timestamp()))

    ts = [threading.Thread(target=worker, args=(w,)) for w in range(threads)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(30)

    assert len(c) == threads * per_thread
    assert c.stats()["bytes"] == threads * per_thread * size


# ── 7 · L2 — the tier that survives the restart ────────────────────────────
#
# ⚰️ THIS SECTION USED TO ASSERT THE OPPOSITE. It walked the module's AST for any sign of a
# persistence layer and failed if it found one — "the cache is in-memory by design and writes
# nothing" — on the reasoning that an 8.4-minute pod makes durability pointless. OI-31 reversed it:
# an 8.4-minute pod is exactly what makes durability the point, because the first render after every
# one of ~77 daily deploys hits an empty cache. The old rails are gone rather than skipped; the
# superseded design is recorded in `docs/discord-render/LEDGER.md`, not deleted from the record.


def _l2(tmp_path, name="l2", **kw):
    return ac.ArtifactCache(l2_dir=tmp_path / name, **kw)


def _restart(tmp_path, name="l2", **kw):
    """A NEW process's cache over the SAME volume. The old object is dropped entirely, so nothing
    it held in memory can be what the next assertion reads."""
    return ac.ArtifactCache(l2_dir=tmp_path / name, **kw)


def _l2_files(tmp_path, name="l2"):
    root = tmp_path / name
    return sorted(p.name for p in root.rglob("*") if p.is_file())


def test_l2_survives_a_simulated_restart(tmp_path):
    """⛔⛔ THE WHOLE REASON THE TIER EXISTS (D-02, OI-31). `web` deploys ~77 times a day and the
    median pod lives 8.4 minutes, so an in-memory-only cache is empty exactly when the first render
    after a deploy needs it most."""
    env = _env()
    key = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, envelope=env)
    art = ac.Artifact(data=_png(), envelope=env, stored_at=RTH_NOW.timestamp(), provider="bars_store")

    before = _l2(tmp_path)
    before.put(key, art)
    del before                                    # the pod is gone, heap and all

    after = _restart(tmp_path)
    assert len(after) == 0, "the new pod must start with an EMPTY heap or this proves nothing"
    back = after.get(key, now=RTH_NOW)
    assert back is not None, "the artifact did not survive the restart"
    assert back.data == _png()
    assert back.stored_at == RTH_NOW.timestamp()
    assert back.provider == "bars_store"
    assert back.envelope == env

    # ⛔ THE CONTROL. A cache over a DIFFERENT volume misses, so the hit above is the file and not
    # some process-wide state the "restart" never cleared.
    assert _restart(tmp_path, "elsewhere").get(key, now=RTH_NOW) is None


def test_an_l2_hit_promotes_into_l1_which_is_the_point_of_two_tiers(tmp_path):
    """⛔ Without the promotion the second request pays the disk read again, and two tiers are one
    slower tier."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    first = _l2(tmp_path)
    first.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))
    del first

    c = _restart(tmp_path)
    assert c.get(key, now=RTH_NOW) is not None
    assert c.stats()["l2_promotions"] == 1
    assert len(c) == 1, "the L2 hit was served but never moved into the heap"

    # the SECOND read is an L1 hit: L2 is not touched again
    l2_hits = c.stats()["l2_hits"]
    assert c.get(key, now=RTH_NOW) is not None
    assert c.stats()["l2_hits"] == l2_hits, "a hot artifact still went to disk"


def test_l1_eviction_does_not_evict_l2(tmp_path):
    """⛔⛔ THE HEAP IS 64 MiB SHARED WITH EVERY DASHBOARD REQUEST AND FILLS CONSTANTLY; THE VOLUME
    IS 512 MiB THAT NOTHING ELSE WANTS. An L1 eviction reaching through to the volume would throw
    away the copy that survives the restart — the only thing L2 exists for."""
    c = _l2(tmp_path, max_entries=1)
    first = ac.key_for("chart", {"ticker": "AAA"}, vintage="v")
    second = ac.key_for("chart", {"ticker": "BBB"}, vintage="v")
    c.put(first, ac.Artifact(data=b"aaa", stored_at=RTH_NOW.timestamp()))
    c.put(second, ac.Artifact(data=b"bbb", stored_at=RTH_NOW.timestamp() + 1))

    assert len(c) == 1, "the heap cap did not evict"
    assert c.stats()["evicted_entries"] == 1
    assert c.stats()["l2_entries"] == 2, "an L1 eviction reached through and deleted the durable copy"
    assert c.get(first, now=RTH_NOW).data == b"aaa", "the evicted artifact is not being served from L2"


def test_an_l2_eviction_does_not_evict_l1(tmp_path):
    """The other direction, asserted separately: the volume's LRU is the volume's business."""
    # ⚠️ Room for ONE entry and not two. Sized against the payload rather than a guessed total: an
    # entry is its payload plus a header of a few hundred bytes, so a cap near the payload size
    # refuses both writes as oversize and the test passes having stored nothing.
    c = _l2(tmp_path, l2_max_bytes=3000)
    first = ac.key_for("chart", {"ticker": "AAA"}, vintage="v")
    second = ac.key_for("chart", {"ticker": "BBB"}, vintage="v")
    c.put(first, ac.Artifact(data=b"a" * 2000, stored_at=RTH_NOW.timestamp()))
    c.put(second, ac.Artifact(data=b"b" * 2000, stored_at=RTH_NOW.timestamp() + 1))

    assert c.stats()["l2_refused_oversize"] == 0, "neither write fit; nothing below was measured"
    assert c.stats()["l2_evicted_entries"] == 1, "the volume cap did not evict"
    assert c.stats()["l2_entries"] == 1
    assert len(c) == 2, "an L2 eviction reached up and emptied the heap"
    assert c.get(first, now=RTH_NOW).data == b"a" * 2000, "the heap copy went with the file"


def test_the_same_expiry_rule_decides_both_tiers(tmp_path):
    """⛔ ONE FUNCTION, NOT TWO THAT AGREE. `expired_at` is called by both tiers, so "same TTL rules"
    is structural. The way two copies would fail is the flattering one: the durable tier serving
    something the heap tier had already ruled too old."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    first = _l2(tmp_path)
    first.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))
    del first

    fresh = _restart(tmp_path)
    assert fresh.get(key, now=RTH_NOW + dt.timedelta(seconds=5)) is not None

    stale = _restart(tmp_path)
    assert stale.get(key, now=RTH_NOW + dt.timedelta(seconds=ac.RTH_TTL_S + 5)) is None
    assert stale.stats()["l2_expired"] == 1
    assert stale.stats()["l2_entries"] == 0, "an expired file was left holding byte budget"


def test_all_three_stale_verdicts_survive_a_restart(tmp_path):
    """⛔⛔ THE LAUNDERING DEFECT, THROUGH A FILE. `False` says "we checked and it is fine"; `None`
    says "we could not tell". JSON has a `null` and a `false` and this must not confuse them."""
    cases = {
        None: fr.envelope(None, tf="D", now=RTH_NOW),
        False: fr.envelope("2026-09-11", tf="D", now=RTH_NOW),
        True: fr.envelope("2026-09-04", tf="D", now=RTH_NOW),
    }
    writer = _l2(tmp_path)
    keys = {}
    for expected, env in cases.items():
        assert env.stale is expected, f"fixture for {expected!r} does not carry that verdict"
        keys[expected] = ac.key_for("chart", {"ticker": "NVDA", "case": str(expected)}, envelope=env)
        writer.put(keys[expected], ac.Artifact(data=_png(), envelope=env,
                                               stored_at=RTH_NOW.timestamp()))
    del writer

    reader = _restart(tmp_path)
    for expected in cases:
        back = reader.get(keys[expected], now=RTH_NOW)
        assert back is not None, f"the {expected!r} case did not survive"
        assert back.stale is expected
        assert back.envelope == cases[expected]
    assert reader.get(keys[None], now=RTH_NOW).badge is None, \
        "an unknown vintage came back with a reassuring badge"


def test_an_entry_with_no_envelope_comes_back_unknown_and_never_fresh(tmp_path):
    """⛔ THE FAIL DIRECTION OF THE DEGRADED-NEVER-FRESH GUARD. An artifact stored without an
    envelope — and a header from a future format that omits the field — must deserialise to
    `stale is None`, which a caller renders as an ABSENT badge, never a clean one."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    writer = _l2(tmp_path)
    writer.put(key, ac.Artifact(data=_png(), envelope=None, stored_at=RTH_NOW.timestamp()))
    del writer

    back = _restart(tmp_path).get(key, now=RTH_NOW)
    assert back.envelope is None
    assert back.stale is None
    assert back.stale is not False
    assert back.badge is None


# ── 7b · corruption is a miss, recorded, never served, never raised ─────────


def _entry_path(tmp_path, key, name="l2"):
    fp = ac.fingerprint(key)
    return tmp_path / name / fp[:2] / (fp + ".art")


def _seed(tmp_path, name="l2", *, data=b"the-real-artifact", env=None):
    """One good entry on the volume, and the key that reads it."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    writer = ac.ArtifactCache(l2_dir=tmp_path / name)
    writer.put(key, ac.Artifact(data=data, envelope=env, stored_at=RTH_NOW.timestamp()))
    return key


def test_the_corruption_checks_can_see_a_good_entry_first(tmp_path):
    """⛔⛔ THE NON-VACUITY CONTROL, AND IT COMES FIRST. Every case below asserts a MISS — and a
    tier that never served anything at all would satisfy every one of them. This is the assertion
    that makes the others mean something."""
    key = _seed(tmp_path)
    back = _restart(tmp_path).get(key, now=RTH_NOW)
    assert back is not None and back.data == b"the-real-artifact"
    assert _entry_path(tmp_path, key).exists()


@pytest.mark.parametrize("damage", ["truncate_payload", "flip_a_payload_byte", "garbage_header",
                                    "empty_file", "no_header_terminator", "header_claims_another_key",
                                    "stale_is_not_a_verdict", "unknown_payload_kind",
                                    "a_format_version_we_cannot_read"])
def test_a_damaged_entry_is_a_miss_recorded_and_discarded_never_served(tmp_path, damage):
    """⛔⛔ "DETECTED AND TREATED AS A MISS, NEVER SERVED" — nine ways a file can be wrong, each of
    which a naive reader would serve as a chart. A truncated write and a flipped byte are the two
    the integrity fields exist for: LENGTH catches the first, SHA-256 catches the second, and
    neither catches both."""
    key = _seed(tmp_path)
    path = _entry_path(tmp_path, key)
    blob = path.read_bytes()
    nl = blob.index(b"\n")
    header, payload = json.loads(blob[:nl].decode()), blob[nl + 1:]

    if damage == "truncate_payload":
        path.write_bytes(blob[: len(blob) - 5])
    elif damage == "flip_a_payload_byte":
        mutated = bytearray(payload)
        mutated[0] ^= 0xFF                               # same LENGTH, different bytes
        path.write_bytes(blob[:nl + 1] + bytes(mutated))
    elif damage == "garbage_header":
        path.write_bytes(b"not json at all\n" + payload)
    elif damage == "empty_file":
        path.write_bytes(b"")
    elif damage == "no_header_terminator":
        path.write_bytes(blob.replace(b"\n", b" ", 1))
    elif damage == "header_claims_another_key":
        header["args"] = "ticker=SOMETHINGELSE"
        path.write_bytes(json.dumps(header).encode() + b"\n" + payload)
    elif damage == "stale_is_not_a_verdict":
        header["envelope"] = dict(fr.envelope("2026-09-11", tf="D", now=RTH_NOW).as_dict(),
                                  stale="probably")
        path.write_bytes(json.dumps(header).encode() + b"\n" + payload)
    elif damage == "unknown_payload_kind":
        header["kind"] = "png-but-not-really"
        path.write_bytes(json.dumps(header).encode() + b"\n" + payload)
    elif damage == "a_format_version_we_cannot_read":
        header["v"] = ac._FORMAT_VERSION + 1
        path.write_bytes(json.dumps(header).encode() + b"\n" + payload)

    c = _restart(tmp_path)
    assert c.get(key, now=RTH_NOW) is None, f"{damage} was SERVED"   # never raises, never serves
    assert c.stats()["l2_corrupt"] == 1, f"{damage} was not recorded"
    assert not path.exists(), f"{damage} was left holding byte budget it can never be served from"


def test_a_damaged_entry_is_a_miss_and_not_an_exception_even_in_bulk(tmp_path):
    """The property stated as one sentence: whatever is on the volume, `get` returns a value."""
    key = _seed(tmp_path)
    path = _entry_path(tmp_path, key)
    for junk in (b"", b"\x00" * 50, b"{}\n", b"{\n}\n", b'{"v":1}\n', b"\n", b"x" * 200_000):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(junk)
        assert _restart(tmp_path).get(key, now=RTH_NOW) is None


def test_an_l2_read_error_is_a_miss_and_l1_keeps_working(tmp_path, monkeypatch):
    """A volume that is unmounted, full or read-only costs a HIT, never a render.

    ⚠️ The refusal is toggled by a flag rather than by `monkeypatch.undo()`: this file's autouse
    fixture shares the SAME monkeypatch instance, so an `undo()` here would also un-blank
    `DISCORD_RENDER_CACHE_DIR` and hand the rest of the test an ambient volume."""
    key = _seed(tmp_path)
    c = _restart(tmp_path)
    real_open, refusing = open, {"on": True}

    def maybe_refuse(*a, **kw):
        if refusing["on"]:
            raise OSError("the volume is not there")
        return real_open(*a, **kw)

    monkeypatch.setattr(ac, "open", maybe_refuse, raising=False)
    assert c.get(key, now=RTH_NOW) is None
    assert c.stats()["l2_read_errors"] == 1

    refusing["on"] = False
    assert c.get(key, now=RTH_NOW) is not None, "the control: the read works when the volume does"


# ── 7c · the write is atomic ────────────────────────────────────────────────


def test_the_live_path_is_only_ever_reached_by_an_atomic_replace(tmp_path, monkeypatch):
    """⛔⛔ TMP FILE THEN `os.replace`, NEVER A WRITE INTO THE LIVE PATH. `os.replace` is atomic
    within a filesystem, so a concurrent reader sees the whole previous entry or the whole new one.
    A writer that dies leaves a tmp file nobody reads, rather than half an entry at the name
    everybody reads."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    calls = []
    real_replace = os.replace

    def spy(src, dst):
        calls.append({"src": str(src), "dst": str(dst),
                      "dst_existed": os.path.exists(dst),
                      "src_bytes": os.path.getsize(src)})
        return real_replace(src, dst)

    monkeypatch.setattr(ac.os, "replace", spy)
    c = _l2(tmp_path)
    c.put(key, ac.Artifact(data=b"first", stored_at=RTH_NOW.timestamp()))
    c.put(key, ac.Artifact(data=b"second", stored_at=RTH_NOW.timestamp() + 1))

    assert len(calls) == 2, "the spy never fired; this test proved nothing"   # non-vacuity
    live = str(_entry_path(tmp_path, key))
    for call in calls:
        assert call["dst"] == live
        assert call["src"] != live, "the payload was written straight into the live path"
        assert os.path.basename(call["src"]).startswith(ac._TMP_PREFIX)
        assert os.path.dirname(call["src"]) == os.path.dirname(live), \
            "the tmp file is on another directory, so the replace may not be atomic"
        assert call["src_bytes"] > 0, "the replace moved an empty file into the live path"
    assert calls[0]["dst_existed"] is False


def test_a_write_that_dies_leaves_the_previous_entry_whole_and_no_debris(tmp_path, monkeypatch):
    """⛔ The failure half of atomicity, and the one that matters: a pod killed mid-write must not
    destroy the entry that was already there."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    c = _l2(tmp_path)
    c.put(key, ac.Artifact(data=b"the-good-one", stored_at=RTH_NOW.timestamp()))

    def die(src, dst):
        raise OSError("the pod was killed")

    monkeypatch.setattr(ac.os, "replace", die)
    c.put(key, ac.Artifact(data=b"the-doomed-one", stored_at=RTH_NOW.timestamp() + 1))
    assert c.stats()["l2_write_errors"] == 1

    assert [n for n in _l2_files(tmp_path) if n.startswith(ac._TMP_PREFIX)] == [], \
        "a failed write left its tmp file behind"
    back = _restart(tmp_path).get(key, now=RTH_NOW)
    assert back is not None and back.data == b"the-good-one", \
        "a failed write destroyed the entry that was already there"


def test_a_volume_that_cannot_be_written_costs_a_hit_not_a_render(tmp_path, monkeypatch):
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    c = _l2(tmp_path)

    def refuse(*a, **kw):
        raise OSError("read-only file system")

    monkeypatch.setattr(ac.os, "makedirs", refuse)
    c.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))   # must not raise
    assert c.stats()["l2_write_errors"] == 1
    assert c.get(key, now=RTH_NOW) is not None, "L1 stopped working because the volume did"


# ── 7d · the volume's own LRU, by BYTES ────────────────────────────────────


def test_l2_evicts_by_bytes_oldest_stored_at_first(tmp_path):
    c = _l2(tmp_path, l2_max_bytes=1600, max_entries=1)      # a tiny heap, so L2 answers
    base = RTH_NOW.timestamp()
    keys = []
    for i in range(4):
        k = ac.key_for("chart", {"ticker": f"T{i}"}, vintage="v")
        keys.append(k)
        c.put(k, ac.Artifact(data=b"x" * 300, stored_at=base + i))

    stats = c.stats()
    assert stats["l2_bytes"] <= 1600
    assert stats["l2_evicted_entries"] >= 1
    assert stats["l2_evicted_bytes"] > 0
    assert c.get(keys[0], now=RTH_NOW) is None, "the oldest stored_at was not the victim"
    assert c.get(keys[3], now=RTH_NOW) is not None, "the newest was evicted"


def test_the_l2_tie_break_is_the_fingerprint_not_the_order_a_dead_pod_left_behind(tmp_path):
    """⛔ L1 BREAKS A `stored_at` TIE WITH AN INSERTION COUNTER; L2 CANNOT. L2's entries outlive the
    process that wrote them, so a counter restarts at zero and the order the index happens to be
    built in — a directory scan on some filesystem — decides which of two same-instant entries dies.
    The fingerprint is a stable total order every pod computes identically from the key alone.

    ⭐ The index order is deliberately REVERSED before the eviction, because otherwise this test
    cannot fail: a scan yields entries in name order, which IS fingerprint order, so a tie-break
    that had been deleted would coincidentally pick the same victim and the rail would be green for
    the wrong reason (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`)."""
    same = RTH_NOW.timestamp()
    a = ac.key_for("chart", {"ticker": "AAA"}, vintage="v")
    b = ac.key_for("chart", {"ticker": "BBB"}, vintage="v")
    assert ac.fingerprint(a) != ac.fingerprint(b)
    doomed, spared = sorted((a, b), key=ac.fingerprint)          # the rule: lower fingerprint first

    writer = _l2(tmp_path, max_entries=1, l2_max_bytes=1_000_000)
    writer.put(a, ac.Artifact(data=b"y" * 200, stored_at=same))
    writer.put(b, ac.Artifact(data=b"y" * 200, stored_at=same))
    each = writer.stats()["l2_bytes"] // 2
    del writer

    reader = _l2(tmp_path, max_entries=1, l2_max_bytes=2 * each)
    reader.stats()                                              # force the index scan
    index = reader._l2._index
    reader._l2._index = dict(reversed(list(index.items())))
    assert list(reader._l2._index) != list(index), \
        "the control: reversing the index did not change its iteration order, so this proves nothing"

    reader.put(ac.key_for("chart", {"ticker": "CCC"}, vintage="v"),
               ac.Artifact(data=b"y" * 200, stored_at=same + 10))
    assert reader.stats()["l2_evicted_entries"] == 1, "expected exactly one eviction"
    assert reader.get(doomed, now=RTH_NOW) is None, "the tie-break did not follow the fingerprint"
    assert reader.get(spared, now=RTH_NOW) is not None


def test_an_artifact_larger_than_the_volume_cap_is_refused_and_evicts_nothing(tmp_path):
    c = _l2(tmp_path, l2_max_bytes=2000)
    keep = ac.key_for("chart", {"ticker": "KEEP"}, vintage="v")
    c.put(keep, ac.Artifact(data=b"y" * 500, stored_at=RTH_NOW.timestamp()))
    c.put(ac.key_for("chart", {"ticker": "HUGE"}, vintage="v"),
          ac.Artifact(data=b"z" * 9000, stored_at=RTH_NOW.timestamp()))

    assert c.stats()["l2_refused_oversize"] == 1
    assert c.stats()["l2_evicted_entries"] == 0
    assert c.stats()["l2_entries"] == 1


def test_an_artifact_too_large_for_the_heap_is_still_served_from_the_volume(tmp_path):
    """⛔ THE TWO CAPS ARE DIFFERENT BUDGETS OVER DIFFERENT RESOURCES, and neither gates the other.
    64 MiB of heap is shared with every dashboard request; 512 MiB of volume is not. An artifact the
    heap refuses is still worth keeping on disk — it is served without being promoted, which is
    recorded as its own thing rather than as an oversize refusal, because nothing was refused."""
    key = ac.key_for("chart", {"ticker": "BIG"}, vintage="v")
    c = _l2(tmp_path, max_bytes=500, l2_max_bytes=100_000)
    c.put(key, ac.Artifact(data=b"q" * 4000, stored_at=RTH_NOW.timestamp()))

    assert c.stats()["refused_oversize"] == 1, "the heap should have refused it"
    assert len(c) == 0
    back = c.get(key, now=RTH_NOW)
    assert back is not None and back.data == b"q" * 4000, "the volume did not keep what the heap refused"
    assert c.stats()["l2_served_unpromoted"] == 1
    assert c.stats()["l2_promotions"] == 0
    assert len(c) == 0, "an artifact the heap cannot hold was promoted into it anyway"


def test_a_payload_that_cannot_be_serialised_stays_in_l1_and_says_so(tmp_path):
    key = ac.key_for("flow", {"ticker": "NVDA"}, vintage="v")
    c = _l2(tmp_path)
    c.put(key, ac.Artifact(data=object(), stored_at=RTH_NOW.timestamp()))
    assert c.stats()["l2_refused_unserialisable"] == 1
    assert c.get(key, now=RTH_NOW) is not None, "the heap copy went with the failed disk write"
    assert _restart(tmp_path).get(key, now=RTH_NOW) is None


@pytest.mark.parametrize("payload", [b"\x89PNG\x00\xff", "a text card", {"rows": [1, 2, 3]},
                                     [{"sym": "NVDA"}], 12345, None])
def test_every_payload_shape_the_bot_produces_round_trips_through_the_volume(tmp_path, payload):
    key = ac.key_for("chart", {"ticker": "NVDA", "case": repr(payload)}, vintage="v")
    writer = _l2(tmp_path)
    writer.put(key, ac.Artifact(data=payload, stored_at=RTH_NOW.timestamp()))
    del writer
    assert _restart(tmp_path).get(key, now=RTH_NOW).data == payload


# ── 7e · wiring: the root, the caps, and the shared-data-root guard ────────


def test_the_l2_root_is_env_derived_with_a_data_default(monkeypatch):
    monkeypatch.delenv("DISCORD_RENDER_CACHE_DIR", raising=False)
    assert ac.l2_root() == "/data/discord_render_cache"
    monkeypatch.setenv("DISCORD_RENDER_CACHE_DIR", "/somewhere/else")
    assert ac.l2_root() == "/somewhere/else"
    monkeypatch.setenv("DISCORD_RENDER_CACHE_DIR", "   ")
    assert ac.l2_root() == "", "a blank value must turn L2 off, not point it at a directory named ' '"


def test_the_shared_data_root_census_pins_the_l2_root(monkeypatch):
    """⛔⛔ `/data` IS REAL ON THIS BOX — `C:\\data`, the owner's LIVE files. The repo-root conftest
    redirects every `/data/...` literal it can DERIVE an env var for, at import, before any module
    captures a path. This asserts our root is one of them; if it ever is not, every test run that
    forgets an explicit root writes into production."""
    literals, pins, unpinnable = rootconf.shared_data_root_census()
    assert pins.get("DISCORD_RENDER_CACHE_DIR") == "/data/discord_render_cache", (
        "L2's root is not a derived pin. The usual cause is a NAMED constant as the `.get()` "
        "default — clause (A) reads the literal out of the call, and a name is not a literal.")
    # the control: the census can see a pin it is not being asked about, so the assertion above is
    # not passing because the derivation returns everything it is handed.
    assert "AUTH_DB_PATH" in pins
    assert "/data/discord_render_cache" not in unpinnable
    assert "/data/discord_render_cache" in literals


def test_the_two_byte_caps_have_two_names_and_one_cannot_move_the_other(monkeypatch):
    """⛔⛔ ONE VARIABLE CANNOT BE TWO CAPS. `DISCORD_RENDER_CACHE_BYTES` is §3.6's VOLUME budget;
    the heap's is `DISCORD_RENDER_CACHE_MEM_BYTES`. The collision mattered in the dangerous
    direction: an operator setting the documented 512 MiB for the volume would, on the old code,
    have raised the HEAP ceiling eightfold on a pod that OOMs members when it runs out."""
    assert ac.L2_MAX_BYTES_DEFAULT == 512 * 1024 * 1024
    assert ac.L1_MAX_BYTES_DEFAULT == 64 * 1024 * 1024

    monkeypatch.setenv("DISCORD_RENDER_CACHE_BYTES", "4096")
    monkeypatch.setenv("DISCORD_RENDER_CACHE_MEM_BYTES", "8192")
    monkeypatch.setenv("DISCORD_RENDER_CACHE_DIR", "/tmp/uct-render-cache-name-check")
    stats = ac.ArtifactCache().stats()
    assert stats["max_bytes"] == 8192, "the heap cap is reading the volume's variable"
    assert stats["l2_max_bytes"] == 4096, "the volume cap is reading the heap's variable"


def test_a_blank_root_runs_the_heap_alone_rather_than_failing(monkeypatch):
    """A pod without the volume mounted must still cache in memory."""
    monkeypatch.setenv("DISCORD_RENDER_CACHE_DIR", "")
    c = ac.ArtifactCache()
    assert c.stats()["l2_enabled"] is False
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    c.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))
    assert c.get(key, now=RTH_NOW) is not None


def test_constructing_a_cache_touches_no_filesystem(tmp_path):
    """⛔ `store()` builds the process-wide cache the first time anything asks for it. A constructor
    that created its directory would make a shared-root directory appear merely because a module was
    imported — in a test run, in a script, on a box where `/data` is the owner's live files."""
    root = tmp_path / "never-created"
    c = ac.ArtifactCache(l2_dir=root)
    assert not root.exists(), "the constructor created a directory under the data root"
    assert c.stats()["l2_entries"] == 0
    assert not root.exists(), "reading the stats created a directory"
    c.put(ac.key_for("chart", {"ticker": "NVDA"}, vintage="v"),
          ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))
    assert root.exists(), "the control: a real write does create it"


def test_clear_is_not_a_delete_against_durable_data_unless_asked(tmp_path):
    """⛔ `feedback_kill_switch_never_a_delete`. Stopping the heap tier must not throw away the
    volume; a caller that genuinely wants the durable copies gone has to say so."""
    key = ac.key_for("chart", {"ticker": "NVDA"}, vintage="v")
    c = _l2(tmp_path)
    c.put(key, ac.Artifact(data=_png(), stored_at=RTH_NOW.timestamp()))

    c.clear()
    assert len(c) == 0
    assert c.stats()["l2_entries"] == 1
    assert c.get(key, now=RTH_NOW) is not None

    c.clear(l2=True)
    assert c.stats()["l2_entries"] == 0
    assert _restart(tmp_path).get(key, now=RTH_NOW) is None


# ── 8 · the frozen cross-lane contract ─────────────────────────────────────


def test_the_module_satisfies_the_frozen_shapes_lane_A_builds_against():
    assert isinstance(ac.key_for("chart", {"ticker": "NVDA"}, envelope=_env()), contracts.CacheKey)
    assert isinstance(ac.Artifact(data=_png(), envelope=_env()), contracts.CachedArtifact)
    assert isinstance(ac.ArtifactCache(), contracts.ArtifactStore)


def test_the_kill_switch_is_read_per_call_so_it_needs_no_redeploy(monkeypatch):
    monkeypatch.delenv("RENDER_CACHE_ENABLED", raising=False)
    assert ac.enabled() is False
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "1")
    assert ac.enabled() is True
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "0")
    assert ac.enabled() is False


def test_the_process_wide_store_is_one_store():
    """⛔ A second instance is a second hit rate: two stores over one key space share nothing and
    each look half as useful as the one that should exist."""
    assert ac.store() is ac.store()
