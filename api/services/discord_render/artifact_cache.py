"""The artifact cache and the coalescer (03 §3.6, §3.2; step 2.5, Lane B).

⛔⛔ TWO TIERS, AND THE SECOND ONE IS THE POINT (D-02, OI-31). L1 is this process's heap; L2 is the
Railway volume. `web` deployed 1,077 times in the 14-day forensics window and the median pod lived
**8.4 minutes** (01 §I, class C-01) — so an in-memory-only cache is empty exactly when the first
render after a deploy needs it most, which is the busiest minute the pod ever has. L1 holds the hot
artifacts and dies with the pod; L2 survives the restart. ⭐ The KEY survives either way —
`(command, args, vintage)` is derived from the data, so the pod that comes up next computes the same
key for the same input. Determinism is what makes the hit POSSIBLE; durability is what makes it
HAPPEN on the first request rather than the second.

⛔ THE LOOKUP ORDER IS L1 → L2 → MISS, AND AN L2 HIT PROMOTES INTO L1. Without the promotion the
second request for a hot artifact pays the disk read again, and the two tiers are a slower one tier.
⛔ AND AN L1 EVICTION NEVER EVICTS L2. They are separate budgets over one key space: the heap is
64 MiB shared with every dashboard request, the volume is 512 MiB that nothing else wants. An L1
eviction that reached through to the volume would throw away the copy that survives the restart,
which is the only thing L2 exists for. Both directions are asserted in the rails.

⛔⛔ THE KEY'S THIRD PART IS THE DATA'S VINTAGE, NEVER THE WALL CLOCK. If it were "now", the same
closed-market input would cache under a new key every second: the hit rate would collapse to zero
and §3.10's determinism guarantee — the same input renders the same pixels — would be
**unobservable**, because no two runs would ever share an entry to compare. `key_for()` is the one
place a key is built and it cannot read a clock; `vintage_of(envelope)` is the one derivation.

⭐ WHY THIS IS WORTH ANYTHING AT ALL, since the caller must know the vintage to ask: the vintage is
cheap (the newest bar's `t`, already in hand after the bars fetch) and the RENDER is not (§2's
latency budget is dominated by the screenshot). The cache skips the expensive half after the cheap
half has already answered. It is not a fetch cache.

⛔ A MISS IS `None` — never an exception, never a stale hit the caller has to re-check, and never a
partially-written file. A store that raises on a miss makes every call site wrap it; a store that
hands back something expired makes every call site re-check it, and the one that forgets is the bug.

⛔⛔ A CORRUPT L2 ENTRY IS A MISS, RECORDED, NEVER SERVED AND NEVER RAISED. The write is atomic
(tmp file in the same directory, `fsync`, then `os.replace`), so a reader sees the whole entry or
the previous one — never half of one. The read verifies the payload's LENGTH and its SHA-256
against the header that travels with it, and verifies that the key the file claims is the key that
was asked for. A truncated file, a wrong digest, an unparseable header, a file moved to another
name: every one of them is a miss, counted in `l2_corrupt`, and the entry is discarded rather than
left to occupy the byte budget it can never be served from.

⛔ COALESCING IS PART OF THE CONTRACT, NOT AN OPTIMISATION (§3.2, §3.6). Ten members asking for the
same chart at the open otherwise produce ten renders on a pod with four render slots, and nine of
them wait for a slot to do work already being done. A follower waits on **its own** `budget_s` — the
budget it would have spent producing — so it is never worse off than not coalescing, and a follower
whose budget expires gets a **miss, not a hang**. Coalescing is an L1 concern by construction: a
flight is in-process work, and a second pod cannot join it.

⛔ `stored_at` AND THE ENVELOPE ARE DIFFERENT NUMBERS AND BOTH ARE KEPT, AT BOTH TIERS. `stored_at`
decides eviction; the envelope decides what the member is told. A cache that kept only `stored_at`
would hand back a week-old chart labelled "cached 30 seconds ago" — true, and completely misleading.

⛔ AND `stale=None` MUST SURVIVE THE ROUND TRIP AS `None` — through the heap AND through the file.
A cache that launders an unmeasured vintage into a clean `False` is the exact defect the three-valued
verdict exists to prevent (`freshness.Envelope`, `adapters/result.py`): the badge would be absent
because everything looked fine, rather than absent because nothing was known. On the L2 read path
that guard is explicit: a header with no envelope deserialises to `None` (unknown, NOT fresh), and a
`stale` that is neither a bool nor `None` is corruption, not a verdict.

Frozen shapes this satisfies: `contracts.CacheKey`, `contracts.CachedArtifact`,
`contracts.ArtifactStore`. `tests/test_discord_render_contracts.py` is what makes those load-bearing;
`tests/test_discord_render_artifact_cache.py` is what makes this module's own rules load-bearing, and
`docs/discord-render/instruments/mutation_harness_cache.py` proves those rails can fail.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import threading
import time
import uuid
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
#: L1, the web pod's own heap — shared with every dashboard request, which is why it is small.
#: ⛔ ITS OWN ENV NAME. It used to read `DISCORD_RENDER_CACHE_BYTES`, the name §3.6 gives the
#: **volume** cap; one variable cannot be two caps, and the direction of that collision was the
#: dangerous one — an operator setting the documented 512 MiB for the volume would have raised the
#: HEAP ceiling eightfold on a pod that OOMs members when it runs out.
L1_MAX_BYTES_DEFAULT = 64 * 1024 * 1024
#: L2, on the volume — §3.6's figure, and it is a disk budget, not a heap one.
L2_MAX_BYTES_DEFAULT = 512 * 1024 * 1024
#: What a non-bytes payload is charged at L1. See `artifact_bytes`.
NOMINAL_BYTES = 4096

_UNKNOWN_VINTAGE = "\x00unknown"

#: L2 on-disk format. Bumping it makes every older entry unreadable — which is a MISS, by design:
#: a format change must never be able to mis-read an old entry as a valid new one.
_FORMAT_VERSION = 1
_SUFFIX = ".art"
_TMP_PREFIX = ".tmp-"
#: A header longer than this is not a header. Bounds how much of a damaged file we will read looking
#: for a newline before calling it corrupt.
_MAX_HEADER_BYTES = 64 * 1024
#: An orphaned tmp file (a pod killed mid-write) is reaped once it is older than this. Not sooner:
#: a shorter window could delete a write another process is still making.
_TMP_REAP_S = 3600.0


def enabled() -> bool:
    """`RENDER_CACHE_ENABLED` (§3.11), read per call so a flip needs no redeploy.

    ⛔ AN **ENABLEMENT GATE**, NOT A KILL SWITCH — unset means OFF, and the polarity below says so.
    The distinction is not pedantry: a kill switch defaults ON because "nobody set it" and "somebody
    deliberately shut it down" must not be indistinguishable; an enablement gate defaults OFF because
    it ADDS behaviour and must not turn itself on in every environment the moment it merges. This
    docstring called it a kill switch while the code did the opposite, which is the kind of
    disagreement that gets read rather than run."""
    return str(os.environ.get("RENDER_CACHE_ENABLED", "")).strip().lower() in ("1", "true", "yes", "on")


def l2_root() -> str:
    """Where the durable tier lives (§3.6's `DISCORD_RENDER_CACHE_DIR`). `""` — or a blank env
    value — means L2 is off and L1 runs alone: the fail direction of a missing volume is a smaller
    cache, never a crash.

    ⛔⛔ THE `/data/...` DEFAULT IS AN INLINE LITERAL IN THE `.get()` CALL, AND IT MUST STAY ONE.
    The repo-root `conftest.py` derives every test-suite sandbox pin by AST
    (`shared_data_root_census`, clause A: "the literal IS the `.get()` default"), so a named
    constant here — `os.environ.get("DISCORD_RENDER_CACHE_DIR", L2_DIR_DEFAULT)` — reads as a path
    NO env var can move and lands in `unpinnable`, which `tests/test_shared_data_root_guard.py`
    refuses. Measured, not assumed: written that way it took `unpinnable` from 0 to 1. A path that
    cannot be pinned is a path a test run resolves against the owner's LIVE `C:\\data`.

    ⭐ Named `l2_root`, not `l2_dir`, so the constructor keyword `l2_dir=` cannot shadow the
    function that supplies its default."""
    return str(os.environ.get("DISCORD_RENDER_CACHE_DIR", "/data/discord_render_cache")).strip()


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
    """What an entry is charged against the L1 byte cap.

    ⛔ A NOMINAL CHARGE FOR ANYTHING THAT IS NOT BYTES, DELIBERATELY. `sys.getsizeof` on a dict or a
    list reports the SHALLOW size — a 2 MB flow card would be charged ~200 bytes — and a cap that
    under-counts by four orders of magnitude is not a cap. PNGs are what this cap exists for and
    they are bytes; everything else pays a flat, honest, deterministic fee.

    ⭐ L2 does NOT use this, and the difference is not an inconsistency: the volume tier SERIALISES
    the payload, so it knows the real byte count it is about to write. A guess is only necessary
    where the bytes are never produced."""
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


# ── expiry: ONE rule, both tiers ────────────────────────────────────────────


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


def expired_at(stored_at: float, now: dt.datetime | None = None) -> bool:
    """⛔ THE ONE EXPIRY RULE, AND BOTH TIERS CALL IT. "Same TTL rules at both tiers" is a property
    of there being one function rather than a promise two copies make to each other — two
    implementations of one boundary is `lesson_a_second_authority_over_one_value`, and the way it
    would fail here is the flattering one: the durable tier serving something the heap tier had
    already decided was too old.

    ⛔ THE TTL IS READ OFF THE SESSION AT READ TIME, not off the session the entry was stored in.
    "How long may we keep serving our copy" is a question about the market NOW."""
    ttl = ttl_s(session_state(now))
    if ttl is None:
        return False
    return (_wall(now) - stored_at) > ttl


# ── L2: the volume tier ─────────────────────────────────────────────────────


def _encode(data: Any) -> tuple[bytes, str]:
    """Payload → `(bytes, kind)`. Raises when the payload cannot be written durably at all."""
    if isinstance(data, (bytes, bytearray, memoryview)):
        return bytes(data), "bytes"
    if isinstance(data, str):
        return data.encode("utf-8"), "str"
    return json.dumps(data, separators=(",", ":"), sort_keys=True,
                      allow_nan=False).encode("utf-8"), "json"


def _decode(payload: bytes, kind: Any) -> Any:
    """`(bytes, kind)` → payload. Raises on anything it cannot read; the caller turns that into a
    MISS. ⛔ It never guesses: an unknown `kind` is corruption, not a reason to hand back raw bytes
    that a caller would then treat as a PNG."""
    if kind == "bytes":
        return payload
    if kind == "str":
        return payload.decode("utf-8")
    if kind == "json":
        return json.loads(payload.decode("utf-8"))
    raise ValueError(f"unknown payload kind {kind!r}")


def _envelope_from(raw: Any) -> Envelope | None:
    """⛔⛔ THE DEGRADED-NEVER-FRESH GUARD, AT THE DESERIALISATION BOUNDARY. A header with no
    envelope comes back as `None` — UNKNOWN, which is not fresh — and never as a fabricated clean
    one. And a `stale` that is neither a bool nor `None` is CORRUPTION, not a verdict: it would sail
    through `is None` (False) and through truthiness (True) and make every downstream badge decision
    wrong in the direction nobody notices. Raising here is what turns it into a miss."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("envelope is not an object")
    env = Envelope(**raw)                      # a wrong key set raises TypeError → a miss
    if env.stale is not None and not isinstance(env.stale, bool):
        raise ValueError(f"stale={env.stale!r} is neither a verdict nor 'unknown'")
    return env


class VolumeCache:
    """L2 — durable, on the Railway volume, LRU by BYTES (§3.6: `DISCORD_RENDER_CACHE_DIR`,
    `DISCORD_RENDER_CACHE_BYTES`, 512 MiB).

    ⛔ EVERY PUBLIC METHOD IS TOTAL: it returns a value or `False`, and it never raises at a caller.
    A durable tier that can throw makes the volume's health a property of every render path, which
    is the opposite of what a cache is for. A disk that is full, read-only, unmounted or missing
    degrades this to "always a miss" and leaves L1 running.

    ⛔ AND NOTHING IS CREATED UNTIL SOMETHING IS STORED. Constructing this must not touch the
    filesystem: `store()` builds the process-wide cache at import-adjacent time, and a constructor
    that did `makedirs` would create a directory under the shared data root simply by being
    imported — in a test run, in a script, on a box where `/data` is the owner's live files."""

    def __init__(self, root: str, *, max_bytes: int | None = None) -> None:
        self._root = str(root)
        self._lock = threading.Lock()
        #: fingerprint → (bytes on disk, stored_at). Seeded by one lazy scan; see `_ensure_index`.
        self._index: dict[str, tuple[int, float]] = {}
        self._bytes = 0
        self._indexed = False
        self._max_bytes = int(max_bytes if max_bytes is not None
                              else os.environ.get("DISCORD_RENDER_CACHE_BYTES", L2_MAX_BYTES_DEFAULT))
        self._stats = {
            "l2_hits": 0, "l2_misses": 0, "l2_expired": 0, "l2_puts": 0, "l2_corrupt": 0,
            "l2_refused_oversize": 0, "l2_refused_unserialisable": 0,
            "l2_write_errors": 0, "l2_read_errors": 0,
            "l2_evicted_entries": 0, "l2_evicted_bytes": 0,
        }

    # ── the index ───────────────────────────────────────────────────────────

    def _path(self, fp: str) -> str:
        # Sharded by the first two hex characters: 256 directories rather than one with thousands of
        # files in it, which some filesystems handle badly and every `ls` handles slowly.
        return os.path.join(self._root, fp[:2], fp + _SUFFIX)

    def _ensure_index(self) -> None:
        """One scan per process, so eviction knows what a previous pod left behind.

        ⭐ IT READS ONLY THE HEADER LINE of each file, never the payload — a 512 MiB cache of chart
        PNGs is a few thousand short reads, once, on the first L2 operation. Sizes come from the
        directory entry, which costs nothing.

        ⛔ A file whose header cannot be read is indexed at `stored_at = 0.0` rather than deleted
        here: it can never be served (the read path proves that separately) and this ordering makes
        it the FIRST thing evicted, so it cannot hold budget indefinitely. Deleting during an index
        scan would make a routine bookkeeping pass into a destructive one."""
        with self._lock:
            if self._indexed:
                return
            # Set BEFORE scanning: a scan that fails on a broken mount must degrade to an empty
            # index, not re-scan on every single request for the rest of the pod's life.
            self._indexed = True

        index: dict[str, tuple[int, float]] = {}
        total = 0
        for entry in self._scandir(self._root):
            if not self._is_dir(entry):
                continue
            for f in self._scandir(entry.path):
                name = f.name
                if name.startswith(_TMP_PREFIX):
                    self._reap_tmp(f)
                    continue
                if not name.endswith(_SUFFIX):
                    continue
                try:
                    size = f.stat().st_size
                except OSError:
                    continue
                index[name[: -len(_SUFFIX)]] = (size, self._stored_at_of(f.path))
                total += size

        with self._lock:
            self._index = index
            self._bytes = total

    @staticmethod
    def _scandir(path: str):
        try:
            with os.scandir(path) as it:
                return list(it)
        except OSError:
            return []

    @staticmethod
    def _is_dir(entry) -> bool:
        try:
            return entry.is_dir()
        except OSError:
            return False

    @staticmethod
    def _reap_tmp(entry) -> None:
        """An orphaned tmp file is a pod that died mid-write. Only reaped once it is old enough that
        nobody can still be writing it."""
        try:
            if time.time() - entry.stat().st_mtime > _TMP_REAP_S:
                os.remove(entry.path)
        except OSError:
            pass

    @staticmethod
    def _stored_at_of(path: str) -> float:
        """`stored_at` from the header alone, or `0.0` when it cannot be read.

        ⛔ `0.0` SORTS FIRST, so an unreadable entry is evicted before any real one. The broad
        `except` is deliberate and scoped: this is a bookkeeping read whose only possible answers
        are "a number" and "evict this first" — there is no third outcome worth propagating."""
        try:
            with open(path, "rb") as fh:
                line = fh.readline(_MAX_HEADER_BYTES)
            value = json.loads(line.decode("utf-8")).get("stored_at")
            return float(value) if isinstance(value, (int, float)) else 0.0
        except Exception:
            return 0.0

    # ── reads ───────────────────────────────────────────────────────────────

    def get(self, key: CacheKey, *, now: dt.datetime | None = None) -> Artifact | None:
        """The stored artifact, or `None`. ⛔ NEVER AN EXCEPTION, NEVER AN EXPIRED ENTRY, AND NEVER
        A CORRUPT ONE."""
        self._ensure_index()
        fp = fingerprint(key)
        try:
            with open(self._path(fp), "rb") as fh:
                blob = fh.read()
        except FileNotFoundError:
            self._bump("l2_misses")
            return None
        except OSError:
            self._bump("l2_read_errors", "l2_misses")
            return None

        try:
            artifact = self._parse(fp, key, blob)
        except Exception:
            # ⛔ EVERY failure of integrity lands here and is IDENTICAL to the caller: a miss. The
            # entry is discarded because it can never be served and must not hold byte budget.
            self._bump("l2_corrupt", "l2_misses")
            self.discard(fp)
            return None

        if expired_at(artifact.stored_at, now):
            self._bump("l2_expired", "l2_misses")
            self.discard(fp)
            return None

        self._bump("l2_hits")
        return artifact

    def _parse(self, fp: str, key: CacheKey, blob: bytes) -> Artifact:
        """Header + payload → an Artifact, or an exception. ⛔ EVERY CHECK IS A DIFFERENT WAY A FILE
        CAN BE WRONG and each one must reach the caller as a miss: an unterminated header, a header
        that is not JSON, a format version we cannot read, a payload whose LENGTH disagrees with the
        header (a truncated write), a payload whose SHA-256 disagrees (silent corruption), and a
        file claiming a different key than the one asked for (a file moved, restored, or copied)."""
        nl = blob.find(b"\n", 0, _MAX_HEADER_BYTES + 1)
        if nl < 0:
            raise ValueError("no header terminator in the first %d bytes" % _MAX_HEADER_BYTES)
        header = json.loads(blob[:nl].decode("utf-8"))
        if not isinstance(header, dict) or header.get("v") != _FORMAT_VERSION:
            raise ValueError("not a v%d artifact header" % _FORMAT_VERSION)

        payload = blob[nl + 1:]
        declared = header.get("len")
        if not isinstance(declared, int) or declared != len(payload):
            raise ValueError(f"payload is {len(payload)} bytes, header declares {declared!r}")
        digest = header.get("sha256")
        if not isinstance(digest, str) or hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError("payload sha256 does not match the header")

        claimed = (header.get("command"), header.get("args"), header.get("vintage"))
        if claimed != (key.command, key.args, key.vintage):
            raise ValueError(f"file at {fp} claims key {claimed!r}")

        stored_at = header.get("stored_at")
        if not isinstance(stored_at, (int, float)) or isinstance(stored_at, bool):
            raise ValueError(f"stored_at={stored_at!r} is not a reading")

        return Artifact(data=_decode(payload, header.get("kind")),
                        envelope=_envelope_from(header.get("envelope")),
                        stored_at=float(stored_at),
                        provider=header.get("provider"))

    # ── writes ──────────────────────────────────────────────────────────────

    def put(self, key: CacheKey, artifact: Artifact) -> bool:
        """Write it durably, then bring the volume back inside its byte cap. Returns whether it
        landed — never raises, because a full or read-only disk must cost a hit, not a render."""
        self._ensure_index()
        fp = fingerprint(key)
        try:
            payload, kind = _encode(artifact.data)
        except (TypeError, ValueError):
            # A payload that cannot be serialised is an L1-only artifact. Recorded rather than
            # silently dropped: a cache that never persists anything must be visible as such.
            self._bump("l2_refused_unserialisable")
            return False

        header = {
            "v": _FORMAT_VERSION,
            "command": key.command,
            "args": key.args,
            "vintage": key.vintage,
            "stored_at": float(artifact.stored_at),
            "provider": artifact.provider,
            # ⛔ THE ENVELOPE IS WRITTEN AS GIVEN, `stale` included and `None` preserved. Nothing
            # here normalises it; see `_envelope_from` for the read side of the same rule.
            "envelope": artifact.envelope.as_dict() if artifact.envelope is not None else None,
            "kind": kind,
            "len": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        try:
            blob = json.dumps(header, separators=(",", ":"), allow_nan=False).encode("utf-8")
        except (TypeError, ValueError):
            self._bump("l2_refused_unserialisable")
            return False
        blob = blob + b"\n" + payload

        if len(blob) > self._max_bytes:
            # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED — the same rule as L1, for the same reason:
            # it would evict everything else to make room for something that still does not fit.
            self._bump("l2_refused_oversize")
            return False

        try:
            self._write_atomic(fp, blob)
        except OSError:
            self._bump("l2_write_errors")
            return False

        with self._lock:
            previous = self._index.pop(fp, None)
            if previous is not None:
                self._bytes -= previous[0]
            self._index[fp] = (len(blob), float(artifact.stored_at))
            self._bytes += len(blob)
            self._stats["l2_puts"] += 1
            self._evict_locked()
        return True

    def _write_atomic(self, fp: str, blob: bytes) -> None:
        """⛔⛔ TMP FILE IN THE SAME DIRECTORY, `fsync`, THEN `os.replace` — AND NEVER A WRITE INTO
        THE LIVE PATH. `os.replace` is atomic within a filesystem, so a concurrent reader sees the
        whole previous entry or the whole new one; a writer that dies leaves a tmp file the reader
        never looks at, rather than a half-entry at the name the reader DOES look at. The `fsync` is
        what makes that true across a pod kill rather than only across a process exit — this pod is
        killed roughly 77 times a day (C-01), so "the bytes were in the page cache" is not a
        durability story here. A failed write removes its own tmp file."""
        path = self._path(fp)
        shard = os.path.dirname(path)
        os.makedirs(shard, exist_ok=True)
        tmp = os.path.join(shard, _TMP_PREFIX + uuid.uuid4().hex)
        try:
            with open(tmp, "wb") as fh:
                fh.write(blob)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    def discard(self, fp: str) -> None:
        """Remove one entry by fingerprint — used for a corrupt or expired file. Total."""
        with self._lock:
            previous = self._index.pop(fp, None)
            if previous is not None:
                self._bytes -= previous[0]
        try:
            os.remove(self._path(fp))
        except OSError:
            pass

    def _evict_locked(self) -> None:
        """LRU by BYTES: oldest `stored_at` first, ties broken by fingerprint.

        ⛔ THE TIE-BREAK IS THE FINGERPRINT, NOT AN INSERTION COUNTER. L1 can use a sequence number
        because its whole world is one process; L2's entries outlive the process that wrote them, so
        a counter would restart at zero and two pods would disagree about which of two same-instant
        entries goes first. The fingerprint is a stable total order every pod computes identically.

        ⛔ AND IT ONLY EVER REACHES THE VOLUME. Nothing in here touches the in-memory tier: an entry
        evicted from disk is still served from the heap until the heap evicts it too."""
        while self._index and self._bytes > self._max_bytes:
            victim = min(self._index.items(), key=lambda kv: (kv[1][1], kv[0]))[0]
            size = self._index.pop(victim)[0]
            self._bytes -= size
            self._stats["l2_evicted_entries"] += 1
            self._stats["l2_evicted_bytes"] += size
            try:
                os.remove(self._path(victim))
            except OSError:
                pass

    # ── introspection ───────────────────────────────────────────────────────

    def _bump(self, *names: str) -> None:
        with self._lock:
            for n in names:
                self._stats[n] += 1

    def stats(self) -> dict:
        self._ensure_index()
        with self._lock:
            out = dict(self._stats)
            out.update(l2_entries=len(self._index), l2_bytes=self._bytes,
                       l2_max_bytes=self._max_bytes, l2_dir=self._root)
            return out

    def clear(self) -> None:
        """Discard every durable entry. ⛔ ONLY EVER CALLED DELIBERATELY — see `ArtifactCache.clear`,
        where it is opt-in — because this is a delete against data on the volume."""
        self._ensure_index()
        with self._lock:
            fingerprints = list(self._index)
        for fp in fingerprints:
            self.discard(fp)

    def __len__(self) -> int:
        self._ensure_index()
        with self._lock:
            return len(self._index)


# ── the store ───────────────────────────────────────────────────────────────


class ArtifactCache:
    """Two-tier, thread-safe. L1 in this process, L2 on the volume. Satisfies
    `contracts.ArtifactStore`.

    ⛔ THREAD-SAFE BECAUSE THE RENDER WORKERS ARE REAL THREADS (§3.2: a dedicated
    `ThreadPoolExecutor`, `DISCORD_RENDER_WORKERS` default 6). Every mutation of the store and of
    the in-flight table happens under `self._lock`; the lock is NEVER held across `produce()`, across
    a follower's wait, or across an L2 disk read, because a coalescer that serialises the work it
    exists to share is worse than no coalescer at all — and a heap tier that blocks on a disk read is
    a disk tier."""

    def __init__(self, *, max_entries: int | None = None, max_bytes: int | None = None,
                 l2_dir: str | None = None, l2_max_bytes: int | None = None) -> None:
        self._lock = threading.Lock()
        self._store: dict[str, _Entry] = {}
        self._flights: dict[str, _Flight] = {}
        self._bytes = 0
        self._seq = 0
        self._max_entries = int(max_entries if max_entries is not None
                                else os.environ.get("DISCORD_RENDER_CACHE_MAX_ENTRIES", MAX_ENTRIES_DEFAULT))
        self._max_bytes = int(max_bytes if max_bytes is not None
                              else os.environ.get("DISCORD_RENDER_CACHE_MEM_BYTES", L1_MAX_BYTES_DEFAULT))
        root = l2_root() if l2_dir is None else str(l2_dir).strip()
        #: ⛔ `None` means "no durable tier", and a BLANK directory is how you ask for that. A pod
        #: without the volume mounted runs L1 alone rather than failing every render.
        self._l2 = VolumeCache(root, max_bytes=l2_max_bytes) if root else None
        self._stats = {
            "hits": 0, "misses": 0, "expired": 0, "puts": 0, "refused_oversize": 0,
            "evicted_entries": 0, "evicted_bytes": 0,
            "coalesced_followers": 0, "follower_timeouts": 0, "leader_failures": 0,
            "l2_promotions": 0, "l2_served_unpromoted": 0,
        }

    # ── reads ───────────────────────────────────────────────────────────────

    def get(self, key: CacheKey, *, now: dt.datetime | None = None) -> Artifact | None:
        """L1 → L2 → `None`. ⛔ NEVER AN EXCEPTION AND NEVER AN EXPIRED ENTRY — expiry is decided
        HERE, at both tiers, so no call site has to remember to re-check one."""
        k = fingerprint(key)
        with self._lock:
            entry = self._store.get(k)
            if entry is None:
                hit = None
            elif self._expired(entry, now):
                self._drop(k)
                self._stats["expired"] += 1
                hit = None
            else:
                self._stats["hits"] += 1
                hit = entry.artifact
        if hit is not None:
            return hit

        # ⛔ OUTSIDE THE LOCK. An L2 lookup is a disk read; holding the heap tier's lock across it
        # would make every concurrent reader wait on the filesystem.
        artifact = self._l2.get(key, now=now) if self._l2 is not None else None
        if artifact is None:
            with self._lock:
                self._stats["misses"] += 1
            return None

        self._promote(k, artifact)
        with self._lock:
            self._stats["hits"] += 1
        return artifact

    def _promote(self, k: str, artifact: Artifact) -> None:
        """⛔ AN L2 HIT BECOMES AN L1 ENTRY — that is what makes two tiers faster than one rather
        than slower. An artifact too large for the HEAP is still served from the volume; it just
        does not move in, and that is recorded separately rather than counted as an oversize
        refusal, because nothing was refused."""
        size = artifact_bytes(artifact.data)
        with self._lock:
            if size > self._max_bytes:
                self._stats["l2_served_unpromoted"] += 1
                return
            if k in self._store:
                self._drop(k)
            self._seq += 1
            self._store[k] = _Entry(artifact=artifact, size=size, seq=self._seq)
            self._bytes += size
            self._stats["l2_promotions"] += 1
            self._evict_locked()

    def _expired(self, entry: _Entry, now: dt.datetime | None = None) -> bool:
        return expired_at(entry.artifact.stored_at, now)

    # ── writes ──────────────────────────────────────────────────────────────

    def put(self, key: CacheKey, artifact: Artifact) -> None:
        """Store it in BOTH tiers, then bring each back inside its own caps.

        ⛔ THE ARTIFACT IS STORED AS GIVEN. Nothing here rebuilds the envelope, normalises `stale`,
        or re-stamps `stored_at` — a store that "tidies" what it was handed is the laundering defect
        in the module docstring, and it would be invisible because the tidied value looks healthier
        than the honest one.

        ⛔ AND L2'S OUTCOME NEVER CHANGES L1'S. An artifact too big for the heap still belongs on
        the volume, and a volume that refuses the write still leaves a working in-memory cache. The
        two caps are different budgets over different resources; making one gate the other would
        give the smaller of them authority over both."""
        k = fingerprint(key)
        size = artifact_bytes(artifact.data)
        with self._lock:
            if size > self._max_bytes:
                # ⛔ REFUSED, NOT ACCEPTED-AND-THEN-EVICTED. Accepting it would evict every other
                # entry to make room for something that still does not fit, so one oversized
                # payload would empty the cache for everybody.
                self._stats["refused_oversize"] += 1
            else:
                if k in self._store:
                    self._drop(k)
                self._seq += 1
                self._store[k] = _Entry(artifact=artifact, size=size, seq=self._seq)
                self._bytes += size
                self._stats["puts"] += 1
                self._evict_locked()
        if self._l2 is not None:
            self._l2.put(key, artifact)

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
        asked for one.

        ⛔⛔ AND IT NEVER REACHES L2. Evicting the durable copy because the HEAP filled up would
        throw away the only thing that survives the restart — the heap is 64 MiB shared with every
        dashboard request and fills constantly; the volume is 512 MiB that nothing else wants."""
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
        way of asking the same question.

        ⛔ AN L1 CONCERN BY CONSTRUCTION. A flight is work happening in THIS process; a second pod
        cannot join it, and pretending otherwise would need a lock on the volume — which is a
        different product with a different failure mode (a stale lock file after a pod is killed)."""
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
                       max_entries=self._max_entries, max_bytes=self._max_bytes,
                       l2_enabled=self._l2 is not None)
        if self._l2 is not None:
            out.update(self._l2.stats())
        return out

    def clear(self, *, l2: bool = False) -> None:
        """Empty the heap tier. ⛔ L2 IS OPT-IN AND DEFAULTS OFF: a stop is never a delete against
        durable data (`feedback_kill_switch_never_a_delete`), and the volume is bounded by its own
        LRU rather than by anybody's sweep. A caller that genuinely wants the durable copies gone
        has to say so."""
        with self._lock:
            self._store.clear()
            self._bytes = 0
        if l2 and self._l2 is not None:
            self._l2.clear()

    def __len__(self) -> int:
        """The HEAP tier's entry count — what the caps in this class bound. `stats()['l2_entries']`
        is the other one; they are different numbers and conflating them would make an L1 eviction
        look like data loss."""
        with self._lock:
            return len(self._store)


def fingerprint(key: CacheKey) -> str:
    """One string per `(command, args, vintage)`, and the ONE place that mapping is computed — any
    duck-typed key from another lane hashes the same way as ours, and the pod that comes up after a
    restart computes the same name for the same file.

    ⛔ An unknown vintage gets its own STABLE token rather than being dropped, so
    `(chart, NVDA, unknown)` and `(chart, NVDA, <a real stamp>)` are two entries and neither can
    ever be served for the other."""
    vintage = key.vintage if key.vintage is not None else _UNKNOWN_VINTAGE
    return hashlib.sha1("\x1f".join((key.command, key.args, vintage)).encode("utf-8")).hexdigest()


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
