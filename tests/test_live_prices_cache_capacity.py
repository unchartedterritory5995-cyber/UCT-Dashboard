"""CAPACITY RAIL: `/api/live-prices` must not thrash above ~970 distinct tickers.

This is the gate on `LIVE-PRICES-LRU` (2026-08-09 performance audit). The
two-tier design in `api/routers/live_prices.py` is correct and its per-ticker
keys are genuinely SHARED across users — but the bound on the "dedicated" cache
instance came from `cache._MAX_SIZE = 1000`, a MODULE-level constant. Above a
distinct working set of ~970 the per-ticker keys evicted each other, forever, in
steady state; those misses funnel into `_MASSIVE_SEM` (6 slots, 8s acquire) and
end in `if not result: 503` — the launch-day 524 shape from a different door.

WHY THE SIMULATION AND NOT A UNIT TEST. **The threshold IS the bug.** A test
that stores 10 keys and reads them back passes identically before and after the
fix, because nothing in it ever crosses the cliff. So this drives the REAL
handler with the audit's own shapes — 200 users × 50 tickers (2.5k distinct),
250 × 50, 200 × 250 (4k distinct) — and measures upstream fetch count and
per-ticker miss rate in STEADY STATE.

WHY EACH SCENARIO IS RUN TWICE. A single "0 fetches" number proves nothing on
its own: it could mean the cache works, or that the simulation never reached the
provider at all. Every scenario therefore runs against BOTH bounds through the
one code path — `_OLD_MODULE_WIDE_CAP` (what shipped) and the live
`live_prices.CACHE_MAX_SIZE` — so the pre-fix leg is a positive control that
must REPRODUCE the thrash. If it ever goes quiet, the harness has stopped
measuring and every "after" assertion below is vacuous.

TTL IS PINNED OUT OF THE WAY on purpose (`_CACHE_TTL` → 1 hour). The defect is
capacity, not expiry; leaving a 15s TTL in a multi-second simulation would let
wall-clock drift masquerade as eviction and vice versa. With expiry off, the
ONLY thing that can evict an entry is the LRU bound under test.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

import pytest

from api.routers import live_prices as lp
from api.services import cache as cache_mod
from api.services.cache import TTLCache

# What the bound WAS: the module-wide constant, applied to this instance too.
_OLD_MODULE_WIDE_CAP = 1000

# The audit's cliff. Below it the cache is perfect; above it, every poll
# re-fetches. Both live in the audit's §3 table.
_THRASH_CLIFF_TICKERS = 970


# ── the harness ──────────────────────────────────────────────────────────────

@dataclass
class Result:
    users: int
    per_user: int
    distinct: int
    cap: int
    upstream_fetches: int      # ticker-fetches sent upstream in the steady round
    tier1_hits: int            # whole-set fast-path hits in the steady round
    lookups: int               # tier-2 per-ticker cache reads in the probe round
    misses: int                # ...of which missed
    miss_pct: float

    def line(self) -> str:
        return (
            f"{self.users:>4} users x {self.per_user:>3} tickers "
            f"({self.distinct:>5} distinct) cap={self.cap:<6} "
            f"steady-state upstream fetches={self.upstream_fetches:<7} "
            f"tier1 hits={self.tier1_hits:<5} "
            f"per-ticker miss={self.misses}/{self.lookups} ({self.miss_pct:.1f}%)"
        )


class _CountingCache(TTLCache):
    """A TTLCache that tallies per-ticker reads. Counting lives HERE, not in the
    product module, so the handler under test is byte-for-byte the shipped one."""

    def __init__(self, max_size: int):
        super().__init__(max_size=max_size)
        self.px_lookups = 0
        self.px_misses = 0
        self.whole_hits = 0

    def get(self, key: str):
        value = super().get(key)
        if key.startswith("live_px1_"):
            self.px_lookups += 1
            if value is None:
                self.px_misses += 1
        elif key.startswith("live_prices_") and value is not None:
            self.whole_hits += 1
        return value


def _pool(n: int) -> list[str]:
    """`n` distinct ticker-shaped symbols. Synthetic on purpose: the audit's
    4,000-distinct row exceeds cap_universe's 3,742, and pinning the simulation
    to a data file would make the rail move whenever that file does."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out, i = [], 0
    while len(out) < n:
        s, k = "", i
        for _ in range(4):
            s += alphabet[k % 26]
            k //= 26
        out.append(s)
        i += 1
    return out


def _user_sets(users: int, per_user: int, distinct: int, seed: int = 20260809):
    """`users` ticker sets whose union is exactly `distinct` symbols.

    Slots are dealt from the pool cyclically and then SHUFFLED. The shuffle is
    load-bearing: contiguous blocks would be a pure sequential scan, LRU's
    textbook worst case, and would overstate the thrash. Random overlap is both
    realistic and the conservative choice.
    """
    assert users * per_user >= distinct, "cannot cover the pool"
    pool = _pool(distinct)
    flat = [pool[k % distinct] for k in range(users * per_user)]
    random.Random(seed).shuffle(flat)
    return [flat[i * per_user:(i + 1) * per_user] for i in range(users)]


def _install(monkeypatch, cap: int) -> _CountingCache:
    """Point the handler at a cache with `cap` and stub everything upstream."""
    counting = _CountingCache(cap)
    monkeypatch.setattr(lp, "cache", counting)
    # Expiry off — see the module docstring. Capacity is the variable under test.
    monkeypatch.setattr(lp, "_CACHE_TTL", 3600)
    monkeypatch.setattr(lp, "_get_client", lambda: object())
    monkeypatch.setattr(lp, "_detect_session", lambda: "regular")

    fetched: list[int] = []

    def _fake_fetch(client, tickers, session):
        fetched.append(len(tickers))
        return {
            tk: {"price": 100.0, "change_pct": 1.0, "change": 1.0, "volume": 1000,
                 "day_open": 99.0, "day_high": 101.0, "day_low": 98.0,
                 "prev_close": 99.0, "day_close": 100.0,
                 "ext_price": None, "ext_session": None,
                 "prev_change": None, "prev_change_pct": None}
            for tk in tickers
        }

    monkeypatch.setattr(lp, "_fetch_snapshots", _fake_fetch)

    # The handler fires price alerts on every freshly-built set; 600 real
    # alert-check passes would dominate the runtime and measure nothing.
    from api.services import watchlist_alert_service as was
    monkeypatch.setattr(was, "run_alert_check", lambda *a, **k: None)

    counting._fetched = fetched  # type: ignore[attr-defined]
    return counting


def _simulate(monkeypatch, *, users: int, per_user: int, distinct: int,
              cap: int, rounds: int = 3) -> Result:
    """Drive the real handler and report the STEADY-STATE round.

    `rounds` identical polls model the 2s cadence (a healthy cache fetches zero
    upstream after round 1). A final PROBE round then perturbs each user's set by
    one symbol so the tier-1 whole-set key misses and the per-ticker tier has to
    answer — that is the only way to read a real tier-2 miss rate, since tier 1
    short-circuits the identical re-poll before tier 2 is consulted.
    """
    sets = _user_sets(users, per_user, distinct)
    cache = _install(monkeypatch, cap)
    pool = _pool(distinct)

    for r in range(rounds):
        if r == rounds - 1:                       # steady-state round: reset tallies
            cache._fetched.clear()                # type: ignore[attr-defined]
            cache.whole_hits = 0
        for s in sets:
            out = lp.get_live_prices(tickers=",".join(s))
            assert isinstance(out, dict), f"handler degraded to {out!r}"

    steady_upstream = sum(cache._fetched)         # type: ignore[attr-defined]
    steady_tier1 = cache.whole_hits

    cache.px_lookups = cache.px_misses = 0
    for i, s in enumerate(sets):                  # tier-2 probe round
        probe = list(s[1:]) + [pool[(i * 7 + 3) % distinct]]
        lp.get_live_prices(tickers=",".join(probe))

    return Result(
        users=users, per_user=per_user, distinct=distinct, cap=cap,
        upstream_fetches=steady_upstream, tier1_hits=steady_tier1,
        lookups=cache.px_lookups, misses=cache.px_misses,
        miss_pct=(100.0 * cache.px_misses / cache.px_lookups) if cache.px_lookups else 0.0,
    )


# ── the audit's shapes, before and after ─────────────────────────────────────

SHAPES = [
    pytest.param(200, 50, 2567, id="200x50"),
    pytest.param(250, 50, 3000, id="250x50"),
    pytest.param(200, 250, 4000, id="200x250"),
]


@pytest.mark.parametrize("users,per_user,distinct", SHAPES)
def test_the_old_module_wide_cap_reproduces_the_thrash(monkeypatch, users, per_user,
                                                       distinct, capsys):
    """POSITIVE CONTROL. Without this the "after" assertions are unfalsifiable:
    a broken harness reports 0 fetches and 0 misses and looks like a clean fix."""
    r = _simulate(monkeypatch, users=users, per_user=per_user,
                  distinct=distinct, cap=_OLD_MODULE_WIDE_CAP)
    with capsys.disabled():
        print("\nBEFORE  " + r.line())
    assert distinct > _THRASH_CLIFF_TICKERS, (
        "this scenario never crosses the ~970-ticker cliff, so it cannot "
        "distinguish the fix from the defect"
    )
    assert r.upstream_fetches > 0, (
        "the pre-fix cap fetched NOTHING upstream in steady state — the harness "
        "is not exercising the provider path, so every 'after' assertion here is "
        "vacuous. Fix the harness before trusting this file."
    )
    assert r.miss_pct > 10.0, (
        f"expected a thrashing per-ticker cache at {distinct} distinct tickers "
        f"under a {_OLD_MODULE_WIDE_CAP}-entry bound; measured {r.miss_pct:.1f}% miss"
    )


@pytest.mark.parametrize("users,per_user,distinct", SHAPES)
def test_the_derived_bound_holds_the_whole_working_set(monkeypatch, users, per_user,
                                                       distinct, capsys):
    r = _simulate(monkeypatch, users=users, per_user=per_user,
                  distinct=distinct, cap=lp.CACHE_MAX_SIZE)
    with capsys.disabled():
        print("AFTER   " + r.line())
    assert r.upstream_fetches == 0, (
        f"{r.upstream_fetches} upstream ticker fetches per steady-state poll "
        f"round at {users}x{per_user} ({distinct} distinct). Those funnel through "
        f"live_prices._MASSIVE_SEM (6 slots) and end in a 503."
    )
    assert r.tier1_hits == users, "the whole-set fast path should serve every repeat poll"
    assert r.misses == 0, (
        f"{r.misses}/{r.lookups} per-ticker misses ({r.miss_pct:.1f}%) with a warm "
        f"cache — the per-ticker tier is still evicting itself"
    )


# ── the bound itself ─────────────────────────────────────────────────────────

def test_the_bound_is_derived_from_the_universe_not_typed():
    expected = lp._universe_size() * lp._KEYS_PER_TICKER + lp._SET_KEY_HEADROOM
    assert lp.CACHE_MAX_SIZE == expected
    assert lp.cache.max_size == lp.CACHE_MAX_SIZE, (
        "the live-prices instance must actually be constructed with its own bound"
    )


def test_the_bound_clears_the_thrash_cliff_with_room_for_extended_hours():
    """Extended hours writes a second key per active ticker (`live_exvol_`) into
    this same instance, which is what roughly halved effective capacity before."""
    assert lp.CACHE_MAX_SIZE >= 2 * lp._universe_size(), (
        "a bound that does not budget both key families per ticker halves itself "
        "every day between 04:00 and 20:00 ET"
    )
    assert lp.CACHE_MAX_SIZE // lp._KEYS_PER_TICKER > _THRASH_CLIFF_TICKERS * 3


def test_a_shrunken_universe_file_cannot_shrink_the_cache_into_the_thrash_regime(monkeypatch):
    monkeypatch.setattr(lp, "_universe_size", lambda: 12)
    assert lp._universe_size() == 12
    # the real loader floors at _UNIVERSE_FALLBACK; prove the floor, not the stub
    monkeypatch.undo()
    assert lp._universe_size() >= lp._UNIVERSE_FALLBACK


def test_raising_this_instance_did_not_raise_the_shared_singleton():
    """⛔ The shared singleton caches MB-scale bars payloads. The whole point of
    a per-instance bound is that live-prices got headroom and nothing else did."""
    assert cache_mod._MAX_SIZE == _OLD_MODULE_WIDE_CAP
    assert cache_mod.cache.max_size == _OLD_MODULE_WIDE_CAP
    assert lp.cache.max_size > cache_mod.cache.max_size


def test_a_default_constructed_cache_still_uses_the_shared_default():
    assert TTLCache().max_size == cache_mod._MAX_SIZE


def test_an_instance_bound_actually_evicts_at_its_own_size():
    """The mechanism, minimally: `set()` must read the INSTANCE bound. If it
    still read the module constant this would evict at 1,000."""
    c = TTLCache(max_size=3)
    for i in range(5):
        c.set(f"k{i}", i, ttl=60)
    assert len(c) == 3
    assert c.get("k0") is None and c.get("k4") == 4


def test_a_nonsense_bound_is_refused_rather_than_silently_disabling_the_cache():
    with pytest.raises(ValueError):
        TTLCache(max_size=0)


# ── the memory cost of the new bound, MEASURED ───────────────────────────────

_MEMORY_BUDGET_MB = 48.0


def _deep_size(obj, seen=None) -> int:
    """Transitive `sys.getsizeof`, sharing-aware. The whole-set entries hold
    REFERENCES to the same per-ticker row dicts, so counting a shared row twice
    would triple the answer and turn a 21 MB cache into a fictional 60 MB one."""
    import sys as _sys
    if seen is None:
        seen = set()
    if id(obj) in seen:
        return 0
    seen.add(id(obj))
    total = _sys.getsizeof(obj)
    if isinstance(obj, dict):
        for k, v in obj.items():
            total += _deep_size(k, seen) + _deep_size(v, seen)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            total += _deep_size(v, seen)
    return total


def test_the_bound_is_affordable_at_full_saturation(capsys):
    """A capacity bound that nobody has costed is a memory leak with a docstring.

    Worst case by construction: every per-ticker slot filled with a full quote
    row AND its extended-hours volume key, and every remaining slot a whole-set
    entry at the `_MAX_TICKERS` maximum. Measured, not estimated — so a future
    bump to `_SET_KEY_HEADROOM` or `_KEYS_PER_TICKER` fails HERE rather than in
    the pod.
    """
    row = {"price": 100.25, "change_pct": 1.2345, "change": 1.23,
           "volume": 12345678, "day_open": 99.0, "day_high": 101.0,
           "day_low": 98.0, "prev_close": 99.0, "day_close": 100.25,
           "ext_price": 100.5, "ext_session": "pre-market",
           "prev_change": 0.5, "prev_change_pct": 0.51}

    c = TTLCache(max_size=lp.CACHE_MAX_SIZE)
    n_tick = lp._universe_size()
    for i in range(n_tick):
        c.set(lp._px_key(f"T{i:05d}"), dict(row), ttl=10 ** 6)
        c.set(lp._exvol_key(f"T{i:05d}"), 12_345_678, ttl=10 ** 6)
    rows = [c.get(lp._px_key(f"T{i:05d}")) for i in range(n_tick)]
    for s in range(lp._SET_KEY_HEADROOM):
        members = {f"T{(s * 7 + j) % n_tick:05d}": rows[(s * 7 + j) % n_tick]
                   for j in range(lp._MAX_TICKERS)}
        c.set(f"live_prices_{s:032x}", members, ttl=10 ** 6)

    assert len(c) == lp.CACHE_MAX_SIZE, "the worst case must actually fill the cache"
    mb = _deep_size(c._store) / 1024 / 1024
    with capsys.disabled():
        print(f"\nMEMORY  live-prices cache at full saturation "
              f"({lp.CACHE_MAX_SIZE} entries): {mb:.1f} MB")
    assert mb < _MEMORY_BUDGET_MB, (
        f"{mb:.1f} MB exceeds the {_MEMORY_BUDGET_MB} MB budget for this cache. "
        f"Pod RSS is ~637 MB idle / ~1.3 GB under load — re-cost the bound "
        f"before raising it."
    )
