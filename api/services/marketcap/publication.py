"""Market Cap V1 PRIVATE IMMUTABLE PUBLICATION -- objects -> audit artifacts -> manifest -> (separately) pointer.

The pattern is Fundamentals V5's (v5_publish.py, production since 2026-09-30): content-addressed write-once objects, a
write-once manifest, and ONE mutable pointer written last by compare-and-set. Differences, all stricter:
  * publishing a build NEVER moves the pointer. `publish_build` ends at a verified, non-authoritative build;
    `advance` is a separate call that re-verifies the whole build before it moves anything;
  * write-once is enforced, not assumed: an existing key with different bytes is an error (never overwritten), and
    every write is read back and hashed;
  * the R2 target distinguishes "absent" from "error" (data_sync.get_bytes returns None for both, which would let a
    transient read failure look like "no pointer yet" to a compare-and-set);
  * the build DB itself is published (gzip, write-once, hashed) so the served documents can always be audited
    against the exact database they came from.

Nothing here deletes. Retention of superseded builds is an owner decision (docs/marketcap/PRODUCTION-LIFECYCLE.md).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import artifacts as A, release_contract as C


class PublishError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def encode_json(doc) -> bytes:
    return json.dumps(doc, sort_keys=True, indent=1, default=str).encode()


# ── targets ─────────────────────────────────────────────────────────────────────────────────────────────────────────
class LocalTarget:
    """A directory mirroring the bucket layout (tests, dark drills, the isolated lifecycle namespace)."""

    def __init__(self, root: str):
        self.root = root

    def _p(self, key: str) -> str:
        if ".." in key.split("/"):
            raise PublishError(f"bad key {key}")
        return os.path.join(self.root, *key.split("/"))

    def get(self, key: str) -> bytes | None:
        p = self._p(key)
        if not os.path.exists(p):
            return None
        with open(p, "rb") as f:
            return f.read()

    def exists(self, key: str) -> bool:
        return os.path.exists(self._p(key))

    def put_new(self, key: str, body: bytes) -> None:
        """Write-once: hard-link a complete temp file into place (fails if the key exists, on every platform)."""
        p = self._p(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(body)
            try:
                os.link(tmp, p)
            except FileExistsError:
                raise PublishError(f"write-once key exists: {key}")
        finally:
            os.unlink(tmp)

    def put_new_file(self, key: str, path: str) -> None:
        p = self._p(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".tmp-")
        os.close(fd)
        try:
            shutil.copyfile(path, tmp)
            try:
                os.link(tmp, p)
            except FileExistsError:
                raise PublishError(f"write-once key exists: {key}")
        finally:
            os.unlink(tmp)

    def open_read(self, key: str):
        return open(self._p(key), "rb")

    def put_mutable(self, key: str, body: bytes) -> None:
        p = self._p(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, p)


class R2Target:
    """The production bucket through data_sync's client (private; credentials from the service environment only)."""

    def __init__(self):
        from api.services import data_sync
        self.cl = data_sync._client()
        self.bucket = data_sync._bucket()
        if self.cl is None or not self.bucket:
            raise PublishError("R2 is NOT CONFIGURED in this environment")

    @staticmethod
    def _absent(e) -> bool:
        code = str(getattr(e, "response", {}).get("Error", {}).get("Code", ""))
        return code in ("404", "NoSuchKey", "NotFound")

    def get(self, key: str) -> bytes | None:
        try:
            return self.cl.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception as e:                       # absent -> None; anything else is an error, never "absent"
            if self._absent(e):
                return None
            raise PublishError(f"read failed for {key}: {type(e).__name__}")

    def exists(self, key: str) -> bool:
        try:
            self.cl.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as e:
            if self._absent(e):
                return False
            raise PublishError(f"head failed for {key}: {type(e).__name__}")

    def put_new(self, key: str, body: bytes) -> None:
        if self.exists(key):
            raise PublishError(f"write-once key exists: {key}")
        self.cl.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/octet-stream")

    def put_new_file(self, key: str, path: str) -> None:
        if self.exists(key):
            raise PublishError(f"write-once key exists: {key}")
        self.cl.upload_file(path, self.bucket, key)

    def open_read(self, key: str):
        return self.cl.get_object(Bucket=self.bucket, Key=key)["Body"]

    def put_mutable(self, key: str, body: bytes) -> None:
        self.cl.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json")


# ── write-once helpers ──────────────────────────────────────────────────────────────────────────────────────────────
def put_once(target, key: str, body: bytes) -> str:
    """'written' | 'existing' (identical bytes already there). Different bytes under the key -> PublishError."""
    have = target.get(key)
    if have is not None:
        if have != body:
            raise PublishError(f"{key} already holds different bytes; immutable keys are never overwritten")
        return "existing"
    target.put_new(key, body)
    back = target.get(key)
    if back is None or A.sha(back) != A.sha(body):
        raise PublishError(f"{key} did not verify after write")
    return "written"


def stream_sha(fobj) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    for b in iter(lambda: fobj.read(1 << 20), b""):
        h.update(b)
        n += len(b)
    return h.hexdigest(), n


def file_sha(path: str) -> tuple[str, int]:
    with open(path, "rb") as f:
        return stream_sha(f)


# ── publish one build (never moves the pointer) ─────────────────────────────────────────────────────────────────────
def publish_documents(target, build_db: str, prices_db: str, workers: int = 8, progress=None) -> dict:
    docs: dict[str, str] = {}
    lock = threading.Lock()
    counts = {"written": 0, "existing": 0, "bytes": 0}
    bad: list = []

    def one(item):
        t, doc = item
        problems = A.check_doc(doc)
        if problems:
            with lock:
                bad.append((t, problems))
            return
        body = A.encode_doc(doc)
        s = A.sha(body)
        r = put_once(target, C.obj_key(s), body)
        with lock:
            docs[t] = s
            counts[r] += 1
            counts["bytes"] += len(body)
            if progress and len(docs) % 500 == 0:
                progress(len(docs))

    # bounded: at most 2 x workers documents in flight (Executor.map would materialize every document up front)
    gate = threading.BoundedSemaphore(2 * max(1, workers))
    errors: list = []

    def run(item):
        try:
            one(item)
        except Exception as e:  # noqa: BLE001
            with lock:
                errors.append(e)
        finally:
            gate.release()
    with ThreadPoolExecutor(max(1, workers)) as ex:
        for item in A.documents(build_db, prices_db):
            if errors:
                break
            gate.acquire()
            ex.submit(run, item)
    if errors:
        raise errors[0]
    if bad:
        raise PublishError(f"{len(bad)} documents fail structural checks (e.g. {bad[0]})")
    return {"documents": dict(sorted(docs.items())), **counts}


def publish_db(target, build_id: str, build_db: str) -> dict:
    raw_sha, raw_bytes = file_sha(build_db)
    key = C.db_key(build_id)
    with tempfile.TemporaryDirectory() as d:
        gzp = os.path.join(d, "build.db.gz")
        with open(build_db, "rb") as src, gzip.GzipFile(gzp, "wb", compresslevel=6, mtime=0) as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        gz_sha, gz_bytes = file_sha(gzp)
        if target.exists(key):
            with target.open_read(key) as f:
                have, _n = stream_sha(f)
            if have != gz_sha:
                raise PublishError(f"{key} already holds a different build DB")
            state = "existing"
        else:
            target.put_new_file(key, gzp)
            state = "written"
    # serving-copy verification: read the published bytes back, hash them compressed AND decompressed
    with target.open_read(key) as f:
        back_gz, _n = stream_sha(f)
    with target.open_read(key) as f, gzip.GzipFile(fileobj=f) as g:
        back_raw, back_n = stream_sha(g)
    if back_gz != gz_sha or back_raw != raw_sha or back_n != raw_bytes:
        raise PublishError("published build DB did not verify")
    return {"key": key, "sha256": raw_sha, "bytes": raw_bytes, "gz_sha256": gz_sha, "gz_bytes": gz_bytes, "state": state}


def publish_build(target, *, build_db: str, prices_db: str, manifest_fields: dict, validation: dict,
                  workers: int = 8, progress=None) -> dict:
    """documents -> build DB -> validation report -> manifest (all write-once, all read back) -> full verification.
    Returns {"build_id", "manifest_sha256", ...}. The AUTHORITY pointer is not touched."""
    t0 = time.time()
    build_id = manifest_fields["build_id"]
    C.build_prefix(build_id)
    C.assert_not_revoked(build_id, (manifest_fields.get("build") or {}).get("db_sha256"))
    C.assert_not_revoked(None, file_sha(build_db)[0])        # the bytes, not just what the manifest claims
    if validation.get("status") != "PASS":
        raise PublishError(f"validation status {validation.get('status')}: an unvalidated build is never published")
    if target.exists(C.manifest_key(build_id)):
        raise PublishError(f"{build_id} is already published (a refresh always makes a NEW build id)")
    docs = publish_documents(target, build_db, prices_db, workers=workers, progress=progress)
    db = publish_db(target, build_id, build_db)
    if db["sha256"] != manifest_fields["build"]["db_sha256"]:
        raise PublishError("the DB being published is not the DB the manifest describes")
    vbody = encode_json(validation)
    put_once(target, C.validation_key(build_id), vbody)
    m = dict(manifest_fields)
    m["artifacts"] = {"documents": docs["documents"],
                      "census": {"tickers": len(docs["documents"]), "objects_written": docs["written"],
                                 "objects_existing": docs["existing"], "document_bytes": docs["bytes"]},
                      "db": {k: db[k] for k in ("key", "sha256", "bytes", "gz_sha256", "gz_bytes")}}
    m["validation"] = {"key": C.validation_key(build_id), "sha256": A.sha(vbody), "status": validation["status"],
                       "gates": {k: v.get("pass") for k, v in (validation.get("gates") or {}).items()}}
    m["schema"] = {"document_format": A.DOC_FORMAT, "compatible_readers": list(C.COMPATIBLE_DOC_FORMATS)}
    m["published_at"] = now_iso()
    C.validate_manifest(m, build_id=build_id)
    mb = encode_json(m)
    put_once(target, C.manifest_key(build_id), mb)
    ver = verify_build(target, build_id, A.sha(mb))
    return {"build_id": build_id, "manifest_sha256": A.sha(mb), "manifest_bytes": len(mb), "census": m["artifacts"]["census"],
            "db": m["artifacts"]["db"], "verified": ver, "elapsed_s": round(time.time() - t0, 1)}


# ── verification (the same proof the reader and every pointer move rely on) ────────────────────────────────────────
def read_manifest(target, build_id: str, manifest_sha: str) -> dict:
    mb = target.get(C.manifest_key(build_id))
    if mb is None:
        raise PublishError(f"no manifest for {build_id}")
    if A.sha(mb) != manifest_sha:
        raise PublishError(f"manifest {build_id} sha mismatch")
    m = json.loads(mb)
    C.validate_manifest(m, build_id=build_id)
    return m


def verify_build(target, build_id: str, manifest_sha: str, *, workers: int = 16, deep_db: bool = False) -> dict:
    """pointer-candidate -> manifest sha -> validation report sha -> EVERY document's bytes and structure."""
    t0 = time.time()
    m = read_manifest(target, build_id, manifest_sha)
    vb = target.get(m["validation"]["key"])
    if vb is None or A.sha(vb) != m["validation"]["sha256"] or json.loads(vb).get("status") != "PASS":
        raise PublishError("validation report missing, altered or not PASS")
    if not target.exists(m["artifacts"]["db"]["key"]):
        raise PublishError("build DB artifact missing")
    errors: list = []

    def one(item):
        t, s = item
        b = target.get(C.obj_key(s))
        if b is None or A.sha(b) != s:
            return (t, "missing or altered")
        try:
            doc = A.decode_doc(b)
        except Exception as e:  # noqa: BLE001
            return (t, f"undecodable: {e}")
        if A.norm_ticker(doc.get("ticker", "")) != t:
            return (t, "document names another ticker")
        p = A.check_doc(doc)
        return (t, p) if p else None

    with ThreadPoolExecutor(max(1, workers)) as ex:
        for r in ex.map(one, m["artifacts"]["documents"].items()):
            if r:
                errors.append(r)
    if errors:
        raise PublishError(f"{len(errors)} documents failed verification (e.g. {errors[0]})")
    out = {"build_id": build_id, "documents": len(m["artifacts"]["documents"]), "elapsed_s": round(time.time() - t0, 1)}
    if deep_db:
        with target.open_read(m["artifacts"]["db"]["key"]) as f, gzip.GzipFile(fileobj=f) as g:
            s, n = stream_sha(g)
        if s != m["artifacts"]["db"]["sha256"] or n != m["artifacts"]["db"]["bytes"]:
            raise PublishError("build DB artifact does not match the manifest")
        out["db_verified"] = True
    return out


# ── the pointer (the only mutable object) ───────────────────────────────────────────────────────────────────────────
def read_pointer(target) -> dict | None:
    b = target.get(C.AUTHORITY_KEY)
    if b is None:
        return None
    p = json.loads(b)
    C.validate_pointer(p)
    return p


def _move(target, build_id: str, manifest_sha: str, *, expect_current: str | None, by: str, reason: str,
          acceptance: str) -> dict:
    verify_build(target, build_id, manifest_sha)              # never point at anything not fully verified
    cur = read_pointer(target)
    if (cur or {}).get("build_id") != expect_current:
        raise PublishError(f"pointer moved: expected {expect_current}, found {(cur or {}).get('build_id')}")
    if cur and cur["build_id"] == build_id:
        raise PublishError(f"{build_id} is already the authority")
    p = C.make_pointer(manifest_sha, build_id, previous=cur, at=now_iso(), by=by, reason=reason, acceptance=acceptance)
    body = encode_json(p)
    target.put_mutable(C.AUTHORITY_KEY, body)
    if read_pointer(target) != p:
        raise PublishError("pointer did not verify after write")
    return p


def advance(target, build_id: str, manifest_sha: str, *, expect_current: str | None, by: str, reason: str,
            acceptance: str) -> dict:
    if acceptance not in ("HUMAN_CUTOVER", "AUTOMATED_REFRESH"):
        raise PublishError("advance acceptance must be HUMAN_CUTOVER or AUTOMATED_REFRESH")
    return _move(target, build_id, manifest_sha, expect_current=expect_current, by=by, reason=reason, acceptance=acceptance)


def rollback(target, to_build_id: str, to_manifest_sha: str, *, expect_current: str, by: str, reason: str) -> dict:
    """N+1 -> N: the pointer moves back to an EXISTING, re-verified build. Nothing is rebuilt or deleted."""
    return _move(target, to_build_id, to_manifest_sha, expect_current=expect_current, by=by, reason=reason,
                 acceptance="ROLLBACK")
