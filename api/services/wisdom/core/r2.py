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
from typing import Iterator, Optional

from api.services.wisdom.core import ids

log = logging.getLogger(__name__)

PREFIX = "wisdom/"


class R2Unavailable(RuntimeError):
    pass


class R2ImmutableConflict(RuntimeError):
    pass


def _client_and_bucket():
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
