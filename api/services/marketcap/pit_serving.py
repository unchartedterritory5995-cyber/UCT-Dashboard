"""Market Cap V1 -- the web tier's READ path (production reader).

The member door (api/routers/marketcap_pit.py) never opens a build DB, never builds, never writes: it reads the
published artifacts and proves, before serving a value,

    AUTHORITY pointer -> manifest bytes hash to the pointer's sha -> manifest validates (format, PASS, schema)
    -> the ticker's document bytes hash to the manifest's sha -> the document decodes and passes its invariants.

SOURCE (env MCAP_PIT_SOURCE): r2 (production; data_sync, private bucket) | local (MCAP_PIT_LOCAL_ROOT, dev / drills).
PIN (env MCAP_PIT_PIN = "<build_id>:<manifest_sha256>"): emergency override that ignores the pointer -- the manifest
must still verify against the pinned sha.

CACHES -- every key carries the build identity, so a pointer advance A -> B can never answer from A:
  * the bound authority (pointer + verified manifest) is re-read every MCAP_PIT_CONTROL_TTL seconds (30);
  * documents are cached by content sha (immutable: the same sha is the same bytes in every build);
  * HTTP: ETag = sha(build_id, manifest sha, document sha, query, currentness state); a new build is a new ETag.

FAIL SAFE. A pointer or manifest that does not verify is never bound: the reader keeps the last authority it verified
(and says so in /status), or answers 503 when it has never verified one. A document that does not verify is a 503 for
that ticker, never a partial or substituted answer.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Optional

from . import artifacts as A, release_contract as C

CONTROL_TTL = float(os.environ.get("MCAP_PIT_CONTROL_TTL", "30"))
_MAX_DOCS = int(os.environ.get("MCAP_PIT_DOC_CACHE", "512"))

_lock = threading.Lock()
_state: dict = {"bound": None, "checked_at": 0.0, "error": None, "error_at": None}
_docs: dict[str, bytes] = {}         # sha -> verified gz bytes (content-addressed: safe across builds)


class Unavailable(RuntimeError):
    pass


def mode() -> str:
    m = os.environ.get("MCAP_PIT_SOURCE", "r2").strip().lower()
    return m if m in ("r2", "local") else "r2"


def _read(key: str) -> Optional[bytes]:
    if mode() == "local":
        root = os.environ.get("MCAP_PIT_LOCAL_ROOT")
        if not root:
            raise Unavailable("MCAP_PIT_LOCAL_ROOT unset")
        p = os.path.join(root, *key.split("/"))
        if not os.path.exists(p):
            return None
        with open(p, "rb") as f:
            return f.read()
    from api.services import data_sync
    return data_sync.get_bytes(key)


def _verify_manifest(build_id: str, manifest_sha: str) -> dict:
    mb = _read(C.manifest_key(build_id))
    if mb is None:
        raise Unavailable(f"manifest for {build_id} missing")
    if A.sha(mb) != manifest_sha:
        raise Unavailable(f"manifest for {build_id} does not hash to the pointer")
    m = json.loads(mb)
    C.validate_manifest(m, build_id=build_id)
    return m


def _resolve() -> dict:
    from .currentness import read_status
    out = _resolve_authority()
    out["heartbeat"] = read_status(_read)
    return out


def _resolve_authority() -> dict:
    pin = os.environ.get("MCAP_PIT_PIN", "").strip()
    if pin:
        bid, _, msha = pin.partition(":")
        m = _verify_manifest(bid, msha)
        return {"build_id": bid, "manifest_sha256": msha, "manifest": m, "pointer": None, "pinned": True}
    pb = _read(C.AUTHORITY_KEY)
    if pb is None:
        raise Unavailable("no authority published")
    p = json.loads(pb)
    C.validate_pointer(p)
    m = _verify_manifest(p["build_id"], p["manifest_sha256"])
    return {"build_id": p["build_id"], "manifest_sha256": p["manifest_sha256"], "manifest": m, "pointer": p,
            "pinned": False}


def bound(force: bool = False) -> dict:
    """The verified authority. Re-checked every CONTROL_TTL; a failed re-check keeps the last verified one."""
    now = time.time()
    with _lock:
        b = _state["bound"]
        if b is not None and not force and now - _state["checked_at"] < CONTROL_TTL:
            return b
    try:
        nb = _resolve()
        with _lock:
            cur = _state["bound"]
            if cur is None or (cur["build_id"], cur["manifest_sha256"]) != (nb["build_id"], nb["manifest_sha256"]):
                _state["bound"] = nb
            else:
                _state["bound"]["pointer"] = nb["pointer"]
                _state["bound"]["heartbeat"] = nb["heartbeat"]
            _state.update(checked_at=now, error=None, error_at=None)
            return _state["bound"]
    except Exception as e:  # noqa: BLE001 -- unverifiable authority: keep the last verified one, or nothing
        with _lock:
            _state.update(checked_at=now, error=f"{type(e).__name__}: {e}"[:300], error_at=now)
            if isinstance(e, C.ContractError) and "REVOKED" in str(e):
                _state["bound"] = None                      # a revoked build is never kept as "last verified"
            if _state["bound"] is not None:
                return _state["bound"]
        raise Unavailable(str(e))


def _document(sha: str) -> dict:
    """Verified COMPRESSED bytes are cached (≈22 KB a document; the web pod is memory-tight), decoded per request."""
    with _lock:
        b = _docs.get(sha)
    if b is not None:
        return A.decode_doc(b)
    b = _read(C.obj_key(sha))
    if b is None or A.sha(b) != sha:
        raise Unavailable("document missing or altered")
    d = A.decode_doc(b)
    if A.check_doc(d):
        raise Unavailable("document fails its invariants")
    with _lock:
        if len(_docs) >= _MAX_DOCS:
            for k in list(_docs)[: _MAX_DOCS // 4]:
                _docs.pop(k, None)
        _docs[sha] = b
    return d


def clear_cache() -> None:
    with _lock:
        _docs.clear()
        _state.update(bound=None, checked_at=0.0, error=None, error_at=None)


def _etag(*parts) -> str:
    return '"' + hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:32] + '"'


def _authority_block(b: dict) -> dict:
    m = b["manifest"]
    p = b["pointer"] or {}
    return {"build_id": b["build_id"], "manifest_sha256": b["manifest_sha256"], "methodology": m["methodology"].get("version"),
            "advanced_at": p.get("advanced_at"), "acceptance": p.get("acceptance"), "pinned": b["pinned"]}


def _lookup(ticker: str):
    if not isinstance(ticker, str) or not (0 < len(ticker) <= 16):
        return None, None, None
    try:
        b = bound()
    except Unavailable:
        return "unavailable", None, None
    t = A.norm_ticker(ticker)
    s = b["manifest"]["artifacts"]["documents"].get(t)
    return b, t, s


def series(ticker: str, start: Optional[str] = None, end: Optional[str] = None) -> tuple[int, dict, Optional[str]]:
    from .currentness import evaluate
    b, t, s = _lookup(ticker)
    if b == "unavailable":
        return 503, {"detail": "market_cap_unavailable"}, None
    if b is None or s is None:
        return 404, {"detail": "unknown ticker"}, None
    try:
        doc = _document(s)
    except Unavailable:
        return 503, {"detail": "market_cap_unavailable"}, None
    pts = doc["points"]
    gaps = doc["gaps"]
    if start or end:
        lo, hi = start or "0000-00-00", end or "9999-99-99"
        pts = [p for p in pts if lo <= p[0] <= hi]
        gaps = [g for g in gaps if g["end"] >= lo and g["start"] <= hi]      # same overlap rule as serve.Authority
    cur = evaluate(b["manifest"], heartbeat=b.get("heartbeat"))
    body = {"ticker": ticker.upper(), "issuer_id": doc["issuer_id"], "listing": doc["listing"], "company_level": True,
            "build_id": b["build_id"], "points": pts, "gaps": gaps, "structure": doc["structure"],
            "authority": _authority_block(b), "currentness": cur}
    return 200, body, _etag(b["build_id"], b["manifest_sha256"], s, start, end, cur["state"], cur.get("expected_session"))


def latest(ticker: str) -> tuple[int, dict, Optional[str]]:
    from .currentness import evaluate
    b, t, s = _lookup(ticker)
    if b == "unavailable":
        return 503, {"detail": "market_cap_unavailable"}, None
    if b is None or s is None:
        return 404, {"detail": "unknown ticker"}, None
    try:
        doc = _document(s)
    except Unavailable:
        return 503, {"detail": "market_cap_unavailable"}, None
    lt = doc["latest"]
    cur = evaluate(b["manifest"], heartbeat=b.get("heartbeat"))
    body = {"ticker": ticker.upper(), "issuer_id": doc["issuer_id"], "date": lt["date"],
            "company_market_cap": lt["company_market_cap"], "security_market_cap": lt["security_market_cap"],
            "build_id": b["build_id"], "authority": _authority_block(b), "currentness": cur}
    if lt["company_market_cap"] is None:
        body["reason"] = lt.get("reason")
    return 200, body, _etag("latest", b["build_id"], b["manifest_sha256"], s, cur["state"], cur.get("expected_session"))


def status() -> tuple[int, dict, Optional[str]]:
    """Observability (no values): authoritative build, served hash, currentness, refresh heartbeat, reader errors."""
    from .currentness import evaluate
    with _lock:
        err, err_at = _state["error"], _state["error_at"]
    try:
        b = bound()
    except Unavailable as e:
        return 503, {"detail": "market_cap_unavailable", "reader_error": str(e)[:300]}, None
    m = b["manifest"]
    hb = b.get("heartbeat")
    body = {"authority": _authority_block(b), "currentness": evaluate(m, heartbeat=hb),
            "knowledge": {k: m["knowledge"].get(k) for k in ("latest_valued_session", "filing_knowledge_cutoff",
                                                             "latest_harvest_at", "sec_bulk_last_modified")},
            "build": {k: m["build"].get(k) for k in ("started_at", "finished_at")},
            "documents": len(m["artifacts"]["documents"]), "served_db_sha256": m["artifacts"]["db"]["sha256"],
            "refresh": hb, "reader_error": err, "reader_error_at": err_at}
    return 200, body, _etag("status", b["build_id"], json.dumps(body, sort_keys=True, default=str))
