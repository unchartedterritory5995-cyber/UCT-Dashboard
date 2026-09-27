"""⛔ THE OFF-SITE TOMBSTONE PUT IS BOUNDED — it rides the admin-delete request path.

Wave 10, lane 10C, fix round 1 item 3. `record_tombstone` puts one object in the backups'
bucket while the admin's DELETE request waits. Through `data_sync._client()` that put had
the SDK's defaults (60 s reads, several retries): one hung bucket pinned a threadpool
worker for minutes (CLAUDE.md: "any NEW blocking external call on the request path MUST
have a timeout"). The put now uses its own bounded client, and the shared client is
untouched for every other caller.

  * the client the store uses CARRIES the bound (read off the client's own config);
  * the shared `data_sync._client()` is unchanged (its reads keep the SDK default);
  * the bounded client reads exactly the environment `data_sync._client()` reads;
  * against a REAL server that accepts and never answers, the deletion's tombstone call
    returns inside the bound, recorded and PENDING -- never a raise, never a hang.
⛔ Every case points the client at 127.0.0.1 with dummy keys: DATA_SYNC_* is set on the
owner's machine, and nothing here may reach the real bucket.
"""
from __future__ import annotations

import ast
import socket
import sqlite3
import threading
import time
from pathlib import Path

import pytest

from api.services import account_tombstones as at

REPO = Path(__file__).resolve().parents[1]
BOUND_S = at.PUT_TOTAL_ATTEMPTS * (at.PUT_CONNECT_TIMEOUT_S + at.PUT_READ_TIMEOUT_S)


class _Hangs:
    """A TCP server that accepts every connection and never sends a byte."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        self.accepted = 0
        self._held = []
        self._stop = False
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        self.sock.settimeout(0.2)
        while not self._stop:
            try:
                c, _ = self.sock.accept()
                self.accepted += 1
                self._held.append(c)          # held open, never answered
            except OSError:
                continue

    def close(self):
        self._stop = True
        for c in self._held:
            c.close()
        self.sock.close()


@pytest.fixture
def local_bucket_env(monkeypatch):
    server = _Hangs()
    monkeypatch.delenv(at.LOCAL_STORE_ENV, raising=False)
    monkeypatch.setenv("AUTHDB_BACKUP_ENABLED", "1")
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", f"http://127.0.0.1:{server.port}")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "rail-dummy")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "rail-dummy")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "rail-bucket")
    monkeypatch.setenv("DATA_SYNC_REGION", "auto")
    yield server
    server.close()


def test_the_store_the_deletion_uses_carries_the_bound(local_bucket_env):
    st = at.default_store()
    assert isinstance(st, at.R2ObjectStore), "the armed store is not the R2 store"
    cfg = st.client.meta.config
    assert cfg.connect_timeout == at.PUT_CONNECT_TIMEOUT_S
    assert cfg.read_timeout == at.PUT_READ_TIMEOUT_S
    assert cfg.retries.get("total_max_attempts") == at.PUT_TOTAL_ATTEMPTS
    assert str(local_bucket_env.port) in st.client.meta.endpoint_url   # never the real bucket


def test_the_shared_data_sync_client_is_left_as_other_callers_rely_on_it(local_bucket_env):
    from api.services import data_sync
    shared = data_sync._client()
    assert shared is not None
    assert shared.meta.config.read_timeout == 60, (
        "the shared client's behaviour changed -- the bound belongs to the tombstone put alone")


def test_the_bounded_client_reads_exactly_data_syncs_environment():
    tree = ast.parse((REPO / "api" / "services" / "data_sync.py").read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_client")
    names = sorted({a.value for n in ast.walk(fn) if isinstance(n, ast.Call)
                    for a in n.args[:1] if isinstance(a, ast.Constant) and isinstance(a.value, str)
                    and a.value.startswith("DATA_SYNC_")})
    assert len(names) >= 3, f"the walk of data_sync._client found almost nothing: {names}"
    assert names == sorted(at._DATA_SYNC_ENV)


def test_a_hung_bucket_leaves_the_tombstone_pending_inside_the_bound(local_bucket_env, tmp_path):
    db = tmp_path / "auth.db"
    out: dict = {}

    def run():
        c = sqlite3.connect(str(db))
        try:
            t0 = time.monotonic()
            out["answer"] = at.record_tombstone("u-hung-5555", c)
            out["elapsed"] = time.monotonic() - t0
        finally:
            c.close()
    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(BOUND_S + 8)
    assert not th.is_alive(), (
        f"⛔ the tombstone put was still blocked after {BOUND_S + 8}s -- a hung bucket pins the "
        f"admin's request (the bound is ~{BOUND_S}s)")
    assert local_bucket_env.accepted >= 1, "the put never reached the hanging server -- not exercised"
    ans = out["answer"]
    assert ans["recorded"] is True and ans["offsite"] is False, ans
    assert "pending" in ans["why"]
    c = sqlite3.connect(str(db))
    try:
        assert c.execute(f"SELECT offsite_at FROM {at.TABLE} WHERE user_id = ?",
                         ("u-hung-5555",)).fetchone() == (None,)
    finally:
        c.close()
