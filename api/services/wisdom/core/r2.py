"""Immutable R2 writes under wisdom/ (docs/wisdom/CONTRACTS.md §2.4).

Uses the existing bucket client (api/services/data_sync._client, read-only
import; that module is not edited). Differences from data_sync.put_bytes, on
purpose:
  * failures RAISE instead of returning a silent False;
  * an existing key is never overwritten — same bytes is a no-op, different
    bytes raises R2ImmutableConflict;
  * existence is a direct head_object, never the 60 s cached object_exists.

There is deliberately no delete function in this module. Every existing pruner
in the four repos is prefix-scoped to a different namespace; none can reach
wisdom/.
"""
from __future__ import annotations

import logging
import os
import pathlib
import sys
from typing import Iterator, Optional

from api.services.wisdom.core import ids

log = logging.getLogger(__name__)

PREFIX = "wisdom/"


class R2Unavailable(RuntimeError):
    pass


class R2ImmutableConflict(RuntimeError):
    pass


class R2TestIsolation(RuntimeError):
    """A test reached for a real bucket. See ALLOW_REAL_CLIENT_UNDER_PYTEST."""


# ── Test isolation ───────────────────────────────────────────────────────────
# 2026-09-13: a sources-stream test run wrote 16 objects (2,399 bytes) into the
# PRODUCTION bucket under wisdom/sources/zoom_vtt/ before its hermetic fixture
# existed. The DATA_SYNC_* vars were already in the operator's shell, so the real
# client built itself and every write SUCCEEDED — the same class as the C:\data
# tripwire in the repo-root conftest: a test that reaches production data does
# not fail, it passes against live files.
#
# ⛔ The guard lives INSIDE _client_and_bucket() on purpose. Every hermetic test
# monkeypatches exactly this function (see the autouse fixtures in the wisdom
# sources suites), so the guard is UNREACHABLE for a test that has isolated
# itself and fires only for one that has not.
#
# ⛔ Not an env var, and not "delete DATA_SYNC_* in a fixture". A kill switch
# nobody sets is indistinguishable from a working one, and the leaking run was
# in a shell that already had those vars. The opt-in is a module attribute a
# test must monkeypatch deliberately —
#     monkeypatch.setattr(r2, "ALLOW_REAL_CLIENT_UNDER_PYTEST", True)
# — which leaves one reviewable line in the test that wants a real bucket.
#
# ⚠️ Scope, stated so nobody reads it as more than it is: this is a PYTEST rail.
# A bare `python tools/...` run still reaches the live bucket, exactly as the
# conftest tripwire is a test-suite rail only.
ALLOW_REAL_CLIENT_UNDER_PYTEST = False


def _under_pytest() -> bool:
    """True only inside a pytest run — never on the web pod.

    Both markers are chosen because the pod cannot have them. ⛔ `"pytest" in
    sys.modules` is NOT usable here: pytest is a production dependency
    (requirements.txt) and api/ carries *_test.py modules, so importing one on
    the pod would arm the guard against real writes.
    """
    if os.environ.get("PYTEST_CURRENT_TEST"):  # set per test: setup, call, teardown
        return True
    # Collection and fixture-import time, before that var is set. Both pytest
    # entry points are named in the LAST TWO path components of argv[0] —
    # `bin/pytest` for the console script and `pytest/__main__.py` for
    # `python -m pytest`, whose basename alone is just `__main__.py`. The pod's
    # `bin/uvicorn` and `bin/python` match neither.
    argv0 = pathlib.PurePath((sys.argv[0] if sys.argv else "") or "")
    return "pytest" in "/".join(argv0.parts[-2:]).lower()


def _client_and_bucket():
    if _under_pytest() and not ALLOW_REAL_CLIENT_UNDER_PYTEST:
        raise R2TestIsolation(
            "refusing to build a real R2 client under pytest: monkeypatch "
            "api.services.wisdom.core.r2._client_and_bucket with a fake bucket, or set "
            "r2.ALLOW_REAL_CLIENT_UNDER_PYTEST = True if this test genuinely wants production"
        )
    from api.services import data_sync

    client = data_sync._client()
    bucket = data_sync._bucket()
    if client is None or not bucket:
        raise R2Unavailable("R2 client or bucket is not configured (DATA_SYNC_* env)")
    return client, bucket


def _check_key(key: str) -> None:
    if not isinstance(key, str) or not key.startswith(PREFIX) or ".." in key or "//" in key:
        raise ValueError(f"Wisdom R2 keys must live under {PREFIX!r}: {key!r}")


def _is_missing(exc: Exception) -> bool:
    response = getattr(exc, "response", None) or {}
    code = str((response.get("Error") or {}).get("Code", ""))
    return code in ("404", "NoSuchKey", "NotFound")


def put_immutable(key: str, data: bytes, content_type: str) -> dict:
    _check_key(key)
    digest = ids.sha256_bytes(data)
    client, bucket = _client_and_bucket()
    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if not _is_missing(exc):
            raise
        head = None
    if head is not None:
        existing = (head.get("Metadata") or {}).get("sha256")
        if existing == digest:
            return {"key": key, "sha256": digest, "bytes": len(data), "created": False}
        raise R2ImmutableConflict(f"{key} already exists with different content")
    try:
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type,
                          Metadata={"sha256": digest})
    except Exception:
        log.exception("[wisdom] R2 put failed for %s", key)
        raise
    return {"key": key, "sha256": digest, "bytes": len(data), "created": True}


STAGING_PREFIX = PREFIX + "staging/"


class R2VerificationFailed(RuntimeError):
    """The stored object did not read back as what we wrote. The canonical key is untouched."""


def put_verified(key: str, data: bytes, content_type: str) -> dict:
    """Write a canonical key ONLY via a staging key and a verified copy (CONTRACTS §8c.1.3).

    Owner ruling, checkpoint 3. `put_immutable` writes the canonical key directly, so a caller
    that computed an empty or truncated payload burns that payload into a key which, by this
    module's design, **can never be deleted or rewritten**. S-A hit exactly that: a capture run
    for a past date returned zero rows and wrote an empty object to
    `wisdom/context/<date>/<dataset>.json.gz`; the later genuine backfill was then exiled to a
    sha-suffixed key, leaving the empty capture as the canonical one permanently.

    The order is the point:
      1. REFUSE an empty payload outright — nothing empty is ever worth a canonical key.
      2. Write to `wisdom/staging/<sha>/…`, which is disposable by convention.
      3. Verify the staged object: it exists, its length matches, its sha256 metadata matches.
      4. Only then copy staging → canonical, under the same never-overwrite rule as put_immutable.
      5. Verify the canonical object the same way, and report `verified: True`.

    ⛔ The caller advances a watermark ONLY on `verified is True`. A result that did not verify
    means the capture did not happen, whatever the run row says.

    ⚠️ The staging object is LEFT IN PLACE. `core/r2.py` has no delete function by design (every
    pruner in the repo is prefix-scoped elsewhere and none can reach `wisdom/`), so a true "move"
    is not available and is not worth adding a delete path for. Staging keys are sha-addressed, so
    a repeat writes the same key rather than accumulating.
    """
    _check_key(key)
    if not data:
        raise R2VerificationFailed(
            f"refusing to write an EMPTY payload to the canonical key {key!r}; this module has no "
            f"delete path, so an empty object here would be permanent")
    digest = ids.sha256_bytes(data)
    staging_key = f"{STAGING_PREFIX}{digest}/{key[len(PREFIX):]}"
    _check_key(staging_key)
    client, bucket = _client_and_bucket()

    staged = put_immutable(staging_key, data, content_type)
    _verify(client, bucket, staging_key, digest, len(data))

    existing = _head_or_none(client, bucket, key)
    if existing is not None:
        if (existing.get("Metadata") or {}).get("sha256") == digest:
            return {"key": key, "staging_key": staging_key, "sha256": digest,
                    "bytes": len(data), "created": False, "verified": True}
        raise R2ImmutableConflict(f"{key} already exists with different content")
    try:
        client.copy_object(Bucket=bucket, Key=key,
                           CopySource={"Bucket": bucket, "Key": staging_key})
    except Exception:
        log.exception("[wisdom] R2 staged copy failed for %s -> %s", staging_key, key)
        raise
    _verify(client, bucket, key, digest, len(data))
    return {"key": key, "staging_key": staging_key, "sha256": digest, "bytes": len(data),
            "created": True, "verified": True, "staged_created": staged.get("created")}


def _head_or_none(client, bucket, key):
    try:
        return client.head_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if _is_missing(exc):
            return None
        raise


def _verify(client, bucket, key: str, digest: str, length: int) -> None:
    head = _head_or_none(client, bucket, key)
    if head is None:
        raise R2VerificationFailed(f"{key} is not readable back after writing it")
    stored_len = head.get("ContentLength")
    if stored_len is not None and int(stored_len) != int(length):
        raise R2VerificationFailed(f"{key} read back {stored_len} bytes, wrote {length}")
    stored_sha = (head.get("Metadata") or {}).get("sha256")
    # ⛔ An ABSENT checksum is a failure, not a pass. "We could not check" and "it matched" are
    # different facts, and only one of them may advance a watermark.
    if stored_sha != digest:
        raise R2VerificationFailed(
            f"{key} checksum {stored_sha!r} does not match the payload {digest!r}")


def get(key: str) -> Optional[bytes]:
    _check_key(key)
    client, bucket = _client_and_bucket()
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if _is_missing(exc):
            return None
        raise
    return obj["Body"].read()


def list_prefix(prefix: str) -> Iterator[dict]:
    _check_key(prefix)
    client, bucket = _client_and_bucket()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []) or []:
            yield {"key": item["Key"], "bytes": item.get("Size"), "last_modified": item.get("LastModified")}
