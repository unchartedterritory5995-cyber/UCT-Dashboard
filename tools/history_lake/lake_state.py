"""The lake's shared state in R2, and the ONE lease every writer takes (2026-11-28).

Two writers publish the same lake: the owner's PC (daily.py, the fallback) and the cloud runner
(cloud_daily.py). They share no process, so without coordination a slow PC publish that started before day
N+1 could land after the cloud published N+1 and silently take it out of R2 while the cloud's ledger says it
is done. Everything here lives under `<prefix>state/`, which the edge never serves:

  state/lease.json            {"holder", "taken_at", "expires_at"}: who may build and publish right now
  state/ledger.json           the build ledger of the newest publish (either writer)
  state/ref.json              {"files": {name: {"sha256", "bytes", "by", "at"}}}: the reference manifest
  state/splits.json           the split reference, last fetched by either writer
  state/ticker_events.jsonl   identity input (the PC's ref/, refreshed by hand there)

THE LEASE is a conditional PUT: `If-None-Match: *` creates it only when nobody holds it; an EXPIRED lease is
replaced only with `If-Match: <its ETag>`, so of two writers that both see it expired exactly one wins. A
writer holds it around build + publish + state writes, and releases it (deleting only its own) in a
`finally`. A crashed writer's lease expires after `ttl_s`.

ONE SOURCE FOR THE REFERENCES: a writer that refreshes a reference uploads it with `put_ref`, which records
its sha256 in the manifest; every publish reads it back with `get_ref`, which REFUSES bytes whose hash is
not the manifest's (a torn or foreign upload), so both writers publish from the same split table and the
same ticker events.
"""
from __future__ import annotations

import hashlib
import json
import socket
import time
import uuid
from typing import Callable, Optional

STATE = "state/"
LEASE = "lease.json"
REF = "ref.json"
LEDGER = "ledger.json"


class LeaseBusy(RuntimeError):
    """Another writer holds the lake."""


class RefMismatch(RuntimeError):
    """A reference file's bytes are not the ones the manifest names."""


def _code(exc) -> str:
    return str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))


def _missing(exc) -> bool:
    return _code(exc) in ("NoSuchKey", "404", "NotFound") or type(exc).__name__ == "NoSuchKey"


def holder_kind(holder) -> str:
    """What may be LOGGED of a holder: its kind (`pc` / `cloud`), never the PC's host name."""
    return str(holder or "?").split(":")[0]


def holder_name(kind: str) -> str:
    return f"{kind}:{socket.gethostname()}:{uuid.uuid4().hex[:8]}"


class LakeState:
    def __init__(self, s3, bucket: str, prefix: str, *, now: Callable[[], float] = time.time):
        self.s3, self.bucket, self.prefix, self.now = s3, bucket, prefix, now
        self.lease_etag: Optional[str] = None
        self.holder: Optional[str] = None

    def key(self, name: str) -> str:
        return f"{self.prefix}{STATE}{name}"

    # ── the lease ──────────────────────────────────────────────────────────────────────────────
    def take(self, holder: str, ttl_s: float) -> dict:
        """Take the lease or raise LeaseBusy. Returns the lease document."""
        doc = {"holder": holder, "taken_at": self.now(), "expires_at": self.now() + ttl_s}
        body = json.dumps(doc).encode()
        try:
            r = self.s3.put_object(Bucket=self.bucket, Key=self.key(LEASE), Body=body,
                                   ContentType="application/json", IfNoneMatch="*")
        except Exception as e:                       # noqa: BLE001 - only "it exists" is expected
            if _code(e) not in ("PreconditionFailed", "412", "ConditionalRequestConflict", "409"):
                raise
            cur = self.s3.get_object(Bucket=self.bucket, Key=self.key(LEASE))
            held = json.loads(cur["Body"].read() or b"{}")
            if float(held.get("expires_at") or 0) > self.now():
                raise LeaseBusy(f"held by {holder_kind(held.get('holder'))} until {held.get('expires_at'):.0f}") from None
            try:                                     # expired: replace it, but only the copy we read
                r = self.s3.put_object(Bucket=self.bucket, Key=self.key(LEASE), Body=body,
                                       ContentType="application/json", IfMatch=cur["ETag"])
            except Exception as e2:                  # noqa: BLE001
                if _code(e2) in ("PreconditionFailed", "412", "ConditionalRequestConflict", "409"):
                    raise LeaseBusy("another writer took the expired lease first") from None
                raise
        self.lease_etag, self.holder = r.get("ETag"), holder
        return doc

    def release(self) -> bool:
        """Delete the lease if it is still ours (never another writer's). True when released."""
        if not self.holder:
            return False
        try:
            cur = self.s3.get_object(Bucket=self.bucket, Key=self.key(LEASE))
            held = json.loads(cur["Body"].read() or b"{}")
        except Exception as e:                       # noqa: BLE001
            if _missing(e):
                self.holder = None
                return False
            raise
        if held.get("holder") != self.holder:
            self.holder = None
            return False
        self.s3.delete_object(Bucket=self.bucket, Key=self.key(LEASE))
        self.holder = self.lease_etag = None
        return True

    def assert_held(self) -> None:
        """Raise LeaseBusy unless the lease in R2 is still ours and unexpired."""
        cur = self.s3.get_object(Bucket=self.bucket, Key=self.key(LEASE))
        held = json.loads(cur["Body"].read() or b"{}")
        if held.get("holder") != self.holder or float(held.get("expires_at") or 0) <= self.now():
            raise LeaseBusy(f"the lease is no longer ours (held by {holder_kind(held.get('holder'))})")

    def renew(self, ttl_s: float) -> dict:
        """FAIL CLOSED before every step that writes the lake: extend OUR unexpired lease to now + ttl_s, or raise
        LeaseBusy. The PUT carries If-Match on the ETag just read, so a writer that took the lease over in between
        makes it fail (412). Works from another process of the same writer (publish.py): only the holder name is
        needed, never the ETag of the original take."""
        if not self.holder:
            raise LeaseBusy("no lease held")
        try:
            cur = self.s3.get_object(Bucket=self.bucket, Key=self.key(LEASE))
        except Exception as e:                       # noqa: BLE001
            if _missing(e):
                raise LeaseBusy("the lease is gone") from None
            raise
        held = json.loads(cur["Body"].read() or b"{}")
        if held.get("holder") != self.holder or float(held.get("expires_at") or 0) <= self.now():
            raise LeaseBusy(f"the lease is no longer ours (held by {holder_kind(held.get('holder'))})")
        doc = dict(held, expires_at=self.now() + ttl_s, renewed_at=self.now())
        try:
            r = self.s3.put_object(Bucket=self.bucket, Key=self.key(LEASE), Body=json.dumps(doc).encode(),
                                   ContentType="application/json", IfMatch=cur["ETag"])
        except Exception as e:                       # noqa: BLE001
            if _code(e) in ("PreconditionFailed", "412", "ConditionalRequestConflict", "409"):
                raise LeaseBusy("the lease changed hands while renewing") from None
            raise
        self.lease_etag = r.get("ETag")
        return doc

    # ── state documents ────────────────────────────────────────────────────────────────────────
    def get_json(self, name: str) -> Optional[dict]:
        try:
            return json.loads(self.s3.get_object(Bucket=self.bucket, Key=self.key(name))["Body"].read())
        except Exception as e:                       # noqa: BLE001
            if _missing(e):
                return None
            raise

    def put_json(self, name: str, doc: dict) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=self.key(name), Body=json.dumps(doc).encode(),
                           ContentType="application/json")

    # ── references: one source, hash-checked ───────────────────────────────────────────────────
    def put_ref(self, name: str, data: bytes, by: str) -> str:
        """Upload a reference file and record its sha256 in the manifest (file first, manifest last)."""
        sha = hashlib.sha256(data).hexdigest()
        man = self.get_json(REF) or {"files": {}}
        if (man.get("files") or {}).get(name, {}).get("sha256") == sha:
            return sha
        self.s3.put_object(Bucket=self.bucket, Key=self.key(name), Body=data, ContentType="application/octet-stream")
        man.setdefault("files", {})[name] = {"sha256": sha, "bytes": len(data), "by": by, "at": self.now()}
        self.put_json(REF, man)
        return sha

    def get_ref(self, name: str) -> bytes:
        """The reference file's bytes, refused unless their sha256 is the manifest's."""
        want = ((self.get_json(REF) or {}).get("files") or {}).get(name, {}).get("sha256")
        if not want:
            raise RefMismatch(f"{name} is not in the reference manifest")
        data = self.s3.get_object(Bucket=self.bucket, Key=self.key(name))["Body"].read()
        if hashlib.sha256(data).hexdigest() != want:
            raise RefMismatch(f"{name}: bytes in R2 are not the manifest's")
        return data
