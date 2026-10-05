"""Exchange Breadth V1 — the ONE writer of the member-authority pointer (runs on breadth-v2-runner).

    publish()   snapshot the append-only live store → upload (immutable, content-addressed) → PROVE the
                candidate pointer by installing it into a private staging replica with the READER's own
                `install()` (download + hash + continuity) → write history/<version> → switch AUTHORITY.json
    rollback()  re-point at an earlier publication's exact artifacts (no rebuild): a NEW version whose
                artifacts equal the target's, proven the same way, then the same single switch
    current()   the captured current authority (pointer bytes + sha)

⛔ The pointer PUT is the only member-visible step and it is last. A crash anywhere before it leaves the
previous authority in force; a refused proof never reaches it. Versions are monotonic; `previous` links
each pointer to the one it replaced, so the chain is the audit trail and the rollback menu.
⛔ Single writer: callers hold the exchange runner's flock (`breadth_exchange_runner`).
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import sqlite3
import tempfile
import time
from typing import Optional

from api.services import breadth_exchange_authority as ea


def _utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def current(store) -> Optional[dict]:
    """{"pointer": doc, "bytes": b, "sha256": …} of the published authority, or None (never published)."""
    try:
        b = store.get(ea.key(ea.POINTER_KEY))
    except Exception:  # noqa: BLE001
        return None
    return {"pointer": ea.parse_pointer(b), "bytes": b, "sha256": ea.sha_bytes(b)}


def _gz(plain: bytes) -> bytes:
    return gzip.compress(plain, compresslevel=6, mtime=0)


def _put_object(store, path: str, want_sha: Optional[str] = None) -> dict:
    plain = open(path, "rb").read()
    sha = ea.sha_bytes(plain)
    if want_sha and sha != want_sha:
        raise ea.Refused("SOURCE_HASH_MISMATCH", {"path": path, "sha256": sha})
    k = ea.object_key(sha)
    blob = None
    if store.exists(k):
        blob = store.get(k)
        if gzip.decompress(blob) != plain:
            raise ea.Refused("OBJECT_KEY_COLLISION", k)
    else:
        blob = _gz(plain)
        store.put(k, blob)
        if store.get(k) != blob:
            raise ea.Refused("OBJECT_READBACK_MISMATCH", k)
    return {"key": k, "sha256": sha, "gz_sha256": ea.sha_bytes(blob), "bytes": len(plain)}


def snapshot(store_db: str, out_path: str) -> dict:
    """A consistent copy of the live store (SQLite backup API), proven logically identical to its source."""
    lc = ea._lc()
    src = sqlite3.connect("file:%s?mode=ro" % store_db, uri=True)
    try:
        if os.path.exists(out_path):
            os.remove(out_path)
        dst = sqlite3.connect(out_path)
        try:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE")
        finally:
            dst.close()
        want = lc.logical_sha256_conn(src)
    finally:
        src.close()
    c = ea._ro(out_path)
    try:
        got = lc.logical_sha256_conn(c)
        dates = [r[0] for r in c.execute("SELECT date FROM live_session ORDER BY seq")]
        lin = dict(c.execute("SELECT key, value FROM lineage"))
    finally:
        c.close()
    if got != want:
        raise ea.Refused("SNAPSHOT_NOT_FAITHFUL", {"source": want, "snapshot": got})
    return {"logical_sha256": got, "first_session": dates[0] if dates else None,
            "latest_session": dates[-1] if dates else None, "session_count": len(dates), "lineage": lin}


def _prove(store, pointer_bytes: bytes) -> dict:
    """Install the candidate into a throwaway replica with the reader's exact code path."""
    tmp = tempfile.mkdtemp(prefix="exch_authority_proof_")
    try:
        return ea.install(pointer_bytes, store, root=tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _switch(store, doc: dict, cur: Optional[dict]) -> dict:
    """history/<version> (immutable record) then the pointer — the single member-visible write."""
    b = ea.encode_pointer(doc)
    proof = _prove(store, b)
    hk = ea.key("history/%06d.json" % doc["publication_version"])
    if store.exists(hk) and store.get(hk) != b:
        # a crashed earlier attempt at this version never reached the pointer (versions only advance
        # through it), so its history record is an orphan and may be replaced
        if cur and cur["pointer"]["publication_version"] >= doc["publication_version"]:
            raise ea.Refused("VERSION_ALREADY_PUBLISHED", doc["publication_version"])
    store.put(hk, b)
    pk = ea.key(ea.POINTER_KEY)
    store.put(pk, b)
    if store.get(pk) != b:
        raise ea.Refused("POINTER_READBACK_MISMATCH")
    return {"published": doc["publication_version"], "pointer_sha256": ea.sha_bytes(b), "proof": proof,
            "previous": doc["previous"], "rollback_of": doc["rollback_of"]}


def publish(store, live_db: str, historical: str, derived: str, code_commit: str,
            crash=None, re_forward: bool = False) -> dict:
    """Publish the live store's current content as the member authority (no-op if already current).
    ⛔ A ROLLBACK HOLDS: while the published pointer is a rollback, scheduled publication refuses; only an
    explicit `re_forward=True` (an operator decision) moves members forward again."""
    cur = current(store)
    if cur and cur["pointer"].get("rollback_of") and not re_forward:
        return {"published": None, "reason": "ROLLBACK_IN_FORCE", "publication_version":
                cur["pointer"]["publication_version"], "rollback_of": cur["pointer"]["rollback_of"]}
    work = tempfile.mkdtemp(prefix="exch_publish_")
    try:
        snap = os.path.join(work, "live_snapshot.db")
        s = snapshot(live_db, snap)
        if cur and cur["pointer"]["live"].get("logical_sha256") == s["logical_sha256"] \
                and not cur["pointer"].get("rollback_of"):
            # (a re-forward to identical content after a rollback is a new version: it clears the hold)
            return {"published": None, "reason": "already current", "publication_version":
                    cur["pointer"]["publication_version"], "logical_sha256": s["logical_sha256"]}
        if cur and s["latest_session"] < cur["pointer"]["live"]["latest_session"]:
            raise ea.Refused("WOULD_MOVE_BACKWARDS", {"store": s["latest_session"],
                                                      "published": cur["pointer"]["live"]["latest_session"]})
        h = _put_object(store, historical, ea.HIST_SHA256)
        d = _put_object(store, derived, ea.DER_SHA256)
        if crash:
            crash("after_frozen_upload")
        lv = _put_object(store, snap)
        if crash:
            crash("after_live_upload")
        lin = s["lineage"]
        doc = {"kind": ea.KIND, "schema": ea.SCHEMA,
               "publication_version": (cur["pointer"]["publication_version"] + 1) if cur else 1,
               "published_at": _utc(),
               "historical": dict(h, name=ea.HIST_NAME), "derived": dict(d, name=ea.DER_NAME),
               "live": dict(lv, logical_sha256=s["logical_sha256"], first_session=s["first_session"],
                            latest_session=s["latest_session"], session_count=s["session_count"]),
               "lineage": {"code_commit": lin.get("code_commit"), "publisher_code_commit": code_commit,
                           "pins_sha256": lin.get("pins_sha256"),
                           "owner_vintage_exceptions_sha256": lin.get("owner_vintage_exceptions_sha256"),
                           "identity_parent_sha256": lin.get("identity_parent_sha256"),
                           "ledger_sha256": lin.get("ledger_sha256"), "historical_sha256": ea.HIST_SHA256,
                           "derived_sha256": ea.DER_SHA256},
               "methodology": ea.METHODOLOGY,
               "previous": ({"publication_version": cur["pointer"]["publication_version"],
                             "pointer_sha256": cur["sha256"]} if cur else None),
               "rollback_of": None}
        if crash:
            crash("before_pointer")
        return _switch(store, doc, cur)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def history(store, version: int) -> dict:
    b = store.get(ea.key("history/%06d.json" % version))
    return ea.parse_pointer(b)


def rollback(store, to_version: int) -> dict:
    """Re-point members at publication `to_version`'s exact artifacts. Deterministic, no rebuild: the
    artifacts are content-addressed and already in the store; the new pointer is proven before it lands."""
    cur = current(store)
    if cur is None:
        raise ea.Refused("NOTHING_PUBLISHED")
    if to_version >= cur["pointer"]["publication_version"]:
        raise ea.Refused("NOT_AN_EARLIER_VERSION", to_version)
    tgt = history(store, to_version)
    doc = dict(tgt, publication_version=cur["pointer"]["publication_version"] + 1, published_at=_utc(),
               previous={"publication_version": cur["pointer"]["publication_version"],
                         "pointer_sha256": cur["sha256"]},
               rollback_of=to_version)
    return _switch(store, doc, cur)
