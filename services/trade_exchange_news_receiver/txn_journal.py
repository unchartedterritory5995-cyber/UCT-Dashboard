"""The durable journal: every accepted Trade Exchange delivery, one object each.

⭐ WHY AN OBJECT STORE AND NOT A VOLUME. A Railway volume mounts to exactly one
service and makes that service un-overlappable on deploy (docs/runbooks/
deploy-windows.md: web's 82-119 s dead window is the volume's). This receiver
exists to stay up while web deploys, so it must not trade web's gap for its own.
With the journal in R2 (S3 API, the vendor UCT already uses for flow and
Notebook backups) the receiver holds NO state: Railway overlaps its deploys, a
restart loses nothing, and web recovers anything it missed by listing the
journal after its own cursor.

⛔ THE KEY IS THE ORDER. ``<prefix>/<event_id>.json`` where the event id is a
ULID (48-bit receipt-ms + 80 random bits, Crockford base32), so a lexicographic
LIST is a receipt-time scan and ``StartAfter`` is a cursor. Web's reader
(``api/services/trade_exchange_news/journal_reader.py``) restates the layout;
``tests/test_trade_exchange_news_handoff.py`` pins the two together.

Three backends behind one two-method surface (``put`` / ``describe``):
  * ``S3Journal``   -- production (R2). Durable before the webhook is answered.
  * ``FileJournal`` -- local development and tests. fsync'd, so a restart test
                       against the same directory is a real restart test.
  * ``MemoryJournal`` -- tests only. ``durable`` is False, and the receiver
                       refuses to call itself ready on Railway with a journal
                       that is not durable.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
import time
from typing import Any, Protocol

DEFAULT_PREFIX = "trade-exchange-news/v1/events"

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
EVENT_ID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

_id_lock = threading.Lock()
_last_ms = -1
_last_rand = 0


def _b32(n: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(_CROCKFORD[n & 31])
        n >>= 5
    return "".join(reversed(out))


def new_event_id(now_ms: int | None = None) -> str:
    """A ULID. Monotonic within this process: two receipts in one millisecond
    still sort in arrival order (the random half is incremented, not redrawn)."""
    global _last_ms, _last_rand
    ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
    with _id_lock:
        if ms <= _last_ms:
            ms = _last_ms
            _last_rand = (_last_rand + 1) & ((1 << 80) - 1)
        else:
            _last_ms = ms
            _last_rand = secrets.randbits(80)
        rand = _last_rand
    return _b32(ms, 10) + _b32(rand, 16)


def event_id_ms(event_id: str) -> int:
    """The receipt millisecond encoded in an event id."""
    n = 0
    for ch in event_id[:10]:
        n = (n << 5) | _CROCKFORD.index(ch)
    return n


def cursor_for_ms(ms: int) -> str:
    """The smallest possible event id at ``ms`` -- a ``StartAfter`` bound that
    includes every id from that millisecond on."""
    return _b32(max(0, int(ms)), 10) + "0" * 16


def object_key(prefix: str, event_id: str) -> str:
    return f"{prefix.rstrip('/')}/{event_id}.json"


def encode(record: dict[str, Any]) -> bytes:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"),
                      sort_keys=True).encode("utf-8")


class Journal(Protocol):
    kind: str
    durable: bool

    def put(self, record: dict[str, Any]) -> None: ...

    def describe(self) -> dict[str, Any]: ...


class JournalError(RuntimeError):
    """The record was NOT made durable. The webhook must not be acknowledged."""


class MemoryJournal:
    kind = "memory"
    durable = False

    def __init__(self, prefix: str = DEFAULT_PREFIX) -> None:
        self.prefix = prefix
        self.objects: dict[str, bytes] = {}
        self.fail = False
        self._lock = threading.Lock()

    def put(self, record: dict[str, Any]) -> None:
        if self.fail:
            raise JournalError("memory journal set to fail")
        with self._lock:
            self.objects[object_key(self.prefix, record["id"])] = encode(record)

    def describe(self) -> dict[str, Any]:
        return {"kind": self.kind, "durable": self.durable, "objects": len(self.objects)}


class FileJournal:
    """One file per record under ``root/<prefix>/``, written atomically
    (temp file, fsync, rename) so a crash leaves the old state or the new one."""

    kind = "file"
    durable = True

    def __init__(self, root: str, prefix: str = DEFAULT_PREFIX) -> None:
        self.root = root
        self.prefix = prefix
        self.dir = os.path.join(root, *prefix.strip("/").split("/"))
        os.makedirs(self.dir, exist_ok=True)

    def put(self, record: dict[str, Any]) -> None:
        final = os.path.join(self.dir, f"{record['id']}.json")
        try:
            fd, tmp = tempfile.mkstemp(dir=self.dir, prefix=".tmp-", suffix=".json")
            with os.fdopen(fd, "wb") as fh:
                fh.write(encode(record))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, final)
        except OSError as e:
            raise JournalError(f"file journal write failed: {type(e).__name__}") from e

    def describe(self) -> dict[str, Any]:
        return {"kind": self.kind, "durable": self.durable}


class S3Journal:
    """R2 through the S3 API. ``put`` returns only once R2 has acknowledged the
    write -- R2 PUTs are strongly consistent, so a LIST issued after the ack
    sees the object (the property web's recovery scan depends on)."""

    kind = "s3"
    durable = True

    def __init__(self, client: Any, bucket: str, prefix: str = DEFAULT_PREFIX) -> None:
        self.client = client
        self.bucket = bucket
        self.prefix = prefix

    def put(self, record: dict[str, Any]) -> None:
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=object_key(self.prefix, record["id"]),
                Body=encode(record),
                ContentType="application/json",
            )
        except Exception as e:  # noqa: BLE001 -- any failure means "not durable"
            # ⛔ The exception TYPE only. botocore messages can carry the
            # endpoint and request ids; nothing here may carry a credential.
            raise JournalError(f"journal put failed: {type(e).__name__}") from e

    def describe(self) -> dict[str, Any]:
        return {"kind": self.kind, "durable": self.durable, "bucket_set": bool(self.bucket)}


def s3_client_from_env(env: dict[str, str]) -> Any | None:
    """The boto3 client for R2, or None when any credential is missing.

    Same R2 specifics as ``api/flow_backup.py::_r2_client`` (checksums relaxed
    to ``when_required``, which R2 needs), but its OWN variables: the journal
    gets a token scoped to one bucket, never the shared DATA_SYNC_* backup
    credential. Short timeouts: a stalled PUT must turn into a 503 the sender
    can retry, inside the sender's own timeout.
    """
    endpoint = env.get("TXN_JOURNAL_ENDPOINT_URL", "")
    key_id = env.get("TXN_JOURNAL_ACCESS_KEY_ID", "")
    secret = env.get("TXN_JOURNAL_SECRET_ACCESS_KEY", "")
    if not (endpoint and key_id and secret):
        return None
    import boto3
    from botocore.config import Config

    common = dict(retries={"max_attempts": 2, "mode": "standard"},
                  connect_timeout=2, read_timeout=3,
                  max_pool_connections=8)
    try:
        config = Config(request_checksum_calculation="when_required",
                        response_checksum_validation="when_required", **common)
    except TypeError:
        config = Config(**common)
    return boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=key_id,
                        aws_secret_access_key=secret,
                        region_name=env.get("TXN_JOURNAL_REGION", "auto"),
                        config=config)


def journal_from_env(env: dict[str, str]) -> Journal:
    kind = (env.get("TXN_JOURNAL") or "").strip().lower()
    prefix = env.get("TXN_JOURNAL_PREFIX") or DEFAULT_PREFIX
    if kind == "s3":
        client = s3_client_from_env(env)
        bucket = env.get("TXN_JOURNAL_BUCKET", "")
        if client is None or not bucket:
            raise RuntimeError("TXN_JOURNAL=s3 but the TXN_JOURNAL_* credentials or bucket are unset")
        return S3Journal(client, bucket, prefix)
    if kind == "file":
        root = env.get("TXN_JOURNAL_DIR") or os.path.join(tempfile.gettempdir(), "txn-journal")
        return FileJournal(root, prefix)
    if kind in ("", "memory"):
        return MemoryJournal(prefix)
    raise RuntimeError(f"unknown TXN_JOURNAL={kind!r} (s3 | file | memory)")
