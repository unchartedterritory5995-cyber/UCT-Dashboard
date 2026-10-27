"""Web's READ-ONLY view of the receiver's journal.

Restates the receiver's layout (``services/trade_exchange_news_receiver/
txn_journal.py``) on purpose rather than importing across the service boundary --
the receiver is its own image and must not depend on ``api``. The handoff test
writes with the receiver's code and reads with this one, so a drift fails there.

⛔ LEAST PRIVILEGE: web's R2 token for this bucket should be READ-ONLY (list +
get). Web never writes or deletes journal objects; retention is the bucket's
lifecycle rule (see the receiver README).
"""
from __future__ import annotations

import json
import os
from typing import Any, Iterator, Protocol

DEFAULT_PREFIX = "trade-exchange-news/v1/events"
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def cursor_for_ms(ms: int) -> str:
    n, out = max(0, int(ms)), []
    for _ in range(10):
        out.append(_CROCKFORD[n & 31])
        n >>= 5
    return "".join(reversed(out)) + "0" * 16


class JournalReader(Protocol):
    kind: str

    def ids_after(self, cursor_id: str) -> Iterator[str]: ...

    def get(self, event_id: str) -> Any: ...


class FileJournalReader:
    kind = "file"

    def __init__(self, root: str, prefix: str = DEFAULT_PREFIX) -> None:
        self.dir = os.path.join(root, *prefix.strip("/").split("/"))

    def ids_after(self, cursor_id: str) -> Iterator[str]:
        try:
            names = sorted(n[:-5] for n in os.listdir(self.dir)
                           if n.endswith(".json") and not n.startswith("."))
        except FileNotFoundError:
            return iter(())
        return iter([n for n in names if n > cursor_id])

    def get(self, event_id: str) -> Any:
        with open(os.path.join(self.dir, f"{event_id}.json"), "rb") as fh:
            return json.loads(fh.read().decode("utf-8"))


class S3JournalReader:
    kind = "s3"

    def __init__(self, client: Any, bucket: str, prefix: str = DEFAULT_PREFIX) -> None:
        self.client, self.bucket, self.prefix = client, bucket, prefix.rstrip("/")

    def ids_after(self, cursor_id: str) -> Iterator[str]:
        start = f"{self.prefix}/{cursor_id}"
        token = None
        while True:
            kw: dict[str, Any] = {"Bucket": self.bucket, "Prefix": self.prefix + "/", "MaxKeys": 1000}
            if token:
                kw["ContinuationToken"] = token
            else:
                kw["StartAfter"] = start
            page = self.client.list_objects_v2(**kw)
            for obj in page.get("Contents", []) or []:
                key = obj["Key"]
                if key.endswith(".json"):
                    yield key[len(self.prefix) + 1:-5]
            if not page.get("IsTruncated"):
                return
            token = page.get("NextContinuationToken")

    def get(self, event_id: str) -> Any:
        body = self.client.get_object(Bucket=self.bucket,
                                      Key=f"{self.prefix}/{event_id}.json")["Body"].read()
        return json.loads(body.decode("utf-8"))


def reader_from_env() -> JournalReader | None:
    """None when no journal is configured -- recovery is then OFF and says so."""
    kind = (os.environ.get("TXN_JOURNAL") or "").strip().lower()
    prefix = os.environ.get("TXN_JOURNAL_PREFIX") or DEFAULT_PREFIX
    if kind == "file" and os.environ.get("TXN_JOURNAL_DIR"):
        return FileJournalReader(os.environ["TXN_JOURNAL_DIR"], prefix)
    if kind == "s3":
        endpoint = os.environ.get("TXN_JOURNAL_ENDPOINT_URL")
        key_id = os.environ.get("TXN_JOURNAL_ACCESS_KEY_ID")
        secret = os.environ.get("TXN_JOURNAL_SECRET_ACCESS_KEY")
        bucket = os.environ.get("TXN_JOURNAL_BUCKET")
        if not (endpoint and key_id and secret and bucket):
            return None
        import boto3
        from botocore.config import Config
        common = dict(retries={"max_attempts": 3, "mode": "standard"},
                      connect_timeout=3, read_timeout=10)
        try:
            cfg = Config(request_checksum_calculation="when_required",
                         response_checksum_validation="when_required", **common)
        except TypeError:
            cfg = Config(**common)
        client = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=key_id,
                              aws_secret_access_key=secret,
                              region_name=os.environ.get("TXN_JOURNAL_REGION", "auto"), config=cfg)
        return S3JournalReader(client, bucket, prefix)
    return None
