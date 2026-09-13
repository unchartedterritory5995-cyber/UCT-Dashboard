"""The R2 layout and encoding of the D12 archive (docs/wisdom/CONTRACTS.md §6.1).

KEYS
    wisdom/context/<as_of YYYY-MM-DD>/<dataset>.json.gz            one object
    wisdom/context/<as_of>/<dataset>-NNN.json.gz                   shard N of a streamed dataset
    wisdom/context/<as_of>/<dataset>.<sha256[:12]>.json.gz         a DIFFERENT capture of an as_of already written

Objects are immutable (core.r2.put_immutable refuses an overwrite). The same
bytes for the same key is a no-op (``created: False``); different bytes for a key
that already exists go to the content-suffixed key, which is itself
immutable and idempotent. A source that legitimately changes within one as_of
(tweets through a day, a screener re-build) therefore keeps every version and
never overwrites one.

ENCODING
    Canonical JSON (sorted keys, compact separators, UTF-8) inside gzip with
    mtime=0 and no filename, so identical content is identical bytes and its
    sha256 is stable across runs, pods and days. ``captured_at`` is deliberately
    NOT inside the object — it would make every re-run a new version; the run
    row in wisdom_capture_runs carries it.
"""
from __future__ import annotations

import gzip
import io
import json
import re
from typing import Any, Callable, Optional

from api.services.wisdom.core import ids, r2

PREFIX = "wisdom/context/"
SCHEMA = "wisdom.capture.v1"
CONTENT_TYPE = "application/gzip"

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATASET = re.compile(r"^[a-z][a-z0-9_]*$")


def object_key(as_of: str, dataset: str, *, shard: Optional[int] = None, sha: Optional[str] = None) -> str:
    if not isinstance(as_of, str) or not _DATE.match(as_of):
        raise ValueError(f"as_of must be YYYY-MM-DD, got {as_of!r}")
    if not isinstance(dataset, str) or not _DATASET.match(dataset):
        raise ValueError(f"dataset must match {_DATASET.pattern}, got {dataset!r}")
    stem = dataset if shard is None else f"{dataset}-{int(shard):03d}"
    if sha:
        stem = f"{stem}.{sha[:12]}"
    return f"{PREFIX}{as_of}/{stem}.json.gz"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=str).encode("utf-8")


def _gzip(raw: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=buf, mode="wb", mtime=0) as fh:
        fh.write(raw)
    return buf.getvalue()


def encode(obj: Any) -> bytes:
    return _gzip(canonical_json(obj))


def decode(data: bytes) -> Any:
    return json.loads(gzip.decompress(data).decode("utf-8"))


def content_sha256(value: Any) -> str:
    return ids.sha256_bytes(canonical_json(value))


class StreamedObject:
    """Build ``{<header…>, "payload": [row, row, …]}`` straight into gzip, one row
    at a time, so a large dataset is never materialised in memory. Output is
    byte-identical for identical header + rows."""

    def __init__(self, header: dict):
        self._buf = io.BytesIO()
        self._gz = gzip.GzipFile(filename="", fileobj=self._buf, mode="wb", mtime=0)
        head = canonical_json(header)
        if not head.endswith(b"}"):
            raise ValueError("header must be a JSON object")
        prefix = head[:-1] + (b',"payload":[' if len(head) > 2 else b'"payload":[')
        self._gz.write(prefix)
        self.rows = 0

    def add(self, row: Any) -> None:
        if self.rows:
            self._gz.write(b",")
        self._gz.write(canonical_json(row))
        self.rows += 1

    def finish(self, trailer: Optional[dict] = None) -> bytes:
        """Close the payload array, then append ``trailer`` keys (sorted) — for the
        facts only known after the last row, such as the row count."""
        self._gz.write(b"]")
        for key in sorted(trailer or {}):
            self._gz.write(b"," + canonical_json(str(key)) + b":" + canonical_json(trailer[key]))
        self._gz.write(b"}")
        self._gz.close()
        return self._buf.getvalue()


def put_versioned(key_for: Callable[[Optional[str]], str], data: bytes, *, dry_run: bool = False,
                  putter: Optional[Callable[[str, bytes, str], dict]] = None) -> dict:
    """Write ``data`` immutably at ``key_for(None)``; a different capture already
    there sends it to ``key_for(sha256)``. Dry run computes and writes nothing.

    ⛔ The default putter is ``r2.put_verified``, never ``put_immutable`` (CONTRACTS
    §8c.1.3): a canonical key is written via a staging key and a verified copy, so a
    truncated or unreadable object never becomes the permanent one — this module's
    bucket has no delete path. The result carries ``verified``, and ``runner._record``
    advances a watermark on nothing else."""
    sha = ids.sha256_bytes(data)
    primary = key_for(None)
    if dry_run:
        return {"key": primary, "sha256": sha, "bytes": len(data), "created": False, "dry_run": True}
    put = putter or r2.put_verified
    try:
        out = dict(put(primary, data, CONTENT_TYPE))
        out["versioned"] = False
    except r2.R2ImmutableConflict:
        out = dict(put(key_for(sha), data, CONTENT_TYPE))
        out["versioned"] = True
    return out
