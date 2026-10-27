"""Shared fakes for the Trade Exchange News tests (synthetic data only).

* ``load_receiver()`` -- puts ``services/trade_exchange_news_receiver`` on
  sys.path and returns its modules (they import each other flat, as they do in
  their own image).
* ``FakeS3`` -- the four S3 calls the journal uses, with R2's semantics that
  matter here: strongly consistent, lexicographic LIST, StartAfter, pages.

⛔ Every headline in these tests is SYNTHETIC. No real Trade Exchange content,
no real market values.
"""
from __future__ import annotations

import importlib
import io
import pathlib
import sys
import threading
from typing import Any

REPO = pathlib.Path(__file__).resolve().parents[2]
RECEIVER_DIR = REPO / "services" / "trade_exchange_news_receiver"
RECEIVER_MODULES = ("txn_journal", "txn_receiver", "txn_forwarder", "txn_redaction", "txn_app",
                    "txn_serve")


def load_receiver() -> dict[str, Any]:
    here = str(RECEIVER_DIR)
    if here not in sys.path:
        sys.path.insert(0, here)
    return {name: importlib.import_module(name) for name in RECEIVER_MODULES}


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.fail_put = False
        self.put_delay_s = 0.0
        self.calls: list[str] = []
        self._lock = threading.Lock()

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str = "") -> dict:
        self.calls.append("put")
        if self.put_delay_s:
            import time
            time.sleep(self.put_delay_s)
        if self.fail_put:
            raise ConnectionError("simulated R2 outage https://acct.r2.example/secret-ish")
        with self._lock:
            self.objects[(Bucket, Key)] = bytes(Body)
        return {"ETag": "x"}

    def list_objects_v2(self, *, Bucket: str, Prefix: str = "", MaxKeys: int = 1000,
                        StartAfter: str = "", ContinuationToken: str | None = None) -> dict:
        self.calls.append("list")
        after = ContinuationToken or StartAfter
        with self._lock:
            keys = sorted(k for (b, k) in self.objects if b == Bucket and k.startswith(Prefix)
                          and k > after)
        page = keys[:MaxKeys]
        out: dict[str, Any] = {"Contents": [{"Key": k} for k in page],
                               "IsTruncated": len(keys) > MaxKeys}
        if out["IsTruncated"]:
            out["NextContinuationToken"] = page[-1]
        return out

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        self.calls.append("get")
        with self._lock:
            return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}
