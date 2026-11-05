"""A fake pine-runtime service for the W5-T11 rails. NO NETWORK: it is a ``Transport`` callable
(``pine_runtime_client.Transport``) that answers in-process.

It behaves as W5-T6's door (``services/pine_runtime/server.mjs`` + ``protocol.mjs`` +
``auth.mjs``) on the points the client depends on, re-derived HERE independently of the client
so a client bug cannot be mirrored by its own fake: the signature over the body, the replay set,
the closed top-level schema, the engine identity, the doc hash and the bars hash. A run computes
``script(cols)`` per wanted key and answers in W5-T7's job-result shape plus the design 3.2
``digest`` (the T3 codec, which the shared fixture holds equal to the JS half).

Faults are injected by name: ``script_next`` (a queue of canned ``(status, body)`` replies or
exceptions), ``withhold`` (run-wide guard per job), ``refuse_output`` (per-output guard per key),
``tamper`` (edit a well-formed reply before it is sent). ``calls`` records every request parsed.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
import struct
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from api.services import pine_runtime_codec as codec

FIXTURE_SECRET = "fixture-secret-not-a-real-key-0123456789abcdef"
FIXTURE_IDENTITY = {
    "script_engine": 4,
    "runtime_language": "pine",
    "runtime_frontend": 1,
    "runtime_ir": 1,
    "bundle_sha256": "ab" * 32,
}
_HEADER = re.compile(r"^t=(\d{1,12}),v1=([0-9a-f]{64})$")
_TOP = {"protocol", "profile", "engine", "definition", "owner", "jobs"}
_COLS = ("t", "o", "h", "l", "c", "v")


def default_script(cols: Mapping[str, List[float]]) -> Dict[str, List[float]]:
    """value = 2 * close; signal = close with na on the first bar."""
    c = cols["c"]
    return {"value": [2.0 * x for x in c], "signal": [float("nan")] + list(c[1:])}


def _err(status: int, guard: str, sentence: str) -> Tuple[int, bytes]:
    return status, json.dumps({"protocol": 1, "error": {"guard": guard, "sentence": sentence}}).encode()


def b64_column(values: List[float]) -> str:
    return base64.b64encode(codec.encode_column(values)).decode("ascii")


class PineRuntimeFake:
    def __init__(self, *, secret: str = FIXTURE_SECRET, identity: Optional[Mapping[str, Any]] = None,
                 now: Callable[[], float] = lambda: 1_762_200_000,
                 script: Callable[[Mapping[str, List[float]]], Dict[str, List[float]]] = default_script):
        self.secrets = [secret]
        self.identity = dict(identity or FIXTURE_IDENTITY)
        self.now = now
        self.script = script
        self.script_next: List[Any] = []
        self.withhold: Dict[str, Tuple[str, str]] = {}
        self.refuse_output: Dict[str, Tuple[str, str]] = {}
        self.tamper: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None
        self.withheld_bars = 0
        self.calls: List[Dict[str, Any]] = []
        self.seen: set = set()
        self.urls: List[str] = []
        self.timeouts: List[float] = []

    # the Transport signature
    def __call__(self, url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> Tuple[int, bytes]:
        self.urls.append(url)
        self.timeouts.append(timeout)
        if self.script_next:
            nxt = self.script_next.pop(0)
            if isinstance(nxt, BaseException):
                raise nxt
            if nxt is not None:
                return nxt
        return self._serve(body, headers)

    def _serve(self, body: bytes, headers: Mapping[str, str]) -> Tuple[int, bytes]:
        sig = {k.lower(): v for k, v in headers.items()}.get("x-pine-runtime-signature")
        m = _HEADER.match(sig or "")
        if not m:
            return _err(401, "runtime:server-auth", "the request carries no signature")
        t, v1 = int(m.group(1)), m.group(2)
        if abs(self.now() - t) > 60:
            return _err(401, "runtime:server-auth", "clock skew")
        want_any = [hmac.new(s.encode(), f"{t}.{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
                    for s in self.secrets]
        if not any(hmac.compare_digest(w, v1) for w in want_any):
            return _err(401, "runtime:server-auth", "the signature does not match the body")
        if v1 in self.seen:
            return _err(401, "runtime:server-auth", "replay")
        self.seen.add(v1)
        try:
            req = json.loads(body.decode("utf-8"))
        except Exception:  # noqa: BLE001
            return _err(400, "runtime:server-schema", "body is not UTF-8 JSON")
        if not isinstance(req, dict) or set(req) != _TOP or req["protocol"] != 1:
            return _err(400, "runtime:server-schema", "body: closed set")
        self.calls.append(req)
        if not all(str(req["engine"].get(k)) == str(self.identity[k]) for k in codec.ENGINE_FIELDS) \
                or set(req["engine"]) != set(codec.ENGINE_FIELDS):
            return _err(409, "runtime:server-engine-mismatch", "different engine")
        d = req["definition"]
        if set(d) != {"def_id", "version", "doc_sha256", "doc"} or not isinstance(d["doc"], str):
            return _err(400, "runtime:server-schema", "definition")
        if hashlib.sha256(d["doc"].encode("utf-8")).hexdigest() != d["doc_sha256"]:
            return _err(422, "runtime:server-integrity", "doc hash")
        if not re.match(r"^hmac:[0-9a-f]{16,64}$", req["owner"]):
            return _err(400, "runtime:server-schema", "owner")
        results = []
        for i, job in enumerate(req["jobs"]):
            bars = job["bars"]
            n = bars["n"]
            raw = {k: base64.b64decode(bars[k]) for k in _COLS}
            if any(len(raw[k]) != n * 8 for k in _COLS):
                return _err(400, "runtime:server-schema", "bars length")
            h = hashlib.sha256(struct.pack("<I", len(b"pine-runtime-bars/1")) + b"pine-runtime-bars/1"
                               + struct.pack("<I", n))
            for k in _COLS:
                h.update(raw[k])
            if h.hexdigest() != bars["sha256"]:
                return _err(422, "runtime:server-integrity", f"jobs[{i}].bars.sha256")
            cols = {k: list(struct.unpack("<%dd" % n, raw[k])) for k in _COLS}
            results.append(self._run_job(job, cols, n))
        reply = {"protocol": 1, "engine": dict(self.identity), "results": results}
        if self.tamper is not None:
            reply = self.tamper(reply)
        return 200, json.dumps(reply).encode("utf-8")

    def _run_job(self, job: Mapping[str, Any], cols: Mapping[str, List[float]], n: int) -> Dict[str, Any]:
        if job["job"] in self.withhold:
            guard, sentence = self.withhold[job["job"]]
            refusals = [{"key": "*", "guard": guard, "sentence": sentence, "bar": None}]
            return {"job": job["job"], "status": "withheld", "refusals": refusals,
                    "digest": codec.column_digest(self.identity, {}, refusals, rows=n), "ms": 1}
        out = self.script(cols)
        k = self.withheld_bars
        # the engine's curtain (runtimeWarmupCurtain.test.js): bars [0, withheldBars) are na in every column
        out = {key: [float("nan")] * min(k, len(col)) + list(col[k:]) for key, col in out.items()}
        keys = job.get("want") or list(out)
        columns, refusals, plain = {}, [], {}
        for key in keys:
            if key in self.refuse_output:
                g, s = self.refuse_output[key]
                refusals.append({"key": key, "guard": g, "sentence": s, "bar": None})
            elif key not in out:
                refusals.append({"key": key, "guard": "runtime:server-output-absent",
                                 "sentence": f"this run produced no output `{key}`.", "bar": None})
            else:
                plain[key] = out[key]
                columns[key] = b64_column(out[key])
        return {"job": job["job"], "status": "ok", "columns": columns, "refusals": refusals,
                "warmup": {"withheldBars": self.withheld_bars},
                "digest": codec.column_digest(self.identity, plain, refusals, rows=n), "cache": "miss", "ms": 1}


def bars_fixture(n: int = 5, start: float = 100.0, t0: float = 1_700_000_000.0) -> List[Dict[str, float]]:
    """``n`` strictly increasing, finite bars."""
    return [{"t": t0 + 86400.0 * i, "o": start + i, "h": start + i + 2, "l": start + i - 1,
             "c": start + i + 0.5, "v": 1000.0 + i} for i in range(n)]


def redigest(identity: Mapping[str, Any], result: Dict[str, Any], n: int) -> str:
    """The digest a result WOULD carry for its (possibly tampered) columns: a tamper that keeps
    the digest honest proves the client's check is on the column, not only on the digest."""
    cols = {k: codec.decode_column(base64.b64decode(v)) for k, v in result.get("columns", {}).items()}
    if any(len(c) != n for c in cols.values()) or any(any(math.isinf(x) for x in c) for c in cols.values()):
        return codec.column_digest(identity, cols, result.get("refusals", []))
    return codec.column_digest(identity, cols, result.get("refusals", []), rows=n)
