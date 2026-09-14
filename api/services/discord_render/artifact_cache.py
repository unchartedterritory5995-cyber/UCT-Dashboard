"""The artifact cache and the coalescer (03 §3.6, §3.2; step 2.5, Lane B).

⛔⛔ IN-MEMORY BY DESIGN, AND THAT IS THE WHOLE POINT OF THE 8-MINUTE POD, NOT A LIMITATION OF IT.
`web` deployed 1,077 times in the 14-day forensics window and the median pod lived **8.4 minutes**
(01 §I, class C-01). A cache in this process therefore lives minutes, and everything here is sized
for that: a restart empties it, nothing is written to disk, and no durability layer is built because
nobody asked for one. ⭐ The thing that actually survives a restart is the KEY — `(command, args,
vintage)` is derived from the data, so the pod that comes up next recomputes the same key for the
same input and the entry it stores is the one the previous pod would have stored. Durability would
buy the bytes; determinism is what buys the hit.

⛔⛔ THE KEY'S THIRD PART IS THE DATA'S VINTAGE, NEVER THE WALL CLOCK. If it were "now", the same
closed-market input would cache under a new key every second: the hit rate would collapse to zero
and §3.10's determinism guarantee — the same input renders the same pixels — would be
**unobservable**, because no two runs would ever share an entry to compare. `key_for()` is the one
place a key is built and it cannot read a clock; `vintage_of(envelope)` is the one derivation.

⭐ WHY THIS IS WORTH ANYTHING AT ALL, since the caller must know the vintage to ask: the vintage is
cheap (the newest bar's `t`, already in hand after the bars fetch) and the RENDER is not (§2's
latency budget is dominated by the screenshot). The cache skips the expensive half after the cheap
half has already answered. It is not a fetch cache.

⛔ A MISS IS `None` — never an exception, never a stale hit the caller has to re-check. A store that
raises on a miss makes every call site wrap it; a store that hands back something expired makes
every call site re-check it, and the one that forgets is the bug.

⛔ COALESCING IS PART OF THE CONTRACT, NOT AN OPTIMISATION (§3.2, §3.6). Ten members asking for the
same chart at the open otherwise produce ten renders on a pod with four render slots, and nine of
them wait for a slot to do work already being done. A follower waits on **its own** `budget_s` — the
budget it would have spent producing — so it is never worse off than not coalescing, and a follower
whose budget expires gets a **miss, not a hang**.

⛔ `stored_at` AND THE ENVELOPE ARE DIFFERENT NUMBERS AND BOTH ARE KEPT. `stored_at` decides
eviction; the envelope decides what the member is told. A cache that kept only `stored_at` would
hand back a week-old chart labelled "cached 30 seconds ago" — true, and completely misleading.

⛔ AND `stale=None` MUST SURVIVE THE ROUND TRIP AS `None`. A cache that launders an unmeasured
vintage into a clean `False` is the exact defect the three-valued verdict exists to prevent
(`freshness.Envelope`, `adapters/result.py`): the badge would be absent because everything looked
fine, rather than absent because nothing was known.

Frozen shapes this satisfies: `contracts.CacheKey`, `contracts.CachedArtifact`,
`contracts.ArtifactStore`. `tests/test_discord_render_contracts.py` is what makes those load-bearing;
`tests/test_discord_render_artifact_cache.py` is what makes this module's own rules load-bearing, and
`docs/discord-render/instruments/mutation_harness_cache.py` proves those rails can fail.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from api.services.discord_render.freshness import (
    CLOSED_STATES,
    ET,
    RTH,
    Envelope,
    session_state,
)

# ── TTL by session state (D-02, §3.6) ───────────────────────────────────────
#
# ⭐ These bound how long we may serve OUR COPY; they are not what keeps the data correct. The key
# carries the vintage, so an entry can only ever be served to a caller asking for that same vintage.
# The TTL is the belt beside those braces — it bounds the window in which a data version we have
# since learned to be superseded could still be handed out under an argument that did not change.
RTH_TTL_S: float = 30.0
EXTENDED_TTL_S: float = 120.0
#: ⛔ `None` MEANS NO AGE EXPIRY, NOT "EXPIRE IMMEDIATELY". §3.6 says "closed until the next session
#: open", and the next session opening changes the data version, which changes the KEY — so the
#: entry is unreachable by construction rather than by a timer. Inventing a number here would be a
#: second authority over a boundary the key already owns (`lesson_a_second_authority_over_one_value`).
CLOSED_TTL_S: float | None = None

MAX_ENTRIES_DEFAULT = 256
#: ⚠️ NOT §3.6's 512 MiB. That figure is for the on-VOLUME cache; this is the web pod's own heap,
#: shared with every dashboard request, so the on-disk number does not transfer.
MAX_BYTES_DEFAULT = 64 * 1024 * 1024
#: What a non-bytes payload is charged. See `artifact_bytes`.
NOMINAL_BYTES = 4096

_UNKNOWN_VINTAGE = "\x00unknown"


def enabled() -> bool:
    """`RENDER_CACHE_ENABLED` (§3.11), read per call so a flip needs no redeploy.

    ⛔ AN **ENABLEMENT GATE**, NOT A KILL SWITCH — unset means OFF, and the polarity below says so.
    The distinction is not pedantry: a kill switch defaults ON because "nobody set it" and "somebody
    deliberately shut it down" must not be indistinguishable; an enablement gate defaults OFF because
    it ADDS behaviour and must not turn itself on in every environment the moment it merges. This
    docstring called it a kill switch while the code did the opposite, which is the kind of
    disagreement that gets read rather than run."""
    return str(os.environ.get("RENDER_CACHE_ENABLED", "")).strip().lower() in ("1", "true", "yes", "on")


# ── the key ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CacheKey:
    """`(command, normalised args, vintage)` — satisfies `contracts.CacheKey`.

    ⛔ `vintage` IS THE DATA'S, AND `None` IS A LEGITIMATE VALUE. An unknown vintage caches under a
    STABLE unknown-key rather than under the clock: two runs a minute apart over the same unmeasured
    input still share an entry, which is the only way a determinism claim about them is testable at
    all. It does not read as "fresh" anywhere — the envelope carries that verdict, not the key."""

    command: str
    args: str
    vintage: str | None


def normalise_args(args: Mapping[str, Any] | str | None) -> str:
    """One spelling for one request. Sorted, `None`s dropped, so `{tf: "D", ticker: "NVDA"}` and
    `{ticker: "NVDA", tf: "D"}` are one cache entry rather than two."""
    if args is None:
        return ""
    if isinstance(args, str):
        return args.strip()
    return "|".join(f"{k}={args[k]}" for k in sorted(args) if args[k] is not None)


def vintage_of(envelope: Envelope | None) -> str | None:
    """The data's vintage stamp, or `None` when it could not be established.

    ⛔ `as_of_utc` IS THE DATA'S OWN TIMESTAMP — the newest bar, the flow window's end. It is the one
    field of the envelope that cannot move while the input does not, which is precisely what a cache
    key needs and precisely what the wall clock is not."""
    return envelope.as_of_utc if envelope is not None else None


def key_for(command: str, args: Mapping[str, Any] | str | None = None, *,
            vintage: str | None = None, envelope: Envelope | None = None) -> CacheKey:
    """Build a key. ⛔ THIS FUNCTION CANNOT READ A CLOCK, AND THAT IS THE POINT — it is the only
    place a key is constructed, so "the vintage is the data's" is a property of the code rather than
    a rule every call site has to remember."""
    if vintage is not None and envelope is not None:
        raise ValueError(
            "pass a vintage OR an envelope, never both — two authorities over one value is how a "
            "key ends up disagreeing with the stamp it was derived from")
    if envelope is not None:
        vintage = vintage_of(envelope)
    return CacheKey(str(command).strip().lower(), normalise_args(args), vintage)


# ── what comes back out ─────────────────────────────────────────────────────


def artifact_bytes(data: Any) -> int:
    """What an entry is charged against the byte cap.

    ⛔ A NOMINAL CHARGE FOR ANYTHING THAT IS NOT BYTES, DELIBERATELY. `sys.getsizeof` on a dict or a
    list reports the SHALLOW size — a 2 MB flow card would be charged ~200 bytes — and a cap that
    under-counts by four orders of magnitude is not a cap. PNGs are what this cap exists for and
    they are bytes; everything else pays a flat, honest, deterministic fee."""
    if isinstance(data, (bytes, bytearray, memoryview)):
        return len(data)
    if isinstance(data, str):
        return len(data.encode("utf-8", "replace"))
    return NOMINAL_BYTES


@dataclass(frozen=True)
class Artifact:
    """Satisfies `contracts.CachedArtifact`. Frozen: an entry is a record of what was stored, and a
    holder that can edit it can make the record disagree with the event (same reason as `Result`)."""

    data: Any
    #: `freshness.Envelope | None`. ⛔ `None` MEANS UNKNOWN, NOT FRESH.
    envelope: Envelope | None = None
    #: When WE cached it — wall clock, seconds. Eviction's authority, and NOT the data's age.
    stored_at: float = field(default_factory=time.time)
    provider: str | None = None

    @property
    def stale(self) -> bool | None:
        """⛔ THREE-VALUED, AND THE ROUND TRIP MUST PRESERVE ALL THREE: True · False · None. `None`
        is "we could not tell", which a caller renders as an ABSENT badge, never as a clean one."""
        return self.envelope.stale if self.envelope else None

    @property
    def badge(self) -> str | None:
        """The envelope's OWN sentence about the DATA's vintage. ⛔ Never composed from `stored_at`:
        that is the "week-old chart labelled cached 30 seconds ago" defect in one line."""
        return self.envelope.badge if self.envelope else None

    @property
    def cached_at_et(self) -> str:
        """When WE cached it, ET. ⛔ Derived from `stored_at`, never from the envelope — these are
        two different numbers and the member is shown both for exactly that reason."""
        return dt.datetime.fromtimestamp(self.stored_at, ET).strftime("%H:%M:%S")

    @property
    def cached_stamp(self) -> str:
        """What §3.6 says a cached reply carries: `cached 14:32:05 ET`."""
        return f"cached {self.cached_at_et} ET"

    @property
    def size_bytes(self) -> int:
        return artifact_bytes(self.data)


@dataclass
class _Entry:
    artifact: Artifact
    size: int
    #: Insertion sequence. Breaks a `stored_at` tie so eviction is DETERMINISTIC — two entries
    #: stored in the same clock tick must still evict in one defined order, or a test of eviction
    #: is a test of the clock's resolution.
    seq: int


class _Flight:
    """One in-flight production, shared by everyone who asked for the same key."""

    __slots__ = ("done", "value", "failed", "followers")

    def __init__(self) -> None:
        self.done = threading.Event()
        self.value: Any = None
        self.failed = False
        self.followers = 0


# ── the store ───────────────────────────────────────────────────────────────


class ArtifactCache:
    """Bounded, thread-safe, in-process. Satisfies `contracts.ArtifactStore`.

    ⛔ THREAD-SAFE BECAUSE THE RENDER WORKERS ARE REAL THREADS (§3.2: a dedicated
    `ThreadPoolExecutor`, `DISCORD_RENDER_WORKERS` default 6). Every mutation of the store and of
    the in-flight table happens under `self._lock`; the lock is NEVER held across `produce()` or
    across a follower's wait, because a coalescer that serialises the work it exists to share is
    worse than no coalescer at all."""

    def __init__(self, *, max_entries: int | None = None, max_bytes: int | None = None) -> None:
        self._lock = threading.Lock()
        self._store: dict[str, _Entry] = {}
        self._flights: dict[str, _Flight] = {}
        self._bytes = 0
        self._seq = 0
        self._max_entries = int(max_entries if max_entries is not None
                                else os.environ.get("DISCORD_RENDER_CACHE_MAX_ENTRIES", MAX_ENTRIES_DEFAULT))
        self._max_bytes = int(max_bytes if max_bytes is not None
                              else os.environ.get("DISCORD_RENDER_CACHE_BYTES", MAX_BYTES_DEFAULT))
        self._stats = {
            "hits": 0, "misses": 0, "expired": 0, "puts": 0, "refused_oversize": 0,
            "evicted_entries": 0, "evicted_bytes": 0,
            "coalesced_followers": 0, "follower_timeouts": 0, "leader_failures": 0,
        }

    # ── reads ───────────────────────────────────────────────────────────────

    def get(self, key: CacheKey, *, now: dt.datetime | None = None) -> Artifact | None:
        """The entry, or `None`. ⛔ NEVER AN EXCEPTION AND NEVER AN EXPIRED ENTRY — expiry is decided
        HERE so no call site has to remember to re-check one."""
        k = fingerprint(key)
        with self._lock:
            entry = self._store.get(k)
            if entry is None:
                self._stats["misses"] += 1
                return None
            if self._expired(entry, now):
                self._drop(k)
                self._stats["expired"] += 1
                self._stats["misses"] += 1
                return None
            self._stats["hits"] += 1
            return entry.artifact

    def _expired(self, entry: _Entry, now: dt.datetime | None = None) -> bool:
        """⛔ THE TTL IS READ OFF THE SESSION AT READ TIME, not off the session the entry was stored
        in. "How long may we keep serving our copy" is a question about the market NOW."""
        ttl = ttl_s(session_state(now))
        if ttl is None:
            return False
        return (_wall(now) - entry.artifact.stored_at) > ttl

    # ── writes ──────────────────────────────────────────────────────────────

    def put(self, key: CacheKey, artifact: Artifact) -> None:
        """Store it, then bring the cache back inside both caps.

        ⛔ THE ARTIFACT IS STORED AS GIVEN. Nothing here rebuilds the envelope, normalises `stale`,
        or re-stamps `stored_at` — a store that "tidies" what it was handed is the laundering defect
        in the module docstring, and it would be invisible because the tidied value looks healthier
        than the honest one."""
        k = fingerprint(key)
        size = artifact_bytes(artifact.data)
        with self._lock:
            if size > self._max_bytes:
                # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED. Accepting it would evict every other
                # entry to make room for something that still does not fit, so one oversized
                # payload would empty the cache for everybody.
                self._stats["refused_oversize"] += 1
                return
            if k in self._store:
                self._drop(k)
            self._seq += 1
            self._store[k] = _Entry(artifact=artifact, size=size, seq=self._seq)
            self._bytes += size
            self._stats["puts"] += 1
            self._evict_locked()

    def _drop(self, k: str) -> None:
        entry = self._store.pop(k, None)
        if entry is not None:
            self._bytes -= entry.size

    def _evict_locked(self) -> None:
        """Oldest `stored_at` first, ties broken by insertion sequence.

        ⛔ `stored_at` DECIDES EVICTION AND A HIT DOES NOT REFRESH IT. Making this an LRU by bumping
        `stored_at` on read would put a second meaning on one field: the entry would then claim to
        have been cached later than it was, and `cached_stamp` — which a member reads — would be a
        lie. An LRU here would need its own access clock; it does not have one because nothing has
        asked for one."""
        while self._store and (len(self._store) > self._max_entries or self._bytes > self._max_bytes):
            victim = min(self._store.items(), key=lambda kv: (kv[1].artifact.stored_at, kv[1].seq))[0]
            size = self._store[victim].size
            self._drop(victim)
            self._stats["evicted_entries"] += 1
            self._stats["evicted_bytes"] += size

    # ── coalescing ──────────────────────────────────────────────────────────

    def coalesce(self, key: CacheKey, produce: Callable[[], Any], *, budget_s: float) -> Any:
        """Run `produce()` once for everyone asking for `key` while it is in flight.

        The LEADER (the first caller) runs `produce()` and gets whatever it returns; an exception it
        raises **propagates to the leader**, because swallowing a caller's own failure turns a broken
        upstream into a confident `None`.

        A FOLLOWER waits at most `budget_s` and then gets `None` — a miss, never a hang, and never
        another job's traceback. ⭐ `budget_s` is the follower's OWN remaining deadline, which is
        what makes "never worse off than not coalescing" true rather than aspirational: the most it
        can spend waiting is what it would have spent producing.

        ⛔ `None` FROM `produce()` IS A MISS TOO, and deliberately indistinguishable from a timeout:
        one value means "no artifact" whatever produced the absence, so no call site grows a second
        way of asking the same question."""
        k = fingerprint(key)
        with self._lock:
            flight = self._flights.get(k)
            if flight is None:
                flight = _Flight()
                self._flights[k] = flight
                leader = True
            else:
                leader = False
                flight.followers += 1
                self._stats["coalesced_followers"] += 1

        if leader:
            try:
                value = produce()
            except BaseException:
                with self._lock:
                    self._flights.pop(k, None)
                    self._stats["leader_failures"] += 1
                flight.failed = True
                flight.done.set()          # ⛔ release the followers NOW; they must not wait out a
                raise                      #    budget for an answer that is never coming.
            with self._lock:
                # ⛔ RETIRED BEFORE THE EVENT IS SET. A caller arriving after completion must start a
                # NEW production, not join a finished flight and receive a value it never asked for.
                self._flights.pop(k, None)
            flight.value = value
            flight.done.set()
            return value

        if budget_s is None or budget_s <= 0:
            # No budget left is not a reason to wait; it is the reason not to.
            self._stats["follower_timeouts"] += 1
            return None
        if not flight.done.wait(budget_s):
            self._stats["follower_timeouts"] += 1
            return None
        if flight.failed:
            return None
        return flight.value

    # ── introspection ───────────────────────────────────────────────────────

    def stats(self) -> dict:
        with self._lock:
            out = dict(self._stats)
            out.update(entries=len(self._store), bytes=self._bytes, in_flight=len(self._flights),
                       max_entries=self._max_entries, max_bytes=self._max_bytes)
            return out

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._bytes = 0

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)


def fingerprint(key: CacheKey) -> str:
    """One string per `(command, args, vintage)`, and the ONE place that mapping is computed — any
    duck-typed key from another lane hashes the same way as ours.

    ⛔ An unknown vintage gets its own STABLE token rather than being dropped, so
    `(chart, NVDA, unknown)` and `(chart, NVDA, <a real stamp>)` are two entries and neither can
    ever be served for the other."""
    vintage = key.vintage if key.vintage is not None else _UNKNOWN_VINTAGE
    return hashlib.sha1("\x1f".join((key.command, key.args, vintage)).encode("utf-8")).hexdigest()


def ttl_s(state: str) -> float | None:
    """How long an entry may be served, by session state (D-02). `None` = no age expiry."""
    if state in CLOSED_STATES:
        return CLOSED_TTL_S
    if state == RTH:
        return RTH_TTL_S
    return EXTENDED_TTL_S


def _wall(now: dt.datetime | None = None) -> float:
    """The reading `stored_at` is compared against. Injectable so a TTL test is a test of the rule
    and not of how long the test took to run."""
    return time.time() if now is None else now.timestamp()


# ── the process-wide store ──────────────────────────────────────────────────

_DEFAULT: ArtifactCache | None = None
_DEFAULT_LOCK = threading.Lock()


def store() -> ArtifactCache:
    """The one cache this process uses. ⛔ A second instance is a second hit rate: two stores over
    one key space share nothing and each look half as useful as the one that should exist."""
    global _DEFAULT
    with _DEFAULT_LOCK:
        if _DEFAULT is None:
            _DEFAULT = ArtifactCache()
        return _DEFAULT
