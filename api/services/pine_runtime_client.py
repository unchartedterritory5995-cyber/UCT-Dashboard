"""W5-T11 -- THE ONE DOOR from the web pod to the pine-runtime service.

``docs/pine/SERVER-RUNTIME-DESIGN.md`` sections 2.3, 3.2, 3.3, 3.6 and 3.7. Every server lane
(alerts, scans, backtests, the rule record) reaches the service through ``PineRuntimeClient.run``
and nothing else. This module signs, sends, decodes, verifies length and digest, and maps EVERY
failure to a named guard of section 3.7. It never raises for a failed run and never returns a
value it did not verify: a job is either ``ok`` with full-length, digest-checked columns, or
``withheld`` with a run-wide refusal that names its guard.

THE RULES (each has its own rail in ``tests/test_pine_runtime_client.py``):

  1. NEVER A STALE VALUE. There is no last-good fallback anywhere. The caller's cache
     (``RunCache``, one per cycle) is keyed on the bars hash, so a value can only describe the
     bars it was computed on; a bars change is a cache miss. A non-deterministic stop (any
     ``runtime:server-*`` guard, ``runtime:time-budget``) is never cached.
  2. NEVER A PARTIAL VALUE. A column is ``bars.n`` rows or the job is withheld
     (``runtime:server-integrity``). A reply that does not answer every job once, in order, by
     id, withholds the whole chunk. One job failing withholds that job only; an ``ok`` job is
     never assembled from two runs (its digest is recomputed over what was received).
  3. A REFUSAL IS NEVER A "NO". A withheld job carries its guard and sentence; the lane decides
     what a withhold means for its surface (``runtime_server_lane.ServerLaneWithheld``).
  4. UNAUTHENTICATED IS NEVER RETRIED. 401/403 is ``runtime:server-auth`` at once.

THE WIRE (mirrors ``services/pine_runtime/protocol.mjs`` and ``auth.mjs`` of W5-T6, and the job
result shape of W5-T7's ``job.mjs``; the service re-checks everything, this side only refuses
early what the service would refuse):

  signature  header ``X-Pine-Runtime-Signature: t=<unix s>,v1=<hex>``,
             ``v1 = HMAC-SHA256(secret, "<t>." + sha256hex(body))``. The secret is the FIRST entry
             of the comma-separated ``PINE_RUNTIME_SERVICE_SECRET`` (rotation: the service accepts
             any listed entry, web signs with the first).
  doc        ``definition.doc`` is the document's canonical JSON TEXT
             (``json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)``) and
             ``doc_sha256`` the sha256 of its UTF-8 bytes. v1 always sends the doc.
  bars       each of t o h l c v is canonical base64 of n little-endian Float64 (the T3 column
             layout, ``pine_runtime_codec.encode_column``); every value finite; t strictly
             increasing. ``bars.sha256 = sha256(str("pine-runtime-bars/1") u32le(n) t o h l c v)``.
  engine     the five T3 identity fields (``pine_runtime_codec.ENGINE_FIELDS``), read from the
             modules that declare them (``caller_identity``), never retyped. An integer and its
             decimal string are one value.
  reply      ``{protocol, engine, results: [{job, status, columns?, refusals, digest?, cache?,
             ms?, instructions?}]}``. ``digest`` is the T3 ``column_digest`` over the service's
             identity, the columns and the refusals; it is REQUIRED on an ``ok`` result.

No user id, member email or source ever reaches a log line: logs carry a 12-hex doc prefix and
the owner pseudonym (``owner_pseudonym``), the S8 pattern.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import re
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from api.services import pine_runtime_codec as codec

log = logging.getLogger(__name__)

PROTOCOL = 1
PROFILES = ("alert", "on-demand", "backtest", "sweep", "record")
SIGNATURE_HEADER = "X-Pine-Runtime-Signature"
RUN_PATH = "/v1/run"
BARS_TAG = "pine-runtime-bars/1"
BAR_COLUMNS = ("t", "o", "h", "l", "c", "v")

# --- the guards of section 3.7 --------------------------------------------------
UNAVAILABLE = "runtime:server-unavailable"
AUTH = "runtime:server-auth"
ENGINE_MISMATCH = "runtime:server-engine-mismatch"
INTEGRITY = "runtime:server-integrity"
BUSY = "runtime:server-busy"
WORKER_OOM = "runtime:server-worker-oom"
FAILED = "runtime:server-failed"
TIME_BUDGET = "runtime:time-budget"

#: The guards THIS module mints (transport and verification). Each one is non-deterministic or
#: a bug, so none is ever cached.
CLIENT_GUARDS = frozenset({UNAVAILABLE, AUTH, ENGINE_MISMATCH, INTEGRITY, BUSY, FAILED})

#: Per-profile request deadline, seconds (design 3.4). One deadline per CHUNK.
DEADLINE_S = {"alert": 15.0, "on-demand": 60.0, "backtest": 60.0, "sweep": 120.0, "record": 60.0}
#: 429 retries per profile (3.7): an alert retries once inside the cycle's deadline; a scan chunk
#: up to 3 times with backoff; a backtest or a record answers at once.
BUSY_RETRIES = {"alert": 1, "on-demand": 3, "sweep": 3, "backtest": 0, "record": 0}
BUSY_BACKOFF_S = 0.5
#: Jobs per request: the nightly sweep is sent in chunks of 50 symbols (3.1); every other
#: profile up to the service's ``MAX_JOBS`` (= ``scan_run.MAX_RUN_SYMBOLS``, read, not retyped).
SWEEP_CHUNK = 50

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_DEF_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_JOB_ID = re.compile(r"^[\x20-\x7e]{1,128}$")
_TICKER = re.compile(r"^[\x21-\x7e]{1,32}$")
_EXCHANGE = re.compile(r"^[\x20-\x7e]{0,32}$")
_RESULT_KEYS = frozenset({"job", "status", "columns", "refusals", "digest", "cache", "ms", "instructions",
                          "warmup", "strategy", "strategy_sha256"})
#: W5-T7b `WARMUP_FIELDS`: an ok result's run-wide warm-up, the bars [0, withheldBars) a run off the
#: listing withheld. Required on ok, refused on withheld (T7b `RESULT_FIELDS`).
_WARMUP_KEYS = frozenset({"withheldBars"})
_REFUSAL_KEYS = frozenset({"key", "guard", "sentence", "bar", "limit"})
#: LIMITS r1: the engine limit a run-wide stop met (``CALL_COUNT``, ``WALL_TIME``), as a field;
#: optional, and never in the sentence.
_LIMIT_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def _max_jobs() -> int:
    from api.services.screener import scan_run
    return int(scan_run.MAX_RUN_SYMBOLS)


def _max_doc_bytes() -> int:
    from api.services import runtime_definitions
    return int(runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES)


# --- results --------------------------------------------------------------------

@dataclass(frozen=True)
class Refusal:
    key: str            # an output key, or "*" for the whole run
    guard: str
    sentence: str
    bar: Optional[int] = None
    limit: Optional[str] = None   # LIMITS r1: the engine limit a stop met, when it names one


@dataclass(frozen=True)
class JobResult:
    """One job's answer. ``ok``: ``columns`` holds every served key at full length.
    ``withheld``: ``columns`` is empty and ``refusals`` holds the run-wide ``*`` refusal."""
    job: str
    status: str
    columns: Mapping[str, Tuple[float, ...]] = field(default_factory=dict)
    refusals: Tuple[Refusal, ...] = ()
    digest: Optional[str] = None
    cache: Optional[str] = None
    #: ``{"withheldBars": k}`` on an ok result (W5-T7b); None on a withheld one. Not in the digest
    #: (the T3 preimage has no field for it), so it is checked by shape and range here.
    warmup: Optional[Mapping[str, int]] = None
    #: W9-T14: the run's ``strategy`` record (W9 design 3.2), decoded and hash-checked
    #: (``pine_runtime_codec.decode_strategy_record``), on an ok result of a job that asked for it
    #: (``want`` names ``codec.STRATEGY_WANT``); None otherwise. When asked for and absent, the
    #: result carries a refusal keyed ``#strategy`` instead (``refusal_for(codec.STRATEGY_WANT)``).
    strategy: Optional[Mapping[str, Any]] = None

    def run_refusal(self) -> Optional[Refusal]:
        return next((r for r in self.refusals if r.key == "*"), None)

    def refusal_for(self, key: str) -> Optional[Refusal]:
        """Why ``key`` has no column here, or None when it has one. The run-wide refusal first."""
        run = self.run_refusal()
        if run is not None:
            return run
        if self.status != "ok":
            return Refusal("*", INTEGRITY, "the job is withheld with no run-wide reason")
        if key in self.columns or (key == codec.STRATEGY_WANT and self.strategy is not None):
            return None
        own = next((r for r in self.refusals if r.key == key), None)
        if own is not None:
            return own
        return Refusal(key, INTEGRITY, f"the runtime service returned no output `{key}` and no reason for it")


def _withheld(job_id: str, guard: str, sentence: str) -> JobResult:
    return JobResult(job=job_id, status="withheld", refusals=(Refusal("*", guard, sentence, None),))


def cacheable(result: JobResult) -> bool:
    """May a caller keep this result for the rest of its cycle? Only a deterministic answer:
    never a client-minted withhold, never ``runtime:server-*``, never ``runtime:time-budget``."""
    for r in result.refusals:
        if r.guard == TIME_BUDGET or r.guard.startswith("runtime:server-"):
            return False
    return True


# --- jobs and bars --------------------------------------------------------------

@dataclass(frozen=True)
class Job:
    job: str
    ticker: str
    tf: str
    bars: Sequence[Mapping[str, Any]]
    exchange: str = ""
    want: Tuple[str, ...] = ()
    runtime_inputs: Mapping[str, Any] = field(default_factory=dict)
    newest_bar_is_forming: bool = False      # v1 evaluates closed bars only (ruling Q3)
    history_from_listing: bool = False
    #: W9-T14: the history window a strategy (broker) run takes, as the CALLER reads it from
    #: ``bars_window.HISTORY_WINDOW_BARS`` (design 3.4). None sends no window (every job as before;
    #: a broker run told none refuses ``runtime:strategy-start``). Never defaulted here.
    history_window_bars: Optional[int] = None


class _Refuse(Exception):
    """Internal: withhold the job(s) in hand with this guard and sentence."""

    def __init__(self, guard: str, sentence: str):
        super().__init__(sentence)
        self.guard = guard
        self.sentence = sentence


def _u32(n: int) -> bytes:
    return struct.pack("<I", n)


def _lp(text: str) -> bytes:
    b = text.encode("utf-8")
    return _u32(len(b)) + b


def bars_sha256(n: int, cols: Mapping[str, bytes]) -> str:
    """``protocol.mjs::barsSha256``: sha256(str(BARS_TAG) u32le(n) t o h l c v)."""
    h = hashlib.sha256(_lp(BARS_TAG) + _u32(n))
    for k in BAR_COLUMNS:
        h.update(cols[k])
    return h.hexdigest()


def encode_bars(bars: Sequence[Mapping[str, Any]]) -> Tuple[int, Dict[str, bytes], str]:
    """``(n, {col: canonical bytes}, sha256)`` for one job's bars, or ``_Refuse`` (integrity)
    when a value is not a finite number or ``t`` is not strictly increasing: the service
    refuses both, and a hole in the bars is never sent as na."""
    if not isinstance(bars, (list, tuple)) or len(bars) < 1:
        raise _Refuse(INTEGRITY, "the job has no bars to run on")
    cols: Dict[str, List[float]] = {k: [] for k in BAR_COLUMNS}
    for i, b in enumerate(bars):
        if not isinstance(b, Mapping):
            raise _Refuse(INTEGRITY, f"bar {i} is not a bar")
        for k in BAR_COLUMNS:
            x = b.get(k)
            if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
                raise _Refuse(INTEGRITY, f"bar {i} holds a {k} that is not a finite number")
            cols[k].append(float(x))
        if i > 0 and not cols["t"][i] > cols["t"][i - 1]:
            raise _Refuse(INTEGRITY, f"the bars' times are not strictly increasing at bar {i}")
    enc = {k: codec.encode_column(cols[k], f"bars.{k}") for k in BAR_COLUMNS}
    return len(bars), enc, bars_sha256(len(bars), enc)


def canonical_doc_text(doc: Mapping[str, Any]) -> str:
    """The document as sent: canonical JSON text (protocol.mjs: the service hashes these bytes)."""
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _inputs_of(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, Mapping) or len(raw) > 256:
        raise _Refuse(INTEGRITY, "the script's inputs are not a map of at most 256 values")
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or not 1 <= len(k) <= 128:
            raise _Refuse(INTEGRITY, "an input name is not 1-128 characters")
        ok = (isinstance(v, bool) or (isinstance(v, (int, float)) and math.isfinite(v))
              or (isinstance(v, str) and len(v) <= 4096))
        if not ok:
            raise _Refuse(INTEGRITY, f"input `{k}` is not a finite number, a short string or a boolean")
        out[k] = v
    return out


def _ctx_of(job: Job) -> Dict[str, Any]:
    ctx = {"newestBarIsForming": bool(job.newest_bar_is_forming),
           "historyFromListing": bool(job.history_from_listing),
           "runtimeInputs": _inputs_of(job.runtime_inputs)}
    # W9-T14: the window, only when the caller states one (protocol.mjs: an optional positive int), so
    # every existing request body and cache key is byte-unchanged.
    w = job.history_window_bars
    if w is not None:
        if isinstance(w, bool) or not isinstance(w, int) or w < 1:
            raise _Refuse(INTEGRITY, "the history window is not a positive whole number of bars")
        ctx["historyWindowBars"] = w
    return ctx


def result_key(identity: Mapping[str, Any], doc_sha256: str, job: Job, ctx: Mapping[str, Any],
               bars_sha: str, profile: str) -> str:
    """The caller's cache key (design 3.3): engine identity, the document, the canonical context
    (with the symbol and timeframe the run reads), the BARS HASH, the sorted wanted keys and the
    profile. Every part is length-prefixed, so no two different inputs share a key."""
    parts = ["pine-runtime-caller-cache/1"]
    parts += [str(identity.get(f)) for f in codec.ENGINE_FIELDS]
    parts += [doc_sha256, job.tf, job.ticker, job.exchange,
              json.dumps(ctx, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
              bars_sha, json.dumps(sorted(job.want)), profile]
    h = hashlib.sha256()
    for p in parts:
        h.update(_lp(p))
    return h.hexdigest()


class RunCache:
    """Per-cycle results, keyed by ``result_key``. Create one per cycle and drop it; nothing in
    this module keeps one across cycles. ``put`` keeps only ``cacheable`` results."""

    def __init__(self) -> None:
        self._d: Dict[str, JobResult] = {}

    def get(self, key: str) -> Optional[JobResult]:
        return self._d.get(key)

    def put(self, key: str, result: JobResult) -> None:
        if cacheable(result):
            self._d[key] = result

    def __len__(self) -> int:
        return len(self._d)


# --- identity, owner, signature -------------------------------------------------

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_ENGINE_DIR = os.path.join(_REPO, "app", "src", "components", "chart", "engine")
FRONTEND_JS = os.path.join(_ENGINE_DIR, "ast", "pineRuntimeFrontend.js")
IR_JS = os.path.join(_ENGINE_DIR, "runtime", "ir.js")
BUNDLE_PATH = os.path.join(_REPO, "app", "dist-server", "pine-runtime.mjs")


def _declared(path: str, name: str) -> Optional[Any]:
    """The value of ``export const <name> = <int | 'str'>`` declared exactly once, else None."""
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return None
    rx = re.compile(r"^export\s+const\s+" + re.escape(name)
                    + r"\s*=\s*(?:(\d+)|'([^'\\]+)'|\"([^\"\\]+)\")\s*;?\s*(?://.*)?$", re.M)
    found = rx.findall(text)
    if len(found) != 1:
        return None
    num, s1, s2 = found[0]
    return int(num) if num else (s1 or s2)


def caller_identity(*, frontend_js: str = FRONTEND_JS, ir_js: str = IR_JS, bundle: str = BUNDLE_PATH,
                    engine_js: Any = None) -> Optional[Dict[str, Any]]:
    """The web pod's engine identity (design 2.3), READ from the modules that declare it, or None
    when any part is unreadable (then every run is withheld by name: the pod cannot say which
    engine it expects)."""
    from api.services import user_definitions
    ident: Dict[str, Any] = {
        "script_engine": user_definitions.read_script_engine_version(engine_js),
        "runtime_language": _declared(frontend_js, "RUNTIME_FRONTEND_LANGUAGE"),
        "runtime_frontend": _declared(frontend_js, "RUNTIME_FRONTEND_VERSION"),
        "runtime_ir": _declared(ir_js, "RUNTIME_IR_VERSION"),
    }
    try:
        with open(bundle, "rb") as fh:
            ident["bundle_sha256"] = hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None
    if any(v is None for v in ident.values()):
        return None
    return ident


def same_identity(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    """protocol.mjs::sameIdentity: every field's decimal/string form equal (T3's rule)."""
    return all(str(a.get(k)) == str(b.get(k)) for k in codec.ENGINE_FIELDS)


def owner_pseudonym(secret: str, owner_id: Any) -> str:
    """``hmac:<32 hex>`` for the definition's owner (quotas and telemetry, never the id; S8)."""
    mac = hmac.new(secret.encode("utf-8"), b"pine-runtime-owner/1\x00" + str(owner_id or "").encode("utf-8"),
                   hashlib.sha256).hexdigest()
    return "hmac:" + mac[:32]


#: The service remembers every accepted signature for its skew window (auth.mjs ``ReplayGuard``)
#: and refuses a repeat as a replay (401). Two IDENTICAL bodies signed in the same second (two
#: alerts on one plot in one cycle, a 429 resend) would share a signature, so the same body is
#: never signed twice with one timestamp: ``signing_time`` hands out a later second instead.
#: Process-wide, because the lanes build a client per call.
REPLAY_WINDOW_S = 60
_SIGNED: Dict[str, int] = {}
_SIGNED_LOCK = threading.Lock()


def signing_time(body_sha: str, now: int) -> int:
    """The timestamp to sign ``body_sha`` with: ``now``, or one second past the last time this
    same body was signed when that is not earlier."""
    with _SIGNED_LOCK:
        for k in [k for k, t in _SIGNED.items() if t < now - 2 * REPLAY_WINDOW_S]:
            del _SIGNED[k]
        t = max(now, _SIGNED.get(body_sha, now - 1) + 1)
        _SIGNED[body_sha] = t
        return t


def _forget_signing_times() -> None:
    """Tests only: start from an empty memory."""
    with _SIGNED_LOCK:
        _SIGNED.clear()


def sign(secret: str, t: int, body: bytes) -> str:
    """The header value (auth.mjs::signHeader)."""
    v1 = hmac.new(secret.encode("utf-8"), f"{t}.{hashlib.sha256(body).hexdigest()}".encode("ascii"),
                  hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


# --- transport ------------------------------------------------------------------

#: ``(url, body, headers, timeout_s) -> (status, reply bytes)``; raises on connect/DNS/timeout.
Transport = Callable[[str, bytes, Mapping[str, str], float], Tuple[int, bytes]]


def httpx_transport(url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> Tuple[int, bytes]:
    """The production transport: one POST, no redirects, no retries of its own."""
    import httpx
    resp = httpx.post(url, content=body, headers=dict(headers), timeout=timeout, follow_redirects=False)
    return resp.status_code, resp.content


# --- the client -----------------------------------------------------------------

class PineRuntimeClient:
    """The one door. ``url``, ``secret`` and ``identity`` are given (``client_from_env`` reads
    them); any of them missing means every run is withheld ``runtime:server-unavailable`` and
    no request is sent."""

    def __init__(self, *, url: Optional[str], secret: Optional[str], identity: Optional[Mapping[str, Any]],
                 transport: Optional[Transport] = None, clock: Callable[[], float] = time.time,
                 monotonic: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.url = (url or "").strip() or None
        self.secret = (secret or "").strip() or None
        self.identity = dict(identity) if identity else None
        self.transport = transport or httpx_transport
        self.clock, self.monotonic, self.sleep = clock, monotonic, sleep

    # -- the batch API ------------------------------------------------------------
    def run(self, *, def_id: str, version: int, doc: Mapping[str, Any], owner_id: Any, profile: str,
            jobs: Sequence[Job], cache: Optional[RunCache] = None) -> List[JobResult]:
        """One result per job, in order. Never raises for a failed run."""
        if profile not in PROFILES:
            raise ValueError(f"profile {profile!r} is not one of {PROFILES}")
        if not self.url or not self.secret or not self.identity:
            missing = [n for n, v in (("the service URL", self.url), ("the signing secret", self.secret),
                                      ("this build's engine identity", self.identity)) if not v]
            why = (f"the runtime service is not reachable from this server ({', '.join(missing)} missing), "
                   "so nothing is computed")
            return [_withheld(j.job, UNAVAILABLE, why) for j in jobs]
        try:
            if not isinstance(def_id, str) or not _DEF_ID.match(def_id):
                raise _Refuse(INTEGRITY, "the definition id is not one the service accepts")
            if isinstance(version, bool) or not isinstance(version, int) or version < 0:
                raise _Refuse(INTEGRITY, "the definition version is not a non-negative integer")
            if not isinstance(doc, dict):
                raise _Refuse(INTEGRITY, "the stored document is not an object")
            doc_text = canonical_doc_text(doc)
            if len(doc_text.encode("utf-8")) > _max_doc_bytes():
                raise _Refuse(INTEGRITY, "the document is larger than the service accepts")
        except (_Refuse, TypeError, ValueError) as e:
            g, s = (e.guard, e.sentence) if isinstance(e, _Refuse) else (INTEGRITY, "the document is not JSON")
            self._loud(g, s, None)
            return [_withheld(j.job, g, s) for j in jobs]
        doc_sha = hashlib.sha256(doc_text.encode("utf-8")).hexdigest()
        owner = owner_pseudonym(self.secret, owner_id)

        out: List[Optional[JobResult]] = [None] * len(jobs)
        pending: List[Tuple[int, Job, Dict[str, Any], str]] = []
        seen = set()
        for i, j in enumerate(jobs):
            try:
                if not isinstance(j.job, str) or not _JOB_ID.match(j.job) or j.job in seen:
                    raise _Refuse(INTEGRITY, "the job id is missing, malformed or repeated")
                seen.add(j.job)
                if not isinstance(j.ticker, str) or not _TICKER.match(j.ticker) \
                        or not isinstance(j.exchange, str) or not _EXCHANGE.match(j.exchange):
                    raise _Refuse(INTEGRITY, "the symbol is not one the service accepts")
                if not isinstance(j.tf, str) or not j.tf:
                    raise _Refuse(INTEGRITY, "the job has no timeframe")
                n, cols, bsha = encode_bars(j.bars)
                ctx = _ctx_of(j)
                wire = {"job": j.job, "symbol": {"ticker": j.ticker, "exchange": j.exchange}, "tf": j.tf,
                        "bars": {"n": n, **{k: codec.bytes_to_b64(cols[k]) for k in BAR_COLUMNS}, "sha256": bsha},
                        "ctx": ctx, "want": list(j.want)}
                key = result_key(self.identity, doc_sha, j, ctx, bsha, profile)
            except _Refuse as e:
                out[i] = _withheld(getattr(j, "job", ""), e.guard, e.sentence)
                continue
            hit = cache.get(key) if cache is not None else None
            if hit is not None:
                out[i] = hit
                continue
            pending.append((i, j, wire, key))

        size = SWEEP_CHUNK if profile == "sweep" else _max_jobs()
        for start in range(0, len(pending), size):
            chunk = pending[start:start + size]
            body = {"protocol": PROTOCOL, "profile": profile, "engine": dict(self.identity),
                    "definition": {"def_id": def_id, "version": version, "doc_sha256": doc_sha, "doc": doc_text},
                    "owner": owner, "jobs": [w for (_, _, w, _) in chunk]}
            answers = self._run_chunk(body, [(j, w["bars"]["n"]) for (_, j, w, _) in chunk], profile, doc_sha, owner)
            for (i, _, _, key), res in zip(chunk, answers):
                out[i] = res
                if cache is not None:
                    cache.put(key, res)
        return [r for r in out if r is not None]

    # -- one request --------------------------------------------------------------
    def _run_chunk(self, body: Dict[str, Any], jobs: List[Tuple[Job, int]], profile: str,
                   doc_sha: str, owner: str) -> List[JobResult]:
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        deadline = self.monotonic() + DEADLINE_S[profile]
        retries = BUSY_RETRIES[profile]
        body_sha = hashlib.sha256(raw).hexdigest()
        attempt = 0
        while True:
            try:
                status, payload = self._post(raw, deadline, signing_time(body_sha, int(self.clock())))
                if status == 200:
                    return self._decode(payload, jobs, doc_sha, owner)
                raise self._refusal_for_status(status, payload)
            except _Refuse as e:
                if e.guard == BUSY and attempt < retries:
                    wait = BUSY_BACKOFF_S * (2 ** attempt)
                    if self.monotonic() + wait < deadline:
                        attempt += 1
                        self.sleep(wait)
                        continue
                self._loud(e.guard, e.sentence, doc_sha, owner)
                return [_withheld(j.job, e.guard, e.sentence) for (j, _) in jobs]

    def _post(self, raw: bytes, deadline: float, t: int) -> Tuple[int, bytes]:
        remaining = deadline - self.monotonic()
        if remaining <= 0:
            raise _Refuse(UNAVAILABLE, "the runtime service did not answer inside this lane's deadline, "
                                       "so nothing is computed")
        headers = {"content-type": "application/json", SIGNATURE_HEADER: sign(self.secret, t, raw)}
        try:
            status, payload = self.transport(self.url.rstrip("/") + RUN_PATH, raw, headers, remaining)
        except Exception as e:  # noqa: BLE001 -- connect, DNS, timeout: every one is "unavailable"
            raise _Refuse(UNAVAILABLE, f"the runtime service could not be reached ({type(e).__name__}), "
                                       "so nothing is computed")
        if isinstance(status, bool) or not isinstance(status, int) or not isinstance(payload, (bytes, bytearray)):
            raise _Refuse(UNAVAILABLE, "the runtime service gave no reply, so nothing is computed")
        return status, bytes(payload)

    @staticmethod
    def _wire_guard(payload: bytes) -> Optional[str]:
        try:
            err = json.loads(payload.decode("utf-8")).get("error")
            g = err.get("guard") if isinstance(err, dict) else None
            return g if isinstance(g, str) else None
        except Exception:  # noqa: BLE001 -- an unreadable error body names no guard
            return None

    def _refusal_for_status(self, status: int, payload: bytes) -> _Refuse:
        guard = self._wire_guard(payload)
        if status in (401, 403):
            return _Refuse(AUTH, "the runtime service refused this server's signature, so nothing runs")
        if status == 429:
            return _Refuse(BUSY, "the runtime service is at capacity, so this run has no value this time")
        if status == 409 and guard == ENGINE_MISMATCH:
            return _Refuse(ENGINE_MISMATCH, "the runtime service runs a different engine than this server "
                                            "(a deploy is in progress), so nothing is computed")
        if status == 500 and guard in (FAILED, WORKER_OOM):
            return _Refuse(guard, "the runtime service failed on this request, so no job in it has a value")
        if 500 <= status <= 599:
            return _Refuse(UNAVAILABLE, f"the runtime service is unavailable (HTTP {status}), so nothing is computed")
        if status in (400, 409, 413, 422):
            return _Refuse(INTEGRITY, f"the runtime service refused this server's request as malformed "
                                      f"(HTTP {status}, {guard or 'no guard'}), so nothing is computed")
        return _Refuse(UNAVAILABLE, f"the runtime service answered HTTP {status}, so nothing is computed")

    # -- the reply ----------------------------------------------------------------
    def _decode(self, payload: bytes, jobs: List[Tuple[Job, int]], doc_sha: str, owner: str) -> List[JobResult]:
        try:
            reply = json.loads(payload.decode("utf-8"))
        except Exception:  # noqa: BLE001
            raise _Refuse(INTEGRITY, "the runtime service's reply is not JSON, so no job in it has a value")
        if not isinstance(reply, dict) or set(reply) != {"protocol", "engine", "results"} \
                or reply["protocol"] != PROTOCOL:
            raise _Refuse(INTEGRITY, "the runtime service's reply is not protocol 1, so no job in it has a value")
        engine = reply["engine"]
        if not isinstance(engine, dict) or set(engine) != set(codec.ENGINE_FIELDS):
            raise _Refuse(INTEGRITY, "the runtime service's reply names no engine, so no job in it has a value")
        if not same_identity(engine, self.identity):
            raise _Refuse(ENGINE_MISMATCH, "the runtime service computed on a different engine than this server "
                                           "expects (a deploy is in progress), so nothing is used")
        results = reply["results"]
        if not isinstance(results, list) or len(results) != len(jobs) \
                or any(not isinstance(r, dict) or r.get("job") != j.job for r, (j, _) in zip(results, jobs)):
            raise _Refuse(INTEGRITY, "the runtime service did not answer every job once, in order, so no job in "
                                     "this request has a value")
        out = []
        for r, (j, n) in zip(results, jobs):
            try:
                out.append(self._result(r, j, n))
            except _Refuse as e:
                self._loud(e.guard, e.sentence, doc_sha, owner)
                out.append(_withheld(j.job, e.guard, e.sentence))
        return out

    def _result(self, r: Dict[str, Any], job: Job, n: int) -> JobResult:
        def bad(why: str) -> _Refuse:
            return _Refuse(INTEGRITY, f"the runtime service's answer {why}, so this job has no value")

        if not set(r) <= _RESULT_KEYS or r.get("status") not in ("ok", "withheld"):
            raise bad("is not a job result")
        raw_refusals = r.get("refusals", [])
        if not isinstance(raw_refusals, list):
            raise bad("carries no refusal list")
        refusals = []
        for x in raw_refusals:
            if not isinstance(x, dict) or not set(x) <= _REFUSAL_KEYS:
                raise bad("carries a malformed refusal")
            key, guard, sentence, bar = x.get("key"), x.get("guard"), x.get("sentence", ""), x.get("bar")
            if not (isinstance(key, str) and key and isinstance(guard, str) and guard and isinstance(sentence, str)):
                raise bad("carries a malformed refusal")
            if bar is not None and (isinstance(bar, bool) or not isinstance(bar, int) or bar < 0):
                raise bad("carries a malformed refusal")
            limit = x.get("limit")
            if limit is not None and not (isinstance(limit, str) and _LIMIT_NAME.match(limit)):
                raise bad("carries a malformed refusal")
            refusals.append(Refusal(key, guard, sentence, bar, limit))
        wire_refusals = [{"key": x.key, "guard": x.guard, "bar": x.bar} for x in refusals]
        digest = r.get("digest")
        cache = r.get("cache") if isinstance(r.get("cache"), str) else None
        run_wide = [x for x in refusals if x.key == "*"]

        if r["status"] == "withheld":
            if "strategy" in r or "strategy_sha256" in r:
                raise bad("withholds the job and carries a strategy record")
            if "warmup" in r:
                raise bad("withholds the job and reports a warm-up")
            if r.get("columns") or not run_wide:
                raise bad("withholds the job without a run-wide reason, or with values")
            if digest is not None and digest != self._digest({}, wire_refusals):
                raise bad("does not match its digest")
            return JobResult(job=job.job, status="withheld", refusals=tuple(refusals), digest=digest, cache=cache)

        if run_wide:
            raise bad("is ok and withheld at once")
        w = r.get("warmup")
        if not isinstance(w, dict) or set(w) != _WARMUP_KEYS:
            raise bad("carries no warm-up of exactly {withheldBars}")
        wb = w["withheldBars"]
        if isinstance(wb, bool) or not isinstance(wb, int) or wb < 0 or wb > n:
            raise bad(f"reports a warm-up that is not a bar count from 0 to {n}")
        cols_in = r.get("columns", {})
        if not isinstance(cols_in, dict):
            raise bad("carries no column map")
        columns: Dict[str, Tuple[float, ...]] = {}
        refused_keys = {x.key for x in refusals}
        for key, text in cols_in.items():
            if key in refused_keys:
                raise bad(f"both serves and refuses output `{key}`")
            if job.want and key not in job.want:
                raise bad(f"serves output `{key}`, which was not asked for")
            try:
                col = codec.decode_column(codec.b64_to_bytes(text), rows=n)
            except codec.CodecError:
                raise bad(f"holds output `{key}` that is not exactly {n} canonical values")
            if any(math.isinf(v) for v in col):
                raise bad(f"holds output `{key}` with a non-finite value")
            columns[key] = tuple(col)
        # r2: THE ENGINE BLANKS ITS OWN WARM-UP (runtimeWarmupCurtain.test.js): bars [0, withheldBars)
        # are na in every column of an ok run. A value there means the service and the engine
        # disagree, so it is refused by name, never masked here (a mask would be a second curtain).
        for key, col in columns.items():
            if any(v == v for v in col[:wb]):
                raise bad(f"serves output `{key}` with a value inside its own warm-up")
        # W9-T14: the record rides beside the columns, never as one, and only when asked for
        strategy = None
        if "strategy" in r or "strategy_sha256" in r:
            if codec.STRATEGY_WANT not in job.want:
                raise bad("serves a strategy record that was not asked for")
            if codec.STRATEGY_WANT in refused_keys:
                raise bad("both serves and refuses the strategy record")
            try:
                strategy = codec.decode_strategy_record(r.get("strategy"), r.get("strategy_sha256"))
            except codec.CodecError as e:
                raise bad(f"carries a strategy record that does not verify ({e})")
        if codec.STRATEGY_WANT in columns:
            raise bad("serves the strategy record as a column")
        for key in job.want:
            if key == codec.STRATEGY_WANT and strategy is not None:
                continue
            if key not in columns and key not in refused_keys:
                raise bad(f"neither serves nor refuses output `{key}`")
        if not isinstance(digest, str) or not _HEX64.match(digest) \
                or digest != self._digest(columns, wire_refusals):
            raise bad("does not match its digest")
        return JobResult(job=job.job, status="ok", columns=columns, refusals=tuple(refusals),
                         digest=digest, cache=cache, warmup={"withheldBars": wb}, strategy=strategy)

    def _digest(self, columns: Mapping[str, Sequence[float]], refusals: List[Dict[str, Any]]) -> str:
        """The T3 digest of what was RECEIVED. The row count is not re-checked here: the decode above
        (``rows=n``) is the one length check."""
        try:
            return codec.column_digest(self.identity, dict(columns), refusals)
        except codec.CodecError:
            return ""

    @staticmethod
    def _loud(guard: str, sentence: str, doc_sha: Optional[str], owner: Optional[str] = None) -> None:
        """Integrity is a bug and is logged at ERROR; every other withhold at WARNING. Never an id,
        an email or a source: the doc prefix and the owner pseudonym only."""
        lvl = logging.ERROR if guard == INTEGRITY else logging.WARNING
        log.log(lvl, "[pine-runtime-client] withheld guard=%s doc=%s owner=%s: %s",
                guard, (doc_sha or "-")[:12], owner or "-", sentence)


def client_from_env(transport: Optional[Transport] = None, identity: Any = "read") -> PineRuntimeClient:
    """A client configured from the environment, read per call. The variable NAMES are W5-T12's
    (``runtime_definitions.SERVICE_URL_ENV`` / ``SERVICE_SECRET_ENV``), asked through the module,
    never retyped here; a build without them gets an unconfigured client, which withholds every
    run by name. The secret is the first comma-separated entry (design 3.6 rotation)."""
    from api.services import runtime_definitions
    url_env = getattr(runtime_definitions, "SERVICE_URL_ENV", None)
    secret_env = getattr(runtime_definitions, "SERVICE_SECRET_ENV", None)
    url = os.environ.get(url_env, "") if url_env else ""
    secret = (os.environ.get(secret_env, "") if secret_env else "").split(",")[0].strip()
    ident = caller_identity() if identity == "read" else identity
    return PineRuntimeClient(url=url, secret=secret, identity=ident, transport=transport)
