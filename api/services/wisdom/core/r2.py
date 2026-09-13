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
