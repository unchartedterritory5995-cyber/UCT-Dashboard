"""V5 PUBLICATION: immutable, versioned, pointer-switched.

    fundamentals_pit/v5/obj/<sha256>.json        per-company artifact, content-addressed, WRITE-ONCE
    fundamentals_pit/v5/versions/<version>.json  version manifest (companies {cik: sha}, tickers, lineage,
                                                 horizon, validation), WRITE-ONCE
    fundamentals_pit/v5/CURRENT.json             the pointer -- the ONLY mutable V5 object, written LAST
    fundamentals_pit/serving.json                member selection (v4 | v5 [+pin]) -- written ONLY by ops

A member request resolves pointer -> manifest -> object; manifests and objects never change after they are written,
so a request sees exactly one complete version. Nothing a failed batch wrote is reachable until the pointer moves.
Rollback never deletes: it points somewhere else.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

PREFIX = "fundamentals_pit/v5/"
CURRENT_KEY = PREFIX + "CURRENT.json"
STATUS_KEY = PREFIX + "status.json"
SERVING_KEY = "fundamentals_pit/serving.json"
MANIFEST_FORMAT = 1


def obj_key(sha: str) -> str:
    return f"{PREFIX}obj/{sha}.json"


def version_key(version_id: str) -> str:
    return f"{PREFIX}versions/{version_id}.json"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def encode(doc: dict) -> bytes:
    return json.dumps(doc, separators=(",", ":"), sort_keys=True).encode()


class PublishError(RuntimeError):
    pass


# ── targets ─────────────────────────────────────────────────────────────────
class LocalTarget:
    """A directory laid out exactly like the bucket (tests, dark drills, the serving 'local' mode)."""

    def __init__(self, root: str):
        self.root = root

    def _p(self, key):
        return os.path.join(self.root, *key.split("/"))

    def get(self, key: str) -> bytes | None:
        p = self._p(key)
        return open(p, "rb").read() if os.path.exists(p) else None

    def exists(self, key: str) -> bool:
        return os.path.exists(self._p(key))

    def put(self, key: str, body: bytes, content_type: str = "application/json") -> None:
        p = self._p(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, p)


class R2Target:
    """The production bucket through the existing data_sync client."""

    def __init__(self):
        from api.services import data_sync
        if not data_sync.credentials_ok():
            raise PublishError("R2 credentials not configured")
        self.ds = data_sync

    def get(self, key: str) -> bytes | None:
        return self.ds.get_bytes(key)

    def exists(self, key: str) -> bool:
        cl, bucket = self.ds._client(), self.ds._bucket()
        try:
            cl.head_object(Bucket=bucket, Key=key)
            return True
        except Exception as e:                            # 404 -> absent; anything else is an error
            code = str(getattr(e, "response", {}).get("Error", {}).get("Code", ""))
            if code in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def put(self, key: str, body: bytes, content_type: str = "application/json") -> None:
        if not self.ds.put_bytes(key, body, content_type):
            raise PublishError(f"put failed: {key}")


# ── reads ───────────────────────────────────────────────────────────────────
def read_json(target, key: str) -> dict | None:
    b = target.get(key)
    return json.loads(b) if b else None


def read_current(target) -> dict | None:
    return read_json(target, CURRENT_KEY)


def read_manifest(target, version_id: str, *, verify_sha: str | None = None) -> dict | None:
    b = target.get(version_key(version_id))
    if b is None:
        return None
    if verify_sha and sha(b) != verify_sha:
        raise PublishError(f"manifest {version_id} sha mismatch")
    return json.loads(b)


# ── writes ──────────────────────────────────────────────────────────────────
def put_objects(target, bodies: dict[str, bytes], *, verify: bool = True, workers: int = 16) -> dict:
    """Write-once content-addressed objects: an existing object is never rewritten (its key IS its content).
    Concurrent (the base version is ~7k objects); every object is verified by read-back before the manifest."""
    from concurrent.futures import ThreadPoolExecutor

    def one(item):
        s, body = item
        if sha(body) != s:
            raise PublishError(f"object body does not hash to its key {s}")
        k = obj_key(s)
        if target.exists(k):
            return "existing"
        target.put(k, body)
        if verify:
            back = target.get(k)
            if back is None or sha(back) != s:
                raise PublishError(f"object {s} did not verify after write")
        return "written"
    with ThreadPoolExecutor(max(1, workers)) as ex:
        res = list(ex.map(one, bodies.items()))
    return {"objects_written": res.count("written"), "objects_existing": res.count("existing")}


def build_manifest(*, version_id: str, parent: str | None, companies: dict[int, str], tickers: dict[str, int],
                   fields: dict) -> dict:
    return {"format": MANIFEST_FORMAT, "version": version_id, "parent": parent, "created_at": int(time.time()),
            "companies": {str(c): s for c, s in sorted(companies.items())}, "tickers": dict(sorted(tickers.items())),
            "census": {"companies": len(companies), "tickers": len(tickers)}, **fields}


def publish_version(target, manifest: dict, bodies: dict[str, bytes], *, expect_parent: str | None,
                    parent_manifest: dict | None = None) -> dict:
    """objects -> manifest (write-once) -> verify -> pointer compare-and-set. Returns the new pointer.

    Refuses if any company references an object that does not exist, if the manifest key already holds different
    bytes, or if CURRENT no longer points at `expect_parent` (someone else published)."""
    t0 = time.time()
    res = put_objects(target, bodies)
    # an object the verified parent version already references was verified when THAT version published
    inherited = set((parent_manifest or {}).get("companies", {}).values())
    missing = [c for c, s in manifest["companies"].items() if s not in bodies and s not in inherited
               and not target.exists(obj_key(s))]
    if missing:
        raise PublishError(f"{len(missing)} companies reference objects that do not exist (e.g. cik {missing[0]})")
    mb = encode(manifest)
    mk = version_key(manifest["version"])
    prev = target.get(mk)
    if prev is not None and prev != mb:
        raise PublishError(f"manifest {manifest['version']} already exists with different content")
    if prev is None:
        target.put(mk, mb)
    back = target.get(mk)
    if back is None or sha(back) != sha(mb):
        raise PublishError("manifest did not verify after write")
    cur = read_current(target)
    if (cur or {}).get("version") != expect_parent:
        raise PublishError(f"pointer moved: expected parent {expect_parent}, found {(cur or {}).get('version')}")
    pointer = {"version": manifest["version"], "manifest_sha256": sha(mb), "previous": expect_parent,
               "published_at": int(time.time())}
    target.put(CURRENT_KEY, encode(pointer))
    if read_current(target) != pointer:
        raise PublishError("pointer did not verify after write")
    return {**pointer, **res, "manifest_bytes": len(mb), "elapsed_s": round(time.time() - t0, 2)}


def set_pointer(target, version_id: str, *, expect_current: str | None, reason: str) -> dict:
    """Move CURRENT to an EXISTING version (rollback within V5). The manifest must exist and verify."""
    mb = target.get(version_key(version_id))
    if mb is None:
        raise PublishError(f"version {version_id} does not exist")
    cur = read_current(target)
    if (cur or {}).get("version") != expect_current:
        raise PublishError(f"pointer moved: expected {expect_current}, found {(cur or {}).get('version')}")
    pointer = {"version": version_id, "manifest_sha256": sha(mb), "previous": expect_current,
               "published_at": int(time.time()), "reason": reason}
    target.put(CURRENT_KEY, encode(pointer))
    return pointer


def write_serving(target, serve: str, *, pin: str | None = None, by: str, reason: str) -> dict:
    """The MEMBER selection. v4 = the untouched V4 artifacts; v5 = CURRENT (or the pin)."""
    if serve not in ("v4", "v5"):
        raise PublishError("serve must be v4 or v5")
    if serve == "v5":
        if pin:
            if target.get(version_key(pin)) is None:
                raise PublishError(f"pin {pin} does not exist")
        elif read_current(target) is None:
            raise PublishError("no V5 CURRENT pointer; refusing to select v5")
    doc = {"serve": serve, "v5_pin": pin, "at": int(time.time()), "by": by, "reason": reason,
           "previous": read_json(target, SERVING_KEY)}
    if doc["previous"]:
        doc["previous"].pop("previous", None)
    target.put(SERVING_KEY, encode(doc))
    return doc
