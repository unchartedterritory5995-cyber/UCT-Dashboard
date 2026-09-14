"""Rails for the artifact cache + coalescer (03 §3.6, §3.2; step 2.5, Lane B).

Every rule the module claims is asserted here against real behaviour, and every one of these rails
has a mutation in `docs/discord-render/instruments/mutation_harness_cache.py` that makes it go RED —
a rail nobody has seen fail is not a rail.

Fixture instants are fixed, never `now()`: a TTL test that reads the real clock is a test of how long
the test took to run. 2026-09-11 is a Friday, so 11:00 ET is `rth`, 17:00 ET is `post` and Saturday
2026-09-12 is `weekend` — the three TTL regimes, each pinned by name below rather than assumed.
"""
from __future__ import annotations

import ast
import datetime as dt
import threading
import time

import pytest

from api.services.discord_render import artifact_cache as ac
from api.services.discord_render import contracts, freshness as fr

RTH_NOW = dt.datetime(2026, 9, 11, 11, 0, tzinfo=fr.ET)      # Friday, mid-session
POST_NOW = dt.datetime(2026, 9, 11, 17, 0, tzinfo=fr.ET)     # Friday, extended
CLOSED_NOW = dt.datetime(2026, 9, 12, 11, 0, tzinfo=fr.ET)   # Saturday


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


# ── 7 · in-memory by design, proved from the source ────────────────────────


_PERSISTENCE = {"open", "sqlite3", "shutil", "pathlib", "Path", "pickle", "shelve", "dbm",
                "tempfile", "NamedTemporaryFile", "makedirs", "mkdir", "write_bytes", "write_text"}


def _persistence_hits(source: str) -> set[str]:
    """An AST walk, never a grep: a `grep` here would match the word "open" in a docstring and read
    as a finding, which is the invented-citation defect a machine commits."""
    tree = ast.parse(source)
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in _PERSISTENCE:
            found.add(node.id)
        elif isinstance(node, ast.Attribute) and node.attr in _PERSISTENCE:
            found.add(node.attr)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [getattr(node, "module", None) or ""] + [a.name for a in node.names]
            found |= {n.split(".")[0] for n in names if n.split(".")[0] in _PERSISTENCE}
    return found


def test_the_checker_can_see_a_presence_before_it_reports_an_absence():
    """⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A PRESENCE."""
    planted = "import sqlite3\nfrom pathlib import Path\ndef f(p):\n    open(p, 'w')\n    Path(p).write_text('x')\n"
    assert _persistence_hits(planted) >= {"sqlite3", "open", "Path", "write_text"}


def test_the_cache_is_in_memory_by_design_and_writes_nothing():
    """⛔ THE POD LIVES 8.4 MINUTES (01 §I, C-01), so durability nobody asked for is the wrong
    build. What survives a restart is the KEY, not the bytes."""
    src = open(ac.__file__, encoding="utf-8").read()
    assert _persistence_hits(src) == set(), "the artifact cache grew a persistence layer"
    assert "in-memory" in (ac.__doc__ or "").lower()


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
